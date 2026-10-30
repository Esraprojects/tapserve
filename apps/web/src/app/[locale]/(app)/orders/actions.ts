"use server";

import { birrToSantim } from "@tapserve/core";
import {
  cancelOrder, createBill, discountItem, mergeOrders, recordPayments, requestBill, transferOrder, voidBill, voidItem,
} from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

const back = (form: FormData) => `/${localeOf(form)}/orders/${str(form, "orderId")}`;

export async function voidItemAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await voidItem(db(), actor, str(form, "itemId"), str(form, "reason"));
  });
}

export async function discountItemAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    let amount: number;
    try {
      amount = birrToSantim(str(form, "amount"));
    } catch {
      throw new Error("invalid_amount");
    }
    await discountItem(db(), actor, str(form, "itemId"), amount, str(form, "reason"));
  });
}

export async function requestBillAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await requestBill(db(), actor, str(form, "orderId"));
  });
}

export async function createBillAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    const selected = form.getAll("itemIds").filter((v): v is string => typeof v === "string");
    await createBill(db(), actor, str(form, "orderId"), str(form, "mode") === "selected" ? selected : undefined);
  });
}

export async function voidBillAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await voidBill(db(), actor, str(form, "billId"), str(form, "reason") || "Voided at POS");
  });
}

export async function recordPaymentsAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    const methods = form.getAll("method").map(String);
    const amounts = form.getAll("amount").map(String);
    const references = form.getAll("reference").map(String);
    const payments = methods
      .map((methodCode, i) => ({ methodCode, amount: amounts[i]?.trim() ?? "", reference: references[i] ?? "" }))
      .filter((p) => p.methodCode && p.amount)
      .map((p) => {
        try {
          return { methodCode: p.methodCode, amountSantim: birrToSantim(p.amount), reference: p.reference };
        } catch {
          throw new Error("invalid_amount");
        }
      });
    await recordPayments(db(), actor, str(form, "billId"), payments);
  });
}

export async function transferOrderAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await transferOrder(db(), actor, str(form, "orderId"), str(form, "tableId"));
  });
}

export async function mergeOrderAction(form: FormData) {
  const locale = localeOf(form);
  const into = str(form, "intoOrderId");
  await runAction(back(form), async () => {
    const { actor } = await appContext(locale);
    await mergeOrders(db(), actor, str(form, "orderId"), into);
    return `/${locale}/orders/${into}`;
  });
}

export async function cancelOrderAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(back(form), async () => {
    const { actor } = await appContext(locale);
    await cancelOrder(db(), actor, str(form, "orderId"), str(form, "reason") || "Cancelled");
    return `/${locale}/orders`;
  });
}
