import { type Sql, type Tx, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";

export interface ShiftView {
  id: string;
  branch_id: string;
  cashier_user_id: string;
  cashier_name: string;
  opened_at: Date;
  closed_at: Date | null;
  opening_float_santim: number;
  expected_cash_santim: number | null;
  counted_cash_santim: number | null;
  variance_santim: number | null;
  note: string;
}

export interface ShiftSummary {
  shift: ShiftView;
  byMethod: { code: string; name_am: string; name_en: string; kind: string; total_santim: number; count: number }[];
  payIns: number;
  payOuts: number;
  /** Opening float + cash payments + pay-ins - pay-outs. */
  expectedCash: number;
  movements: { kind: "pay_in" | "pay_out"; amount_santim: number; reason: string; created_at: Date }[];
}

const shiftColumns = (tx: Tx) => tx`
  s.id, s.branch_id, s.cashier_user_id, u.full_name as cashier_name, s.opened_at, s.closed_at,
  s.opening_float_santim::int as opening_float_santim, s.expected_cash_santim::int as expected_cash_santim,
  s.counted_cash_santim::int as counted_cash_santim, s.variance_santim::int as variance_santim, s.note`;

export async function currentShift(sql: Sql, actor: Actor, branchId: string): Promise<ShiftView | null> {
  return withTenant(sql, actor, async (tx) => {
    const [row] = await tx<ShiftView[]>`
      select ${shiftColumns(tx)} from shifts s join users u on u.id = s.cashier_user_id
      where s.branch_id = ${branchId} and s.cashier_user_id = ${actor.userId} and s.closed_at is null`;
    return row ?? null;
  });
}

export async function openShift(sql: Sql, actor: Actor, branchId: string, openingFloatSantim: number): Promise<string> {
  requirePermission(actor, "shift.manage");
  if (!Number.isSafeInteger(openingFloatSantim) || openingFloatSantim < 0) throw new DomainError("invalid_amount");
  return withTenant(sql, actor, async (tx) => {
    try {
      const [row] = await tx<{ id: string }[]>`
        insert into shifts (branch_id, cashier_user_id, opening_float_santim)
        values (${branchId}, ${actor.userId}, ${openingFloatSantim}) returning id`;
      await tx`insert into audit_logs (action, entity, entity_id, after)
               values ('shift.open', 'shift', ${row!.id}, ${tx.json({ opening_float_santim: openingFloatSantim })})`;
      return row!.id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new DomainError("shift_already_open");
      throw err;
    }
  });
}

export async function addCashMovement(
  sql: Sql, actor: Actor, shiftId: string, kind: "pay_in" | "pay_out", amountSantim: number, reason: string,
): Promise<void> {
  requirePermission(actor, "shift.manage");
  if (!Number.isSafeInteger(amountSantim) || amountSantim <= 0) throw new DomainError("invalid_amount");
  if (!reason.trim()) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [shift] = await tx`select closed_at from shifts where id = ${shiftId}`;
    if (!shift) throw new DomainError("not_found");
    if (shift.closed_at) throw new DomainError("shift_closed");
    await tx`insert into cash_movements (shift_id, kind, amount_santim, reason)
             values (${shiftId}, ${kind}, ${amountSantim}, ${reason.trim()})`;
  });
}

async function summarize(tx: Tx, shiftId: string): Promise<ShiftSummary | null> {
  const [shift] = await tx<ShiftView[]>`
    select ${shiftColumns(tx)} from shifts s join users u on u.id = s.cashier_user_id where s.id = ${shiftId}`;
  if (!shift) return null;
  const byMethod = await tx<ShiftSummary["byMethod"]>`
    select pm.code, pm.name_am, pm.name_en, pm.kind, sum(p.amount_santim)::int as total_santim, count(*)::int as count
    from payments p join payment_methods pm on pm.id = p.method_id
    where p.shift_id = ${shiftId}
    group by pm.code, pm.name_am, pm.name_en, pm.kind, pm.sort order by pm.sort`;
  const movements = await tx<ShiftSummary["movements"]>`
    select kind, amount_santim::int as amount_santim, reason, created_at from cash_movements
    where shift_id = ${shiftId} order by created_at`;
  const payIns = movements.filter((m) => m.kind === "pay_in").reduce((s, m) => s + m.amount_santim, 0);
  const payOuts = movements.filter((m) => m.kind === "pay_out").reduce((s, m) => s + m.amount_santim, 0);
  const cash = byMethod.filter((m) => m.kind === "cash").reduce((s, m) => s + m.total_santim, 0);
  return { shift, byMethod, payIns, payOuts, movements, expectedCash: shift.opening_float_santim + cash + payIns - payOuts };
}

export async function shiftSummary(sql: Sql, actor: Actor, shiftId: string): Promise<ShiftSummary | null> {
  return withTenant(sql, actor, (tx) => summarize(tx, shiftId));
}

/** Close a shift: compare counted cash with what the drawer should hold. */
export async function closeShift(
  sql: Sql, actor: Actor, shiftId: string, countedCashSantim: number, note = "",
): Promise<ShiftSummary> {
  requirePermission(actor, "shift.manage");
  if (!Number.isSafeInteger(countedCashSantim) || countedCashSantim < 0) throw new DomainError("invalid_amount");
  return withTenant(sql, actor, async (tx) => {
    const [locked] = await tx`select cashier_user_id, closed_at from shifts where id = ${shiftId} for update`;
    if (!locked) throw new DomainError("not_found");
    if (locked.closed_at) throw new DomainError("shift_closed");
    if (locked.cashier_user_id !== actor.userId && !actor.permissions.includes("reports.view")) {
      throw new DomainError("forbidden");
    }
    const summary = (await summarize(tx, shiftId))!;
    const variance = countedCashSantim - summary.expectedCash;
    await tx`
      update shifts set closed_at = now(), expected_cash_santim = ${summary.expectedCash},
        counted_cash_santim = ${countedCashSantim}, variance_santim = ${variance}, note = ${note}
      where id = ${shiftId}`;
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('shift.close', 'shift', ${shiftId},
                     ${tx.json({ expected: summary.expectedCash, counted: countedCashSantim, variance })})`;
    return (await summarize(tx, shiftId))!;
  });
}

export async function listShifts(sql: Sql, actor: Actor, branchId: string, limit = 30): Promise<ShiftView[]> {
  return withTenant(sql, actor, (tx) => tx<ShiftView[]>`
    select ${shiftColumns(tx)} from shifts s join users u on u.id = s.cashier_user_id
    where s.branch_id = ${branchId} order by s.opened_at desc limit ${limit}`);
}
