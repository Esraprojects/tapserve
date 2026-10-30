import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";
import type { DateRange } from "./reports";

export interface ExpenseCategory {
  id: string;
  code: string;
  name_am: string;
  name_en: string;
}

export async function listExpenseCategories(sql: Sql, actor: Actor): Promise<ExpenseCategory[]> {
  return withTenant(sql, actor, (tx) => tx<ExpenseCategory[]>`
    select id, code, name_am, name_en from expense_categories order by sort, name_en`);
}

export async function addExpenseCategory(sql: Sql, actor: Actor, input: { nameAm: string; nameEn: string }): Promise<string> {
  requirePermission(actor, "expenses.manage");
  const nameAm = input.nameAm.trim().slice(0, 60);
  const nameEn = input.nameEn.trim().slice(0, 60);
  if (!nameAm && !nameEn) throw new DomainError("name_required");
  const code = (nameEn || nameAm).toLowerCase().replace(/\s+/g, "_");
  return withTenant(sql, actor, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into expense_categories (code, name_am, name_en, sort)
      values (${code}, ${nameAm}, ${nameEn}, (select coalesce(max(sort), 0) + 1 from expense_categories))
      on conflict (tenant_id, code) do update set name_am = excluded.name_am
      returning id`;
    return row!.id;
  });
}

export interface ExpenseInput {
  branchId: string;
  categoryId: string;
  amountSantim: number;
  /** YYYY-MM-DD */
  spentOn: string;
  paymentMethodCode?: string | null;
  /** Cash taken from the cashier's drawer: recorded as a pay-out on their open shift. */
  fromDrawer?: boolean;
  vendor?: string;
  note?: string;
}

export async function recordExpense(sql: Sql, actor: Actor, input: ExpenseInput): Promise<string> {
  requirePermission(actor, "expenses.manage");
  if (!Number.isSafeInteger(input.amountSantim) || input.amountSantim <= 0) throw new DomainError("invalid_amount");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spentOn)) throw new DomainError("invalid_date");
  const vendor = (input.vendor ?? "").trim().slice(0, 120);
  const note = (input.note ?? "").trim().slice(0, 300);
  return withTenant(sql, actor, async (tx) => {
    const [category] = await tx<{ name_en: string; name_am: string }[]>`
      select name_en, name_am from expense_categories where id = ${input.categoryId}`;
    if (!category) throw new DomainError("unknown_category");
    let methodId: string | null = null;
    let methodKind: string | null = null;
    const code = input.fromDrawer ? "cash" : input.paymentMethodCode;
    if (code) {
      const [m] = await tx<{ id: string; kind: string }[]>`select id, kind from payment_methods where code = ${code}`;
      if (!m) throw new DomainError("unknown_payment_method");
      methodId = m.id;
      methodKind = m.kind;
    }
    let shiftId: string | null = null;
    if (input.fromDrawer) {
      if (methodKind !== "cash") throw new DomainError("unknown_payment_method");
      const [shift] = await tx<{ id: string }[]>`
        select id from shifts where branch_id = ${input.branchId} and cashier_user_id = ${actor.userId} and closed_at is null`;
      if (!shift) throw new DomainError("no_open_shift");
      shiftId = shift.id;
      const label = [category.name_en || category.name_am, vendor].filter(Boolean).join(" · ");
      await tx`insert into cash_movements (shift_id, kind, amount_santim, reason)
               values (${shift.id}, 'pay_out', ${input.amountSantim}, ${"Expense: " + label})`;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into expenses (branch_id, category_id, amount_santim, spent_on, payment_method_id, shift_id, vendor, note)
      values (${input.branchId}, ${input.categoryId}, ${input.amountSantim}, ${input.spentOn}, ${methodId}, ${shiftId},
              ${vendor}, ${note})
      returning id`;
    return row!.id;
  });
}

export interface ExpenseView {
  id: string;
  spent_on: string;
  branch_name: string;
  category_am: string;
  category_en: string;
  amount_santim: number;
  method_am: string | null;
  method_en: string | null;
  from_drawer: boolean;
  vendor: string;
  note: string;
  voided_at: Date | null;
  void_reason: string | null;
  user_name: string;
}

export async function listExpenses(
  sql: Sql, actor: Actor, range: DateRange, branchId: string | null,
): Promise<ExpenseView[]> {
  requirePermission(actor, "expenses.manage");
  return withTenant(sql, actor, (tx) => tx<ExpenseView[]>`
    select e.id, to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, b.name as branch_name,
           c.name_am as category_am, c.name_en as category_en, e.amount_santim::int as amount_santim,
           pm.name_am as method_am, pm.name_en as method_en, e.shift_id is not null as from_drawer,
           e.vendor, e.note, e.voided_at, e.void_reason, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as user_name
    from expenses e
    join branches b on b.id = e.branch_id
    join expense_categories c on c.id = e.category_id
    left join payment_methods pm on pm.id = e.payment_method_id
    join users u on u.id = e.created_by
    where e.spent_on between ${range.from}::date and ${range.to}::date
      and (${branchId}::uuid is null or e.branch_id = ${branchId}::uuid)
    order by e.spent_on desc, e.created_at desc`);
}

/**
 * Void a mistaken expense (rows are never deleted). If the cash came from a drawer whose
 * shift is still open, the money is put back as a pay-in so the drawer still balances.
 */
export async function voidExpense(sql: Sql, actor: Actor, expenseId: string, reason: string): Promise<void> {
  requirePermission(actor, "expenses.manage");
  const why = reason.trim().slice(0, 200);
  if (!why) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [expense] = await tx<{ id: string; amount_santim: number; shift_id: string | null; voided_at: Date | null }[]>`
      select id, amount_santim::int as amount_santim, shift_id, voided_at from expenses where id = ${expenseId} for update`;
    if (!expense) throw new DomainError("not_found");
    if (expense.voided_at) return;
    if (expense.shift_id) {
      const [open] = await tx`select 1 from shifts where id = ${expense.shift_id} and closed_at is null`;
      if (open) {
        await tx`insert into cash_movements (shift_id, kind, amount_santim, reason)
                 values (${expense.shift_id}, 'pay_in', ${expense.amount_santim}, ${"Expense voided: " + why})`;
      }
    }
    await tx`update expenses set voided_at = now(), void_reason = ${why} where id = ${expenseId}`;
    await tx`insert into audit_logs (action, entity, entity_id, before, reason)
             values ('expense.void', 'expense', ${expenseId}, ${tx.json(expense as never)}, ${why})`;
  });
}
