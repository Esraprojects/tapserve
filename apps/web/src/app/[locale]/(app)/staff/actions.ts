"use server";

import { addStaffMember, setStaffStatus } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

export async function addStaffAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/staff`, async () => {
    const { actor } = await appContext(locale);
    await addStaffMember(db(), actor, { phone: str(form, "phone"), fullName: str(form, "fullName"), roleName: str(form, "role") });
  });
}

export async function setStaffStatusAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/staff`, async () => {
    const { actor } = await appContext(locale);
    await setStaffStatus(db(), actor, str(form, "membershipId"), str(form, "status") === "active" ? "active" : "disabled");
  });
}
