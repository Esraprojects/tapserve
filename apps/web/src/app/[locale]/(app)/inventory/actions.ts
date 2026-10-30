"use server";

import {
  addUnit, DomainError, postStockCount, recordPurchase, recordWaste, saveCountLines, saveInventoryItem, saveSupplier,
  setOpeningStock, startStockCount, transferStock,
} from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { birrField, localeOf, quantityField, runAction, str } from "@/server/actions";

const requiredQuantity = (form: FormData, key: string) => {
  const q = quantityField(form, key);
  if (q === null) throw new DomainError("invalid_quantity");
  return q;
};

export async function saveInventoryItemAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory`, async () => {
    const { actor } = await appContext(locale, "inventory.manage");
    await saveInventoryItem(db(), actor, {
      id: str(form, "id") || undefined,
      nameAm: str(form, "nameAm"),
      nameEn: str(form, "nameEn"),
      unitId: str(form, "unitId"),
      category: str(form, "category"),
      reorderLevel: quantityField(form, "reorderLevel") ?? 0,
    });
  });
}

export async function addUnitAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory`, async () => {
    const { actor } = await appContext(locale, "inventory.manage");
    await addUnit(db(), actor, { nameAm: str(form, "nameAm"), nameEn: str(form, "nameEn") });
  });
}

export async function wasteAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory`, async () => {
    const { actor, branchId } = await appContext(locale, "inventory.manage");
    await recordWaste(db(), actor, {
      branchId, itemId: str(form, "itemId"), quantity: requiredQuantity(form, "quantity"), reason: str(form, "reason"),
    });
  });
}

export async function openingStockAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory`, async () => {
    const { actor, branchId } = await appContext(locale, "inventory.manage");
    await setOpeningStock(db(), actor, {
      branchId, itemId: str(form, "itemId"), quantity: requiredQuantity(form, "quantity"),
      unitCostSantim: birrField(form, "unitCost"),
    });
  });
}

export async function transferAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory`, async () => {
    const { actor, branchId } = await appContext(locale, "inventory.manage");
    await transferStock(db(), actor, {
      fromBranchId: branchId, toBranchId: str(form, "toBranchId"), note: str(form, "note"),
      lines: [{ itemId: str(form, "itemId"), quantity: requiredQuantity(form, "quantity") }],
    });
  });
}

export async function purchaseAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory/purchases`, async () => {
    const { actor, branchId } = await appContext(locale, "inventory.manage");
    const lines = form.getAll("itemId").flatMap((itemId, i) => {
      const q = String(form.getAll("quantity")[i] ?? "").trim().replace(",", ".");
      if (typeof itemId !== "string" || !itemId || !q) return [];
      const lineForm = new FormData();
      lineForm.set("total", String(form.getAll("lineTotal")[i] ?? ""));
      return [{ itemId, quantity: Number(q), lineTotalSantim: birrField(lineForm, "total") }];
    });
    await recordPurchase(db(), actor, {
      branchId,
      supplierId: str(form, "supplierId") || null,
      invoiceRef: str(form, "invoiceRef"),
      purchasedOn: str(form, "purchasedOn"),
      paymentMethodCode: str(form, "method") || null,
      note: str(form, "note"),
      lines,
    });
    return `/${locale}/inventory/purchases?saved=1`;
  });
}

export async function saveSupplierAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory/purchases`, async () => {
    const { actor } = await appContext(locale, "inventory.manage");
    await saveSupplier(db(), actor, {
      id: str(form, "id") || undefined, name: str(form, "name"), phone: str(form, "phone"), tin: str(form, "tin"), note: str(form, "note"),
    });
  });
}

export async function startCountAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/inventory/counts`, async () => {
    const { actor, branchId } = await appContext(locale, "inventory.manage");
    const id = await startStockCount(db(), actor, branchId);
    return `/${locale}/inventory/counts/${id}`;
  });
}

export async function saveCountAction(form: FormData) {
  const locale = localeOf(form);
  const countId = str(form, "countId");
  const post = str(form, "intent") === "post";
  await runAction(`/${locale}/inventory/counts/${countId}`, async () => {
    const { actor } = await appContext(locale, "inventory.manage");
    const lines = form.getAll("itemId").map((itemId, i) => {
      const raw = String(form.getAll("counted")[i] ?? "").trim().replace(",", ".");
      const value = raw === "" ? null : Number(raw);
      if (value !== null && !Number.isFinite(value)) throw new DomainError("invalid_quantity");
      return { itemId: String(itemId), countedQuantity: value };
    });
    await saveCountLines(db(), actor, countId, lines);
    if (post) await postStockCount(db(), actor, countId, str(form, "note"));
    return `/${locale}/inventory/counts/${countId}${post ? "" : "?saved=1"}`;
  });
}
