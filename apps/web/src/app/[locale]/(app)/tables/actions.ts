"use server";

import { removeTable, saveArea, saveTable } from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

export async function addTableAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/tables?manage=1`, async () => {
    const { actor, branchId } = await appContext(locale);
    const name = str(form, "name");
    if (!name) throw new Error("invalid_input");
    await saveTable(db(), actor, {
      branchId,
      name,
      seats: Math.max(1, Math.min(50, Number(str(form, "seats")) || 4)),
      areaId: str(form, "areaId") || null,
    });
  });
}

export async function addAreaAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/tables?manage=1`, async () => {
    const { actor, branchId } = await appContext(locale);
    const name = str(form, "name");
    if (!name) throw new Error("invalid_input");
    await saveArea(db(), actor, { branchId, name });
  });
}

export async function removeTableAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/tables?manage=1`, async () => {
    const { actor } = await appContext(locale);
    await removeTable(db(), actor, str(form, "id"));
  });
}
