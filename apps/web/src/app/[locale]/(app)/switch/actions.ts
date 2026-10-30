"use server";

import { deleteSession, setOwnPin, switchUserWithPin } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";
import { sessionToken, setSessionCookie } from "@/server/session";

/** Hand the device to another staff member: new session for them, the old one is ended. */
export async function switchUserAction(form: FormData) {
  const locale = localeOf(form);
  const membershipId = str(form, "membershipId");
  await runAction(`/${locale}/switch?m=${encodeURIComponent(membershipId)}`, async () => {
    const { actor, branchId } = await appContext(locale);
    const { token } = await switchUserWithPin(db(), actor, { membershipId, pin: str(form, "pin"), branchId });
    const old = await sessionToken();
    await setSessionCookie(token);
    if (old) await deleteSession(db(), old);
    return `/${locale}/dashboard`;
  });
}

export async function setPinAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/switch`, async () => {
    const { actor } = await appContext(locale);
    await setOwnPin(db(), actor, str(form, "pin"));
    return `/${locale}/switch?pin=saved`;
  });
}
