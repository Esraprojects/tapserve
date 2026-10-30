import { listStockCounts } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { startCountAction } from "../actions";
import { InventoryTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CountsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "inventory.manage");
  const counts = await listStockCounts(db(), actor, branchId);
  const hasDraft = counts.some((c) => c.status === "draft");
  const inv = t.inventory;
  const dt = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={inv.title} />
      <InventoryTabs locale={locale} t={t} active="counts" />
      <FormError t={t} code={param(search.error)} />
      <form action={startCountAction} className="card mb-6 space-y-2">
        <input type="hidden" name="locale" value={locale} />
        <p className="text-sm text-stone-500">{inv.countHint}</p>
        <button className="btn w-auto px-6">{hasDraft ? inv.continueCount : inv.startCount}</button>
      </form>
      {counts.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{inv.pastCounts}</h2>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left dark:bg-stone-800">
                <tr><th className="px-3 py-2">{inv.when}</th><th className="px-3 py-2">{inv.lines}</th><th className="px-3 py-2 text-right">{inv.variance}</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="px-3 py-2">
                      <a href={`/${locale}/inventory/counts/${c.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-500">{dt.format(c.posted_at ?? c.created_at)}</a>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{c.lines}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${c.variance_value_santim < 0 ? "text-red-600" : ""}`}>{c.status === "posted" ? money(locale, c.variance_value_santim) : "—"}</td>
                    <td className="px-3 py-2 text-right text-stone-500">{c.status === "posted" ? inv.posted : inv.draft}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
