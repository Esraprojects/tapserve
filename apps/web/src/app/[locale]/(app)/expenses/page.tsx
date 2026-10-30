import { listExpenseCategories, listExpenses, listPaymentMethods } from "@tapserve/db";
import { BarList } from "@/components/charts";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { addisToday, bothCalendars } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { reportRange } from "@/lib/reportParams";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { addExpenseCategoryAction, recordExpenseAction, voidExpenseAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ExpensesPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branches, branchId: currentBranch } = await appContext(locale, "expenses.manage");
  const { from, to } = reportRange(search, branches);
  const [categories, methods, expenses] = await Promise.all([
    listExpenseCategories(db(), actor), listPaymentMethods(db(), actor), listExpenses(db(), actor, { from, to }, currentBranch),
  ]);
  const e = t.expenses;
  const live = expenses.filter((x) => !x.voided_at);
  const total = live.reduce((s, x) => s + x.amount_santim, 0);
  const byCategory = new Map<string, number>();
  for (const x of live) {
    const k = pick(locale, x.category_am, x.category_en);
    byCategory.set(k, (byCategory.get(k) ?? 0) + x.amount_santim);
  }
  const query = new URLSearchParams({ from, to }).toString();

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title={e.title} subtitle={`${bothCalendars(from, locale)} → ${bothCalendars(to, locale)} · ${e.total}: ${money(locale, total)}`} />
      <FormError t={t} code={param(search.error)} />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          <form action={recordExpenseAction} className="card space-y-2">
            <h2 className="font-semibold">{e.add}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="query" value={query} />
            <label className="label" htmlFor="categoryId">{e.category}</label>
            <select id="categoryId" name="categoryId" className="input py-2">
              {categories.map((c) => <option key={c.id} value={c.id}>{pick(locale, c.name_am, c.name_en)}</option>)}
            </select>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label" htmlFor="amount">{e.amount}</label>
                <input id="amount" name="amount" inputMode="decimal" required className="input py-2" />
              </div>
              <div className="flex-1">
                <label className="label" htmlFor="spentOn">{e.date}</label>
                <input id="spentOn" name="spentOn" type="date" defaultValue={addisToday()} required className="input py-2" />
              </div>
            </div>
            <label className="label" htmlFor="method">{e.paidWith}</label>
            <select id="method" name="method" defaultValue="cash" className="input py-2">
              <option value="">—</option>
              {methods.filter((m) => m.kind !== "house_account").map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
            </select>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="fromDrawer" className="mt-1" /> {e.fromDrawer}
            </label>
            <input name="vendor" placeholder={e.vendor} aria-label={e.vendor} className="input py-2" />
            <input name="note" placeholder={e.note} aria-label={e.note} className="input py-2" />
            <button className="btn">{e.add}</button>
          </form>

          <details className="card">
            <summary className="cursor-pointer font-semibold">{e.addCategory}</summary>
            <form action={addExpenseCategoryAction} className="mt-3 space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="query" value={query} />
              <input name="nameAm" placeholder={t.menu.nameAm} aria-label={t.menu.nameAm} className="input py-2" />
              <input name="nameEn" placeholder={t.menu.nameEn} aria-label={t.menu.nameEn} className="input py-2" />
              <button className="btn-secondary w-full">{t.inventory.save}</button>
            </form>
          </details>
        </aside>

        <section className="space-y-4">
          <form className="card flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="from">{t.reports.from}</label>
              <input id="from" name="from" type="date" defaultValue={from} className="input py-2" />
            </div>
            <div>
              <label className="label" htmlFor="to">{t.reports.to}</label>
              <input id="to" name="to" type="date" defaultValue={to} className="input py-2" />
            </div>
            <button className="btn w-auto px-5">{t.reports.apply}</button>
          </form>

          {byCategory.size > 0 && (
            <div className="card">
              <h2 className="mb-3 font-semibold">{e.byCategory}</h2>
              <BarList data={[...byCategory].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} format={(v) => money(locale, v)} />
            </div>
          )}

          {expenses.length === 0 ? (
            <p className="card text-stone-500">{e.none}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
              <table className="w-full text-sm">
                <thead className="bg-stone-100 text-left dark:bg-stone-800">
                  <tr>
                    <th className="px-3 py-2">{e.date}</th><th className="px-3 py-2">{e.category}</th><th className="px-3 py-2">{e.vendor}</th>
                    <th className="px-3 py-2">{e.paidWith}</th><th className="px-3 py-2 text-right">{e.amount}</th><th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((x) => (
                    <tr key={x.id} className={`border-t border-stone-100 align-top dark:border-stone-800 ${x.voided_at ? "text-stone-400 line-through" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{bothCalendars(x.spent_on, locale)}</td>
                      <td className="px-3 py-2">{pick(locale, x.category_am, x.category_en)}</td>
                      <td className="px-3 py-2">{x.vendor || "—"}{x.note && <span className="block text-xs text-stone-500">{x.note}</span>}</td>
                      <td className="px-3 py-2">{x.method_en ? pick(locale, x.method_am ?? "", x.method_en) : "—"}{x.from_drawer ? " · ⧉" : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(locale, x.amount_santim)}</td>
                      <td className="px-3 py-2 text-right no-underline">
                        {x.voided_at ? (
                          <span className="text-xs" title={x.void_reason ?? ""}>{e.voided}</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer text-red-600">{e.void}</summary>
                            <form action={voidExpenseAction} className="mt-2 flex gap-1">
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="query" value={query} />
                              <input type="hidden" name="expenseId" value={x.id} />
                              <input name="reason" required placeholder={e.voidReason} aria-label={e.voidReason} className="input w-32 py-1 text-xs" />
                              <button className="rounded-lg bg-red-600 px-2 text-xs text-white">{e.void}</button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
