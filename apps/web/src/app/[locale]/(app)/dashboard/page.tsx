import Link from "next/link";
import { hasRooms, hotelToday, listMemberships, liveStatus, lowStock, profitReport, roomReport, salesReport } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { BarList, ColumnChart } from "@/components/charts";
import { FormError } from "@/components/FormError";
import { addDays, addisToday, bothCalendars, shortDay } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { switchBusinessAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { session, access, actor, branchId, can } = await appContext(locale);
  const today = addisToday();
  const name = session.user.full_name || session.user.phone || session.user.email || "";
  const roleName = (t.roles as Record<string, string>)[access.roleName] ?? access.roleName;
  const live = await liveStatus(db(), actor, branchId);
  const canReports = can("reports.view");
  const [day, week] = canReports
    ? await Promise.all([
        salesReport(db(), actor, { from: today, to: today }, branchId),
        salesReport(db(), actor, { from: addDays(today, -6), to: today }, branchId),
      ])
    : [null, null];
  const profit = can("reports.profit.view") ? await profitReport(db(), actor, { from: today, to: today }, branchId) : null;
  const others = (await listMemberships(db(), session.user.id)).filter((m) => m.tenant_id !== access.tenantId);
  const low = can("inventory.manage") ? await lowStock(db(), actor, branchId) : [];
  const hotel = hasRooms(access.businessType) ? await hotelToday(db(), actor, branchId) : null;
  // Rooms are charged by the night audit, so the week's rates run up to last night.
  const rooms = hotel && hotel.rooms > 0 && canReports
    ? await roomReport(db(), actor, { from: addDays(today, -7), to: addDays(today, -1) }, branchId) : null;
  const fmt = (v: number) => money(locale, v);

  const tiles = [
    canReports && { label: t.dashboard.salesToday, value: fmt(day!.totals.gross_santim), hero: true },
    canReports && { label: t.reports.bills, value: String(day!.totals.bills) },
    canReports && { label: t.reports.averageBill, value: fmt(day!.totals.average_bill_santim) },
    profit && { label: t.dashboard.profitToday, value: fmt(profit.net_profit_santim) },
    { label: t.dashboard.openTables, value: `${live.occupiedTables} / ${live.totalTables}` },
    { label: t.dashboard.orders, value: String(live.openOrders) },
  ].filter(Boolean) as { label: string; value: string; hero?: boolean }[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6">
        <p className="text-sm text-stone-500">{access.tenantName} · {roleName}</p>
        <h1 className="text-2xl font-bold">{format(t.dashboard.welcome, { name })}</h1>
        <p className="mt-1 text-sm text-stone-500">{t.common.today}: {bothCalendars(today, locale)}</p>
        {others.length > 0 && (
          <form action={switchBusinessAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="locale" value={locale} />
            <span className="text-stone-500">{t.dashboard.switchBusiness}:</span>
            {others.map((m) => (
              <button key={m.tenant_id} name="tenantId" value={m.tenant_id} className="btn-secondary min-h-10 px-3">{m.tenant_name}</button>
            ))}
          </form>
        )}
      </header>
      <FormError t={t} code={param(search.error)} />
      {low.length > 0 && (
        <Link href={`/${locale}/inventory`} className="mb-4 block rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          ⚠ {t.inventory.lowStockTitle}: {low.slice(0, 6).map((i) => pick(locale, i.name_am, i.name_en)).join(", ")}{low.length > 6 ? "…" : ""}
        </Link>
      )}

      {hotel && hotel.rooms > 0 && (
        <section className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { label: t.dashboard.occupancyNow, value: `${hotel.inHouse} / ${hotel.rooms}`, href: "hotel" },
            { label: t.dashboard.arrivalsToday, value: String(hotel.arrivals), href: "hotel" },
            { label: t.dashboard.departuresToday, value: String(hotel.departures), href: "hotel" },
            { label: t.dashboard.roomsToClean, value: String(hotel.dirty), href: "housekeeping" },
            ...(rooms ? [
              { label: `${t.roomReport.adr} · ${t.reports.last7Days}`, value: fmt(rooms.adrSantim), href: "reports" },
              { label: `RevPAR · ${t.reports.last7Days}`, value: fmt(rooms.revparSantim), href: "reports" },
            ] : []),
          ].map((tile) => (
            <Link key={tile.label} href={`/${locale}/${tile.href}`} className="card hover:border-brand-500">
              <p className="text-sm text-stone-500">{tile.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{tile.value}</p>
            </Link>
          ))}
        </section>
      )}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className={`card ${tile.hero ? "col-span-2 lg:col-span-1" : ""}`}>
            <p className="text-sm text-stone-500">{tile.label}</p>
            <p className={`mt-2 font-semibold tabular-nums ${tile.hero ? "text-3xl" : "text-2xl"}`}>{tile.value}</p>
          </div>
        ))}
      </section>

      {canReports && week && day && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="card lg:col-span-2">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">{t.reports.daily} · {t.reports.last7Days}</h2>
              <Link href={`/${locale}/reports`} className="text-sm text-brand-600">{t.reports.title} →</Link>
            </div>
            <ColumnChart
              label={`${t.reports.daily} · ${t.reports.last7Days}`}
              data={week.daily.map((d) => ({ label: shortDay(d.day, locale), value: d.gross_santim }))}
              format={fmt}
            />
            <p className="mt-2 text-sm text-stone-500">
              {t.reports.gross}: <span className="font-semibold tabular-nums text-stone-900 dark:text-stone-100">{fmt(week.totals.gross_santim)}</span>
              {" · "}{t.reports.net}: <span className="tabular-nums">{fmt(week.totals.net_santim)}</span>
            </p>
          </section>
          <section className="card">
            <h2 className="mb-3 font-semibold">{t.reports.byMethod} · {t.common.today}</h2>
            {day.byMethod.length ? (
              <BarList data={day.byMethod.map((m) => ({ label: pick(locale, m.name_am, m.name_en), value: m.total_santim }))} format={fmt} />
            ) : <p className="text-sm text-stone-500">{t.reports.noData}</p>}
          </section>
          <section className="card lg:col-span-2">
            <h2 className="mb-3 font-semibold">{t.reports.topItems} · {t.common.today}</h2>
            {day.topItems.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-stone-500">
                  <tr><th className="pb-2 font-medium">{t.reports.item}</th><th className="pb-2 text-right font-medium">{t.reports.quantity}</th><th className="pb-2 text-right font-medium">{t.reports.revenue}</th></tr>
                </thead>
                <tbody>
                  {day.topItems.map((i) => (
                    <tr key={i.name_en + i.name_am} className="border-t border-stone-100 dark:border-stone-800">
                      <td className="py-2">{pick(locale, i.name_am, i.name_en)}</td>
                      <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{fmt(i.revenue_santim)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-stone-500">{t.reports.noData}</p>}
          </section>
          <section className="card">
            <h2 className="mb-3 font-semibold">{t.reports.byWaiter} · {t.common.today}</h2>
            {day.byWaiter.length ? (
              <BarList data={day.byWaiter.map((w) => ({ label: w.name, value: w.revenue_santim }))} format={fmt} />
            ) : <p className="text-sm text-stone-500">{t.reports.noData}</p>}
          </section>
        </div>
      )}
      {profit && profit.items_without_recipe > 0 && (
        <p className="mt-4 text-sm text-stone-500">{format(t.profit.missingRecipes, { n: String(profit.items_without_recipe) })}</p>
      )}
      {!canReports && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/${locale}/pos`} className="btn sm:w-auto">{t.nav.pos}</Link>
          <Link href={`/${locale}/tables`} className="btn-secondary">{t.nav.tables}</Link>
        </div>
      )}
    </main>
  );
}
