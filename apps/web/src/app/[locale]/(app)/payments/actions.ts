"use server";

import { setPaymentCheck } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

export async function checkPaymentAction(form: FormData) {
  const locale = localeOf(form);
  const q = str(form, "query");
  await runAction(`/${locale}/payments${q ? `?${q}` : ""}`, async () => {
    const { actor } = await appContext(locale, "payment.verify");
    const value = str(form, "status");
    const status = value === "confirmed" || value === "not_found" ? value : null;
    await setPaymentCheck(db(), actor, str(form, "paymentId"), status, str(form, "note"));
  });
}
