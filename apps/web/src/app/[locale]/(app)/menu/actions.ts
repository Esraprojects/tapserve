"use server";

import { birrToSantim } from "@tapserve/core";
import { DomainError, deleteCategory, deleteItem, saveCategory, saveItem, saveRecipe, setItemAvailability, type Station } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

const STATIONS = ["kitchen", "bar", "barista"];

export async function saveCategoryAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/menu`, async () => {
    const { actor } = await appContext(locale);
    const station = STATIONS.includes(str(form, "station")) ? (str(form, "station") as Station) : "kitchen";
    if (!str(form, "nameAm") && !str(form, "nameEn")) throw new Error("invalid_input");
    await saveCategory(db(), actor, {
      id: str(form, "id") || undefined,
      nameAm: str(form, "nameAm"),
      nameEn: str(form, "nameEn"),
      station,
      sort: Number(str(form, "sort")) || 0,
    });
  });
}

export async function deleteCategoryAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/menu`, async () => {
    const { actor } = await appContext(locale);
    await deleteCategory(db(), actor, str(form, "id"));
  });
}

/** "ትንሽ / Small = 40" -> { nameAm: "ትንሽ", nameEn: "Small", price }. */
function parseSizes(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [names = "", price = ""] = line.split("=").map((s) => s.trim());
    const parts = names.split("/").map((s) => s.trim());
    const hasEthiopic = (s: string) => /[ሀ-፿]/.test(s);
    const nameAm = parts.find(hasEthiopic) ?? "";
    const nameEn = parts.find((p) => !hasEthiopic(p)) ?? "";
    return { nameAm, nameEn, priceSantim: birrToSantim(price) };
  });
}

export async function saveItemAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "id");
  await runAction(id ? `/${locale}/menu?edit=${id}` : `/${locale}/menu`, async () => {
    const { actor } = await appContext(locale);
    if (!str(form, "nameAm") && !str(form, "nameEn")) throw new Error("invalid_input");
    let variants;
    try {
      const sizes = str(form, "sizes");
      variants = sizes ? parseSizes(sizes) : [{ nameAm: "", nameEn: "", priceSantim: birrToSantim(str(form, "price")) }];
    } catch {
      throw new Error("invalid_price");
    }
    await saveItem(db(), actor, {
      id: id || undefined,
      categoryId: str(form, "categoryId"),
      nameAm: str(form, "nameAm"),
      nameEn: str(form, "nameEn"),
      description: str(form, "description"),
      isFasting: form.get("isFasting") === "on",
      isAvailable: true,
      variants,
    });
    return `/${locale}/menu`;
  });
}

export async function toggleAvailabilityAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(str(form, "back") || `/${locale}/menu`, async () => {
    const { actor } = await appContext(locale);
    await setItemAvailability(db(), actor, str(form, "id"), str(form, "available") === "true");
  });
}

export async function deleteItemAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/menu`, async () => {
    const { actor } = await appContext(locale);
    await deleteItem(db(), actor, str(form, "id"));
  });
}

export async function saveRecipeAction(form: FormData) {
  const locale = localeOf(form);
  const variantId = str(form, "variantId");
  await runAction(`/${locale}/menu/recipe/${variantId}`, async () => {
    const { actor } = await appContext(locale, "menu.manage");
    const quantities = form.getAll("quantity");
    const lines = form.getAll("itemId").flatMap((itemId, i) => {
      const raw = String(quantities[i] ?? "").trim().replace(",", ".");
      if (typeof itemId !== "string" || !itemId || !raw) return [];
      const quantity = Number(raw);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new DomainError("invalid_quantity");
      return [{ itemId, quantity }];
    });
    await saveRecipe(db(), actor, variantId, lines);
    return `/${locale}/menu/costing`;
  });
}
