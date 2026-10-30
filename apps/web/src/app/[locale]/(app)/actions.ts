"use server";

import { listBranches, setActiveBranch } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";
import { sessionToken } from "@/server/session";

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
