import Link from "next/link";
import { availableRooms, getGuest, listPaymentMethods, listRoomTypes, quoteStay, searchGuests } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { addDays, addisToday, isIsoDate } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { createBookingAction } from "../../actions";
import { nightsLabel } from "../../BookingList";
import { GuestFields } from "../../GuestFields";

type Search = Promise<Record<string, string | string[] | undefined>>;
const SOURCES = ["direct", "phone", "booking_com", "expedia", "travel_agent", "other"] as const;

export default async function NewBookingPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "hotel.frontdesk");
  const h = t.hotel;
  const today = addisToday();
  const walkIn = param(search.walkin) === "1";
  const arrivalParam = param(search.arrival);
  const arrival = walkIn ? today : isIsoDate(arrivalParam) ? arrivalParam : today;
  const departureParam = param(search.departure);
  const departure = isIsoDate(departureParam) && departureParam > arrival ? departureParam : addDays(arrival, 1);
  const nights = Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000);
  const q = param(search.q) ?? "";
  const guestId = param(search.guest);

  const [types, rooms, methods, found, chosen] = await Promise.all([
    listRoomTypes(db(), actor),
    availableRooms(db(), actor, branchId, arrival, departure),
    listPaymentMethods(db(), actor),
    q ? searchGuests(db(), actor, q) : Promise.resolve([]),
    guestId ? getGuest(db(), actor, guestId) : Promise.resolve(null),
  ]);
  const active = types.filter((x) => x.is_active);
  const quotes = await Promise.all(active.map(async (type) => ({
    type,
    free: rooms.filter((r) => r.room_type_id === type.id),
    local: (await quoteStay(db(), actor, { roomTypeId: type.id, arrival, departure, rateCategory: "local", nightlyRateSantim: null })).total,
    foreign: (await quoteStay(db(), actor, { roomTypeId: type.id, arrival, departure, rateCategory: "foreign", nightlyRateSantim: null })).total,
  })));
  const keep = new URLSearchParams({ arrival, departure, ...(walkIn ? { walkin: "1" } : {}), ...(guestId ? { guest: guestId } : {}) });
  const preferredType = param(search.type) ?? quotes.find((x) => x.free.length)?.type.id ?? active[0]?.id;
  const depositMethods = methods.filter((m) => m.kind !== "room_charge" && m.kind !== "house_account");

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={walkIn ? h.walkIn : h.newBooking} subtitle={walkIn ? h.walkInHint : undefined}
        actions={<Link href={`/${locale}/hotel`} className="btn-secondary">{t.common.back}</Link>} />
      <FormError t={t} code={param(search.error)} />

      <form className="card mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" method="get">
        {walkIn && <input type="hidden" name="walkin" value="1" />}
        {guestId && <input type="hidden" name="guest" value={guestId} />}
        <div>
          <label className="label" htmlFor="arrival">{h.arrival}</label>
          <input id="arrival" name="arrival" type="date" defaultValue={arrival} min={addDays(today, -1)} readOnly={walkIn} className="input py-2" />
        </div>
        <div>
          <label className="label" htmlFor="departure">{h.departure}</label>
          <input id="departure" name="departure" type="date" defaultValue={departure} min={addDays(arrival, 1)} className="input py-2" />
        </div>
        <button className="btn-secondary">{h.findRooms}</button>
      </form>

      <section className="mb-4 grid gap-2 sm:grid-cols-2">
        {quotes.map(({ type, free, local, foreign }) => (
          <div key={type.id} className={`card ${free.length ? "" : "opacity-60"}`}>
            <p className="font-semibold">{pick(locale, type.name_am, type.name_en)} <span className="text-sm font-normal text-stone-500">· {free.length} {h.freeRooms.toLowerCase()}</span></p>
            <p className="text-sm text-stone-500">{nightsLabel(t, nights)}</p>
            <p className="mt-1 text-sm tabular-nums">{h.rates.local}: <strong>{money(locale, local)}</strong></p>
            <p className="text-sm tabular-nums">{h.rates.foreign}: <strong>{money(locale, foreign)}</strong></p>
          </div>
        ))}
        {!active.length && <p className="card text-stone-500">{h.noFreeRooms}</p>}
      </section>

      {rooms.length === 0 ? (
        <p className="card text-amber-800 dark:text-amber-200">{h.noFreeRooms}</p>
      ) : (
        <form action={createBookingAction} className="card space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="query" value={keep.toString()} />
          <input type="hidden" name="arrival" value={arrival} />
          <input type="hidden" name="departure" value={departure} />
          {walkIn && <input type="hidden" name="walkIn" value="1" />}

          <section className="space-y-2">
            <h2 className="font-semibold">{h.room}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="roomTypeId">{h.roomType}</label>
                <select id="roomTypeId" name="roomTypeId" defaultValue={preferredType} className="input py-2">
                  {active.map((x) => <option key={x.id} value={x.id}>{pick(locale, x.name_am, x.name_en)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="roomId">{h.room}</label>
                <select id="roomId" name="roomId" className="input py-2" required={walkIn} defaultValue="">
                  {!walkIn && <option value="">{h.assignLater}</option>}
                  {walkIn && <option value="">—</option>}
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.number} · {pick(locale, r.type_am, r.type_en)}{r.hk_status !== "clean" && r.hk_status !== "inspected" ? ` · ${t.housekeeping.statuses[r.hk_status as "dirty"]}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="adults">{h.adults}</label>
                <input id="adults" name="adults" type="number" min={1} max={20} defaultValue={1} className="input py-2" />
              </div>
              <div>
                <label className="label" htmlFor="children">{h.children}</label>
                <input id="children" name="children" type="number" min={0} max={20} defaultValue={0} className="input py-2" />
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold">{h.guest}</h2>
            {!chosen && (
              <div className="rounded-xl bg-stone-50 p-2 text-sm dark:bg-stone-800/50">
                <p className="mb-1 font-medium">{h.existingGuest}</p>
                <div className="flex gap-2">
                  <input form="guest-search" name="q" defaultValue={q} placeholder={h.searchGuests} aria-label={h.searchGuests} className="input py-2" />
                  <button form="guest-search" className="btn-secondary">{h.search}</button>
                </div>
                {q && (found.length ? (
                  <ul className="mt-2 space-y-1">
                    {found.map((g) => (
                      <li key={g.id}>
                        <Link className="text-brand-700 underline dark:text-brand-500" href={`?${new URLSearchParams({ ...Object.fromEntries(keep), guest: g.id })}`}>
                          {g.full_name}
                        </Link>
                        <span className="text-stone-500"> · {[g.phone, g.id_number].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-stone-500">{h.noGuests}</p>)}
              </div>
            )}
            <GuestFields t={t} guest={chosen?.guest} requireId={walkIn} />
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            {!walkIn && (
              <div>
                <label className="label" htmlFor="source">{h.source}</label>
                <select id="source" name="source" className="input py-2">
                  {SOURCES.map((s) => <option key={s} value={s}>{h.sources[s]}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="rateCategory">{h.rateCategory}</label>
              <select id="rateCategory" name="rateCategory" defaultValue="" className="input py-2">
                <option value="">{h.rates.local} / {h.rates.foreign} ({h.nationality})</option>
                <option value="local">{h.rates.local}</option>
                <option value="foreign">{h.rates.foreign}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="agreedRate">{h.agreedRate}</label>
              <input id="agreedRate" name="agreedRate" inputMode="decimal" className="input py-2" />
              <p className="mt-1 text-xs text-stone-500">{h.agreedRateHint}</p>
            </div>
            <div>
              <label className="label" htmlFor="note">{h.note}</label>
              <input id="note" name="note" className="input py-2" />
            </div>
          </section>

          {can("payment.record") && (
            <section className="space-y-2">
              <h2 className="font-semibold">{h.deposit}</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                <input name="depositAmount" inputMode="decimal" placeholder={h.depositAmount} aria-label={h.depositAmount} className="input py-2" />
                <select name="depositMethod" defaultValue="cash" aria-label={t.bill.method} className="input py-2">
                  {depositMethods.map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
                </select>
                <input name="depositReference" placeholder={t.bill.reference} aria-label={t.bill.reference} className="input py-2" />
              </div>
            </section>
          )}

          <button className="btn w-full sm:w-auto">{walkIn ? `${h.newBooking} · ${h.checkIn}` : h.newBooking}</button>
        </form>
      )}
      <form id="guest-search" method="get">
        {[...keep].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      </form>
    </main>
  );
}
