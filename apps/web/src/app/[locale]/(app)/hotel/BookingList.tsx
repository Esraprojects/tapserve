import Link from "next/link";
import type { BookingRow } from "@tapserve/db";
import { type Dictionary, format, type Locale } from "@tapserve/i18n";
import { shortDay } from "@/lib/dates";
import { money, pick } from "@/lib/text";
import { BOOKING_STATUS_STYLE } from "./tabs";

export function nightsLabel(t: Dictionary, n: number) {
  return n === 1 ? t.hotel.oneNight : format(t.hotel.nights, { n });
}

/** A compact list of bookings for the front desk; each row opens the booking and its folio. */
export function BookingList({ rows, locale, t, empty }: { rows: BookingRow[]; locale: Locale; t: Dictionary; empty: string }) {
  if (!rows.length) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <ul className="divide-y divide-stone-100 dark:divide-stone-800">
      {rows.map((b) => (
        <li key={b.id}>
          <Link href={`/${locale}/hotel/bookings/${b.id}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/50">
            <span className="w-14 shrink-0 rounded-lg bg-stone-100 py-1 text-center font-semibold tabular-nums dark:bg-stone-800">
              {b.room_number ?? "—"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{b.guest_name}{b.nationality !== "ET" ? ` · ${b.nationality}` : ""}</span>
              <span className="block text-xs text-stone-500">
                {shortDay(b.arrival, locale)} → {shortDay(b.departure, locale)} · {nightsLabel(t, b.nights)} · {pick(locale, b.type_am, b.type_en)}
              </span>
              {b.balance_santim !== 0 && (
                <span className={`block text-xs tabular-nums ${b.balance_santim > 0 ? "text-amber-700 dark:text-amber-300" : "text-brand-700 dark:text-brand-500"}`}>
                  {b.balance_santim > 0 ? t.hotel.balance : t.hotel.credit}: {money(locale, Math.abs(b.balance_santim))}
                </span>
              )}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${BOOKING_STATUS_STYLE[b.status]}`}>{t.hotel.status[b.status]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
