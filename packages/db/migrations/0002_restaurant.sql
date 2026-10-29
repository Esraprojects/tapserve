-- Phase 1 restaurant: menu, floor plan, orders, kitchen, bills, payments, shifts.
-- Money columns are bigint santim. Every table is tenant-scoped with forced RLS.

alter table sessions add column active_branch_id uuid;

-- Kitchen and bar staff work the kitchen display without being able to take orders.
insert into permissions (key) values ('kitchen.manage') on conflict do nothing;

-- Menu ---------------------------------------------------------------------------

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name_am text not null default '',
  name_en text not null default '',
  -- Where items in this category are prepared; kitchen tickets and the KDS route by it.
  station text not null default 'kitchen' check (station in ('kitchen', 'bar', 'barista')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (name_am <> '' or name_en <> '')
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  category_id uuid not null,
  name_am text not null default '',
  name_en text not null default '',
  description text not null default '',
  photo_url text,
  is_fasting boolean not null default false,
  is_available boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references menu_categories (tenant_id, id) on delete cascade,
  check (name_am <> '' or name_en <> '')
);
create trigger menu_items_touch before update on menu_items for each row execute function touch_updated_at();

-- Every item has at least one variant; a single-size item has one variant with empty names.
create table menu_item_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  item_id uuid not null,
  name_am text not null default '',
  name_en text not null default '',
  price_santim bigint not null check (price_santim >= 0),
  sort int not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references menu_items (tenant_id, id) on delete cascade
);

-- Optional per-branch price that overrides the variant's default price.
create table branch_prices (
  tenant_id uuid not null default current_tenant_id(),
  variant_id uuid not null,
  branch_id uuid not null,
  price_santim bigint not null check (price_santim >= 0),
  primary key (variant_id, branch_id),
  foreign key (tenant_id, variant_id) references menu_item_variants (tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade
);

create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name_am text not null default '',
  name_en text not null default '',
  min_select int not null default 0,
  max_select int not null default 1,
  unique (tenant_id, id)
);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  group_id uuid not null,
  name_am text not null default '',
  name_en text not null default '',
  price_delta_santim bigint not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, group_id) references modifier_groups (tenant_id, id) on delete cascade
);

create table item_modifier_groups (
  tenant_id uuid not null default current_tenant_id(),
  item_id uuid not null,
  group_id uuid not null,
  primary key (item_id, group_id),
  foreign key (tenant_id, item_id) references menu_items (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_id) references modifier_groups (tenant_id, id) on delete cascade
);

-- Floor plan -----------------------------------------------------------------------

create table floor_areas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  sort int not null default 0,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade
);

-- Live status (free / occupied / waiting for bill) is derived from open orders, never stored.
create table dining_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  area_id uuid,
  name text not null,
  seats int not null default 4 check (seats > 0),
  is_active boolean not null default true,
  sort int not null default 0,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, name),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade,
  foreign key (tenant_id, area_id) references floor_areas (tenant_id, id) on delete set null (area_id)
);

-- Shifts and cash control ------------------------------------------------------------

create table shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  cashier_user_id uuid not null references users (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_float_santim bigint not null default 0 check (opening_float_santim >= 0),
  expected_cash_santim bigint,
  counted_cash_santim bigint,
  variance_santim bigint,
  note text not null default '',
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id)
);
-- A cashier has at most one open shift per branch.
create unique index shifts_one_open on shifts (tenant_id, branch_id, cashier_user_id) where closed_at is null;

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  shift_id uuid not null,
  kind text not null check (kind in ('pay_in', 'pay_out')),
  amount_santim bigint not null check (amount_santim > 0),
  reason text not null,
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, shift_id) references shifts (tenant_id, id)
);

-- Orders -------------------------------------------------------------------------------

create table branch_counters (
  tenant_id uuid not null default current_tenant_id(),
  branch_id uuid not null,
  kind text not null check (kind in ('order', 'receipt')),
  next_value bigint not null default 1,
  primary key (branch_id, kind),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade
);

-- Gap-free per-branch numbers for orders and receipts (row lock serialises concurrent callers).
create or replace function next_branch_number(p_branch uuid, p_kind text) returns bigint
language plpgsql as $$
declare
  v bigint;
begin
  insert into branch_counters (branch_id, kind) values (p_branch, p_kind)
  on conflict (branch_id, kind) do nothing;
  update branch_counters set next_value = next_value + 1
  where branch_id = p_branch and kind = p_kind
  returning next_value - 1 into v;
  return v;
end
$$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  order_no bigint not null,
  type text not null check (type in ('dine_in', 'takeaway', 'delivery')),
  table_id uuid,
  waiter_user_id uuid references users (id),
  guest_count int,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  bill_requested_at timestamptz,
  note text not null default '',
  -- Generated on the device, so a retried or offline-synced order is never created twice.
  client_uuid uuid,
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  unique (branch_id, order_no),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, table_id) references dining_tables (tenant_id, id),
  check (type <> 'dine_in' or table_id is not null)
);
create index orders_open_idx on orders (tenant_id, branch_id) where status = 'open';
create index orders_created_idx on orders (tenant_id, created_at);
-- One open order per table.
create unique index orders_one_open_per_table on orders (table_id) where status = 'open' and table_id is not null;

create table order_items (
  id uuid primary key default gen_random_uuid(),
  -- Rows inserted in one transaction share created_at; seq keeps their entry order stable.
  seq bigint generated always as identity,
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  order_id uuid not null,
  variant_id uuid,
  item_id uuid,
  -- Names and price are copied at order time so later menu edits never change past orders.
  name_am text not null,
  name_en text not null,
  variant_name text not null default '',
  modifiers_text text not null default '',
  unit_price_santim bigint not null check (unit_price_santim >= 0),
  quantity int not null check (quantity > 0),
  discount_santim bigint not null default 0 check (discount_santim >= 0),
  notes text not null default '',
  station text not null check (station in ('kitchen', 'bar', 'barista')),
  status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'served', 'voided')),
  void_reason text,
  voided_by uuid references users (id),
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id) on delete cascade,
  check (discount_santim <= unit_price_santim * quantity)
);
create index order_items_order_idx on order_items (order_id);
create index order_items_kds_idx on order_items (tenant_id, station, status) where status in ('new', 'preparing', 'ready');
create trigger order_items_touch before update on order_items for each row execute function touch_updated_at();

-- Bills and payments -------------------------------------------------------------------

create table bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid not null,
  receipt_no bigint not null,
  subtotal_santim bigint not null,
  service_charge_santim bigint not null,
  tax_santim bigint not null,
  total_santim bigint not null,
  tax_type text not null,
  tax_rate_bp int not null,
  service_charge_rate_bp int not null,
  prices_include_tax boolean not null,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (tenant_id, id),
  unique (branch_id, receipt_no),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id)
);
create index bills_paid_idx on bills (tenant_id, paid_at) where status = 'paid';

-- Which order items are on which bill (split bills put different items on different bills).
create table bill_items (
  tenant_id uuid not null default current_tenant_id(),
  bill_id uuid not null,
  order_item_id uuid not null,
  primary key (bill_id, order_item_id),
  foreign key (tenant_id, bill_id) references bills (tenant_id, id) on delete cascade,
  foreign key (tenant_id, order_item_id) references order_items (tenant_id, id)
);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  code text not null,
  name_am text not null,
  name_en text not null,
  kind text not null check (kind in ('cash', 'mobile_money', 'bank_transfer', 'card', 'house_account')),
  enabled boolean not null default true,
  sort int not null default 0,
  unique (tenant_id, code),
  unique (tenant_id, id)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  bill_id uuid not null,
  method_id uuid not null,
  amount_santim bigint not null check (amount_santim > 0),
  reference text not null default '',
  shift_id uuid,
  -- Interface for a future Chapa / Telebirr integration; null while payments are only recorded.
  provider_txn_id text,
  received_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, bill_id) references bills (tenant_id, id),
  foreign key (tenant_id, method_id) references payment_methods (tenant_id, id),
  foreign key (tenant_id, shift_id) references shifts (tenant_id, id)
);
create index payments_bill_idx on payments (bill_id);
create index payments_shift_idx on payments (shift_id);

-- Row-level security -------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'menu_categories', 'menu_items', 'menu_item_variants', 'branch_prices', 'modifier_groups',
    'modifiers', 'item_modifier_groups', 'floor_areas', 'dining_tables', 'shifts', 'cash_movements',
    'branch_counters', 'orders', 'order_items', 'bills', 'bill_items', 'payment_methods', 'payments'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
    execute format('grant select, insert, update, delete on %I to tapserve_app', t);
  end loop;
end
$$;

-- Payments are a money record: the app may add them but never edit or delete them.
revoke update, delete on payments, cash_movements from tapserve_app;
grant execute on function next_branch_number(uuid, text) to tapserve_app;

-- Default payment methods for every business --------------------------------------------

create or replace function seed_payment_methods(p_tenant uuid) returns void
language sql as $$
  insert into payment_methods (tenant_id, code, name_am, name_en, kind, sort) values
    (p_tenant, 'cash', 'ጥሬ ገንዘብ', 'Cash', 'cash', 1),
    (p_tenant, 'telebirr', 'ቴሌብር', 'Telebirr', 'mobile_money', 2),
    (p_tenant, 'cbe_birr', 'ሲቢኢ ብር', 'CBE Birr', 'mobile_money', 3),
    (p_tenant, 'bank_cbe', 'የባንክ ዝውውር (ንግድ ባንክ)', 'Bank transfer (CBE)', 'bank_transfer', 4),
    (p_tenant, 'bank_awash', 'የባንክ ዝውውር (አዋሽ)', 'Bank transfer (Awash)', 'bank_transfer', 5),
    (p_tenant, 'bank_dashen', 'የባንክ ዝውውር (ዳሽን)', 'Bank transfer (Dashen)', 'bank_transfer', 6),
    (p_tenant, 'bank_abyssinia', 'የባንክ ዝውውር (አቢሲኒያ)', 'Bank transfer (Abyssinia)', 'bank_transfer', 7),
    (p_tenant, 'pos_card', 'ካርድ (POS)', 'Card (POS)', 'card', 8),
    (p_tenant, 'house_account', 'የዱቤ ሂሳብ', 'House account (credit)', 'house_account', 9)
  on conflict (tenant_id, code) do nothing
$$;
grant execute on function seed_payment_methods(uuid) to tapserve_app;

-- Existing businesses get the defaults too.
do $$
declare
  t uuid;
begin
  for t in select id from tenants loop
    perform set_config('app.tenant_id', t::text, true);
    perform seed_payment_methods(t);
  end loop;
  perform set_config('app.tenant_id', '', true);
end
$$;
