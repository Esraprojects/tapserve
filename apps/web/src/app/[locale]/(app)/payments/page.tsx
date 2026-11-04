import { listPaymentMethods, listPayments } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { bothCalendars } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { paymentFilter, paymentQuery } from "@/lib/paymentFilter";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { checkPaymentAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branches, can } = await appContext(locale, "reports.view");
  const filter = paymentFilter(search, branches);
  const [methods, rows] = await Promise.all([listPaymentMethods(db(), actor), listPayments(db(), actor, filter)]);
  const p = t.payments;
  const query = paymentQuery(filter);
  const total = rows.reduce((s, r) => s + r.amount_santim, 0);
  const canVerify = can("payment.verify");
  const dt = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });
  const checkBadge = (status: string | null) =>
    status === "confirmed" ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800 dark:bg-brand-700/30 dark:text-brand-100">✓ {p.confirmed}</span>
    : status === "not_found" ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-200">✕ {p.notFound}</span>
    : <span className="text-xs text-stone-400">{p.unchecked}</span>;
  const checkForm = (paymentId: string, status: string, label: string, cls: string) => (
    <form action={checkPaymentAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="query" value={query} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="status" value={status} />
      <button className={`rounded-lg px-2 py-1 text-xs font-medium ${cls}`}>{label}</button>
    </form>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title={p.title} subtitle={p.subtitle}
        actions={<a href={`/${locale}/payments/payments.csv?${query}`} className="btn-secondary">{p.exportCsv}</a>} />
      <FormError t={t} code={param(search.error)} />

      <form className="card mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">{t.reports.from}</label>
          <input id="from" name="from" type="date" defaultValue={filter.range.from} className="input py-2" />
        </div>
        <div>
          <label className="label" htmlFor="to">{t.reports.to}</label>
          <input id="to" name="to" type="date" defaultValue={filter.range.to} className="input py-2" />
        </div>
        <div>
          <label className="label" htmlFor="method">{p.method}</label>
          <select id="method" name="method" defaultValue={filter.methodCode ?? ""} className="input py-2">
            <option value="">{p.allMethods}</option>
            {methods.map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="check">{p.check}</label>
          <select id="check" name="check" defaultValue={filter.check ?? ""} className="input py-2">
            <option value="">{p.all}</option>
            <option value="unchecked">{p.unchecked}</option>
            <option value="confirmed">{p.confirmed}</option>
            <option value="not_found">{p.notFound}</option>
          </select>
        </div>
        {branches.length > 1 && (
          <div>
            <label className="label" htmlFor="branch">{t.nav.branch}</label>
            <select id="branch" name="branch" defaultValue={filter.branchId ?? ""} className="input py-2">
              <option value="">{t.reports.allBranches}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn w-auto px-5">{t.reports.apply}</button>
      </form>

      <p className="mb-3 text-sm text-stone-500">
        {bothCalendars(filter.range.from, locale)} → {bothCalendars(filter.range.to, locale)} · {format(p.count, { n: String(rows.length) })} · {p.total}: <span className="font-semibold text-stone-900 dark:text-stone-100">{money(locale, total)}</span>
      </p>

      {rows.length === 0 ? (
        <p className="card text-stone-500">{p.none}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left dark:bg-stone-800">
              <tr>
                <th className="px-3 py-2">{p.time}</th><th className="px-3 py-2">{p.method}</th><th className="px-3 py-2">{p.reference}</th>
                <th className="px-3 py-2 text-right">{p.amount}</th><th className="px-3 py-2">{p.receipt}</th><th className="px-3 py-2">{p.receivedBy}</th>
                <th className="px-3 py-2">{p.check}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="px-3 py-2 whitespace-nowrap">{dt.format(r.created_at)}</td>
                  <td className="px-3 py-2">{pick(locale, r.method_am, r.method_en)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.reference || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(locale, r.amount_santim)}</td>
                  <td className="px-3 py-2">
                    {r.order_id
                      ? <a className="text-brand-700 hover:underline dark:text-brand-500" href={`/${locale}/orders/${r.order_id}`}>#{r.receipt_no}</a>
                      : <a className="text-brand-700 hover:underline dark:text-brand-500" href={`/${locale}/hotel/bookings/${r.booking_id}`}>{format(t.hotel.booking, { n: r.booking_no ?? "" })}</a>}
                    {branches.length > 1 ? ` · ${r.branch_name}` : ""}
                  </td>
                  <td className="px-3 py-2">{r.received_by}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {checkBadge(r.check_status)}
                      {canVerify && r.method_kind !== "cash" && (r.check_status === null ? (
                        <>
                          {checkForm(r.id, "confirmed", p.markFound, "bg-brand-600 text-white")}
                          {checkForm(r.id, "not_found", p.markMissing, "border border-red-300 text-red-700 dark:text-red-300")}
                        </>
                      ) : checkForm(r.id, "", p.clear, "text-stone-500 underline"))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
