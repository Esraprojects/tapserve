import { auditTrail, hasRooms, profitReport, roomReport, salesReport } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { BarList, ColumnChart } from "@/components/charts";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/PrintButton";
import { bothCalendars, shortDay } from "@/lib/dates";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { reportRange } from "@/lib/reportParams";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branches, can, access } = await appContext(locale, "reports.view");
  const { from, to, branchId } = reportRange(search, branches);
  const report = await salesReport(db(), actor, { from, to }, branchId);
  const profit = can("reports.profit.view") ? await profitReport(db(), actor, { from, to }, branchId) : null;
  const rooms = hasRooms(access.businessType) ? await roomReport(db(), actor, { from, to }, branchId) : null;
  const audit = can("audit.view") ? await auditTrail(db(), actor, { from, to }, 100) : [];
  const fmt = (v: number) => money(locale, v);
  const r = t.reports;
  const query = new URLSearchParams({ from, to, ...(branchId ? { branch: branchId } : {}) }).toString();
  const dt = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });

  const kpis = [
    { label: r.gross, value: fmt(report.totals.gross_santim) },
    { label: r.net, value: fmt(report.totals.net_santim) },
    { label: r.tax, value: fmt(report.totals.tax_santim) },
    { label: r.serviceCharge, value: fmt(report.totals.service_charge_santim) },
    { label: r.bills, value: String(report.totals.bills) },
    { label: r.averageBill, value: fmt(report.totals.average_bill_santim) },
    { label: r.discounts, value: fmt(report.totals.discounts_santim) },
    { label: r.voids, value: fmt(report.totals.voids_santim) },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title={r.title}
        subtitle={`${bothCalendars(from, locale)} → ${bothCalendars(to, locale)}`}
        actions={
          <>
            <a href={`/${locale}/reports/sales.csv?${query}`} className="btn-secondary no-print">{r.exportCsv}</a>
            <div className="no-print"><PrintButton label={r.print} auto={false} /></div>
          </>
        }
      />

      <form className="no-print card mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">{r.from}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="input py-2" />
        </div>
        <div>
          <label className="label" htmlFor="to">{r.to}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="input py-2" />
        </div>
        {branches.length > 1 && (
          <div>
            <label className="label" htmlFor="branch">{t.nav.branch}</label>
            <select id="branch" name="branch" defaultValue={branchId ?? ""} className="input py-2">
              <option value="">{r.allBranches}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn w-auto">{r.apply}</button>
      </form>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card py-4">
            <p className="text-sm text-stone-500">{k.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
          </div>
        ))}
      </section>
      {rooms && rooms.rooms > 0 && <RoomSection locale={locale} t={t} report={rooms} />}
      {profit && <ProfitSection locale={locale} t={t} profit={profit} />}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">{r.daily}</h2>
          <ColumnChart label={r.daily} data={report.daily.map((d) => ({ label: shortDay(d.day, locale), value: d.gross_santim }))} format={fmt} />
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-stone-500">{r.day} / {r.gross}</summary>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr><th className="py-1 font-medium">{r.day}</th><th className="py-1 text-right font-medium">{r.bills}</th><th className="py-1 text-right font-medium">{r.net}</th><th className="py-1 text-right font-medium">{r.tax}</th><th className="py-1 text-right font-medium">{r.gross}</th></tr>
              </thead>
              <tbody>
                {report.daily.map((d) => (
                  <tr key={d.day} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-1">{bothCalendars(d.day, locale)}</td>
                    <td className="py-1 text-right tabular-nums">{d.bills}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(d.net_santim)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(d.tax_santim)}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(d.gross_santim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">{r.byMethod}</h2>
          {report.byMethod.length ? (
            <BarList data={report.byMethod.map((m) => ({ label: `${pick(locale, m.name_am, m.name_en)} (${m.count})`, value: m.total_santim }))} format={fmt} />
          ) : <p className="text-sm text-stone-500">{r.noData}</p>}
        </section>
        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">{r.topItems}</h2>
          {report.topItems.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr><th className="pb-2 font-medium">{r.item}</th><th className="pb-2 text-right font-medium">{r.quantity}</th><th className="pb-2 text-right font-medium">{r.revenue}</th></tr>
              </thead>
              <tbody>
                {report.topItems.map((i) => (
                  <tr key={i.name_en + i.name_am} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-2">{pick(locale, i.name_am, i.name_en)}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(i.revenue_santim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-stone-500">{r.noData}</p>}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">{r.byWaiter}</h2>
          {report.byWaiter.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr><th className="pb-2 font-medium">{t.order.waiter}</th><th className="pb-2 text-right font-medium">{r.orders}</th><th className="pb-2 text-right font-medium">{r.revenue}</th></tr>
              </thead>
              <tbody>
                {report.byWaiter.map((w) => (
                  <tr key={w.name} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-2">{w.name}</td>
                    <td className="py-2 text-right tabular-nums">{w.orders}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(w.revenue_santim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-stone-500">{r.noData}</p>}
        </section>
        <section className="card lg:col-span-3">
          <h2 className="mb-3 font-semibold">{r.byHour}</h2>
          <ColumnChart
            label={r.byHour}
            data={Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, value: report.byHour.find((x) => x.hour === h)?.gross_santim ?? 0 }))}
            format={fmt}
          />
        </section>
      </div>

      {can("audit.view") && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">{r.audit}</h2>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left dark:bg-stone-800">
                <tr><th className="px-3 py-2">{r.when}</th><th className="px-3 py-2">{r.who}</th><th className="px-3 py-2">{r.what}</th><th className="px-3 py-2">{r.reason}</th></tr>
              </thead>
              <tbody>
                {audit.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-stone-500">{r.noData}</td></tr>}
                {audit.map((a, i) => (
                  <tr key={i} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="whitespace-nowrap px-3 py-2">{dt.format(a.at)}</td>
                    <td className="px-3 py-2">{a.actor}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-3 py-2">{a.reason ?? ""}</td>
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

function ProfitSection({ locale, t, profit }: {
  locale: "am" | "en";
  t: Awaited<ReturnType<typeof resolveLocale>>["t"];
  profit: Awaited<ReturnType<typeof profitReport>>;
}) {
  const p = t.profit;
  const fmt = (v: number) => money(locale, v);
  const revenue = profit.net_sales_santim + profit.service_charge_santim + profit.room_revenue_santim;
  const margin = revenue > 0 ? Math.round((profit.net_profit_santim / revenue) * 100) : 0;
  const rows: { label: string; value: number; sign: string; strong?: boolean }[] = [
    { label: p.netSales, value: profit.net_sales_santim, sign: "" },
    ...(profit.service_charge_santim ? [{ label: p.serviceCharge, value: profit.service_charge_santim, sign: "+" }] : []),
    ...(profit.room_revenue_santim ? [{ label: t.roomReport.revenue, value: profit.room_revenue_santim, sign: "+" }] : []),
    { label: p.costOfSales, value: profit.cost_of_sales_santim, sign: "−" },
    { label: p.grossProfit, value: profit.gross_profit_santim, sign: "=", strong: true },
    { label: p.stockLoss, value: profit.stock_loss_santim, sign: "−" },
    { label: p.expenses, value: profit.expenses_santim, sign: "−" },
  ];
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-3">
      <div className="card">
        <h2 className="mb-3 font-semibold">{p.title}</h2>
        <dl className="space-y-1.5 text-sm">
          {rows.map((row) => (
            <div key={row.label} className={`flex justify-between ${row.strong ? "border-t border-stone-200 pt-1.5 font-semibold dark:border-stone-800" : ""}`}>
              <dt>{row.sign && <span className="mr-1 inline-block w-3 text-stone-400">{row.sign}</span>}{row.label}</dt>
              <dd className="tabular-nums">{fmt(row.value)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-200 pt-2 text-lg font-bold dark:border-stone-800">
            <dt>{p.netProfit}</dt>
            <dd className={`tabular-nums ${profit.net_profit_santim < 0 ? "text-red-600" : ""}`}>{fmt(profit.net_profit_santim)}</dd>
          </div>
          <div className="flex justify-between text-stone-500"><dt>{p.margin}</dt><dd className="tabular-nums">{margin}%</dd></div>
        </dl>
        {profit.items_without_recipe > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            {format(p.missingRecipes, { n: String(profit.items_without_recipe) })}
          </p>
        )}
      </div>
      <div className="card lg:col-span-2">
        <h2 className="mb-3 font-semibold">{p.daily}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500">
              <tr>
                <th className="py-1 font-medium">{t.reports.day}</th><th className="py-1 text-right font-medium">{p.netSales}</th>
                <th className="py-1 text-right font-medium">{p.costOfSales}</th><th className="py-1 text-right font-medium">{p.expenses}</th>
                <th className="py-1 text-right font-medium">{p.netProfit}</th>
              </tr>
            </thead>
            <tbody>
              {profit.daily.map((d) => (
                <tr key={d.day} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="py-1">{bothCalendars(d.day, locale)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(d.net_sales_santim)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(d.cost_santim)}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(d.expenses_santim)}</td>
                  <td className={`py-1 text-right font-medium tabular-nums ${d.profit_santim < 0 ? "text-red-600" : ""}`}>{fmt(d.profit_santim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {profit.expensesByCategory.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-sm font-semibold">{p.expensesByCategory}</h3>
            <BarList data={profit.expensesByCategory.map((c) => ({ label: pick(locale, c.name_am, c.name_en), value: c.total_santim }))} format={fmt} />
          </>
        )}
      </div>
    </section>
  );
}

function RoomSection({ locale, t, report }: {
  locale: "am" | "en";
  t: Awaited<ReturnType<typeof resolveLocale>>["t"];
  report: Awaited<ReturnType<typeof roomReport>>;
}) {
  const rr = t.roomReport;
  const fmt = (v: number) => money(locale, v);
  const kpis = [
    { label: rr.occupancy, value: `${(report.occupancyBp / 100).toFixed(1)}%` },
    { label: rr.adr, value: fmt(report.adrSantim) },
    { label: rr.revpar, value: fmt(report.revparSantim) },
    { label: rr.revenue, value: fmt(report.revenueSantim) },
    { label: t.reports.tax, value: fmt(report.taxSantim) },
    { label: rr.sold, value: `${report.roomNightsSold}`, note: format(rr.available, { n: report.roomNightsAvailable }) },
  ];
  return (
    <section className="mt-6">
      <h2 className="mb-3 font-semibold">{rr.title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="card">
            <p className="text-sm text-stone-500">{k.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
            {k.note && <p className="text-xs text-stone-500">{k.note}</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          {/* ColumnChart works in santim, so counts are scaled by 100 and back. */}
          <h3 className="mb-3 text-sm font-semibold">{rr.daily}</h3>
          <ColumnChart label={rr.daily} data={report.daily.map((d) => ({ label: shortDay(d.day, locale), value: d.sold * 100 }))} format={(v) => String(v / 100)} />
        </div>
        <div className="card space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">{rr.bySource}</h3>
            <BarList data={report.bySource.map((x) => ({ label: t.hotel.sources[x.source as keyof typeof t.hotel.sources] ?? x.source, value: x.revenue_santim }))} format={fmt} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{rr.byCategory}</h3>
            <BarList data={report.byCategory.map((x) => ({ label: t.hotel.rates[x.category as "local" | "foreign"], value: x.revenue_santim }))} format={fmt} />
          </div>
        </div>
      </div>
    </section>
  );
}
