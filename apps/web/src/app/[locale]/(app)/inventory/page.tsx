import { listStock, listUnits } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick, quantity } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { addUnitAction, openingStockAction, saveInventoryItemAction, transferAction, wasteAction } from "./actions";
import { InventoryTabs } from "./tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function InventoryPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, branches } = await appContext(locale, "inventory.manage");
  const [items, units] = await Promise.all([listStock(db(), actor, branchId), listUnits(db(), actor)]);
  const editing = items.find((i) => i.id === param(search.edit));
  const low = items.filter((i) => i.low);
  const active = items.filter((i) => i.is_active);
  const totalValue = items.reduce((s, i) => s + i.value_santim, 0);
  const inv = t.inventory;
  const unitName = (i: { unit_am: string; unit_en: string }) => pick(locale, i.unit_am, i.unit_en);
  const itemOptions = active.map((i) => (
    <option key={i.id} value={i.id}>{pick(locale, i.name_am, i.name_en)} ({unitName(i)})</option>
  ));
  const otherBranches = branches.filter((b) => b.id !== branchId);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title={inv.title} subtitle={`${inv.value}: ${money(locale, totalValue)}`} />
      <InventoryTabs locale={locale} t={t} active="stock" />
      <FormError t={t} code={param(search.error)} />

      {low.length > 0 && (
        <section className="mb-6 rounded-2xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" role="status">
          <h2 className="font-semibold">⚠ {inv.lowStockTitle}</h2>
          <p className="mt-1 text-sm">
            {low.map((i) => `${pick(locale, i.name_am, i.name_en)} (${quantity(locale, i.quantity)} ${unitName(i)})`).join(" · ")}
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          {items.length === 0 ? (
            <p className="card text-stone-500">{inv.noItems}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
              <table className="w-full text-sm">
                <thead className="bg-stone-100 text-left dark:bg-stone-800">
                  <tr>
                    <th className="px-3 py-2">{inv.item}</th>
                    <th className="px-3 py-2 text-right">{inv.onHand}</th>
                    <th className="px-3 py-2 text-right">{inv.avgCost}</th>
                    <th className="px-3 py-2 text-right">{inv.value}</th>
                    <th className="px-3 py-2"><span className="sr-only">{inv.editItem}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className={`border-t border-stone-100 dark:border-stone-800 ${i.is_active ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{pick(locale, i.name_am, i.name_en)}</span>
                        {i.category && <span className="ml-2 text-xs text-stone-500">{i.category}</span>}
                        {i.low && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{inv.low}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${i.quantity < 0 ? "text-red-600" : ""}`}>
                        {quantity(locale, i.quantity)} {unitName(i)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(locale, Math.round(i.avg_cost_santim))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(locale, i.value_santim)}</td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/${locale}/inventory?edit=${i.id}#item-form`} className="text-brand-700 hover:underline dark:text-brand-500">{inv.editItem}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <form id="item-form" action={saveInventoryItemAction} className="card space-y-2">
            <h2 className="font-semibold">{editing ? inv.editItem : inv.addItem}</h2>
            <input type="hidden" name="locale" value={locale} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input name="nameAm" placeholder={t.menu.nameAm} aria-label={t.menu.nameAm} defaultValue={editing?.name_am} className="input py-2" />
            <input name="nameEn" placeholder={t.menu.nameEn} aria-label={t.menu.nameEn} defaultValue={editing?.name_en} className="input py-2" />
            <div className="flex gap-2">
              <select name="unitId" aria-label={inv.unit} defaultValue={editing?.unit_id ?? units[0]?.id} className="input py-2">
                {units.map((u) => <option key={u.id} value={u.id}>{pick(locale, u.name_am, u.name_en)}</option>)}
              </select>
              <input name="category" placeholder={inv.category} aria-label={inv.category} defaultValue={editing?.category} className="input py-2" />
            </div>
            <label className="label" htmlFor="reorderLevel">{inv.reorderLevel}</label>
            <input id="reorderLevel" name="reorderLevel" inputMode="decimal" defaultValue={editing ? String(editing.reorder_level) : "0"} className="input py-2" />
            <button className="btn">{inv.save}</button>
          </form>

          {active.length > 0 && (
            <form action={wasteAction} className="card space-y-2">
              <h2 className="font-semibold">{inv.waste}</h2>
              <p className="text-xs text-stone-500">{inv.wasteHint}</p>
              <input type="hidden" name="locale" value={locale} />
              <select name="itemId" aria-label={inv.item} className="input py-2">{itemOptions}</select>
              <input name="quantity" inputMode="decimal" required placeholder={inv.quantity} aria-label={inv.quantity} className="input py-2" />
              <input name="reason" required placeholder={inv.reason} aria-label={inv.reason} className="input py-2" />
              <button className="btn-secondary w-full">{inv.waste}</button>
            </form>
          )}

          {active.length > 0 && otherBranches.length > 0 && (
            <form action={transferAction} className="card space-y-2">
              <h2 className="font-semibold">{inv.transfer}</h2>
              <input type="hidden" name="locale" value={locale} />
              <select name="toBranchId" aria-label={inv.toBranch} className="input py-2">
                {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select name="itemId" aria-label={inv.item} className="input py-2">{itemOptions}</select>
              <input name="quantity" inputMode="decimal" required placeholder={inv.quantity} aria-label={inv.quantity} className="input py-2" />
              <button className="btn-secondary w-full">{inv.send}</button>
            </form>
          )}

          {active.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer font-semibold">{inv.opening}</summary>
              <form action={openingStockAction} className="mt-3 space-y-2">
                <p className="text-xs text-stone-500">{inv.openingHint}</p>
                <input type="hidden" name="locale" value={locale} />
                <select name="itemId" aria-label={inv.item} className="input py-2">{itemOptions}</select>
                <div className="flex gap-2">
                  <input name="quantity" inputMode="decimal" required placeholder={inv.quantity} aria-label={inv.quantity} className="input py-2" />
                  <input name="unitCost" inputMode="decimal" required placeholder={inv.unitCost} aria-label={inv.unitCost} className="input py-2" />
                </div>
                <button className="btn-secondary w-full">{inv.save}</button>
              </form>
            </details>
          )}

          <details className="card">
            <summary className="cursor-pointer font-semibold">{inv.addUnit}</summary>
            <form action={addUnitAction} className="mt-3 space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input name="nameAm" placeholder={t.menu.nameAm} aria-label={t.menu.nameAm} className="input py-2" />
              <input name="nameEn" placeholder={t.menu.nameEn} aria-label={t.menu.nameEn} className="input py-2" />
              <button className="btn-secondary w-full">{inv.save}</button>
            </form>
          </details>
        </aside>
      </div>
    </main>
  );
}
