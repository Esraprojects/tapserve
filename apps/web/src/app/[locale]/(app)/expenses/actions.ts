"use server";

import { addExpenseCategory, recordExpense, voidExpense } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { birrField, localeOf, runAction, str } from "@/server/actions";

const back = (form: FormData, locale: string) => {
  const q = str(form, "query");
  return `/${locale}/expenses${q ? `?${q}` : ""}`;
};

export async function recordExpenseAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(back(form, locale), async () => {
    const { actor, branchId } = await appContext(locale, "expenses.manage");
    await recordExpense(db(), actor, {
      branchId,
      categoryId: str(form, "categoryId"),
      amountSantim: birrField(form, "amount"),
      spentOn: str(form, "spentOn"),
      paymentMethodCode: str(form, "method") || null,
      fromDrawer: form.get("fromDrawer") === "on",
      vendor: str(form, "vendor"),
      note: str(form, "note"),
    });
  });
}

export async function voidExpenseAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(back(form, locale), async () => {
    const { actor } = await appContext(locale, "expenses.manage");
    await voidExpense(db(), actor, str(form, "expenseId"), str(form, "reason"));
  });
}

export async function addExpenseCategoryAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(back(form, locale), async () => {
    const { actor } = await appContext(locale, "expenses.manage");
    await addExpenseCategory(db(), actor, { nameAm: str(form, "nameAm"), nameEn: str(form, "nameEn") });
  });
}
