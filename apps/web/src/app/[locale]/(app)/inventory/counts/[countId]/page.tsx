import { notFound } from "next/navigation";
import { getStockCount } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale } from "@/lib/locale";
import { money, pick, quantity } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { saveCountAction } from "../../actions";
import { InventoryTabs } from "../../tabs";

type Params = Promise<{ locale: string; countId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CountPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { countId } = await params;
  const search = await searchParams;
  const { actor } = await appContext(locale, "inventory.manage");
  const count = await getStockCount(db(), actor, countId);
  if (!count) notFound();
  const inv = t.inventory;
  const posted = count.status === "posted";
  const totalVariance = count.lines.reduce((s, l) => s + (l.counted_quantity === null ? 0 : l.variance_value_santim ?? 0), 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={inv.tabs.counts} subtitle={posted ? `${inv.posted} · ${inv.variance}: ${money(locale, totalVariance)}` : inv.countHint} />
      <InventoryTabs locale={locale} t={t} active="counts" />
      <FormError t={t} code={param(search.error)} />
      {param(search.saved) && <p className="mb-4 text-sm text-brand-700" role="status">✓ {inv.saveCount}</p>}
      <form action={saveCountAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="countId" value={count.id} />
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left dark:bg-stone-800">
              <tr>
                <th className="px-3 py-2">{inv.item}</th>
                <th className="px-3 py-2 text-right">{inv.expected}</th>
                <th className="px-3 py-2 text-right">{inv.counted}</th>
                <th className="px-3 py-2 text-right">{inv.variance}</th>
              </tr>
            </thead>
            <tbody>
              {count.lines.map((l) => {
                const unit = pick(locale, l.unit_am, l.unit_en);
                return (
                  <tr key={l.item_id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="px-3 py-2 font-medium">{pick(locale, l.name_am, l.name_en)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{quantity(locale, l.expected_quantity)} {unit}</td>
                    <td className="px-3 py-2 text-right">
                      {posted ? (
                        <span className="tabular-nums">{l.counted_quantity === null ? "—" : `${quantity(locale, l.counted_quantity)} ${unit}`}</span>
                      ) : (
                        <>
                          <input type="hidden" name="itemId" value={l.item_id} />
                          <input name="counted" inputMode="decimal" defaultValue={l.counted_quantity ?? ""} aria-label={`${inv.counted}: ${pick(locale, l.name_am, l.name_en)}`}
                            className="input ml-auto w-28 py-1.5 text-right" />
                        </>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${(l.variance_quantity ?? 0) < 0 ? "text-red-600" : ""}`}>
                      {l.variance_quantity === null ? "—" : `${quantity(locale, l.variance_quantity)} · ${money(locale, l.variance_value_santim ?? 0)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!posted && (
          <div className="flex flex-wrap items-center gap-3">
            <button name="intent" value="save" className="btn-secondary w-auto px-6">{inv.saveCount}</button>
            <button name="intent" value="post" className="btn w-auto px-6">{inv.postCount}</button>
            <span className="text-sm text-stone-500">{inv.postConfirm}</span>
          </div>
        )}
      </form>
    </main>
  );
}
