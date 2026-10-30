import Link from "next/link";
import { type BookingRow, listBookings, listRooms } from "@tapserve/db";
import { PageHeader } from "@/components/PageHeader";
import { addDays, addisToday, isIsoDate, shortDay } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { HotelTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;
const DAYS = 14;
const BAR: Record<string, string> = {
  reserved: "bg-sky-500 text-white",
  checked_in: "bg-brand-600 text-white",
  checked_out: "bg-stone-300 text-stone-700 dark:bg-stone-600 dark:text-stone-100",
  no_show: "bg-amber-300 text-amber-900",
};

const DOT: Record<string, string> = { clean: "bg-brand-500", inspected: "bg-sky-500", dirty: "bg-amber-500", out_of_order: "bg-red-500" };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Tape chart: rooms down the side, two weeks across, one bar per stay. */
export default async function RoomChartPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "hotel.frontdesk");
  const today = addisToday();
  const fromParam = param(search.from);
  const from = isIsoDate(fromParam) ? fromParam : addDays(today, -1);
  const to = addDays(from, DAYS - 1);
  const [rooms, bookings] = await Promise.all([
    listRooms(db(), actor, branchId, { activeOnly: true }),
    listBookings(db(), actor, branchId, { from, to }),
  ]);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const unassigned = bookings.filter((b) => !b.room_id && b.status === "reserved");
  const cols = `5.5rem repeat(${DAYS}, minmax(2.75rem, 1fr))`;
  const h = t.hotel;

  const bar = (b: BookingRow, row: number) => {
    const start = b.arrival < from ? from : b.arrival;
    const end = b.departure > addDays(to, 1) ? addDays(to, 1) : b.departure;
    return (
      <Link key={b.id} href={`/${locale}/hotel/bookings/${b.id}`} title={`${b.guest_name} · ${h.status[b.status]}`}
        style={{ gridColumn: `${2 + daysBetween(from, start)} / span ${Math.max(1, daysBetween(start, end))}`, gridRow: row }}
        className={`z-10 my-1 truncate rounded-md px-1.5 py-1 text-xs font-medium ${BAR[b.status] ?? ""}`}>
        {b.guest_name}
      </Link>
    );
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <PageHeader title={h.title} actions={<>
        <Link href={`?from=${addDays(from, -7)}`} className="btn-secondary">{h.earlier}</Link>
        <Link href="?" className="btn-secondary">{t.common.today}</Link>
        <Link href={`?from=${addDays(from, 7)}`} className="btn-secondary">{h.later}</Link>
      </>} />
      <HotelTabs locale={locale} t={t} active="calendar" canManage={can("hotel.manage")} />

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="min-w-[44rem]">
          <div className="grid border-b border-stone-200 text-center text-xs dark:border-stone-800" style={{ gridTemplateColumns: cols }}>
            <div />
            {days.map((d) => (
              <div key={d} className={`py-2 ${d === today ? "font-bold text-brand-700 dark:text-brand-500" : "text-stone-500"}`}>{shortDay(d, locale)}</div>
            ))}
          </div>
          {rooms.map((room) => (
            <div key={room.id} className="grid border-b border-stone-100 dark:border-stone-800" style={{ gridTemplateColumns: cols }}>
              <div className="flex items-center gap-1 px-2 py-1 text-sm" style={{ gridRow: 1 }}>
                <span className="font-semibold">{room.number}</span>
                <span className={`h-2 w-2 rounded-full ${DOT[room.hk_status]}`} title={t.housekeeping.statuses[room.hk_status]} />
              </div>
              {days.map((d, i) => (
                <Link key={d} href={`/${locale}/hotel/bookings/new?arrival=${d}&departure=${addDays(d, 1)}`} aria-label={`${room.number} ${d}`}
                  style={{ gridColumn: i + 2, gridRow: 1 }}
                  className={`border-l border-stone-100 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800 ${d === today ? "bg-brand-50/50 dark:bg-brand-700/10" : ""}`} />
              ))}
              {bookings.filter((b) => b.room_id === room.id).map((b) => bar(b, 1))}
            </div>
          ))}
          {unassigned.length > 0 && (
            <div className="grid bg-stone-50 dark:bg-stone-800/40" style={{ gridTemplateColumns: cols }}>
              <div className="px-2 py-1 text-xs text-stone-500" style={{ gridRow: `1 / span ${unassigned.length}` }}>{h.assignLater}</div>
              {unassigned.map((b, i) => bar(b, i + 1))}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 flex flex-wrap gap-3 text-xs text-stone-500">
        {(["reserved", "checked_in", "checked_out", "no_show"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1"><span className={`inline-block h-3 w-5 rounded ${BAR[s]}`} />{h.status[s]}</span>
        ))}
      </p>
    </main>
  );
}
