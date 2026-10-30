import { menuCosting } from "@tapserve/db";
import { PageHeader } from "@/components/PageHeader";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

export default async function CostingPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const { actor, branchId } = await appContext(locale, "menu.manage");
  const rows = await menuCosting(db(), actor, branchId);
  const r = t.recipe;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={r.title} subtitle={r.hint}
        actions={<a href={`/${locale}/menu`} className="btn-secondary">{t.nav.menu}</a>} />
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left dark:bg-stone-800">
            <tr>
              <th className="px-3 py-2">{r.item}</th><th className="px-3 py-2 text-right">{r.price}</th>
              <th className="px-3 py-2 text-right">{r.cost}</th><th className="px-3 py-2 text-right">{r.costPct}</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const pct = v.price_santim > 0 ? Math.round((v.cost_santim / v.price_santim) * 100) : 0;
              const variant = pick(locale, v.variant_name_am, v.variant_name_en);
              return (
                <tr key={v.variant_id} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="px-3 py-2 font-medium">{pick(locale, v.item_name_am, v.item_name_en)}{variant ? ` · ${variant}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(locale, v.price_santim)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.ingredients ? money(locale, v.cost_santim) : <span className="text-stone-400">{r.noRecipe}</span>}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${pct > 40 ? "text-amber-700 dark:text-amber-400" : ""}`}>{v.ingredients ? `${pct}%` : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <a href={`/${locale}/menu/recipe/${v.variant_id}`} className="text-brand-700 hover:underline dark:text-brand-500">{r.edit}</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
