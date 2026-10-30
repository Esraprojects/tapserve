import { listMovements, listStock, type MovementKind } from "@tapserve/db";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick, quantity } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { InventoryTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;
const KINDS: MovementKind[] = ["purchase", "sale", "void_return", "waste", "transfer_in", "transfer_out", "count_adjustment", "opening"];

export default async function MovementsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "inventory.manage");
  const items = await listStock(db(), actor, branchId);
  const itemId = items.some((i) => i.id === param(search.item)) ? param(search.item) : undefined;
  const kind = KINDS.find((k) => k === param(search.kind));
  const moves = await listMovements(db(), actor, branchId, { itemId, kinds: kind ? [kind] : undefined, limit: 200 });
  const inv = t.inventory;
  const dt = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader title={inv.title} />
      <InventoryTabs locale={locale} t={t} active="movements" />
      <form className="card mb-4 flex flex-wrap items-end gap-2">
        <select name="item" defaultValue={itemId ?? ""} aria-label={inv.item} className="input w-auto py-2">
          <option value="">{inv.allItems}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{pick(locale, i.name_am, i.name_en)}</option>)}
        </select>
        <select name="kind" defaultValue={kind ?? ""} aria-label={inv.tabs.movements} className="input w-auto py-2">
          <option value="">—</option>
          {KINDS.map((k) => <option key={k} value={k}>{inv.kinds[k]}</option>)}
        </select>
        <button className="btn w-auto px-5">{t.reports.apply}</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left dark:bg-stone-800">
            <tr>
              <th className="px-3 py-2">{inv.when}</th><th className="px-3 py-2">{inv.item}</th><th className="px-3 py-2">{inv.tabs.movements}</th>
              <th className="px-3 py-2 text-right">{inv.quantity}</th><th className="px-3 py-2 text-right">{inv.value}</th><th className="px-3 py-2">{inv.by}</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id} className="border-t border-stone-100 dark:border-stone-800">
                <td className="px-3 py-2 whitespace-nowrap">{dt.format(m.created_at)}</td>
                <td className="px-3 py-2">{pick(locale, m.name_am, m.name_en)}</td>
                <td className="px-3 py-2">{inv.kinds[m.kind]}{m.reason && m.reason !== "count" && m.reason !== "void" && m.reason !== "opening" ? ` · ${m.reason}` : ""}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${m.quantity < 0 ? "text-red-600" : ""}`}>{m.quantity > 0 ? "+" : ""}{quantity(locale, m.quantity)} {pick(locale, m.unit_am, m.unit_en)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(locale, m.value_santim)}</td>
                <td className="px-3 py-2">{m.user_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
