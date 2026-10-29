import { DEFAULT_ROLE_PERMISSIONS, type SystemRole } from "@tapserve/core";
import { type Sql, withTenant, withUser } from "./client";

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
