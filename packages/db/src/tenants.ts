import { DEFAULT_ROLE_PERMISSIONS, normalizeEthiopianPhone, type SystemRole } from "@tapserve/core";
import { type Sql, withTenant, withUser } from "./client";
import { DomainError } from "./restaurant/common";

export const BUSINESS_TYPES = ["restaurant", "cafe", "bar", "hotel", "hotel_restaurant"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface OnboardInput {
  name: string;
  businessType: BusinessType;
  city: string;
  subCity: string;
  tin?: string;
  branchName: string;
  locale: "am" | "en";
}

/** Create a business on the Free plan with the user as Owner. Returns the tenant id. */
export async function onboardBusiness(sql: Sql, userId: string, input: OnboardInput): Promise<string> {
  return withUser(sql, userId, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      select onboard_business(${input.name.trim()}, ${input.businessType}, ${input.city.trim()},
        ${input.subCity.trim()}, ${input.tin?.trim() || null}, ${input.branchName.trim()}, ${input.locale}) as id`;
    const tenantId = row!.id;
    await tx`select seed_payment_methods(${tenantId})`;
    // onboard_business set app.tenant_id for this transaction, so these rows pass RLS.
    const roles = await tx<{ id: string; name: SystemRole }[]>`select id, name from roles`;
    const grants = roles.flatMap((r) =>
      (DEFAULT_ROLE_PERMISSIONS[r.name] ?? []).map((key) => ({ tenant_id: tenantId, role_id: r.id, permission_key: key })),
    );
    if (grants.length) await tx`insert into role_permissions ${tx(grants)}`;
    return tenantId;
  });
}

export interface MembershipSummary {
  tenant_id: string;
  tenant_name: string;
  business_type: BusinessType;
  role_name: string;
  onboarding_completed: boolean;
}

/** Businesses the user belongs to (for login and the business switcher). */
export async function listMemberships(sql: Sql, userId: string): Promise<MembershipSummary[]> {
  return withUser(sql, userId, (tx) => tx<MembershipSummary[]>`
    select t.id as tenant_id, t.name as tenant_name, t.business_type,
           coalesce((select r.name from roles r where r.id = m.role_id), '') as role_name,
           t.onboarding_completed_at is not null as onboarding_completed
    from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = ${userId} and m.status = 'active' and t.status = 'active'
    order by t.created_at`);
}

export interface TenantAccess {
  tenantId: string;
  tenantName: string;
  businessType: BusinessType;
  roleName: string;
  permissions: string[];
  onboardingCompleted: boolean;
}

/**
 * Confirm the user is an active member of an active tenant and load their permissions.
 * Always call this before withTenant: RLS isolates tenants, membership decides which one.
 */
export async function getTenantAccess(sql: Sql, userId: string, tenantId: string): Promise<TenantAccess | null> {
  const memberships = await listMemberships(sql, userId);
  if (!memberships.some((m) => m.tenant_id === tenantId)) return null;
  return withTenant(sql, { tenantId, userId }, async (tx) => {
    const [row] = await tx<{ name: string; business_type: BusinessType; role_name: string; done: boolean }[]>`
      select t.name, t.business_type, r.name as role_name, t.onboarding_completed_at is not null as done
      from memberships m join tenants t on t.id = m.tenant_id join roles r on r.id = m.role_id
      where m.user_id = ${userId}`;
    if (!row) return null;
    const perms = await tx<{ permission_key: string }[]>`
      select rp.permission_key from role_permissions rp
      join memberships m on m.role_id = rp.role_id where m.user_id = ${userId}`;
    return {
      tenantId,
      tenantName: row.name,
      businessType: row.business_type,
      roleName: row.role_name,
      permissions: perms.map((p) => p.permission_key),
      onboardingCompleted: row.done,
    };
  });
}

export interface TaxSettingsInput {
  taxType: "VAT" | "TOT" | "NONE";
  taxRateBp: number;
  pricesIncludeTax: boolean;
  serviceChargeEnabled: boolean;
  serviceChargeRateBp: number;
}

export async function saveTaxSettings(sql: Sql, ctx: { tenantId: string; userId: string }, input: TaxSettingsInput) {
  await withTenant(sql, ctx, async (tx) => {
    const [before] = await tx`select tax_type, tax_rate_bp, prices_include_tax, service_charge_enabled, service_charge_rate_bp from tenant_settings`;
    const [after] = await tx`
      update tenant_settings set tax_type = ${input.taxType}, tax_rate_bp = ${input.taxRateBp},
        prices_include_tax = ${input.pricesIncludeTax}, service_charge_enabled = ${input.serviceChargeEnabled},
        service_charge_rate_bp = ${input.serviceChargeRateBp}
      returning tax_type, tax_rate_bp, prices_include_tax, service_charge_enabled, service_charge_rate_bp`;
    await tx`insert into audit_logs (action, entity, before, after)
             values ('settings.tax.update', 'tenant_settings', ${tx.json(before ?? null)}, ${tx.json(after ?? null)})`;
  });
}

export async function completeOnboarding(sql: Sql, ctx: { tenantId: string; userId: string }) {
  await withTenant(sql, ctx, (tx) => tx`update tenants set onboarding_completed_at = now() where id = current_tenant_id() and onboarding_completed_at is null`);
}

export interface StaffMember {
  membership_id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role_name: string;
  status: "active" | "disabled";
}

export async function listStaff(sql: Sql, ctx: { tenantId: string; userId: string }): Promise<StaffMember[]> {
  return withTenant(sql, ctx, (tx) => tx<StaffMember[]>`
    select m.id as membership_id, u.id as user_id, u.full_name, u.phone, u.email, r.name as role_name, m.status
    from memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
    order by r.name = 'Owner' desc, u.full_name`);
}

/**
 * Add a staff member by Ethiopian phone number. They log in with a one-time code sent to that phone.
 * Needs staff.manage. Only an Owner can add another Owner.
 */
export async function addStaffMember(
  sql: Sql,
  ctx: { tenantId: string; userId: string; permissions: readonly string[] },
  input: { phone: string; fullName: string; roleName: string },
): Promise<string> {
  if (!ctx.permissions.includes("staff.manage")) throw new DomainError("forbidden");
  const phone = normalizeEthiopianPhone(input.phone);
  if (!phone) throw new DomainError("invalid_phone");
  return withTenant(sql, ctx, async (tx) => {
    const [role] = await tx<{ id: string; name: string }[]>`select id, name from roles where name = ${input.roleName}`;
    if (!role) throw new DomainError("unknown_role");
    if (role.name === "Owner" && !ctx.permissions.includes("roles.manage")) throw new DomainError("forbidden");
    const [user] = await tx<{ id: string }[]>`
      insert into users (phone, full_name) values (${phone}, ${input.fullName.trim()})
      on conflict (phone) do update set full_name = case when users.full_name = '' then excluded.full_name else users.full_name end
      returning id`;
    const [membership] = await tx<{ id: string }[]>`
      insert into memberships (user_id, role_id) values (${user!.id}, ${role.id})
      on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, status = 'active'
      returning id`;
    await tx`insert into membership_branches (membership_id, branch_id)
             select ${membership!.id}, id from branches on conflict do nothing`;
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('staff.add', 'membership', ${membership!.id}, ${tx.json({ phone, role: role.name })})`;
    return user!.id;
  });
}

export async function setStaffStatus(
  sql: Sql,
  ctx: { tenantId: string; userId: string; permissions: readonly string[] },
  membershipId: string,
  status: "active" | "disabled",
): Promise<void> {
  if (!ctx.permissions.includes("staff.manage")) throw new DomainError("forbidden");
  await withTenant(sql, ctx, async (tx) => {
    const [target] = await tx`select m.user_id, r.name from memberships m join roles r on r.id = m.role_id where m.id = ${membershipId}`;
    if (!target) throw new DomainError("not_found");
    if (target.user_id === ctx.userId || target.name === "Owner") throw new DomainError("forbidden");
    await tx`update memberships set status = ${status} where id = ${membershipId}`;
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('staff.status', 'membership', ${membershipId}, ${tx.json({ status })})`;
  });
}

export interface BranchView {
  id: string;
  name: string;
}

/** Branches the user may work in (Owners and Managers see all). */
export async function listBranches(sql: Sql, ctx: { tenantId: string; userId: string }): Promise<BranchView[]> {
  return withTenant(sql, ctx, (tx) => tx<BranchView[]>`
    select b.id, b.name from branches b
    where exists (select 1 from memberships m join roles r on r.id = m.role_id
                  where m.user_id = ${ctx.userId} and r.name in ('Owner', 'Manager'))
       or b.id in (select mb.branch_id from membership_branches mb join memberships m on m.id = mb.membership_id
                   where m.user_id = ${ctx.userId})
    order by b.created_at`);
}
