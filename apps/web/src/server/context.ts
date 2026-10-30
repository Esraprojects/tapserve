import { redirect } from "next/navigation";
import { type Actor, type BranchView, listBranches, setActiveBranch, type Session, type TenantAccess } from "@tapserve/db";
import type { Permission } from "@tapserve/core";
import type { Locale } from "@tapserve/i18n";
import { db } from "./db";
import { requireTenant, sessionToken } from "./session";

export interface AppContext {
  session: Session;
  access: TenantAccess;
  actor: Actor;
  branches: BranchView[];
  branchId: string;
  can: (permission: Permission) => boolean;
}

/** Signed-in user, their business, permissions and current branch. Redirects when anything is missing. */
export async function appContext(locale: Locale, permission?: Permission): Promise<AppContext> {
  const { session, access } = await requireTenant(locale);
  if (!access.onboardingCompleted) redirect(`/${locale}/onboarding?step=tax`);
  const actor: Actor = { tenantId: access.tenantId, userId: session.user.id, permissions: access.permissions };
  const branches = await listBranches(db(), actor);
  if (!branches.length) redirect(`/${locale}/login`);
  let branchId = session.activeBranchId;
  if (!branchId || !branches.some((b) => b.id === branchId)) {
    branchId = branches[0]!.id;
    const token = await sessionToken();
    if (token) await setActiveBranch(db(), token, branchId);
  }
  const can = (p: Permission) => access.permissions.includes(p);
  if (permission && !can(permission)) redirect(`/${locale}/dashboard?error=forbidden`);
  return { session, access, actor, branches, branchId, can };
}
