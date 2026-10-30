import { createHash, randomBytes, randomInt } from "node:crypto";
import { normalizeEthiopianPhone } from "@tapserve/core";
import type { Sql } from "./client";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";
import type { SmsProvider } from "./sms";

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  locale: "am" | "en";
  calendar_pref: "EC" | "GC";
}

export class AuthError extends Error {
  constructor(public readonly code:
    | "email_taken" | "weak_password" | "invalid_credentials" | "invalid_phone"
    | "rate_limited" | "invalid_code" | "code_expired" | "too_many_attempts") {
    super(code);
  }
}

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_PER_WINDOW = 3;
export const OTP_WINDOW_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_DAYS = 30;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function signUpWithEmail(
  sql: Sql,
  input: { email: string; password: string; fullName: string; locale?: "am" | "en" },
): Promise<User> {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new AuthError("weak_password");
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const rows = await sql<User[]>`
    insert into users (email, password_hash, full_name, locale)
    values (${email}, ${passwordHash}, ${input.fullName.trim()}, ${input.locale ?? "am"})
    on conflict (email) do nothing
    returning id, email, phone, full_name, locale, calendar_pref`;
  if (!rows[0]) throw new AuthError("email_taken");
  return rows[0];
}

export async function loginWithEmail(sql: Sql, email: string, password: string): Promise<User> {
  const [row] = await sql<(User & { password_hash: string | null })[]>`
    select id, email, phone, full_name, locale, calendar_pref, password_hash
    from users where email = ${email.trim().toLowerCase()}`;
  if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
    throw new AuthError("invalid_credentials");
  }
  const { password_hash: _, ...user } = row;
  return user;
}

/** Send a 6-digit code. Limited to OTP_MAX_PER_WINDOW codes per phone per window. */
export async function requestPhoneOtp(sql: Sql, sms: SmsProvider, rawPhone: string): Promise<string> {
  const phone = normalizeEthiopianPhone(rawPhone);
  if (!phone) throw new AuthError("invalid_phone");
  const [recent] = await sql<{ count: number }[]>`
    select count(*)::int as count from otp_codes
    where phone = ${phone} and created_at > now() - make_interval(mins => ${OTP_WINDOW_MINUTES})`;
  if ((recent?.count ?? 0) >= OTP_MAX_PER_WINDOW) throw new AuthError("rate_limited");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql`
    insert into otp_codes (phone, code_hash, expires_at)
    values (${phone}, ${sha256(`${phone}:${code}`)}, now() + make_interval(mins => ${OTP_TTL_MINUTES}))`;
  await sms.send(phone, `Tapserve code: ${code}`);
  return phone;
}

/** Check the latest code for the phone; on success returns the user, creating one if new. */
export async function verifyPhoneOtp(sql: Sql, rawPhone: string, code: string): Promise<User> {
  const phone = normalizeEthiopianPhone(rawPhone);
  if (!phone) throw new AuthError("invalid_phone");
  return (await sql.begin(async (tx) => {
    const [otp] = await tx<{ id: string; code_hash: string; attempts: number; expired: boolean }[]>`
      select id, code_hash, attempts, expires_at < now() as expired from otp_codes
      where phone = ${phone} and consumed_at is null
      order by created_at desc limit 1 for update`;
    if (!otp) throw new AuthError("invalid_code");
    if (otp.expired) throw new AuthError("code_expired");
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AuthError("too_many_attempts");
    if (otp.code_hash !== sha256(`${phone}:${code.trim()}`)) throw new AuthError("invalid_code");
    await tx`update otp_codes set consumed_at = now() where id = ${otp.id}`;
    const [user] = await tx<User[]>`
      insert into users (phone) values (${phone})
      on conflict (phone) do update set phone = excluded.phone
      returning id, email, phone, full_name, locale, calendar_pref`;
    return user!;
  }).catch(async (err) => {
    // Failed attempts must be counted even though the transaction rolled back.
    if (err instanceof AuthError && err.code === "invalid_code") {
      await sql`
        update otp_codes set attempts = attempts + 1
        where id = (select id from otp_codes where phone = ${phone} and consumed_at is null
                    order by created_at desc limit 1)`;
    }
    throw err;
  })) as User;
}

export async function createSession(sql: Sql, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${sha256(token)}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return token;
}

export interface Session {
  user: User;
  activeTenantId: string | null;
  activeBranchId: string | null;
}

export async function getSession(sql: Sql, token: string): Promise<Session | null> {
  const [row] = await sql<(User & { active_tenant_id: string | null; active_branch_id: string | null })[]>`
    select u.id, u.email, u.phone, u.full_name, u.locale, u.calendar_pref, s.active_tenant_id, s.active_branch_id
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  if (!row) return null;
  const { active_tenant_id, active_branch_id, ...user } = row;
  return { user, activeTenantId: active_tenant_id, activeBranchId: active_branch_id };
}

/** Callers must check membership first (see getTenantAccess). */
export async function setActiveTenant(sql: Sql, token: string, tenantId: string | null): Promise<void> {
  await sql`update sessions set active_tenant_id = ${tenantId}, active_branch_id = null where token_hash = ${sha256(token)}`;
}

/** Callers must check the branch belongs to the user (see listBranches). */
export async function setActiveBranch(sql: Sql, token: string, branchId: string | null): Promise<void> {
  await sql`update sessions set active_branch_id = ${branchId} where token_hash = ${sha256(token)}`;
}

export async function deleteSession(sql: Sql, token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${sha256(token)}`;
}
