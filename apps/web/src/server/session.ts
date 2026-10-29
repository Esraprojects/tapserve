import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  getSession,
  getTenantAccess,
  listMemberships,
  setActiveTenant,
  SESSION_DAYS,
  type Session,
  type TenantAccess,
} from "@tapserve/db";
import type { Locale } from "@tapserve/i18n";
import { db } from "./db";

export const SESSION_COOKIE = "tapserve_session";

export async function startSession(userId: string): Promise<void> {
  const token = await createSession(db(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export const currentSession = cache(async (): Promise<Session | null> => {
  const token = await sessionToken();
  return token ? getSession(db(), token) : null;
});

export async function requireUser(locale: Locale): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect(`/${locale}/login`);
  return session;
}

/**
 * The signed-in user's current business. Membership is checked on every request,
 * so a stale or tampered session can never open another tenant's data.
 */
export async function requireTenant(locale: Locale): Promise<{ session: Session; access: TenantAccess }> {
  const session = await requireUser(locale);
  let tenantId = session.activeTenantId;
  let access = tenantId ? await getTenantAccess(db(), session.user.id, tenantId) : null;
  if (!access) {
    const [first] = await listMemberships(db(), session.user.id);
    if (!first) redirect(`/${locale}/onboarding`);
    tenantId = first.tenant_id;
    access = await getTenantAccess(db(), session.user.id, tenantId);
    if (!access) redirect(`/${locale}/onboarding`);
    const token = await sessionToken();
    if (token) await setActiveTenant(db(), token, tenantId);
  }
  return { session, access };
}
