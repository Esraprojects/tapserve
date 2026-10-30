import Link from "next/link";
import { frontDesk, hotelToday } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { addDays, bothCalendars } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { BookingList } from "./BookingList";
import { HotelTabs } from "./tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function FrontDeskPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "hotel.frontdesk");
  const [desk, today] = await Promise.all([frontDesk(db(), actor, branchId), hotelToday(db(), actor, branchId)]);
  const h = t.hotel;
  // Guests leaving today are listed once, under departures.
  const staying = desk.inHouse.filter((b) => b.departure > desk.today);
  const tiles = [
    { label: t.dashboard.occupancyNow, value: `${today.inHouse} / ${today.rooms}` },
    { label: t.dashboard.arrivalsToday, value: String(today.arrivals) },
    { label: t.dashboard.departuresToday, value: String(today.departures) },
    { label: t.dashboard.roomsToClean, value: String(today.dirty) },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title={h.title}
        subtitle={bothCalendars(desk.today, locale)}
        actions={<>
          <Link href={`/${locale}/hotel/bookings/new?walkin=1`} className="btn-secondary">{h.walkIn}</Link>
          <Link href={`/${locale}/hotel/bookings/new`} className="btn w-auto">{h.newBooking}</Link>
        </>}
      />
      <HotelTabs locale={locale} t={t} active="today" canManage={can("hotel.manage")} />
      <FormError t={t} code={param(search.error)} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card">
            <p className="text-sm text-stone-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>
      {desk.inHouse.length > 0 && (today.lastAudit ?? "") < addDays(desk.today, -1) && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          <Link href={`/${locale}/hotel/audit`} className="underline">{t.dashboard.auditReminder}</Link>
          {today.lastAudit && <span className="block text-xs">{format(h.lastAudit, { date: bothCalendars(today.lastAudit, locale) })}</span>}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card">
          <h2 className="mb-2 font-semibold">{h.arrivals} <span className="text-stone-400">{desk.arrivals.length}</span></h2>
          <BookingList rows={desk.arrivals} locale={locale} t={t} empty={h.noArrivals} />
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">{h.departures} <span className="text-stone-400">{desk.departures.length}</span></h2>
          <BookingList rows={desk.departures} locale={locale} t={t} empty={h.noDepartures} />
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">{h.inHouse} <span className="text-stone-400">{staying.length}</span></h2>
          <BookingList rows={staying} locale={locale} t={t} empty={h.noInHouse} />
        </section>
      </div>
      {desk.upcoming.length > 0 && (
        <section className="card mt-4">
          <h2 className="mb-2 font-semibold">{h.upcoming}</h2>
          <BookingList rows={desk.upcoming} locale={locale} t={t} empty="" />
        </section>
      )}
    </main>
  );
}
