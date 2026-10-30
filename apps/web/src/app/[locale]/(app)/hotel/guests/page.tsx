import Link from "next/link";
import { searchGuests } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { PageHeader } from "@/components/PageHeader";
import { shortDay } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { HotelTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function GuestsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const q = param((await searchParams).q) ?? "";
  const { actor, can } = await appContext(locale, "hotel.frontdesk");
  const guests = await searchGuests(db(), actor, q);
  const h = t.hotel;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={h.title} />
      <HotelTabs locale={locale} t={t} active="guests" canManage={can("hotel.manage")} />
      <form method="get" className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder={h.searchGuests} aria-label={h.searchGuests} className="input py-2" />
        <button className="btn-secondary">{h.search}</button>
      </form>
      {guests.length === 0 ? <p className="card text-stone-500">{h.noGuests}</p> : (
        <ul className="card divide-y divide-stone-100 dark:divide-stone-800">
          {guests.map((g) => (
            <li key={g.id}>
              <Link href={`/${locale}/hotel/guests/${g.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <span>
                  <span className="block font-medium">{g.full_name}{g.nationality !== "ET" ? ` · ${g.nationality}` : ""}</span>
                  <span className="block text-xs text-stone-500">
                    {[g.phone, g.id_type ? `${h.idTypes[g.id_type]} ${g.id_number}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-right text-xs text-stone-500">
                  {g.stays ? format(h.stays, { n: g.stays }) : ""}
                  {g.last_stay && <span className="block">{format(h.lastStay, { date: shortDay(g.last_stay, locale) })}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
