import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTenantAccess,
  listMemberships,
  onboardBusiness,
  signUpWithEmail,
  type Sql,
  withTenant,
  withUser,
} from "@tapserve/db";
import { freshDatabase } from "./db";

let admin: Sql;
let app: Sql;
let alice: string; // owner of tenant A
let bob: string; // owner of tenant B
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  ({ admin, app } = await freshDatabase());
  alice = (await signUpWithEmail(app, { email: "alice@example.com", password: "password-a", fullName: "Alice" })).id;
  bob = (await signUpWithEmail(app, { email: "bob@example.com", password: "password-b", fullName: "Bob" })).id;
  const base = { city: "Addis Ababa", subCity: "Bole", branchName: "Main", locale: "en" as const };
  tenantA = await onboardBusiness(app, alice, { ...base, name: "Buna House", businessType: "cafe" });
  tenantB = await onboardBusiness(app, bob, { ...base, name: "Entoto View", businessType: "hotel_restaurant" });
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

const asA = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app, { tenantId: tenantA, userId: alice }, fn);

describe("tenant isolation (row-level security)", () => {
  it("the app role cannot bypass RLS", async () => {
    const [role] = await admin<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      select rolbypassrls, rolsuper from pg_roles where rolname = 'tapserve_app'`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("onboarding creates the business, owner, branch, roles, settings and Free plan", async () => {
    await asA(async (tx) => {
      expect((await tx`select name from tenants where id = ${tenantA}`)[0]?.name).toBe("Buna House");
      expect(await tx`select name from branches`).toHaveLength(1);
      expect(await tx`select name from roles`).toHaveLength(9);
      const [plan] = await tx`select p.code from subscriptions s join plans p on p.id = s.plan_id`;
      expect(plan?.code).toBe("free");
      const [settings] = await tx`select tax_type, tax_rate_bp from tenant_settings`;
      expect(settings).toEqual({ tax_type: "VAT", tax_rate_bp: 1500 });
    });
    const access = await getTenantAccess(app, alice, tenantA);
    expect(access?.roleName).toBe("Owner");
    expect(access?.permissions).toContain("roles.manage");
  });

  it("sees nothing without a tenant context", async () => {
    expect(await app`select * from branches`).toHaveLength(0);
    expect(await app`select * from tenants`).toHaveLength(0);
    expect(await app`select * from tenant_settings`).toHaveLength(0);
  });

  it("tenant A cannot read tenant B's rows", async () => {
    await asA(async (tx) => {
      const tables = ["branches", "roles", "role_permissions", "memberships", "tenant_settings", "subscriptions", "audit_logs"];
      for (const table of tables) {
        const rows = await tx.unsafe(`select tenant_id from ${table}`);
        expect(rows.length, table).toBeGreaterThan(0);
        expect(rows.every((r) => r.tenant_id === tenantA), table).toBe(true);
      }
      expect(await tx`select * from tenants where id = ${tenantB}`).toHaveLength(0);
    });
  });

  it("tenant A cannot insert rows into tenant B", async () => {
    await expect(
      asA((tx) => tx`insert into branches (tenant_id, name) values (${tenantB}, 'Sneaky branch')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("tenant A cannot update or delete tenant B's rows", async () => {
    await asA(async (tx) => {
      expect((await tx`update branches set name = 'Hacked' where tenant_id = ${tenantB}`).count).toBe(0);
      expect((await tx`delete from tenant_settings where tenant_id = ${tenantB}`).count).toBe(0);
      expect((await tx`update tenants set name = 'Hacked' where id = ${tenantB}`).count).toBe(0);
    });
    const [branch] = await admin`select name from branches where tenant_id = ${tenantB}`;
    expect(branch?.name).toBe("Main");
  });

  it("tenant A cannot move its own rows into tenant B", async () => {
    await expect(asA((tx) => tx`update branches set tenant_id = ${tenantB}`)).rejects.toThrow(/row-level security/);
  });

  it("audit logs are append-only for the app", async () => {
    await expect(asA((tx) => tx`delete from audit_logs`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`update audit_logs set action = 'x'`)).rejects.toThrow(/permission denied/);
  });

  it("users only see their own memberships before choosing a business", async () => {
    const mine = await listMemberships(app, alice);
    expect(mine.map((m) => m.tenant_name)).toEqual(["Buna House"]);
    await withUser(app, alice, async (tx) => {
      const rows = await tx`select tenant_id from memberships`;
      expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
    });
  });

  it("a user with two businesses can only change the current one", async () => {
    const second = await onboardBusiness(app, alice, {
      name: "Buna House 2", businessType: "restaurant", city: "Adama", subCity: "", branchName: "Main", locale: "en",
    });
    await asA(async (tx) => {
      // Both businesses are visible for the switcher...
      expect(await tx`select id from tenants`).toHaveLength(2);
      // ...but writes reach only the current one.
      expect((await tx`update tenants set city = 'Changed'`).count).toBe(1);
      expect((await tx`delete from tenants where id = ${second}`).count).toBe(0);
    });
    const [other] = await admin`select city from tenants where id = ${second}`;
    expect(other?.city).toBe("Adama");
  });

  it("refuses access to a business the user does not belong to", async () => {
    expect(await getTenantAccess(app, alice, tenantB)).toBeNull();
  });
});
