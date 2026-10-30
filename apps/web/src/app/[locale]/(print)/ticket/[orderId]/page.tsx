import { notFound } from "next/navigation";
import { getOrder, type Station } from "@tapserve/db";
import { PrintButton } from "@/components/PrintButton";
import { param, resolveLocale } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import "../../print.css";

type Params = Promise<{ locale: string; orderId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** Kitchen / bar ticket: only the station's items still to prepare, large and in Amharic and English. */
export default async function TicketPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { orderId } = await params;
  const search = await searchParams;
  const station = (param(search.station) ?? "kitchen") as Station;
  const width = param(search.w) === "58" ? "w58" : "w80";
  const { actor } = await appContext(locale, "kitchen.manage");
  const order = await getOrder(db(), actor, orderId);
  if (!order) notFound();
  const items = order.items.filter((i) => i.station === station && ["new", "preparing"].includes(i.status));
  const time = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "Africa/Addis_Ababa" }).format(new Date());

  return (
    <div className="min-h-dvh bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto w-fit"><PrintButton label={t.kitchen.printTicket} /></div>
      <div className={`slip ${width} px-2 shadow print:shadow-none`}>
        <div className="center big">{t.menu.stations[station]} · #{order.order_no}</div>
        <div className="center">{order.table_name ?? t.pos.types[order.type]} · {time}</div>
        {order.waiter_name && <div className="center">{order.waiter_name}</div>}
        <hr />
        {items.map((i) => (
          <div key={i.id} style={{ marginBottom: 6 }}>
            <div className="big">{i.quantity} × {i.name_am}</div>
            {i.name_en && i.name_en !== i.name_am && <div>{i.name_en}</div>}
            {[i.variant_name, i.modifiers_text, i.notes].filter(Boolean).map((x) => <div key={x}>» {x}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}
