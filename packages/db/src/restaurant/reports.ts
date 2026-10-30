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
