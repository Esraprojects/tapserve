import { type Sql, withTenant } from "../client";
import { type Actor, requirePermission } from "./common";

export interface DateRange {
  /** Inclusive Addis Ababa calendar dates, YYYY-MM-DD. */
  from: string;
  to: string;
}

export interface SalesReport {
  totals: {
    bills: number;
    gross_santim: number;
    net_santim: number;
    tax_santim: number;
    service_charge_santim: number;
    discounts_santim: number;
    voids_santim: number;
    average_bill_santim: number;
  };
  daily: { day: string; bills: number; gross_santim: number; net_santim: number; tax_santim: number }[];
  byMethod: { code: string; name_am: string; name_en: string; total_santim: number; count: number }[];
  topItems: { name_am: string; name_en: string; quantity: number; revenue_santim: number }[];
  byWaiter: { name: string; orders: number; revenue_santim: number }[];
  byHour: { hour: number; gross_santim: number }[];
}

/**
 * Sales from paid bills in the range (Addis Ababa dates). branchId null = all branches combined.
 * "Net" excludes tax and service charge.
 */
export async function salesReport(sql: Sql, actor: Actor, range: DateRange, branchId: string | null): Promise<SalesReport> {
  requirePermission(actor, "reports.view");
  return withTenant(sql, actor, async (tx) => {
    const day = tx`(b.paid_at at time zone 'Africa/Addis_Ababa')::date`;
    const where = tx`b.status = 'paid' and ${day} between ${range.from}::date and ${range.to}::date
                     and (${branchId}::uuid is null or b.branch_id = ${branchId}::uuid)`;
    const [totals] = await tx<SalesReport["totals"][]>`
      select count(*)::int as bills, coalesce(sum(b.total_santim), 0)::int as gross_santim,
             coalesce(sum(b.subtotal_santim), 0)::int as net_santim, coalesce(sum(b.tax_santim), 0)::int as tax_santim,
             coalesce(sum(b.service_charge_santim), 0)::int as service_charge_santim,
             coalesce((select sum(oi.discount_santim) from bill_items bi join order_items oi on oi.id = bi.order_item_id
                       join bills b on b.id = bi.bill_id where ${where}), 0)::int as discounts_santim,
             coalesce((select sum(oi.unit_price_santim * oi.quantity) from order_items oi join orders o on o.id = oi.order_id
                       where oi.status = 'voided'
                         and (oi.updated_at at time zone 'Africa/Addis_Ababa')::date between ${range.from}::date and ${range.to}::date
                         and (${branchId}::uuid is null or o.branch_id = ${branchId}::uuid)), 0)::int as voids_santim,
             coalesce(round(avg(b.total_santim)), 0)::int as average_bill_santim
      from bills b where ${where}`;
    const daily = await tx<SalesReport["daily"]>`
      select to_char(d, 'YYYY-MM-DD') as day,
             count(b.id)::int as bills, coalesce(sum(b.total_santim), 0)::int as gross_santim,
             coalesce(sum(b.subtotal_santim), 0)::int as net_santim, coalesce(sum(b.tax_santim), 0)::int as tax_santim
      from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
      left join bills b on ${day} = d::date and ${where}
      group by d order by d`;
    const byMethod = await tx<SalesReport["byMethod"]>`
      select pm.code, pm.name_am, pm.name_en, sum(p.amount_santim)::int as total_santim, count(*)::int as count
      from payments p join payment_methods pm on pm.id = p.method_id join bills b on b.id = p.bill_id
      where ${where} group by pm.code, pm.name_am, pm.name_en, pm.sort order by total_santim desc`;
    const topItems = await tx<SalesReport["topItems"]>`
      select oi.name_am, oi.name_en, sum(oi.quantity)::int as quantity,
             sum(oi.unit_price_santim * oi.quantity - oi.discount_santim)::int as revenue_santim
      from bill_items bi join order_items oi on oi.id = bi.order_item_id join bills b on b.id = bi.bill_id
      where ${where} group by oi.name_am, oi.name_en order by revenue_santim desc limit 10`;
    const byWaiter = await tx<SalesReport["byWaiter"]>`
      select coalesce(nullif(u.full_name, ''), u.phone, u.email, '—') as name,
             count(distinct o.id)::int as orders, sum(b.total_santim)::int as revenue_santim
      from bills b join orders o on o.id = b.order_id left join users u on u.id = o.waiter_user_id
      where ${where} group by 1 order by revenue_santim desc`;
    const byHour = await tx<SalesReport["byHour"]>`
      select extract(hour from b.paid_at at time zone 'Africa/Addis_Ababa')::int as hour,
             sum(b.total_santim)::int as gross_santim
      from bills b where ${where} group by 1 order by 1`;
    return { totals: totals!, daily, byMethod, topItems, byWaiter, byHour };
  });
}

export interface LiveStatus {
  openOrders: number;
  occupiedTables: number;
  totalTables: number;
  kitchenQueue: number;
  openShifts: number;
}

export async function liveStatus(sql: Sql, actor: Actor, branchId: string | null): Promise<LiveStatus> {
  return withTenant(sql, actor, async (tx) => {
    const branch = tx`(${branchId}::uuid is null or branch_id = ${branchId}::uuid)`;
    const [row] = await tx<LiveStatus[]>`
      select
        (select count(*) from orders where status = 'open' and ${branch})::int as "openOrders",
        (select count(*) from orders where status = 'open' and table_id is not null and ${branch})::int as "occupiedTables",
        (select count(*) from dining_tables where is_active and ${branch})::int as "totalTables",
        (select count(*) from order_items oi join orders o on o.id = oi.order_id
          where o.status = 'open' and oi.status in ('new', 'preparing')
            and (${branchId}::uuid is null or o.branch_id = ${branchId}::uuid))::int as "kitchenQueue",
        (select count(*) from shifts where closed_at is null and ${branch})::int as "openShifts"`;
    return row!;
  });
}

export interface AuditEntry {
  at: Date;
  action: string;
  entity: string;
  entity_id: string | null;
  actor: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

/** Voids, discounts, price changes, bill voids and shift closes, newest first. */
export async function auditTrail(sql: Sql, actor: Actor, range: DateRange, limit = 200): Promise<AuditEntry[]> {
  requirePermission(actor, "audit.view");
  return withTenant(sql, actor, (tx) => tx<AuditEntry[]>`
    select a.at, a.action, a.entity, a.entity_id, coalesce(nullif(u.full_name, ''), u.phone, u.email, '—') as actor,
           a.reason, a.before, a.after
    from audit_logs a left join users u on u.id = a.actor_user_id
    where (a.at at time zone 'Africa/Addis_Ababa')::date between ${range.from}::date and ${range.to}::date
    order by a.at desc limit ${limit}`);
}

export interface ProfitReport {
  /** Sales without tax and service charge, from paid bills. */
  net_sales_santim: number;
  service_charge_santim: number;
  /** Hotel rooms, extras and discounts on guest folios, before tax (zero for restaurants and cafés). */
  room_revenue_santim: number;
  /** Ingredients used by sales (net of items voided before cooking). */
  cost_of_sales_santim: number;
  /** Spoiled or spilled stock, plus stock-count shortages (gains reduce it). */
  stock_loss_santim: number;
  expenses_santim: number;
  gross_profit_santim: number;
  net_profit_santim: number;
  /** Menu items without a recipe sold in the range; their cost is missing from cost of sales. */
  items_without_recipe: number;
  expensesByCategory: { name_am: string; name_en: string; total_santim: number }[];
  daily: { day: string; net_sales_santim: number; cost_santim: number; expenses_santim: number; profit_santim: number }[];
}

/**
 * Profit = net sales + service charge + room revenue - cost of sales - stock losses - expenses.
 * Costs come from the stock ledger, so they are only as complete as the recipes and purchases entered.
 */
export async function profitReport(sql: Sql, actor: Actor, range: DateRange, branchId: string | null): Promise<ProfitReport> {
  requirePermission(actor, "reports.profit.view");
  return withTenant(sql, actor, async (tx) => {
    const inRange = (col: string) =>
      tx`(${tx.unsafe(col)} at time zone 'Africa/Addis_Ababa')::date between ${range.from}::date and ${range.to}::date`;
    const branch = (col: string) => tx`(${branchId}::uuid is null or ${tx.unsafe(col)} = ${branchId}::uuid)`;
    const daily = await tx<{ day: string; net: number; service: number; room: number; cost: number; loss: number; expenses: number }[]>`
      with days as (select d::date as d from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d),
      sales as (
        select (b.paid_at at time zone 'Africa/Addis_Ababa')::date as d, sum(b.subtotal_santim) as net,
               sum(b.service_charge_santim) as service
        from bills b where b.status = 'paid' and ${inRange("b.paid_at")} and ${branch("b.branch_id")} group by 1),
      rooms as (
        select coalesce(c.night_date, (c.created_at at time zone 'Africa/Addis_Ababa')::date) as d,
               sum(c.amount_santim - c.tax_santim) as room
        from folio_charges c join bookings bk on bk.id = c.booking_id
        where c.kind in ('room', 'extra', 'discount') and c.voided_at is null and ${branch("bk.branch_id")}
          and coalesce(c.night_date, (c.created_at at time zone 'Africa/Addis_Ababa')::date) between ${range.from}::date and ${range.to}::date
        group by 1),
      stock as (
        select (m.created_at at time zone 'Africa/Addis_Ababa')::date as d,
               -sum(m.value_santim) filter (where m.kind in ('sale', 'void_return')) as cost,
               -sum(m.value_santim) filter (where m.kind in ('waste', 'count_adjustment')) as loss
        from stock_movements m where ${inRange("m.created_at")} and ${branch("m.branch_id")} group by 1),
      spent as (
        select e.spent_on as d, sum(e.amount_santim) as expenses
        from expenses e
        where e.voided_at is null and e.spent_on between ${range.from}::date and ${range.to}::date and ${branch("e.branch_id")}
        group by 1)
      select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(s.net, 0)::int as net, coalesce(s.service, 0)::int as service,
             coalesce(r.room, 0)::int as room,
             coalesce(st.cost, 0)::int as cost, coalesce(st.loss, 0)::int as loss, coalesce(sp.expenses, 0)::int as expenses
      from days left join sales s on s.d = days.d left join rooms r on r.d = days.d left join stock st on st.d = days.d left join spent sp on sp.d = days.d
      order by days.d`;
    const expensesByCategory = await tx<ProfitReport["expensesByCategory"]>`
      select c.name_am, c.name_en, sum(e.amount_santim)::int as total_santim
      from expenses e join expense_categories c on c.id = e.category_id
      where e.voided_at is null and e.spent_on between ${range.from}::date and ${range.to}::date and ${branch("e.branch_id")}
      group by c.id, c.name_am, c.name_en order by total_santim desc`;
    const [missing] = await tx<{ n: number }[]>`
      select count(distinct oi.variant_id)::int as n
      from bill_items bi join bills b on b.id = bi.bill_id join order_items oi on oi.id = bi.order_item_id
      where b.status = 'paid' and ${inRange("b.paid_at")} and ${branch("b.branch_id")}
        and oi.variant_id is not null
        and not exists (select 1 from recipe_lines rl where rl.variant_id = oi.variant_id)`;
    const sum = (k: "net" | "service" | "room" | "cost" | "loss" | "expenses") => daily.reduce((s, d) => s + d[k], 0);
    const net = sum("net");
    const service = sum("service");
    const room = sum("room");
    const cost = sum("cost");
    const loss = sum("loss");
    const expenses = sum("expenses");
    const gross = net + service + room - cost;
    return {
      net_sales_santim: net,
      service_charge_santim: service,
      room_revenue_santim: room,
      cost_of_sales_santim: cost,
      stock_loss_santim: loss,
      expenses_santim: expenses,
      gross_profit_santim: gross,
      net_profit_santim: gross - loss - expenses,
      items_without_recipe: missing!.n,
      expensesByCategory,
      daily: daily.map((d) => ({
        day: d.day,
        net_sales_santim: d.net + d.room,
        cost_santim: d.cost + d.loss,
        expenses_santim: d.expenses,
        profit_santim: d.net + d.service + d.room - d.cost - d.loss - d.expenses,
      })),
    };
  });
}
