-- Phase 2: inventory with recipes, purchases, transfers, wastage and stock counts; expenses;
-- staff PINs for shared devices; idempotent "add items" for the offline outbox.
-- Quantities are numeric in the item's own unit; money stays santim (unit costs keep decimals).

-- Units are per business so owners can add local ones (ቁና, ጣሳ, ...).
create table units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  code text not null,
  name_am text not null default '',
  name_en text not null default '',
  sort int not null default 0,
  unique (tenant_id, code),
  unique (tenant_id, id),
  check (name_am <> '' or name_en <> '')
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name text not null check (name <> ''),
  phone text not null default '',
  tin text not null default '',
  note text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name_am text not null default '',
  name_en text not null default '',
  unit_id uuid not null,
  category text not null default '',
  -- Alert when a branch's stock falls to or below this level.
  reorder_level numeric(14, 3) not null default 0 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, unit_id) references units (tenant_id, id),
  check (name_am <> '' or name_en <> '')
);
create trigger inventory_items_touch before update on inventory_items for each row execute function touch_updated_at();

-- Running stock and weighted-average cost per branch. Maintained only by the stock_movements trigger.
create table stock_levels (
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  item_id uuid not null,
  quantity numeric(14, 3) not null default 0,
  avg_cost_santim numeric(16, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, item_id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id) on delete cascade
);

-- Bill of materials: how much of each ingredient one unit of a menu variant uses.
create table recipe_lines (
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  variant_id uuid not null,
  item_id uuid not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  primary key (variant_id, item_id),
  foreign key (tenant_id, variant_id) references menu_item_variants (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id) on delete cascade
);

create table purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  supplier_id uuid,
  invoice_ref text not null default '',
  purchased_on date not null,
  total_santim bigint not null check (total_santim >= 0),
  payment_method_id uuid,
  note text not null default '',
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, supplier_id) references suppliers (tenant_id, id),
  foreign key (tenant_id, payment_method_id) references payment_methods (tenant_id, id)
);

create table purchase_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  purchase_id uuid not null,
  item_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  line_total_santim bigint not null check (line_total_santim >= 0),
  foreign key (tenant_id, purchase_id) references purchases (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id)
);

create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  from_branch_id uuid not null,
  to_branch_id uuid not null,
  note text not null default '',
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, from_branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, to_branch_id) references branches (tenant_id, id),
  check (from_branch_id <> to_branch_id)
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  note text not null default '',
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id)
);

create table stock_count_lines (
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  count_id uuid not null,
  item_id uuid not null,
  counted_quantity numeric(14, 3) not null check (counted_quantity >= 0),
  -- Filled in when the count is posted.
  expected_quantity numeric(14, 3),
  variance_value_santim bigint,
  primary key (count_id, item_id),
  foreign key (tenant_id, count_id) references stock_counts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id)
);

-- The stock ledger. Quantity is signed; value is quantity x unit cost in santim.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  item_id uuid not null,
  kind text not null check (kind in (
    'purchase', 'sale', 'void_return', 'waste', 'transfer_in', 'transfer_out', 'count_adjustment', 'opening'
  )),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost_santim numeric(16, 4),
  value_santim bigint,
  ref_type text,
  ref_id uuid,
  reason text not null default '',
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, item_id) references inventory_items (tenant_id, id)
);
create index stock_movements_item_idx on stock_movements (tenant_id, branch_id, item_id, seq);
create index stock_movements_ref_idx on stock_movements (ref_id);
create index stock_movements_time_idx on stock_movements (tenant_id, created_at);

-- Every movement updates the branch level. Receipts with a cost move the weighted average;
-- everything else is valued at the current average.
create or replace function apply_stock_movement() returns trigger
language plpgsql as $$
declare
  lvl stock_levels%rowtype;
  new_avg numeric(16, 4);
begin
  insert into stock_levels (tenant_id, branch_id, item_id) values (new.tenant_id, new.branch_id, new.item_id)
  on conflict (branch_id, item_id) do nothing;
  select * into lvl from stock_levels where branch_id = new.branch_id and item_id = new.item_id for update;
  new_avg := lvl.avg_cost_santim;
  if new.quantity > 0 and new.unit_cost_santim is not null then
    if lvl.quantity > 0 then
      new_avg := (lvl.quantity * lvl.avg_cost_santim + new.quantity * new.unit_cost_santim) / (lvl.quantity + new.quantity);
    else
      new_avg := new.unit_cost_santim;
    end if;
  else
    new.unit_cost_santim := lvl.avg_cost_santim;
  end if;
  new.value_santim := round(new.quantity * new.unit_cost_santim);
  update stock_levels set quantity = quantity + new.quantity, avg_cost_santim = new_avg, updated_at = now()
  where branch_id = new.branch_id and item_id = new.item_id;
  return new;
end
$$;
create trigger stock_movements_apply before insert on stock_movements
  for each row execute function apply_stock_movement();

-- Sales deduct ingredients the moment an item is ordered.
create or replace function deduct_recipe_stock() returns trigger
language plpgsql as $$
begin
  if new.variant_id is null then
    return new;
  end if;
  insert into stock_movements (branch_id, item_id, kind, quantity, ref_type, ref_id)
  select o.branch_id, rl.item_id, 'sale', -(rl.quantity * new.quantity), 'order_item', new.id
  from recipe_lines rl join orders o on o.id = new.order_id
  where rl.variant_id = new.variant_id;
  return new;
end
$$;
create trigger order_items_deduct_stock after insert on order_items
  for each row execute function deduct_recipe_stock();

-- A line voided before the kitchen started it goes back to stock at the cost it left with.
-- Once preparation started, the ingredients are gone, so the deduction stays (it shows as cost).
create or replace function return_voided_stock() returns trigger
language plpgsql as $$
begin
  if new.status = 'voided' and old.status = 'new' then
    insert into stock_movements (branch_id, item_id, kind, quantity, unit_cost_santim, ref_type, ref_id, reason)
    select branch_id, item_id, 'void_return', -quantity, unit_cost_santim, 'order_item', ref_id, 'void'
    from stock_movements where ref_type = 'order_item' and ref_id = new.id and kind = 'sale';
  end if;
  return new;
end
$$;
create trigger order_items_return_stock after update of status on order_items
  for each row execute function return_voided_stock();

-- Expenses ------------------------------------------------------------------------------

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  code text not null,
  name_am text not null default '',
  name_en text not null default '',
  sort int not null default 0,
  unique (tenant_id, code),
  unique (tenant_id, id),
  check (name_am <> '' or name_en <> '')
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  category_id uuid not null,
  amount_santim bigint not null check (amount_santim > 0),
  spent_on date not null,
  payment_method_id uuid,
  -- Set when the cash came out of a cashier's drawer; the shift then shows it as a pay-out.
  shift_id uuid,
  vendor text not null default '',
  note text not null default '',
  voided_at timestamptz,
  void_reason text,
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, category_id) references expense_categories (tenant_id, id),
  foreign key (tenant_id, payment_method_id) references payment_methods (tenant_id, id),
  foreign key (tenant_id, shift_id) references shifts (tenant_id, id)
);
create index expenses_date_idx on expenses (tenant_id, spent_on);

-- Staff PINs ----------------------------------------------------------------------------

-- A short PIN lets staff switch user on a shared tablet. Hashed like passwords; locked after
-- repeated wrong tries.
alter table memberships
  add column pin_hash text,
  add column pin_failed_attempts int not null default 0,
  add column pin_locked_until timestamptz;

-- Offline outbox: "add items" batches carry a device id so a re-sent batch is applied once.
alter table order_items add column batch_uuid uuid;
create index order_items_batch_idx on order_items (batch_uuid) where batch_uuid is not null;

-- RLS and grants ------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'units', 'suppliers', 'inventory_items', 'stock_levels', 'recipe_lines', 'purchases', 'purchase_lines',
    'stock_transfers', 'stock_counts', 'stock_count_lines', 'stock_movements', 'expense_categories', 'expenses'
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

-- The stock ledger is append-only; corrections are new movements.
revoke update, delete on stock_movements from tapserve_app;
revoke delete on expenses, purchases, purchase_lines, stock_transfers from tapserve_app;

-- Defaults for every business -------------------------------------------------------------

create or replace function seed_inventory_defaults(p_tenant uuid) returns void
language sql as $$
  insert into units (tenant_id, code, name_am, name_en, sort) values
    (p_tenant, 'kg', 'ኪሎ', 'kg', 1),
    (p_tenant, 'g', 'ግራም', 'g', 2),
    (p_tenant, 'l', 'ሊትር', 'liter', 3),
    (p_tenant, 'ml', 'ሚሊ ሊትር', 'ml', 4),
    (p_tenant, 'pc', 'ፍሬ', 'piece', 5),
    (p_tenant, 'kuna', 'ቁና', 'kuna', 6),
    (p_tenant, 'pack', 'ፓኬት', 'pack', 7),
    (p_tenant, 'bottle', 'ጠርሙስ', 'bottle', 8),
    (p_tenant, 'crate', 'ሳጥን', 'crate', 9)
  on conflict (tenant_id, code) do nothing;
  insert into expense_categories (tenant_id, code, name_am, name_en, sort) values
    (p_tenant, 'rent', 'ኪራይ', 'Rent', 1),
    (p_tenant, 'salary', 'ደመወዝ', 'Salaries', 2),
    (p_tenant, 'utilities', 'መብራት እና ውሃ', 'Electricity and water', 3),
    (p_tenant, 'gas', 'ጋዝ እና ከሰል', 'Gas and charcoal', 4),
    (p_tenant, 'transport', 'ትራንስፖርት', 'Transport', 5),
    (p_tenant, 'maintenance', 'ጥገና', 'Maintenance', 6),
    (p_tenant, 'supplies', 'የጽዳት እና የቢሮ እቃ', 'Cleaning and office supplies', 7),
    (p_tenant, 'tax_fees', 'ግብር እና ክፍያዎች', 'Taxes and fees', 8),
    (p_tenant, 'telecom', 'ስልክ እና ኢንተርኔት', 'Phone and internet', 9),
    (p_tenant, 'other', 'ሌላ', 'Other', 10)
  on conflict (tenant_id, code) do nothing
$$;
grant execute on function seed_inventory_defaults(uuid) to tapserve_app;

do $$
declare
  t uuid;
begin
  for t in select id from tenants loop
    perform seed_inventory_defaults(t);
  end loop;
end
$$;

-- Payments without a printer ---------------------------------------------------------------

-- Many businesses take Telebirr or bank transfers and print nothing, so the owner reconciles
-- recorded payments against the provider statement. Payments stay immutable; a check is a row.
create table payment_checks (
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  payment_id uuid primary key references payments (id) on delete cascade,
  status text not null check (status in ('confirmed', 'not_found')),
  note text not null default '',
  checked_by uuid not null default current_app_user_id() references users (id),
  checked_at timestamptz not null default now()
);
alter table payment_checks enable row level security;
alter table payment_checks force row level security;
create policy tenant_isolation on payment_checks
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
grant select, insert, update, delete on payment_checks to tapserve_app;

-- Digital receipts: an unguessable link the customer can open on a phone instead of paper.
alter table bills add column public_token text not null default encode(gen_random_bytes(16), 'hex');
create unique index bills_public_token_idx on bills (public_token);

-- The only cross-tenant lookup the app may do: turn a receipt token into its business and bill.
create or replace function resolve_receipt_token(p_token text)
returns table (tenant_id uuid, bill_id uuid)
language sql stable security definer set search_path = public as $$
  select b.tenant_id, b.id from bills b where b.public_token = p_token and b.status <> 'void'
$$;
revoke all on function resolve_receipt_token(text) from public;
grant execute on function resolve_receipt_token(text) to tapserve_app;

-- Checking payments against the Telebirr or bank statement is its own permission.
insert into permissions (key) values ('payment.verify') on conflict do nothing;
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'payment.verify' from roles r where r.name in ('Owner', 'Manager', 'Accountant')
on conflict do nothing;

-- Cafés and coffee houses sell at the counter: no table, paid straight away.
alter table orders drop constraint orders_type_check;
alter table orders add constraint orders_type_check check (type in ('dine_in', 'takeaway', 'delivery', 'counter'));
