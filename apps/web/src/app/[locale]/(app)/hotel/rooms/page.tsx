import { getUsdRate, listRateSeasons, listRooms, listRoomTypes } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { shortDay } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { addRoomsAction, addSeasonAction, deleteSeasonAction, saveRoomAction, saveRoomTypeAction, setUsdRateAction } from "../actions";
import { HK_STATUS_STYLE, HotelTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;
const birr = (santim: number | null | undefined) => (santim ? (santim / 100).toFixed(2) : "");

export default async function RoomsSetupPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "hotel.manage");
  const [types, seasons, rooms, usdRate] = await Promise.all([
    listRoomTypes(db(), actor), listRateSeasons(db(), actor), listRooms(db(), actor, branchId), getUsdRate(db(), actor),
  ]);
  const editing = types.find((x) => x.id === param(search.type));
  const editingRoom = rooms.find((r) => r.id === param(search.room));
  const h = t.hotel;
  const typeName = (id: string) => {
    const type = types.find((x) => x.id === id);
    return type ? pick(locale, type.name_am, type.name_en) : "";
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title={h.title} />
      <HotelTabs locale={locale} t={t} active="rooms" canManage />
      <FormError t={t} code={param(search.error)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 font-semibold">{h.roomTypes}</h2>
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
              <table className="w-full text-sm">
                <thead className="bg-stone-100 text-left dark:bg-stone-800">
                  <tr>
                    <th className="px-3 py-2">{h.roomType}</th>
                    <th className="px-3 py-2 text-right">{h.rates.local}</th>
                    <th className="px-3 py-2 text-right">{h.rates.foreign}</th>
                    <th className="px-3 py-2"><span className="sr-only">{h.editRoomType}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((x) => (
                    <tr key={x.id} className={`border-t border-stone-100 dark:border-stone-800 ${x.is_active ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{pick(locale, x.name_am, x.name_en)}</span>
                        <span className="ml-2 text-xs text-stone-500">{format(h.roomCount, { n: x.room_count })} · {h.capacity} {x.capacity}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(locale, x.local_rate_santim)}
                        {x.weekend_local_rate_santim && <span className="block text-xs text-stone-500">{h.weekendLocal}: {money(locale, x.weekend_local_rate_santim)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(locale, x.foreign_rate_santim)}
                        {x.weekend_foreign_rate_santim && <span className="block text-xs text-stone-500">{h.weekendForeign}: {money(locale, x.weekend_foreign_rate_santim)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`?type=${x.id}#type-form`} className="whitespace-nowrap text-brand-700 hover:underline dark:text-brand-500">{t.inventory.editItem}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-1 font-semibold">{h.seasons}</h2>
            <p className="mb-2 text-sm text-stone-500">{h.seasonsHint}</p>
            {seasons.length > 0 && (
              <ul className="card mb-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
                {seasons.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{s.name}</span> · {typeName(s.room_type_id)}
                      <span className="block text-xs text-stone-500">
                        {shortDay(s.starts_on, locale)} → {shortDay(s.ends_on, locale)} · {money(locale, s.local_rate_santim)} / {money(locale, s.foreign_rate_santim)}
                      </span>
                    </span>
                    <form action={deleteSeasonAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="seasonId" value={s.id} />
                      <button className="text-xs text-red-600">{h.delete}</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {types.length > 0 && (
              <details className="card">
                <summary className="cursor-pointer font-medium">{h.addSeason}</summary>
                <form action={addSeasonAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input name="name" required placeholder={h.seasonName} aria-label={h.seasonName} className="input py-2" />
                  <select name="roomTypeId" aria-label={h.roomType} className="input py-2">
                    {types.map((x) => <option key={x.id} value={x.id}>{pick(locale, x.name_am, x.name_en)}</option>)}
                  </select>
                  <div><label className="label" htmlFor="startsOn">{h.startsOn}</label><input id="startsOn" name="startsOn" type="date" required className="input py-2" /></div>
                  <div><label className="label" htmlFor="endsOn">{h.endsOn}</label><input id="endsOn" name="endsOn" type="date" required className="input py-2" /></div>
                  <input name="localRate" inputMode="decimal" required placeholder={h.localRate} aria-label={h.localRate} className="input py-2" />
                  <input name="foreignRate" inputMode="decimal" required placeholder={h.foreignRate} aria-label={h.foreignRate} className="input py-2" />
                  <button className="btn-secondary">{h.addSeason}</button>
                </form>
              </details>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">{h.rooms}</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {rooms.map((r) => (
                <a key={r.id} href={`?room=${r.id}#room-form`}
                  className={`rounded-xl border border-stone-200 p-2 text-center dark:border-stone-700 ${r.is_active ? "" : "opacity-50"}`}>
                  <span className="block text-lg font-semibold">{r.number}</span>
                  <span className="block truncate text-xs text-stone-500">{pick(locale, r.type_am, r.type_en)}</span>
                  <span className={`mt-1 inline-block rounded-full px-2 text-[10px] ${HK_STATUS_STYLE[r.hk_status]}`}>{t.housekeeping.statuses[r.hk_status]}</span>
                </a>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <form id="type-form" action={saveRoomTypeAction} className="card space-y-2">
            <h2 className="font-semibold">{editing ? h.editRoomType : h.addRoomType}</h2>
            <input type="hidden" name="locale" value={locale} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input name="nameAm" placeholder={h.nameAm} aria-label={h.nameAm} defaultValue={editing?.name_am} className="input py-2" />
            <input name="nameEn" placeholder={h.nameEn} aria-label={h.nameEn} defaultValue={editing?.name_en} className="input py-2" />
            <label className="label" htmlFor="capacity">{h.capacity}</label>
            <input id="capacity" name="capacity" type="number" min={1} max={20} defaultValue={editing?.capacity ?? 2} className="input py-2" />
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="localRate">{h.localRate}</label>
                <input id="localRate" name="localRate" inputMode="decimal" required defaultValue={birr(editing?.local_rate_santim)} className="input py-2" /></div>
              <div><label className="label" htmlFor="foreignRate">{h.foreignRate}</label>
                <input id="foreignRate" name="foreignRate" inputMode="decimal" required defaultValue={birr(editing?.foreign_rate_santim)} className="input py-2" /></div>
              <div><label className="label" htmlFor="weekendLocal">{h.weekendLocal}</label>
                <input id="weekendLocal" name="weekendLocal" inputMode="decimal" defaultValue={birr(editing?.weekend_local_rate_santim)} className="input py-2" /></div>
              <div><label className="label" htmlFor="weekendForeign">{h.weekendForeign}</label>
                <input id="weekendForeign" name="weekendForeign" inputMode="decimal" defaultValue={birr(editing?.weekend_foreign_rate_santim)} className="input py-2" /></div>
            </div>
            <p className="text-xs text-stone-500">{h.weekendHint}</p>
            {editing && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" defaultChecked={!editing.is_active} /> {h.inactive}</label>
            )}
            <button className="btn">{h.save}</button>
          </form>

          {editingRoom ? (
            <form id="room-form" action={saveRoomAction} className="card space-y-2">
              <h2 className="font-semibold">{h.room} {editingRoom.number}</h2>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={editingRoom.id} />
              <div className="grid grid-cols-2 gap-2">
                <input name="number" required defaultValue={editingRoom.number} aria-label={h.number} className="input py-2" />
                <input name="floor" defaultValue={editingRoom.floor} placeholder={h.floor} aria-label={h.floor} className="input py-2" />
              </div>
              <select name="roomTypeId" defaultValue={editingRoom.room_type_id} aria-label={h.roomType} className="input py-2">
                {types.map((x) => <option key={x.id} value={x.id}>{pick(locale, x.name_am, x.name_en)}</option>)}
              </select>
              <input name="note" defaultValue={editingRoom.note} placeholder={h.note} aria-label={h.note} className="input py-2" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" defaultChecked={!editingRoom.is_active} /> {h.inactive}</label>
              <button className="btn-secondary w-full">{h.save}</button>
            </form>
          ) : types.length > 0 && (
            <form id="room-form" action={addRoomsAction} className="card space-y-2">
              <h2 className="font-semibold">{h.addRooms}</h2>
              <input type="hidden" name="locale" value={locale} />
              <select name="roomTypeId" aria-label={h.roomType} className="input py-2">
                {types.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{pick(locale, x.name_am, x.name_en)}</option>)}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input name="from" required placeholder="101" aria-label={h.fromNumber} className="input py-2" />
                <input name="to" inputMode="numeric" placeholder="110" aria-label={h.toNumber} className="input py-2" />
                <input name="floor" placeholder={h.floor} aria-label={h.floor} className="input py-2" />
              </div>
              <button className="btn-secondary w-full">{h.addRooms}</button>
            </form>
          )}

          <form action={setUsdRateAction} className="card space-y-2">
            <label className="label" htmlFor="usdRate">{h.usdRate}</label>
            <input type="hidden" name="locale" value={locale} />
            <div className="flex gap-2">
              <input id="usdRate" name="usdRate" inputMode="decimal" defaultValue={birr(usdRate)} placeholder="155.00" className="input py-2" />
              <button className="btn-secondary">{h.save}</button>
            </div>
            <p className="text-xs text-stone-500">{h.usdRateHint}</p>
          </form>
        </aside>
      </div>
    </main>
  );
}
