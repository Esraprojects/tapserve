import { computeBill, type TaxType } from "@tapserve/core";
import { type Sql, type Tx, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";

export interface PaymentMethod {
  id: string;
  code: string;
  name_am: string;
  name_en: string;
  kind: string;
}

export async function listPaymentMethods(sql: Sql, actor: Actor): Promise<PaymentMethod[]> {
  return withTenant(sql, actor, (tx) => tx<PaymentMethod[]>`
    select id, code, name_am, name_en, kind from payment_methods where enabled order by sort`);
}

export interface BillView {
  id: string;
  order_id: string;
  receipt_no: number;
  subtotal_santim: number;
  service_charge_santim: number;
  tax_santim: number;
  total_santim: number;
  paid_santim: number;
  tax_type: TaxType;
  tax_rate_bp: number;
  service_charge_rate_bp: number;
  prices_include_tax: boolean;
  status: "open" | "paid" | "void";
  created_at: Date;
  paid_at: Date | null;
  /** For the customer's digital receipt link (/r/<token>). */
  public_token: string;
}

const billColumns = (tx: Tx) => tx`
  b.id, b.order_id, b.receipt_no::int as receipt_no, b.subtotal_santim::int as subtotal_santim,
  b.service_charge_santim::int as service_charge_santim, b.tax_santim::int as tax_santim,
  b.total_santim::int as total_santim,
  coalesce((select sum(p.amount_santim) from payments p where p.bill_id = b.id), 0)::int as paid_santim,
  b.tax_type, b.tax_rate_bp, b.service_charge_rate_bp, b.prices_include_tax, b.status, b.created_at, b.paid_at, b.public_token`;

export async function listBills(sql: Sql, actor: Actor, orderId: string): Promise<BillView[]> {
  return withTenant(sql, actor, (tx) => tx<BillView[]>`
    select ${billColumns(tx)} from bills b where b.order_id = ${orderId} and b.status <> 'void' order by b.created_at`);
}

/**
 * Create a bill for some or all unbilled items of an order. Passing a subset splits the bill:
 * each item goes on exactly one bill. Totals use the business's tax and service-charge settings.
 */
export async function createBill(sql: Sql, actor: Actor, orderId: string, orderItemIds?: string[]): Promise<string> {
  requirePermission(actor, "payment.record");
  return withTenant(sql, actor, async (tx) => {
    const [order] = await tx<{ branch_id: string; status: string }[]>`
      select branch_id, status from orders where id = ${orderId} for update`;
    if (!order) throw new DomainError("not_found");
    if (order.status !== "open") throw new DomainError("order_closed");
    const unbilled = await tx<{ id: string; unit_price_santim: number; quantity: number; discount_santim: number }[]>`
      select oi.id, oi.unit_price_santim::int as unit_price_santim, oi.quantity, oi.discount_santim::int as discount_santim
      from order_items oi
      where oi.order_id = ${orderId} and oi.status <> 'voided'
        and not exists (select 1 from bill_items bi join bills b on b.id = bi.bill_id
                        where bi.order_item_id = oi.id and b.status <> 'void')`;
    const chosen = orderItemIds ? unbilled.filter((i) => orderItemIds.includes(i.id)) : unbilled;
    if (orderItemIds && chosen.length !== new Set(orderItemIds).size) throw new DomainError("item_not_billable");
    if (!chosen.length) throw new DomainError("nothing_to_bill");

    const [s] = await tx<{ tax_type: TaxType; tax_rate_bp: number; prices_include_tax: boolean;
      service_charge_enabled: boolean; service_charge_rate_bp: number }[]>`
      select tax_type, tax_rate_bp, prices_include_tax, service_charge_enabled, service_charge_rate_bp from tenant_settings`;
    if (!s) throw new DomainError("settings_missing");
    const totals = computeBill(
      chosen.map((i) => ({ unitPrice: i.unit_price_santim, quantity: i.quantity, discount: i.discount_santim })),
      {
        taxType: s.tax_type,
        taxRateBp: s.tax_rate_bp,
        pricesIncludeTax: s.prices_include_tax,
        serviceChargeEnabled: s.service_charge_enabled,
        serviceChargeRateBp: s.service_charge_rate_bp,
      },
    );
    const [no] = await tx<{ n: number }[]>`select next_branch_number(${order.branch_id}, 'receipt')::int as n`;
    const [bill] = await tx<{ id: string }[]>`
      insert into bills (branch_id, order_id, receipt_no, subtotal_santim, service_charge_santim, tax_santim, total_santim,
                         tax_type, tax_rate_bp, service_charge_rate_bp, prices_include_tax)
      values (${order.branch_id}, ${orderId}, ${no!.n}, ${totals.subtotal}, ${totals.serviceCharge}, ${totals.tax},
              ${totals.total}, ${s.tax_type}, ${s.tax_type === "NONE" ? 0 : s.tax_rate_bp},
              ${s.service_charge_enabled ? s.service_charge_rate_bp : 0}, ${s.prices_include_tax})
      returning id`;
    await tx`insert into bill_items ${tx(chosen.map((i) => ({ bill_id: bill!.id, order_item_id: i.id })))}`;
    await tx`update orders set bill_requested_at = coalesce(bill_requested_at, now()) where id = ${orderId}`;
    return bill!.id;
  });
}

/** Void an unpaid bill so its items can be billed again (for example to split differently). */
export async function voidBill(sql: Sql, actor: Actor, billId: string, reason: string): Promise<void> {
  requirePermission(actor, "order.void");
  if (!reason.trim()) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [bill] = await tx`select status, total_santim from bills where id = ${billId} for update`;
    if (!bill) throw new DomainError("not_found");
    if (bill.status !== "open") throw new DomainError("bill_not_open");
    const [paid] = await tx`select 1 from payments where bill_id = ${billId}`;
    if (paid) throw new DomainError("bill_has_payments");
    await tx`update bills set status = 'void' where id = ${billId}`;
    await tx`insert into audit_logs (action, entity, entity_id, before, reason)
             values ('bill.void', 'bill', ${billId}, ${tx.json({ total_santim: bill.total_santim })}, ${reason.trim()})`;
  });
}

export const REFERENCE_REQUIRED: readonly string[] = ["mobile_money", "bank_transfer"];

export interface PaymentInput {
  methodCode: string;
  amountSantim: number;
  reference?: string;
}

/**
 * Record one or more payments (for example part cash, part Telebirr). The cashier needs an open shift.
 * Payments may not exceed the bill; give change in cash outside the system.
 * When the bill is fully paid it closes, and when every item of the order is on a paid bill the order closes.
 */
export async function recordPayments(sql: Sql, actor: Actor, billId: string, payments: PaymentInput[]): Promise<BillView> {
  requirePermission(actor, "payment.record");
  if (!payments.length) throw new DomainError("no_payments");
  for (const p of payments) {
    if (!Number.isSafeInteger(p.amountSantim) || p.amountSantim <= 0) throw new DomainError("invalid_amount");
  }
  return withTenant(sql, actor, async (tx) => {
    const [bill] = await tx<{ id: string; branch_id: string; order_id: string; status: string; total: number; paid: number }[]>`
      select b.id, b.branch_id, b.order_id, b.status, b.total_santim::int as total,
             coalesce((select sum(amount_santim) from payments where bill_id = b.id), 0)::int as paid
      from bills b where b.id = ${billId} for update`;
    if (!bill) throw new DomainError("not_found");
    if (bill.status !== "open") throw new DomainError("bill_not_open");
    const [shift] = await tx<{ id: string }[]>`
      select id from shifts where branch_id = ${bill.branch_id} and cashier_user_id = ${actor.userId} and closed_at is null`;
    if (!shift) throw new DomainError("no_open_shift");

    const total = payments.reduce((s, p) => s + p.amountSantim, 0);
    if (bill.paid + total > bill.total) throw new DomainError("overpayment");

    const codes = [...new Set(payments.map((p) => p.methodCode))];
    const methods = await tx<{ id: string; code: string; kind: string }[]>`
      select id, code, kind from payment_methods where enabled and code in ${tx(codes)}`;
    const rows = payments.map((p) => {
      const method = methods.find((m) => m.code === p.methodCode);
      if (!method) throw new DomainError("unknown_payment_method");
      // Telebirr, CBE Birr and bank transfers are reconciled against the provider statement by this number.
      if (REFERENCE_REQUIRED.includes(method.kind) && !(p.reference ?? "").trim()) throw new DomainError("reference_required");
      return { bill_id: billId, method_id: method.id, amount_santim: p.amountSantim, reference: (p.reference ?? "").trim().slice(0, 100), shift_id: shift.id };
    });
    await tx`insert into payments ${tx(rows)}`;

    if (bill.paid + total === bill.total) {
      await tx`update bills set status = 'paid', paid_at = now() where id = ${billId}`;
      const [left] = await tx`
        select 1 from order_items oi
        where oi.order_id = ${bill.order_id} and oi.status <> 'voided'
          and not exists (select 1 from bill_items bi join bills b on b.id = bi.bill_id
                          where bi.order_item_id = oi.id and b.status = 'paid')`;
      if (!left) {
        await tx`update orders set status = 'paid', closed_at = now() where id = ${bill.order_id}`;
        // Food still waiting in the kitchen stays visible there until served.
      }
    }
    const [view] = await tx<BillView[]>`select ${billColumns(tx)} from bills b where b.id = ${billId}`;
    return view!;
  });
}

export interface Receipt {
  bill: BillView;
  /** For the customer's digital receipt link (/r/<token>). */
  publicToken: string;
  business: { name: string; tin: string | null; city: string; sub_city: string; receipt_footer: string };
  branch: { name: string; address: string; phone: string | null };
  order: { order_no: number; type: string; table_name: string | null; waiter_name: string | null };
  cashier: string;
  lines: { name_am: string; name_en: string; variant_name: string; modifiers_text: string; quantity: number;
    unit_price_santim: number; discount_santim: number; line_total_santim: number }[];
  payments: { name_am: string; name_en: string; amount_santim: number; reference: string }[];
}

export async function getReceipt(sql: Sql, actor: Actor, billId: string): Promise<Receipt | null> {
  return withTenant(sql, actor, (tx) => loadReceipt(tx, billId));
}

/**
 * The customer's digital receipt, opened from a link or QR code without signing in.
 * The token resolves to exactly one business and bill; everything else runs under that tenant's RLS.
 */
export async function getPublicReceipt(sql: Sql, token: string): Promise<Receipt | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const [ref] = await sql<{ tenant_id: string; bill_id: string }[]>`select * from resolve_receipt_token(${token})`;
  if (!ref) return null;
  return withTenant(sql, { tenantId: ref.tenant_id, userId: "" }, (tx) => loadReceipt(tx, ref.bill_id));
}

async function loadReceipt(tx: Tx, billId: string): Promise<Receipt | null> {
  {
    const [bill] = await tx<(BillView & { branch_id: string; created_by: string })[]>`
      select ${billColumns(tx)}, b.branch_id, b.created_by from bills b where b.id = ${billId}`;
    if (!bill) return null;
    const [business] = await tx<Receipt["business"][]>`
      select t.name, t.tin, t.city, t.sub_city, s.receipt_footer
      from tenants t join tenant_settings s on s.tenant_id = t.id where t.id = current_tenant_id()`;
    const [branch] = await tx<Receipt["branch"][]>`select name, address, phone from branches where id = ${bill.branch_id}`;
    const [order] = await tx<Receipt["order"][]>`
      select o.order_no::int as order_no, o.type, t.name as table_name, u.full_name as waiter_name
      from orders o left join dining_tables t on t.id = o.table_id left join users u on u.id = o.waiter_user_id
      where o.id = ${bill.order_id}`;
    const [cashier] = await tx<{ name: string }[]>`
      select coalesce(nullif(full_name, ''), phone, email, '') as name from users where id = ${bill.created_by}`;
    const lines = await tx<Receipt["lines"]>`
      select oi.name_am, oi.name_en, oi.variant_name, oi.modifiers_text, oi.quantity,
             oi.unit_price_santim::int as unit_price_santim, oi.discount_santim::int as discount_santim,
             (oi.unit_price_santim * oi.quantity - oi.discount_santim)::int as line_total_santim
      from bill_items bi join order_items oi on oi.id = bi.order_item_id
      where bi.bill_id = ${billId} order by oi.seq`;
    const payments = await tx<Receipt["payments"]>`
      select pm.name_am, pm.name_en, p.amount_santim::int as amount_santim, p.reference
      from payments p join payment_methods pm on pm.id = p.method_id where p.bill_id = ${billId} order by p.seq`;
    const { branch_id: _b, created_by: _c, ...billView } = bill;
    return {
      bill: billView, publicToken: billView.public_token, business: business!, branch: branch!, order: order!,
      cashier: cashier?.name ?? "", lines, payments,
    };
  }
}
