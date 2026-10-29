-- Tapserve foundation: platform, identity, tenants, branches, roles, settings, audit log.
-- Every business table has tenant_id and is protected by row-level security (RLS).
-- The application connects as tapserve_app, which cannot bypass RLS.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tapserve_app') then
    create role tapserve_app login nobypassrls;
  end if;
end
$$;

-- The tenant and user for the current transaction, set by the app with set_config(..., true).
create or replace function current_tenant_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function current_app_user_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- Platform (not tenant-scoped) ------------------------------------------------

create table plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  limits jsonb not null default '{}',
  price_santim bigint not null default 0,
  created_at timestamptz not null default now()
);

insert into plans (code, name, limits) values ('free', 'Free', '{"branches": null, "users": null}');

create table permissions (
  key text primary key,
  description text not null default ''
);

insert into permissions (key) values
  ('settings.manage'), ('staff.manage'), ('roles.manage'), ('branches.manage'), ('menu.manage'),
  ('order.create'), ('order.void'), ('order.discount'), ('payment.record'), ('payment.refund'),
  ('shift.manage'), ('inventory.manage'), ('expenses.manage'), ('reports.view'),
  ('reports.profit.view'), ('hotel.frontdesk'), ('hotel.housekeeping'), ('audit.view');

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique check (email = lower(email)),
  phone text unique check (phone ~ '^\+251[79][0-9]{8}$'),
  password_hash text,
  full_name text not null default '',
  locale text not null default 'am' check (locale in ('am', 'en')),
  calendar_pref text not null default 'EC' check (calendar_pref in ('EC', 'GC')),
  ethiopian_time boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create trigger users_touch before update on users for each row execute function touch_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  active_tenant_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_codes_phone_idx on otp_codes (phone, created_at desc);

create table platform_admins (
  user_id uuid primary key references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Tenants ------------------------------------------------------------------------

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  business_type text not null
    check (business_type in ('restaurant', 'cafe', 'bar', 'hotel', 'hotel_restaurant')),
  city text not null default '',
  sub_city text not null default '',
  tin text check (tin is null or tin ~ '^[0-9]{10}$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  default_locale text not null default 'am' check (default_locale in ('am', 'en')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on tenants for each row execute function touch_updated_at();

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  plan_id uuid not null references plans (id),
  status text not null default 'active'
    check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  started_at timestamptz not null default now(),
  ends_at timestamptz
);
create index subscriptions_tenant_idx on subscriptions (tenant_id);

create table tenant_features (
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  primary key (tenant_id, feature_key)
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  city text not null default '',
  sub_city text not null default '',
  address text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create trigger branches_touch before update on branches for each row execute function touch_updated_at();

create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table role_permissions (
  tenant_id uuid not null default current_tenant_id(),
  role_id uuid not null,
  permission_key text not null references permissions (key),
  primary key (role_id, permission_key),
  foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, id),
  foreign key (tenant_id, role_id) references roles (tenant_id, id)
);
create index memberships_user_idx on memberships (user_id);

create table membership_branches (
  tenant_id uuid not null default current_tenant_id(),
  membership_id uuid not null,
  branch_id uuid not null,
  primary key (membership_id, branch_id),
  foreign key (tenant_id, membership_id) references memberships (tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references branches (tenant_id, id) on delete cascade
);

create table tenant_settings (
  tenant_id uuid primary key default current_tenant_id() references tenants (id) on delete cascade,
  currency text not null default 'ETB',
  prices_include_tax boolean not null default true,
  tax_type text not null default 'VAT' check (tax_type in ('VAT', 'TOT', 'NONE')),
  tax_rate_bp int not null default 1500 check (tax_rate_bp between 0 and 10000),
  service_charge_enabled boolean not null default false,
  service_charge_rate_bp int not null default 1000 check (service_charge_rate_bp between 0 and 10000),
  receipt_footer text not null default '',
  updated_at timestamptz not null default now()
);
create trigger tenant_settings_touch before update on tenant_settings
  for each row execute function touch_updated_at();

-- Append-only: the app role may insert and read, never update or delete.
create table audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  actor_user_id uuid default current_app_user_id() references users (id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);
create index audit_logs_tenant_at_idx on audit_logs (tenant_id, at desc);

-- Row-level security -------------------------------------------------------------

alter table tenants enable row level security;
alter table tenants force row level security;
-- Reads: the current tenant, plus every tenant the user belongs to (for the business switcher).
-- Writes: only the current tenant.
create policy tenant_read on tenants for select
  using (
    id = current_tenant_id()
    or id in (select m.tenant_id from memberships m where m.user_id = current_app_user_id())
  );
create policy tenant_insert on tenants for insert with check (id = current_tenant_id());
create policy tenant_update on tenants for update
  using (id = current_tenant_id()) with check (id = current_tenant_id());
create policy tenant_delete on tenants for delete using (id = current_tenant_id());

do $$
declare
  t text;
begin
  foreach t in array array[
    'subscriptions', 'tenant_features', 'branches', 'roles', 'role_permissions',
    'membership_branches', 'tenant_settings', 'audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
  end loop;
end
$$;

alter table memberships enable row level security;
alter table memberships force row level security;
create policy tenant_isolation on memberships
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());
-- Users may list their own memberships before choosing a business.
create policy own_memberships on memberships for select
  using (user_id = current_app_user_id());

-- Self-service onboarding: creates a business with its owner, first branch, roles,
-- default settings and the Free plan. Runs with the caller's rights, so RLS still applies.
create or replace function onboard_business(
  p_name text,
  p_business_type text,
  p_city text,
  p_sub_city text,
  p_tin text,
  p_branch_name text,
  p_locale text
) returns uuid
language plpgsql as $$
declare
  v_user uuid := current_app_user_id();
  v_tenant uuid := gen_random_uuid();
  v_owner_role uuid;
  v_branch uuid;
  v_membership uuid;
begin
  if v_user is null then
    raise exception 'onboard_business requires app.user_id';
  end if;
  perform set_config('app.tenant_id', v_tenant::text, true);

  insert into tenants (id, name, business_type, city, sub_city, tin, default_locale)
  values (v_tenant, p_name, p_business_type, coalesce(p_city, ''), coalesce(p_sub_city, ''),
          nullif(p_tin, ''), coalesce(p_locale, 'am'));

  insert into subscriptions (tenant_id, plan_id) select v_tenant, id from plans where code = 'free';
  insert into tenant_settings (tenant_id) values (v_tenant);

  insert into branches (tenant_id, name, city, sub_city)
  values (v_tenant, coalesce(nullif(p_branch_name, ''), 'Main'), coalesce(p_city, ''), coalesce(p_sub_city, ''))
  returning id into v_branch;

  insert into roles (tenant_id, name, is_system)
  select v_tenant, r, true
  from unnest(array['Owner', 'Manager', 'Cashier', 'Waiter', 'Kitchen', 'Receptionist',
                    'Housekeeping', 'Storekeeper', 'Accountant']) as r;
  select id into v_owner_role from roles where tenant_id = v_tenant and name = 'Owner';

  insert into memberships (tenant_id, user_id, role_id)
  values (v_tenant, v_user, v_owner_role) returning id into v_membership;
  insert into membership_branches (tenant_id, membership_id, branch_id)
  values (v_tenant, v_membership, v_branch);

  insert into audit_logs (tenant_id, actor_user_id, action, entity, entity_id)
  values (v_tenant, v_user, 'tenant.create', 'tenant', v_tenant::text);

  return v_tenant;
end
$$;

-- Grants -------------------------------------------------------------------------

grant usage on schema public to tapserve_app;
grant select, insert, update, delete on all tables in schema public to tapserve_app;
revoke insert, update, delete on plans, permissions, platform_admins from tapserve_app;
revoke update, delete on audit_logs from tapserve_app;
grant usage, select on all sequences in schema public to tapserve_app;
grant execute on all functions in schema public to tapserve_app;
