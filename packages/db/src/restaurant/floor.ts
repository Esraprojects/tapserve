import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";

export type TableStatus = "free" | "occupied" | "waiting_bill";

export interface TableView {
  id: string;
  name: string;
  seats: number;
  area_id: string | null;
  area_name: string | null;
  status: TableStatus;
  order_id: string | null;
  order_no: number | null;
  waiter_name: string | null;
  opened_at: Date | null;
  running_total_santim: number;
}

/** Tables with live status, derived from open orders. */
export async function listTables(sql: Sql, actor: Actor, branchId: string): Promise<TableView[]> {
  return withTenant(sql, actor, async (tx) => {
    const rows = await tx<(Omit<TableView, "status"> & { bill_requested: boolean | null })[]>`
      select t.id, t.name, t.seats, t.area_id, a.name as area_name,
             o.id as order_id, o.order_no::int as order_no, u.full_name as waiter_name, o.created_at as opened_at,
             o.bill_requested_at is not null as bill_requested,
             coalesce((select sum(oi.unit_price_santim * oi.quantity - oi.discount_santim)
                       from order_items oi where oi.order_id = o.id and oi.status <> 'voided'), 0)::int
               as running_total_santim
      from dining_tables t
      left join floor_areas a on a.id = t.area_id
      left join orders o on o.table_id = t.id and o.status = 'open'
      left join users u on u.id = o.waiter_user_id
      where t.branch_id = ${branchId} and t.is_active
      order by a.sort nulls last, a.name, t.sort, t.name`;
    return rows.map(({ bill_requested, ...r }) => ({
      ...r,
      status: !r.order_id ? "free" : bill_requested ? "waiting_bill" : "occupied",
    }));
  });
}

export interface AreaView {
  id: string;
  name: string;
}

export async function listAreas(sql: Sql, actor: Actor, branchId: string): Promise<AreaView[]> {
  return withTenant(sql, actor, (tx) => tx<AreaView[]>`
    select id, name from floor_areas where branch_id = ${branchId} order by sort, name`);
}

export async function saveArea(sql: Sql, actor: Actor, input: { branchId: string; name: string; id?: string }): Promise<string> {
  requirePermission(actor, "branches.manage");
  return withTenant(sql, actor, async (tx) => {
    if (input.id) {
      await tx`update floor_areas set name = ${input.name} where id = ${input.id}`;
      return input.id;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into floor_areas (branch_id, name) values (${input.branchId}, ${input.name}) returning id`;
    return row!.id;
  });
}

export async function saveTable(
  sql: Sql,
  actor: Actor,
  input: { branchId: string; name: string; seats: number; areaId: string | null; id?: string },
): Promise<string> {
  requirePermission(actor, "branches.manage");
  return withTenant(sql, actor, async (tx) => {
    try {
      if (input.id) {
        await tx`update dining_tables set name = ${input.name}, seats = ${input.seats}, area_id = ${input.areaId}
                 where id = ${input.id}`;
        return input.id;
      }
      const [row] = await tx<{ id: string }[]>`
        insert into dining_tables (branch_id, name, seats, area_id)
        values (${input.branchId}, ${input.name}, ${input.seats}, ${input.areaId}) returning id`;
      return row!.id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new DomainError("table_name_taken");
      throw err;
    }
  });
}

/** Tables with order history are hidden rather than deleted. */
export async function removeTable(sql: Sql, actor: Actor, tableId: string): Promise<void> {
  requirePermission(actor, "branches.manage");
  await withTenant(sql, actor, async (tx) => {
    const [open] = await tx`select 1 from orders where table_id = ${tableId} and status = 'open'`;
    if (open) throw new DomainError("table_in_use");
    await tx`update dining_tables set is_active = false where id = ${tableId}`;
  });
}
