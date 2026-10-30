"use server";

import { listBranches, listMemberships, setActiveBranch, setActiveTenant } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";
import { requireUser, sessionToken } from "@/server/session";

export async function switchBranchAction(form: FormData) {
  const locale = localeOf(form);
  const back = str(form, "back") || `/${locale}/dashboard`;
  await runAction(back.startsWith(`/${locale}/`) ? back : `/${locale}/dashboard`, async () => {
    const ctx = await appContext(locale);
    const branchId = str(form, "branchId");
    const branches = await listBranches(db(), ctx.actor);
    if (!branches.some((b) => b.id === branchId)) throw new Error("forbidden");
    const token = await sessionToken();
    if (token) await setActiveBranch(db(), token, branchId);
  });
}

/** Open another business the user belongs to (for example an owner with a café and a hotel). */
export async function switchBusinessAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/dashboard`, async () => {
    const session = await requireUser(locale);
    const tenantId = str(form, "tenantId");
    const memberships = await listMemberships(db(), session.user.id);
    if (!memberships.some((m) => m.tenant_id === tenantId)) throw new Error("forbidden");
    const token = await sessionToken();
    if (token) await setActiveTenant(db(), token, tenantId);
  });
}
