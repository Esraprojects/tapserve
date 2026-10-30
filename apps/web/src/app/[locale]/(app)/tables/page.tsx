import Link from "next/link";
import { listAreas, listTables, type TableStatus } from "@tapserve/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { addAreaAction, addTableAction, removeTableAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

const STATUS_STYLE: Record<TableStatus, string> = {
  free: "border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900",
  occupied: "border-brand-500 bg-brand-50 dark:bg-brand-700/20",
  waiting_bill: "border-amber-500 bg-amber-50 dark:bg-amber-900/30",
};

export default async function TablesPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "order.create");
  const [tables, areas] = await Promise.all([listTables(db(), actor, branchId), listAreas(db(), actor, branchId)]);
  const manage = param(search.manage) === "1" && can("branches.manage");
  const statusLabel = { free: t.tables.free, occupied: t.tables.occupied, waiting_bill: t.tables.waitingBill };
  const groups = new Map<string, typeof tables>();
  for (const table of tables) {
    const key = table.area_name ?? t.tables.noArea;
    groups.set(key, [...(groups.get(key) ?? []), table]);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <AutoRefresh seconds={15} />
      <PageHeader
        title={t.tables.title}
        subtitle={
          <span className="inline-flex flex-wrap gap-3">
            {(["free", "occupied", "waiting_bill"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded border ${STATUS_STYLE[s]}`} aria-hidden />
                {statusLabel[s]} ({tables.filter((x) => x.status === s).length})
              </span>
            ))}
          </span>
        }
        actions={can("branches.manage") && (
          <Link href={`/${locale}/tables${manage ? "" : "?manage=1"}`} className="btn-secondary">
            {manage ? t.common.back : t.tables.manage}
          </Link>
        )}
      />
      <FormError t={t} code={param(search.error)} />
      {tables.length === 0 && <p className="mb-6 text-stone-500">{t.tables.empty}</p>}

      {[...groups.entries()].map(([area, list]) => (
        <section key={area} className="mb-6">
          {groups.size > 1 && <h2 className="mb-2 text-sm font-semibold text-stone-500">{area}</h2>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {list.map((table) => {
              const href = table.order_id ? `/${locale}/orders/${table.order_id}` : `/${locale}/pos?table=${table.id}`;
              return (
                <div key={table.id} className={`relative rounded-2xl border-2 p-4 ${STATUS_STYLE[table.status]}`}>
                  <Link href={href} className="block min-h-20">
                    <p className="text-xl font-bold">{table.name}</p>
                    <p className="text-sm text-stone-600 dark:text-stone-300">{statusLabel[table.status]}</p>
                    {table.order_id && (
                      <p className="mt-1 text-sm tabular-nums">
                        #{table.order_no} · {money(locale, table.running_total_santim)}
                        {table.waiter_name && <span className="block truncate text-stone-500">{table.waiter_name}</span>}
                      </p>
                    )}
                  </Link>
                  {manage && table.status === "free" && (
                    <form action={removeTableAction} className="absolute right-2 top-2">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={table.id} />
                      <button className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50">{t.tables.remove}</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {manage && (
        <div className="grid gap-4 md:grid-cols-2">
          <form action={addTableAction} className="card space-y-3">
            <h2 className="font-semibold">{t.tables.addTable}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input name="name" required className="input" placeholder={t.tables.tableName} aria-label={t.tables.tableName} />
            <input name="seats" type="number" min={1} max={50} defaultValue={4} className="input" aria-label={t.tables.seats} />
            <select name="areaId" className="input" aria-label={t.tables.area}>
              <option value="">{t.tables.noArea}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn">{t.tables.addTable}</button>
          </form>
          <form action={addAreaAction} className="card space-y-3">
            <h2 className="font-semibold">{t.tables.addArea}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input name="name" required className="input" placeholder={t.tables.area} aria-label={t.tables.area} />
            <button className="btn">{t.tables.addArea}</button>
          </form>
        </div>
      )}
    </main>
  );
}
