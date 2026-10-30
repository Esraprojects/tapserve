"use server";

import { type ItemStatus, setItemStatus } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

export async function setItemStatusAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/kitchen?station=${encodeURIComponent(str(form, "station"))}`, async () => {
    const { actor } = await appContext(locale);
    await setItemStatus(db(), actor, str(form, "itemId"), str(form, "status") as ItemStatus);
  });
}
