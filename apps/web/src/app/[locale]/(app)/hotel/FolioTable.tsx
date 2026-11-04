import type { BookingDetail } from "@tapserve/db";
import { type Dictionary, format, type Locale } from "@tapserve/i18n";
import { toUsdCents } from "@tapserve/core";
import { shortDay } from "@/lib/dates";
import { money, pick } from "@/lib/text";

export function usdLine(t: Dictionary, santim: number, usdRate: number | null): string | null {
  if (!usdRate || santim === 0) return null;
  return format(t.hotel.usd, { amount: (toUsdCents(Math.abs(santim), usdRate) / 100).toFixed(2) });
}

/** Charges and payments of a stay, used on the booking page and the printed folio. */
export function FolioTable({ detail, locale, t, usdRate, voidAction }: {
  detail: BookingDetail; locale: Locale; t: Dictionary; usdRate: number | null;
  voidAction?: (form: FormData) => Promise<void>;
}) {
  const h = t.hotel;
  const { folio, booking } = detail;
  const showUsd = booking.nationality !== "ET";
  const label = (c: BookingDetail["folio"]["charges"][number]) =>
    c.kind === "restaurant" ? `${h.chargeKinds.restaurant} · ${format(h.receiptNo, { no: c.description })}`
    : c.kind === "room" ? `${h.chargeKinds.room} · ${booking.room_number ?? ""}`
    : c.description ? `${h.chargeKinds[c.kind]} · ${c.description}` : h.chargeKinds[c.kind];

  return (
    <div className="space-y-3 text-sm">
      <table className="w-full">
        <thead className="text-left text-xs text-stone-500">
          <tr><th className="py-1 font-medium">{h.charges}</th><th className="py-1 text-right font-medium">{h.amount}</th></tr>
        </thead>
        <tbody>
          {folio.charges.map((c) => (
            <tr key={c.id} className={`border-t border-stone-100 dark:border-stone-800 ${c.voided_at ? "text-stone-400 line-through" : ""}`}>
              <td className="py-1.5 pr-2">
                <span className="mr-2 text-xs text-stone-500">{shortDay(c.night_date ?? new Date(c.created_at).toISOString().slice(0, 10), locale)}</span>
                {label(c)}
                {c.voided_at && <span className="ml-1 text-xs no-underline">({h.voided}: {c.void_reason})</span>}
                {voidAction && !c.voided_at && (c.kind === "room" || c.kind === "extra" || c.kind === "discount") && (
                  <details className="no-print inline-block">
                    <summary className="ml-2 cursor-pointer text-xs text-red-600">{h.voidCharge}</summary>
                    <form action={voidAction} className="mt-1 flex gap-1">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <input type="hidden" name="chargeId" value={c.id} />
                      <input name="reason" required placeholder={h.voidReason} aria-label={h.voidReason} className="input py-1 text-xs" />
                      <button className="btn-secondary min-h-8 px-2 text-xs">{h.voidCharge}</button>
                    </form>
                  </details>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(locale, c.amount_santim)}</td>
            </tr>
          ))}
          {folio.pending.map((n) => (
            <tr key={n.night} className="border-t border-dashed border-stone-200 text-stone-500 dark:border-stone-700">
              <td className="py-1.5 pr-2"><span className="mr-2 text-xs">{shortDay(n.night, locale)}</span>{h.chargeKinds.room} · {h.pendingNights}</td>
              <td className="py-1.5 text-right tabular-nums">{money(locale, n.amount_santim)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {folio.payments.length > 0 && (
        <table className="w-full">
          <thead className="text-left text-xs text-stone-500">
            <tr><th className="py-1 font-medium">{h.payments}</th><th className="py-1 text-right font-medium">{h.amount}</th></tr>
          </thead>
          <tbody>
            {folio.payments.map((p) => (
              <tr key={p.id} className="border-t border-stone-100 dark:border-stone-800">
                <td className="py-1.5 pr-2">
                  <span className="mr-2 text-xs text-stone-500">{shortDay(new Date(p.created_at).toISOString().slice(0, 10), locale)}</span>
                  {pick(locale, p.method_am, p.method_en)}{p.reference ? <span className="font-mono text-xs"> · {p.reference}</span> : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">−{money(locale, p.amount_santim)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="space-y-1 border-t border-stone-200 pt-2 dark:border-stone-700">
        <div className="flex justify-between text-base font-semibold">
          <dt>{folio.balance < 0 ? h.credit : h.balance}</dt>
          <dd className="text-right tabular-nums">
            {money(locale, Math.abs(folio.balance))}
            {showUsd && usdLine(t, folio.balance, usdRate) && <span className="block text-xs font-normal text-stone-500">{usdLine(t, folio.balance, usdRate)}</span>}
          </dd>
        </div>
        {booking.status === "checked_in" && (
          <div className="flex justify-between">
            <dt>{h.payIfLeavingToday}</dt>
            <dd className="text-right tabular-nums">
              {money(locale, folio.balanceIfLeavingToday)}
              {showUsd && usdLine(t, folio.balanceIfLeavingToday, usdRate) && <span className="block text-xs text-stone-500">{usdLine(t, folio.balanceIfLeavingToday, usdRate)}</span>}
            </dd>
          </div>
        )}
        {folio.pending.length > 0 && (
          <div className="flex justify-between text-stone-500">
            <dt>{h.payAtEnd}</dt>
            <dd className="text-right tabular-nums">
              {money(locale, folio.balanceAtCheckout)}
              {showUsd && usdLine(t, folio.balanceAtCheckout, usdRate) && <span className="block text-xs">{usdLine(t, folio.balanceAtCheckout, usdRate)}</span>}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
