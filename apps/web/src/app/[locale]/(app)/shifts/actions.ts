"use server";

import { birrToSantim } from "@tapserve/core";
import { addCashMovement, closeShift, openShift } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

function amount(form: FormData, key: string): number {
  try {
    return birrToSantim(str(form, key) || "0");
  } catch {
    throw new Error("invalid_amount");
  }
}

export async function openShiftAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/shifts`, async () => {
    const { actor, branchId } = await appContext(locale);
    await openShift(db(), actor, branchId, amount(form, "float"));
  });
}

export async function cashMovementAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/shifts`, async () => {
    const { actor } = await appContext(locale);
    const kind = str(form, "kind") === "pay_in" ? "pay_in" : "pay_out";
    await addCashMovement(db(), actor, str(form, "shiftId"), kind, amount(form, "amount"), str(form, "reason"));
  });
}

export async function closeShiftAction(form: FormData) {
  const locale = localeOf(form);
  const shiftId = str(form, "shiftId");
  await runAction(`/${locale}/shifts`, async () => {
    const { actor } = await appContext(locale);
    await closeShift(db(), actor, shiftId, amount(form, "counted"), str(form, "note"));
    return `/${locale}/shifts?closed=${shiftId}`;
  });
}
