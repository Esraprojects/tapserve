import { createSession, setActiveBranch, setActiveTenant } from "./auth";
import { type Sql, withTenant } from "./client";
import { hashPassword, verifyPassword } from "./password";
import { DomainError } from "./restaurant/common";
import { listBranches } from "./tenants";

/**
 * Staff PINs for a shared POS tablet: the device stays signed in to the business, and each
 * person switches to themselves with a short PIN so orders, payments and voids carry their name.
 * PINs are salted and hashed like passwords and lock after repeated wrong tries.
 */

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 5;

type Ctx = { tenantId: string; userId: string };

function validatePin(pin: string) {
  if (!/^[0-9]{4,6}$/.test(pin)) throw new DomainError("invalid_pin");
  const digits = [...pin].map(Number);
  const same = digits.every((d) => d === digits[0]);
  const up = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const down = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  if (same || up || down) throw new DomainError("weak_pin");
}

/** Set or change your own PIN for the current business. */
export async function setOwnPin(sql: Sql, ctx: Ctx, pin: string): Promise<void> {
  validatePin(pin);
  const hash = await hashPassword(pin);
  await withTenant(sql, ctx, async (tx) => {
    const [row] = await tx`
      update memberships set pin_hash = ${hash}, pin_failed_attempts = 0, pin_locked_until = null
      where user_id = ${ctx.userId} and status = 'active' returning id`;
    if (!row) throw new DomainError("forbidden");
  });
}

/** A manager clears someone's PIN (forgotten, or a phone changed hands). They set a new one at next sign-in. */
export async function clearStaffPin(
  sql: Sql, ctx: Ctx & { permissions: readonly string[] }, membershipId: string,
): Promise<void> {
  if (!ctx.permissions.includes("staff.manage")) throw new DomainError("forbidden");
  await withTenant(sql, ctx, async (tx) => {
    const [row] = await tx`
      update memberships set pin_hash = null, pin_failed_attempts = 0, pin_locked_until = null
      where id = ${membershipId} returning id`;
    if (!row) throw new DomainError("not_found");
    await tx`insert into audit_logs (action, entity, entity_id) values ('staff.pin_clear', 'membership', ${membershipId})`;
  });
}

export interface PinUser {
  membership_id: string;
  user_id: string;
  full_name: string;
  role_name: string;
  has_pin: boolean;
}

/** Active staff for the "who are you?" screen. */
export async function listPinUsers(sql: Sql, ctx: Ctx): Promise<PinUser[]> {
  return withTenant(sql, ctx, (tx) => tx<PinUser[]>`
    select m.id as membership_id, m.user_id, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as full_name,
           r.name as role_name, m.pin_hash is not null as has_pin
    from memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
    where m.status = 'active'
    order by u.full_name`);
}

export async function hasOwnPin(sql: Sql, ctx: Ctx): Promise<boolean> {
  return withTenant(sql, ctx, async (tx) => {
    const [row] = await tx`select 1 from memberships where user_id = ${ctx.userId} and pin_hash is not null`;
    return Boolean(row);
  });
}

/**
 * Switch the device to another staff member. Returns a new session token already set to the
 * same business and (when that person may use it) the same branch. The caller replaces the cookie
 * and deletes the old session.
 */
export async function switchUserWithPin(
  sql: Sql, ctx: Ctx, input: { membershipId: string; pin: string; branchId: string | null },
): Promise<{ token: string; userId: string }> {
  const outcome = await withTenant(sql, ctx, async (tx) => {
    const [m] = await tx<{ user_id: string; pin_hash: string | null; attempts: number; locked: boolean }[]>`
      select user_id, pin_hash, pin_failed_attempts as attempts,
             coalesce(pin_locked_until > now(), false) as locked
      from memberships where id = ${input.membershipId} and status = 'active' for update`;
    if (!m) return { error: "not_found" } as const;
    if (!m.pin_hash) return { error: "pin_not_set" } as const;
    if (m.locked) return { error: "pin_locked" } as const;
    if (/^[0-9]{4,6}$/.test(input.pin) && (await verifyPassword(input.pin, m.pin_hash))) {
      await tx`update memberships set pin_failed_attempts = 0, pin_locked_until = null where id = ${input.membershipId}`;
      return { userId: m.user_id } as const;
    }
    const attempts = m.attempts + 1;
    const lock = attempts >= PIN_MAX_ATTEMPTS;
    await tx`
      update memberships
      set pin_failed_attempts = ${lock ? 0 : attempts},
          pin_locked_until = ${lock ? tx`now() + make_interval(mins => ${PIN_LOCK_MINUTES})` : null}
      where id = ${input.membershipId}`;
    if (lock) {
      await tx`insert into audit_logs (action, entity, entity_id) values ('staff.pin_locked', 'membership', ${input.membershipId})`;
    }
    return { error: lock ? "pin_locked" : "wrong_pin" } as const;
  });
  if ("error" in outcome) throw new DomainError(outcome.error!);
  const userId = outcome.userId!;

  const token = await createSession(sql, userId);
  await setActiveTenant(sql, token, ctx.tenantId);
  if (input.branchId) {
    const branches = await listBranches(sql, { tenantId: ctx.tenantId, userId });
    if (branches.some((b) => b.id === input.branchId)) await setActiveBranch(sql, token, input.branchId);
  }
  return { token, userId };
}
