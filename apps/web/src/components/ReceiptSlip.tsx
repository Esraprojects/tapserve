import { formatEthiopianDate, toEthiopian } from "@tapserve/ethiopian-calendar";
import type { Receipt } from "@tapserve/db";
import type { Dictionary, Locale } from "@tapserve/i18n";
import { money, pick } from "@/lib/text";

/**
 * The receipt body, shared by the thermal print page and the customer's digital receipt.
 * Rendering is kept separate from the data so a fiscal-printer driver can later print the same Receipt.
 */
export function ReceiptSlip({ r, t, locale, width, className = "" }: {
  r: Receipt; t: Dictionary; locale: Locale; width: "w58" | "w80"; className?: string;
}) {
  const at = r.bill.paid_at ?? r.bill.created_at;
  const gc = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Addis_Ababa" }).format(at);
  const ec = formatEthiopianDate(toEthiopian(at), "am");
  const b = t.bill;
  return (
      <div className={`slip ${width} px-2 shadow print:shadow-none ${className}`}>
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
  );
}
