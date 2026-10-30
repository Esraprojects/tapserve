import { notFound } from "next/navigation";
import { formatEthiopianDate, toEthiopian } from "@tapserve/ethiopian-calendar";
import { getReceipt } from "@tapserve/db";
import { PrintButton } from "@/components/PrintButton";
import { param, resolveLocale } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import "../../print.css";

type Params = Promise<{ locale: string; billId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Receipt for 80 mm or 58 mm thermal printers. Rendering is kept separate from the data so a
 * fiscal-printer driver can later print the same Receipt object instead.
 */
export default async function ReceiptPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { billId } = await params;
  const width = param((await searchParams).w) === "58" ? "w58" : "w80";
  const { actor } = await appContext(locale, "order.create");
  const r = await getReceipt(db(), actor, billId);
  if (!r) notFound();
  const at = r.bill.paid_at ?? r.bill.created_at;
  const gc = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" }).format(at);
  const ec = formatEthiopianDate(toEthiopian(at), "am");
  const b = t.bill;

  return (
    <div className="min-h-dvh bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto w-fit"><PrintButton label={b.print} /></div>
      <div className={`slip ${width} px-2 shadow print:shadow-none`}>
        <div className="center">
          <div className="big">{r.business.name}</div>
          <div>{r.branch.name}{r.branch.address ? `, ${r.branch.address}` : ""}</div>
          <div>{[r.business.sub_city, r.business.city].filter(Boolean).join(", ")}</div>
          {r.branch.phone && <div>{r.branch.phone}</div>}
          {r.business.tin && <div>{b.tin}: {r.business.tin}</div>}
        </div>
        <hr />
        <div className="row"><span>{b.receiptNo}</span><span>{r.bill.receipt_no}</span></div>
        <div className="row"><span>EC</span><span>{ec}</span></div>
        <div className="row"><span>GC</span><span>{gc}</span></div>
        <div className="row"><span>{b.cashier}</span><span>{r.cashier}</span></div>
        <div className="row"><span>#{r.order.order_no}</span><span>{r.order.table_name ?? t.pos.types[r.order.type as "takeaway"]}</span></div>
        <hr />
        {r.lines.map((l, i) => (
          <div key={i}>
            <div>{pick(locale, l.name_am, l.name_en)}{l.variant_name ? ` (${l.variant_name})` : ""}</div>
            <div className="row muted">
              <span>{l.quantity} × {money(locale, l.unit_price_santim)}{l.discount_santim ? ` −${money(locale, l.discount_santim)}` : ""}</span>
              <span>{money(locale, l.line_total_santim)}</span>
            </div>
          </div>
        ))}
        <hr />
        <div className="row"><span>{b.subtotal}</span><span>{money(locale, r.bill.subtotal_santim)}</span></div>
        {r.bill.service_charge_santim > 0 && (
          <div className="row"><span>{b.serviceCharge} {r.bill.service_charge_rate_bp / 100}%</span><span>{money(locale, r.bill.service_charge_santim)}</span></div>
        )}
        {r.bill.tax_type !== "NONE" && (
          <div className="row"><span>{r.bill.tax_type === "VAT" ? b.vat : b.tot} {r.bill.tax_rate_bp / 100}%</span><span>{money(locale, r.bill.tax_santim)}</span></div>
        )}
        <div className="row big"><span>{b.total}</span><span>{money(locale, r.bill.total_santim)}</span></div>
        {r.payments.length > 0 && <hr />}
        {r.payments.map((p, i) => (
          <div key={i} className="row"><span>{pick(locale, p.name_am, p.name_en)}{p.reference ? ` ${p.reference}` : ""}</span><span>{money(locale, p.amount_santim)}</span></div>
        ))}
        <hr />
        {r.business.receipt_footer && <div className="center">{r.business.receipt_footer}</div>}
        <div className="center">{b.thankYou}</div>
        <div className="center muted">{b.notFiscal}</div>
      </div>
    </div>
  );
}
