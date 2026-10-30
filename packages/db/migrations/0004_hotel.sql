-- Phase 3: hotel. Room setup and rates, reservations, front desk, guest folio, housekeeping
-- and night audit. Everything here is only shown to hotel and hotel + restaurant businesses.

create extension if not exists btree_gist;

-- Room setup ------------------------------------------------------------------------------

create table room_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name_am text not null default '',
  name_en text not null default '',
  capacity int not null default 2 check (capacity between 1 and 20),
  -- Ethiopian hotels commonly price residents and foreigners differently.
  local_rate_santim bigint not null check (local_rate_santim >= 0),
  foreign_rate_santim bigint not null check (foreign_rate_santim >= 0),
  -- Friday and Saturday nights; null means the normal rate applies.
  weekend_local_rate_santim bigint check (weekend_local_rate_santim >= 0),
  weekend_foreign_rate_santim bigint check (weekend_foreign_rate_santim >= 0),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (length(trim(name_am)) > 0 or length(trim(name_en)) > 0)
);

-- Seasonal rates (holidays such as Meskel or Timket, conference season) win over weekday and weekend rates.
create table rate_seasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  room_type_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  starts_on date not null,
  ends_on date not null,
  local_rate_santim bigint not null check (local_rate_santim >= 0),
  foreign_rate_santim bigint not null check (foreign_rate_santim >= 0),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  foreign key (tenant_id, room_type_id) references room_types (tenant_id, id) on delete cascade
);
create index rate_seasons_type_idx on rate_seasons (room_type_id, starts_on);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  room_type_id uuid not null,
  number text not null check (length(trim(number)) > 0),
  floor text not null default '',
  hk_status text not null default 'clean' check (hk_status in ('clean', 'dirty', 'inspected', 'out_of_order')),
  is_active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (branch_id, number),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_type_id) references room_types (tenant_id, id)
);
create trigger rooms_touch before update on rooms for each row execute function touch_updated_at();

-- Guests and bookings ------------------------------------------------------------------------

create table guests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null default '',
  email text not null default '',
  -- ISO 3166 alpha-2; ET for Ethiopian guests.
  nationality text not null default 'ET' check (nationality ~ '^[A-Z]{2}$'),
  id_type text check (id_type in ('kebele', 'fayda', 'passport', 'driving_license', 'other')),
  id_number text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index guests_name_idx on guests (tenant_id, lower(full_name));
create index guests_phone_idx on guests (tenant_id, phone);
create trigger guests_touch before update on guests for each row execute function touch_updated_at();

alter table branch_counters drop constraint branch_counters_kind_check;
alter table branch_counters add constraint branch_counters_kind_check check (kind in ('order', 'receipt', 'booking'));

create table bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  booking_no bigint not null,
  guest_id uuid not null,
  room_type_id uuid not null,
  -- Assigned when booked or at the latest at check-in.
  room_id uuid,
  arrival date not null,
  departure date not null,
  adults int not null default 1 check (adults between 1 and 20),
  children int not null default 0 check (children between 0 and 20),
  source text not null default 'direct'
    check (source in ('direct', 'phone', 'walk_in', 'booking_com', 'expedia', 'travel_agent', 'other')),
  rate_category text not null default 'local' check (rate_category in ('local', 'foreign')),
  -- An agreed price per night; null uses the room type's rates night by night.
  nightly_rate_santim bigint check (nightly_rate_santim >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  note text not null default '',
  cancel_reason text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (branch_id, booking_no),
  check (departure > arrival),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id),
  foreign key (tenant_id, guest_id) references guests (tenant_id, id),
  foreign key (tenant_id, room_type_id) references room_types (tenant_id, id),
  foreign key (tenant_id, room_id) references rooms (tenant_id, id),
  check (status not in ('checked_in', 'checked_out') or room_id is not null),
  -- A room can never hold two live bookings for the same night.
  constraint bookings_no_overlap exclude using gist (
    room_id with =, daterange(arrival, departure) with &&
  ) where (room_id is not null and status in ('reserved', 'checked_in'))
);
create index bookings_dates_idx on bookings (tenant_id, branch_id, arrival, departure);
create index bookings_guest_idx on bookings (guest_id);
create unique index bookings_one_in_house_per_room on bookings (room_id) where status = 'checked_in';
create trigger bookings_touch before update on bookings for each row execute function touch_updated_at();

-- Guest folio -----------------------------------------------------------------------------------

-- Everything the guest owes. Restaurant and bar bills charged to the room land here, which is the
-- link between the two halves of a hotel. Rows are never deleted; a mistake is voided with a reason.
create table folio_charges (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  booking_id uuid not null,
  kind text not null check (kind in ('room', 'restaurant', 'extra', 'discount', 'refund')),
  description text not null default '',
  night_date date,
  -- What the guest pays, tax included; discounts are negative.
  amount_santim bigint not null,
  tax_santim bigint not null default 0,
  bill_id uuid,
  payment_id uuid references payments (id),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references users (id),
  created_by uuid not null default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, booking_id) references bookings (tenant_id, id),
  foreign key (tenant_id, bill_id) references bills (tenant_id, id),
  check ((kind = 'discount') = (amount_santim < 0) or amount_santim = 0),
  check ((kind = 'room') = (night_date is not null))
);
create index folio_charges_booking_idx on folio_charges (booking_id);
create index folio_charges_night_idx on folio_charges (tenant_id, night_date) where kind = 'room' and voided_at is null;
-- Each night is charged once, so the night audit and check-out can both post safely.
create unique index folio_one_room_charge_per_night on folio_charges (booking_id, night_date)
  where kind = 'room' and voided_at is null;

-- Deposits and folio payments go in the same payments table as restaurant bills, so the payments
-- register, statement checks and the cashier's drawer all see them.
alter table payments alter column bill_id drop not null;
alter table payments add column booking_id uuid;
alter table payments add constraint payments_booking_fk foreign key (tenant_id, booking_id) references bookings (tenant_id, id);
alter table payments add constraint payments_one_target check ((bill_id is null) <> (booking_id is null));
create index payments_booking_idx on payments (booking_id) where booking_id is not null;

-- A restaurant bill can be paid by charging it to an in-house guest's room.
alter table payment_methods drop constraint payment_methods_kind_check;
alter table payment_methods add constraint payment_methods_kind_check
  check (kind in ('cash', 'mobile_money', 'bank_transfer', 'card', 'house_account', 'room_charge'));

-- Housekeeping and night audit --------------------------------------------------------------------

create table housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  room_id uuid not null,
  kind text not null default 'clean' check (kind in ('clean', 'inspect', 'repair')),
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid references users (id),
  note text not null default '',
  created_by uuid default current_app_user_id() references users (id),
  created_at timestamptz not null default now(),
  done_by uuid references users (id),
  done_at timestamptz,
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_id) references rooms (tenant_id, id) on delete cascade
);
create index housekeeping_open_idx on housekeeping_tasks (tenant_id, branch_id) where status = 'open';

create table night_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  branch_id uuid not null,
  business_date date not null,
  rooms_charged int not null,
  room_revenue_santim bigint not null,
  no_shows int not null,
  ran_by uuid not null default current_app_user_id() references users (id),
  ran_at timestamptz not null default now(),
  unique (branch_id, business_date),
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade
);

-- Foreign guests often think in dollars; the rate is typed in by the business, never fetched.
alter table tenant_settings add column usd_rate_santim bigint check (usd_rate_santim > 0);

-- Row-level security ------------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'room_types', 'rate_seasons', 'rooms', 'guests', 'bookings', 'folio_charges', 'housekeeping_tasks', 'night_audits'
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

-- Money records: corrections are voids or new rows, never edits or deletes.
revoke delete on bookings, folio_charges, night_audits from tapserve_app;
revoke update, delete on night_audits from tapserve_app;

-- Permissions ------------------------------------------------------------------------------------

-- Room types, rates and rooms are set up by owners and managers; front desk staff sell them.
insert into permissions (key) values ('hotel.manage') on conflict do nothing;
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'hotel.manage' from roles r where r.name in ('Owner', 'Manager')
on conflict do nothing;
-- Receptionists take deposits and folio payments, so they run a cash drawer like cashiers.
insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'shift.manage' from roles r where r.name = 'Receptionist'
on conflict do nothing;

-- Defaults for hotels ------------------------------------------------------------------------------

create or replace function seed_hotel_defaults(p_tenant uuid) returns void
language sql as $$
  insert into payment_methods (tenant_id, code, name_am, name_en, kind, sort)
  values (p_tenant, 'room', 'ወደ ክፍል ሂሳብ', 'Charge to room', 'room_charge', 10)
  on conflict (tenant_id, code) do nothing
$$;
grant execute on function seed_hotel_defaults(uuid) to tapserve_app;

do $$
declare
  t uuid;
begin
  for t in select id from tenants where business_type in ('hotel', 'hotel_restaurant') loop
    perform seed_hotel_defaults(t);
  end loop;
end
$$;
