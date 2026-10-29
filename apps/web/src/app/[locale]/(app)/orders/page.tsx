import Link from "next/link";
import { listOpenOrders } from "@tapserve/db";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader } from "@/components/PageHeader";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { money } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

export default async function OrdersPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const { actor, branchId } = await appContext(locale, "order.create");
  const orders = await listOpenOrders(db(), actor, branchId);
  const time = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { timeStyle: "short", timeZone: "Africa/Addis_Ababa" });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <AutoRefresh seconds={15} />
      <PageHeader title={t.order.openOrders} actions={<Link href={`/${locale}/pos`} className="btn">{t.nav.pos}</Link>} />
      {orders.length === 0 && <p className="text-stone-500">{t.order.noOpenOrders}</p>}
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/${locale}/orders/${o.id}`} className="card flex items-center gap-4 py-4">
              <span className="text-lg font-bold tabular-nums">#{o.order_no}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{o.table_name ?? t.pos.types[o.type]}</span>
                <span className="block text-sm text-stone-500">{time.format(o.created_at)}{o.waiter_name ? ` · ${o.waiter_name}` : ""}</span>
              </span>
              {o.bill_requested && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t.tables.waitingBill}</span>}
              <span className="font-semibold tabular-nums">{money(locale, o.total_santim)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
