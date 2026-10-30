import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "@tapserve/i18n";
import { currentShift, getOrder, listBills, listOpenOrders, listPaymentMethods, listTables } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { ReceiptQr } from "@/components/ReceiptQr";
import { PaymentForm } from "@/components/PaymentForm";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import {
  cancelOrderAction, createBillAction, discountItemAction, mergeOrderAction, recordPaymentsAction, requestBillAction,
  transferOrderAction, voidBillAction, voidItemAction,
} from "../actions";

type Params = Promise<{ locale: string; orderId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const STATUS_STYLE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  preparing: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  ready: "bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100",
  served: "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
  voided: "bg-red-100 text-red-700 line-through dark:bg-red-900/40 dark:text-red-200",
};

export default async function OrderPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { orderId } = await params;
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "order.create");
  const order = await getOrder(db(), actor, orderId);
  if (!order) notFound();
  const [bills, methods, shift, tables, openOrders] = await Promise.all([
    listBills(db(), actor, orderId),
    listPaymentMethods(db(), actor),
    currentShift(db(), actor, branchId),
    listTables(db(), actor, branchId),
    listOpenOrders(db(), actor, branchId),
  ]);
  const open = order.status === "open";
  const live = order.items.filter((i) => i.status !== "voided");
  const unbilled = live.filter((i) => !i.bill_id);
  const total = live.reduce((s, i) => s + i.unit_price_santim * i.quantity - i.discount_santim, 0);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderId" value={order.id} />
    </>
  );
  const o = t.order;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader
        title={format(o.title, { no: order.order_no })}
        subtitle={`${order.table_name ?? t.pos.types[order.type]}${order.waiter_name ? ` · ${o.waiter}: ${order.waiter_name}` : ""}${order.status === "paid" ? ` · ${o.paid}` : ""}`}
        actions={open && (
          <>
            <Link href={`/${locale}/pos?order=${order.id}`} className="btn-secondary">{o.addItems}</Link>
            {!order.bill_requested_at && (
              <form action={requestBillAction}>{hidden}<button className="btn-secondary">{o.requestBill}</button></form>
            )}
          </>
        )}
      />
      <FormError t={t} code={param(search.error)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card p-0">
          <form id="bill-form" action={createBillAction}>{hidden}</form>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {order.items.map((item) => (
              <li key={item.id} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  {open && !item.bill_id && item.status !== "voided" && can("payment.record") && (
                    <input type="checkbox" name="itemIds" value={item.id} form="bill-form" defaultChecked
                      className="mt-1 h-5 w-5 accent-brand-600" aria-label={o.billSelected} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${item.status === "voided" ? "text-stone-400 line-through" : ""}`}>
                      {item.quantity} × {pick(locale, item.name_am, item.name_en)}
                      {item.variant_name && <span className="text-stone-500"> · {item.variant_name}</span>}
                    </p>
                    {(item.modifiers_text || item.notes) && (
                      <p className="text-sm text-stone-500">{[item.modifiers_text, item.notes].filter(Boolean).join(" · ")}</p>
                    )}
                    {item.void_reason && <p className="text-sm text-red-600">{o.voided}: {item.void_reason}</p>}
                    {item.discount_santim > 0 && <p className="text-sm text-brand-600">{o.discount}: −{money(locale, item.discount_santim)}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}>{o.statuses[item.status]}</span>
                  <span className="w-28 text-right tabular-nums">{money(locale, item.unit_price_santim * item.quantity - item.discount_santim)}</span>
                </div>
                {open && !item.bill_id && item.status !== "voided" && (can("order.void") || can("order.discount")) && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-stone-500">{o.void} / {o.discount}</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {can("order.void") && (
                        <form action={voidItemAction} className="flex gap-2">
                          {hidden}
                          <input type="hidden" name="itemId" value={item.id} />
                          <input name="reason" required placeholder={o.voidReason} aria-label={o.voidReason} className="input py-2 text-sm" />
                          <button className="btn-secondary min-h-10 px-3 text-sm text-red-600">{o.void}</button>
                        </form>
                      )}
                      {can("order.discount") && (
                        <form action={discountItemAction} className="flex gap-2">
                          {hidden}
                          <input type="hidden" name="itemId" value={item.id} />
                          <input name="amount" inputMode="decimal" required placeholder={o.discountAmount} aria-label={o.discountAmount} className="input w-24 py-2 text-sm" />
                          <input name="reason" required placeholder={o.discountReason} aria-label={o.discountReason} className="input py-2 text-sm" />
                          <button className="btn-secondary min-h-10 px-3 text-sm">{o.discount}</button>
                        </form>
                      )}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-stone-200 px-5 py-4 text-lg font-semibold dark:border-stone-800">
            <span>{t.pos.total}</span>
            <span className="tabular-nums">{money(locale, total)}</span>
          </div>
          {open && unbilled.length > 0 && can("payment.record") && (
            <div className="flex flex-wrap gap-2 border-t border-stone-200 px-5 py-4 dark:border-stone-800">
              <button form="bill-form" name="mode" value="all" className="btn sm:w-auto">{o.billAll}</button>
              <button form="bill-form" name="mode" value="selected" className="btn-secondary">{o.billSelected}</button>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {bills.map((bill) => (
            <div key={bill.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{format(t.bill.title, { no: bill.receipt_no })}</h2>
                <span className="text-sm text-stone-500">{bill.status === "paid" ? o.paid : ""}</span>
              </div>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt>{t.bill.subtotal}</dt><dd className="tabular-nums">{money(locale, bill.subtotal_santim)}</dd></div>
                {bill.service_charge_santim > 0 && (
                  <div className="flex justify-between"><dt>{t.bill.serviceCharge} ({bill.service_charge_rate_bp / 100}%)</dt><dd className="tabular-nums">{money(locale, bill.service_charge_santim)}</dd></div>
                )}
                {bill.tax_type !== "NONE" && (
                  <div className="flex justify-between"><dt>{bill.tax_type === "VAT" ? t.bill.vat : t.bill.tot} ({bill.tax_rate_bp / 100}%)</dt><dd className="tabular-nums">{money(locale, bill.tax_santim)}</dd></div>
                )}
                <div className="flex justify-between text-base font-semibold"><dt>{t.bill.total}</dt><dd className="tabular-nums">{money(locale, bill.total_santim)}</dd></div>
                {bill.paid_santim > 0 && bill.status !== "paid" && (
                  <div className="flex justify-between text-stone-500"><dt>{t.bill.paid}</dt><dd className="tabular-nums">{money(locale, bill.paid_santim)}</dd></div>
                )}
              </dl>
              {bill.status === "open" && can("payment.record") && (
                shift ? (
                  <PaymentForm
                    action={recordPaymentsAction}
                    locale={locale}
                    orderId={order.id}
                    billId={bill.id}
                    dueSantim={bill.total_santim - bill.paid_santim}
                    methods={methods.map((m) => ({ code: m.code, name: pick(locale, m.name_am, m.name_en), kind: m.kind }))}
                    t={t.bill}
                  />
                ) : (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t.domain.no_open_shift} <Link href={`/${locale}/shifts`} className="font-semibold underline">{t.shift.open}</Link>
                  </p>
                )
              )}
              {bill.status === "paid" && <ReceiptQr token={bill.public_token} locale={locale} t={t} />}
              <div className="flex flex-wrap gap-2 pt-1 text-sm">
                <a href={`/${locale}/receipt/${bill.id}?w=80`} target="_blank" className="btn-secondary min-h-10 px-3">{t.bill.print} {t.bill.printWide}</a>
                <a href={`/${locale}/receipt/${bill.id}?w=58`} target="_blank" className="btn-secondary min-h-10 px-3">{t.bill.printNarrow}</a>
                {bill.status === "open" && bill.paid_santim === 0 && can("order.void") && (
                  <form action={voidBillAction}>
                    {hidden}
                    <input type="hidden" name="billId" value={bill.id} />
                    <button className="min-h-10 px-3 text-red-600">{t.bill.voidBill}</button>
                  </form>
                )}
              </div>
            </div>
          ))}

          {open && (
            <div className="card space-y-3">
              <form action={transferOrderAction} className="flex gap-2">
                {hidden}
                <select name="tableId" required className="input py-2 text-sm" aria-label={o.transfer}>
                  <option value="">{o.transfer}</option>
                  {tables.filter((x) => x.status === "free").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="btn-secondary min-h-10 px-3 text-sm">→</button>
              </form>
              {openOrders.length > 1 && bills.length === 0 && (
                <form action={mergeOrderAction} className="flex gap-2">
                  {hidden}
                  <select name="intoOrderId" required className="input py-2 text-sm" aria-label={o.merge}>
                    <option value="">{o.merge}</option>
                    {openOrders.filter((x) => x.id !== order.id).map((x) => (
                      <option key={x.id} value={x.id}>#{x.order_no} {x.table_name ?? ""}</option>
                    ))}
                  </select>
                  <button className="btn-secondary min-h-10 px-3 text-sm">⇢</button>
                </form>
              )}
              {live.length === 0 && can("order.void") && (
                <form action={cancelOrderAction}>
                  {hidden}
                  <button className="text-sm text-red-600">{o.cancel}</button>
                </form>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
