import Link from "next/link";
import { notFound } from "next/navigation";
import { availableRooms, currentShift, getBooking, getUsdRate, listPaymentMethods } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { bothCalendars } from "@/lib/dates";
import { param, resolveLocale } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import {
  addChargeAction, cancelBookingAction, checkInAction, checkOutAction, folioPaymentAction, refundAction, saveGuestAction,
  updateBookingAction, voidChargeAction,
} from "../../actions";
import { nightsLabel } from "../../BookingList";
import { FolioTable } from "../../FolioTable";
import { GuestFields } from "../../GuestFields";
import { BOOKING_STATUS_STYLE } from "../../tabs";

type Params = Promise<{ locale: string; bookingId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function BookingPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { bookingId } = await params;
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "hotel.frontdesk");
  const detail = await getBooking(db(), actor, bookingId);
  if (!detail) notFound();
  const { booking: b, guest, folio, today } = detail;
  const live = b.status === "reserved" || b.status === "checked_in";
  const [methods, usdRate, shift, rooms] = await Promise.all([
    listPaymentMethods(db(), actor),
    getUsdRate(db(), actor),
    currentShift(db(), actor, b.branch_id),
    // Rooms free for the rest of the stay (an overstaying guest is still in the room tonight).
    live ? availableRooms(db(), actor, b.branch_id, b.arrival, b.departure > today ? b.departure : addOne(today), b.id) : Promise.resolve([]),
  ]);
  const h = t.hotel;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="bookingId" value={b.id} />
    </>
  );
  const payMethods = methods.filter((m) => m.kind !== "room_charge" && m.kind !== "house_account");
  const due = b.status === "checked_in" ? folio.balanceIfLeavingToday : folio.balanceAtCheckout;
  const missingId = !guest.id_type || !guest.id_number;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title={`${format(h.booking, { n: b.booking_no })} · ${b.guest_name}`}
        subtitle={<>
          <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs ${BOOKING_STATUS_STYLE[b.status]}`}>{h.status[b.status]}</span>
          {b.room_number ? `${h.room} ${b.room_number} · ` : ""}{pick(locale, b.type_am, b.type_en)} · {nightsLabel(t, b.nights)}
        </>}
        actions={<>
          <Link href={`/${locale}/hotel`} className="btn-secondary">{t.common.back}</Link>
          <a href={`/${locale}/folio/${b.id}`} target="_blank" className="btn-secondary">{h.printFolio}</a>
          {b.status === "reserved" && b.arrival <= today && (
            <form action={checkInAction}>{hidden}<button className="btn w-auto">{h.checkIn}</button></form>
          )}
          {b.status === "checked_in" && (
            <form action={checkOutAction}>{hidden}<button className="btn w-auto">{h.checkOut}</button></form>
          )}
        </>}
      />
      <FormError t={t} code={param(search.error)} />
      {b.status === "reserved" && missingId && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">{h.idHint}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <section className="card">
            <h2 className="mb-2 font-semibold">{h.room}</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-stone-500">{h.arrival}</dt><dd>{bothCalendars(b.arrival, locale)}</dd>
              <dt className="text-stone-500">{h.departure}</dt><dd>{bothCalendars(b.departure, locale)}</dd>
              <dt className="text-stone-500">{h.adults} / {h.children}</dt><dd>{b.adults} / {b.children}</dd>
              <dt className="text-stone-500">{h.source}</dt><dd>{h.sources[b.source]}</dd>
              <dt className="text-stone-500">{h.rateCategory}</dt>
              <dd>{h.rates[b.rate_category]}{b.nightly_rate_santim !== null ? ` · ${money(locale, b.nightly_rate_santim)} ${h.perNight}` : ""}</dd>
              {b.note && <><dt className="text-stone-500">{h.note}</dt><dd>{b.note}</dd></>}
            </dl>
            {live && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-500">{h.changeStay}</summary>
                <form action={updateBookingAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                  {hidden}
                  <div>
                    <label className="label" htmlFor="arrival">{h.arrival}</label>
                    <input id="arrival" name="arrival" type="date" defaultValue={b.arrival} readOnly={b.status === "checked_in"} className="input py-2" />
                  </div>
                  <div>
                    <label className="label" htmlFor="departure">{h.departure}</label>
                    <input id="departure" name="departure" type="date" defaultValue={b.departure} className="input py-2" />
                  </div>
                  <div>
                    <label className="label" htmlFor="roomId">{h.room}</label>
                    <select id="roomId" name="roomId" defaultValue={b.room_id ?? ""} className="input py-2">
                      {b.status === "reserved" && <option value="">{h.assignLater}</option>}
                      {b.room_id && <option value={b.room_id}>{b.room_number}</option>}
                      {rooms.filter((r) => r.id !== b.room_id).map((r) => (
                        <option key={r.id} value={r.id}>{r.number} · {pick(locale, r.type_am, r.type_en)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="agreedRate">{h.agreedRate}</label>
                    <input id="agreedRate" name="agreedRate" inputMode="decimal"
                      defaultValue={b.nightly_rate_santim !== null ? (b.nightly_rate_santim / 100).toFixed(2) : ""} className="input py-2" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="note">{h.note}</label>
                    <input id="note" name="note" defaultValue={b.note} className="input py-2" />
                  </div>
                  <button className="btn-secondary">{h.save}</button>
                </form>
              </details>
            )}
          </section>

          <section className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{h.registration}</h2>
              <Link href={`/${locale}/hotel/guests/${guest.id}`} className="text-sm text-brand-700 dark:text-brand-500">
                {h.history}{guest.stays ? ` · ${format(h.stays, { n: guest.stays })}` : ""}
              </Link>
            </div>
            <form action={saveGuestAction} className="space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="back" value={`/${locale}/hotel/bookings/${b.id}`} />
              <GuestFields t={t} guest={guest} requireId={b.status === "reserved"} />
              <button className="btn-secondary">{h.save}</button>
            </form>
          </section>

          {b.status === "reserved" && (
            <details className="card">
              <summary className="cursor-pointer font-semibold text-red-700 dark:text-red-400">{h.cancel}</summary>
              <form action={cancelBookingAction} className="mt-2 flex gap-2">
                {hidden}
                <input name="reason" required placeholder={h.cancelReason} aria-label={h.cancelReason} className="input py-2" />
                <button className="btn-secondary">{h.cancel}</button>
              </form>
            </details>
          )}
        </div>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="mb-2 font-semibold">{h.folio}</h2>
            <FolioTable detail={detail} locale={locale} t={t} usdRate={usdRate} voidAction={live && can("order.void") ? voidChargeAction : undefined} />
          </section>

          {can("payment.record") && (live || folio.balance > 0) && (
            <section className="card">
              <h2 className="mb-2 font-semibold">{h.takePayment}</h2>
              {shift ? (
                <form action={folioPaymentAction} className="space-y-2">
                  {hidden}
                  <div className="flex gap-2">
                    <select name="method" defaultValue="cash" aria-label={t.bill.method} className="input py-2">
                      {payMethods.map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
                    </select>
                    <input name="amount" inputMode="decimal" required defaultValue={due > 0 ? (due / 100).toFixed(2) : ""}
                      aria-label={h.amount} className="input w-32 py-2 text-right tabular-nums" />
                  </div>
                  <input name="reference" placeholder={t.bill.reference} aria-label={t.bill.reference} className="input py-2" />
                  <button className="btn w-full">{t.bill.recordPayment}</button>
                </form>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t.domain.no_open_shift} <Link href={`/${locale}/shifts`} className="font-semibold underline">{t.shift.open}</Link>
                </p>
              )}
            </section>
          )}

          {folio.balance < 0 && can("payment.refund") && (
            <section className="card">
              <h2 className="mb-2 font-semibold">{h.refundCredit} · {money(locale, -folio.balance)}</h2>
              <form action={refundAction} className="space-y-2">
                {hidden}
                <select name="method" defaultValue="cash" aria-label={t.bill.method} className="input py-2">
                  {payMethods.map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
                </select>
                <input name="reference" placeholder={t.bill.reference} aria-label={t.bill.reference} className="input py-2" />
                <button className="btn-secondary w-full">{h.refundCredit}</button>
              </form>
            </section>
          )}

          {live && (
            <details className="card">
              <summary className="cursor-pointer font-semibold">{h.addExtra}{can("order.discount") ? ` / ${h.addDiscount}` : ""}</summary>
              <form action={addChargeAction} className="mt-2 space-y-2">
                {hidden}
                <select name="kind" aria-label={h.charges} className="input py-2">
                  <option value="extra">{h.chargeKinds.extra}</option>
                  {can("order.discount") && <option value="discount">{h.chargeKinds.discount}</option>}
                </select>
                <input name="description" required placeholder={h.description} aria-label={h.description} className="input py-2" />
                <input name="amount" inputMode="decimal" required placeholder={h.amount} aria-label={h.amount} className="input py-2" />
                <button className="btn-secondary w-full">{t.common.save}</button>
              </form>
            </details>
          )}
        </aside>
      </div>
    </main>
  );
}

function addOne(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
