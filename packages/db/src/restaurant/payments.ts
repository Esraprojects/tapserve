import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";
import type { DateRange } from "./reports";

export type PaymentCheckStatus = "confirmed" | "not_found";

export interface PaymentRow {
  id: string;
  created_at: Date;
  branch_name: string;
  amount_santim: number;
  method_code: string;
  method_am: string;
  method_en: string;
  method_kind: string;
  reference: string;
  /** Restaurant payments have a bill; hotel deposits and folio payments have a booking instead. */
  receipt_no: number | null;
  bill_id: string | null;
  order_id: string | null;
  booking_id: string | null;
  booking_no: number | null;
  received_by: string;
  check_status: PaymentCheckStatus | null;
  check_note: string | null;
  checked_by: string | null;
  checked_at: Date | null;
}

export interface PaymentFilter {
  range: DateRange;
  branchId: string | null;
  methodCode?: string | null;
  /** "unchecked" lists payments nobody has checked against the statement yet. */
  check?: PaymentCheckStatus | "unchecked" | null;
}

/**
 * Every recorded payment, newest first: the register a business without a receipt printer
 * uses to match Telebirr, CBE Birr and bank transfers against the provider statement.
 */
export async function listPayments(sql: Sql, actor: Actor, filter: PaymentFilter): Promise<PaymentRow[]> {
  requirePermission(actor, "reports.view");
  const method = filter.methodCode || null;
  const check = filter.check || null;
  return withTenant(sql, actor, (tx) => tx<PaymentRow[]>`
    select p.id, p.created_at, br.name as branch_name, p.amount_santim::int as amount_santim,
           pm.code as method_code, pm.name_am as method_am, pm.name_en as method_en, pm.kind as method_kind,
           p.reference, b.receipt_no::int as receipt_no, b.id as bill_id, b.order_id,
           bk.id as booking_id, bk.booking_no::int as booking_no,
           coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as received_by,
           pc.status as check_status, pc.note as check_note,
           coalesce(nullif(cu.full_name, ''), cu.phone, cu.email) as checked_by, pc.checked_at
    from payments p
    join payment_methods pm on pm.id = p.method_id
    left join bills b on b.id = p.bill_id
    left join bookings bk on bk.id = p.booking_id
    join branches br on br.id = coalesce(b.branch_id, bk.branch_id)
    join users u on u.id = p.received_by
    left join payment_checks pc on pc.payment_id = p.id
    left join users cu on cu.id = pc.checked_by
    where (p.created_at at time zone 'Africa/Addis_Ababa')::date between ${filter.range.from}::date and ${filter.range.to}::date
      and (${filter.branchId}::uuid is null or br.id = ${filter.branchId}::uuid)
      and (${method}::text is null or pm.code = ${method}::text)
      and (${check}::text is null
           or (${check}::text = 'unchecked' and pc.payment_id is null)
           or pc.status = ${check}::text)
    order by p.seq desc
    limit 1000`);
}

/** Mark a payment as found (or not found) on the provider statement; null clears the mark. */
export async function setPaymentCheck(
  sql: Sql, actor: Actor, paymentId: string, status: PaymentCheckStatus | null, note = "",
): Promise<void> {
  requirePermission(actor, "payment.verify");
  await withTenant(sql, actor, async (tx) => {
    const [payment] = await tx`select 1 from payments where id = ${paymentId}`;
    if (!payment) throw new DomainError("not_found");
    if (status === null) {
      await tx`delete from payment_checks where payment_id = ${paymentId}`;
      return;
    }
    await tx`
      insert into payment_checks (payment_id, status, note) values (${paymentId}, ${status}, ${note.trim().slice(0, 200)})
      on conflict (payment_id) do update
        set status = excluded.status, note = excluded.note, checked_by = excluded.checked_by, checked_at = now()`;
    if (status === "not_found") {
      await tx`insert into audit_logs (action, entity, entity_id, after, reason)
               values ('payment.not_found', 'payment', ${paymentId}, ${tx.json({ status })}, ${note.trim().slice(0, 200)})`;
    }
  });
}
