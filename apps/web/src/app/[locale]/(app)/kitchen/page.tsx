import Link from "next/link";
import { kitchenQueue, type KitchenTicketItem, type Station } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { setItemStatusAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;
const STATIONS: Station[] = ["kitchen", "bar", "barista"];

export default async function KitchenPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "kitchen.manage");
  const requested = param(search.station) as Station | undefined;
  const station: Station = requested && STATIONS.includes(requested) ? requested : "kitchen";
  const items = await kitchenQueue(db(), actor, branchId, station);
  const now = Date.now();

  const tickets = new Map<string, KitchenTicketItem[]>();
  for (const item of items) tickets.set(item.order_id, [...(tickets.get(item.order_id) ?? []), item]);
  const next = { new: { status: "preparing", label: t.kitchen.start }, preparing: { status: "ready", label: t.kitchen.ready }, ready: { status: "served", label: t.kitchen.served } } as const;

  return (
    <main className="px-4 py-6">
      <AutoRefresh seconds={10} />
      <PageHeader
        title={t.kitchen.title}
        actions={STATIONS.map((s) => (
          <Link key={s} href={`/${locale}/kitchen?station=${s}`} aria-current={s === station ? "page" : undefined}
            className={`rounded-full px-4 py-2 text-sm font-medium ${s === station ? "bg-brand-600 text-white" : "bg-stone-200 dark:bg-stone-800"}`}>
            {t.menu.stations[s]}
          </Link>
        ))}
      />
      <FormError t={t} code={param(search.error)} />
      {tickets.size === 0 && <p className="py-12 text-center text-lg text-stone-500">{t.kitchen.empty}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {[...tickets.values()].map((list) => {
          const first = list[0]!;
          const minutes = Math.floor((now - new Date(first.created_at).getTime()) / 60000);
          return (
            <article key={first.order_id} className={`card p-0 ${minutes >= 20 ? "border-red-400" : minutes >= 10 ? "border-amber-400" : ""}`}>
              <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                <div>
                  <p className="text-lg font-bold">#{first.order_no} · {first.table_name ?? t.pos.types[first.type]}</p>
                  <p className="text-sm text-stone-500">{format(t.kitchen.minutesAgo, { n: minutes })}</p>
                </div>
                <a href={`/${locale}/ticket/${first.order_id}?station=${station}`} target="_blank" className="text-sm text-brand-600">{t.kitchen.printTicket}</a>
              </header>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {list.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold">{item.quantity} × {pick(locale, item.name_am, item.name_en)}</p>
                      {(item.variant_name || item.modifiers_text || item.notes) && (
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          {[item.variant_name, item.modifiers_text, item.notes].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <p className="text-xs text-stone-500">{t.order.statuses[item.status]}</p>
                    </div>
                    {item.status in next && (
                      <form action={setItemStatusAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="station" value={station} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="status" value={next[item.status as keyof typeof next].status} />
                        <button className="btn min-h-12 w-auto px-4">{next[item.status as keyof typeof next].label}</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </main>
  );
}
