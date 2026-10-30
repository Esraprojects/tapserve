import { type Sql, type Tx, withTenant } from "../client";
import { type Actor, DomainError, requirePermission, type Station } from "./common";

export type OrderType = "dine_in" | "takeaway" | "delivery";
export type ItemStatus = "new" | "preparing" | "ready" | "served" | "voided";

export interface OrderLineInput {
  variantId: string;
  quantity: number;
  notes?: string;
  modifierIds?: string[];
}

export interface CreateOrderInput {
  branchId: string;
  type: OrderType;
  tableId?: string | null;
  guestCount?: number | null;
  note?: string;
  /** Generated on the device; retrying with the same id returns the same order. */
  clientUuid?: string;
  items: OrderLineInput[];
}

export interface OrderItemView {
  id: string;
  name_am: string;
  name_en: string;
  variant_name: string;
  modifiers_text: string;
  unit_price_santim: number;
  quantity: number;
  discount_santim: number;
  notes: string;
  station: Station;
  status: ItemStatus;
  void_reason: string | null;
  bill_id: string | null;
  created_at: Date;
}

export interface OrderView {
  id: string;
  branch_id: string;
  order_no: number;
  type: OrderType;
  table_id: string | null;
  table_name: string | null;
  waiter_user_id: string | null;
  waiter_name: string | null;
  status: "open" | "paid" | "cancelled";
  bill_requested_at: Date | null;
  note: string;
  created_at: Date;
  items: OrderItemView[];
}

/** Price and name every line from the database; the client only sends ids and quantities. */
async function buildLines(tx: Tx, branchId: string, lines: OrderLineInput[]) {
  if (!lines.length) throw new DomainError("order_empty");
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const variants = await tx<{
    id: string; item_id: string; item_am: string; item_en: string; variant_am: string; variant_en: string;
    price: number; station: Station; available: boolean;
  }[]>`
    select v.id, i.id as item_id, i.name_am as item_am, i.name_en as item_en, v.name_am as variant_am,
           v.name_en as variant_en, coalesce(bp.price_santim, v.price_santim)::int as price,
           c.station, i.is_available as available
    from menu_item_variants v
    join menu_items i on i.id = v.item_id
    join menu_categories c on c.id = i.category_id
    left join branch_prices bp on bp.variant_id = v.id and bp.branch_id = ${branchId}
    where v.id in ${tx(variantIds)}`;
  const modifierIds = [...new Set(lines.flatMap((l) => l.modifierIds ?? []))];
  const modifiers = modifierIds.length
    ? await tx<{ id: string; name_am: string; name_en: string; delta: number }[]>`
        select id, name_am, name_en, price_delta_santim::int as delta from modifiers where id in ${tx(modifierIds)}`
    : [];

  return lines.map((line) => {
    const v = variants.find((x) => x.id === line.variantId);
    if (!v) throw new DomainError("item_not_found");
    if (!v.available) throw new DomainError("item_unavailable");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) throw new DomainError("invalid_quantity");
    const mods = (line.modifierIds ?? []).map((id) => {
      const m = modifiers.find((x) => x.id === id);
      if (!m) throw new DomainError("modifier_not_found");
      return m;
    });
    return {
      variant_id: v.id,
      item_id: v.item_id,
      name_am: v.item_am || v.item_en,
      name_en: v.item_en || v.item_am,
      variant_name: [v.variant_en, v.variant_am].filter(Boolean).join(" / "),
      modifiers_text: mods.map((m) => m.name_en || m.name_am).join(", "),
      unit_price_santim: v.price + mods.reduce((sum, m) => sum + m.delta, 0),
      quantity: line.quantity,
      notes: (line.notes ?? "").slice(0, 300),
      station: v.station,
    };
  });
}

export async function createOrder(sql: Sql, actor: Actor, input: CreateOrderInput): Promise<string> {
  requirePermission(actor, "order.create");
  if (input.type === "dine_in" && !input.tableId) throw new DomainError("table_required");
  return withTenant(sql, actor, async (tx) => {
    if (input.clientUuid) {
      const [existing] = await tx<{ id: string }[]>`select id from orders where client_uuid = ${input.clientUuid}`;
      if (existing) return existing.id;
    }
    if (input.tableId) {
      const [open] = await tx`select 1 from orders where table_id = ${input.tableId} and status = 'open'`;
      if (open) throw new DomainError("table_occupied");
    }
    const lines = await buildLines(tx, input.branchId, input.items);
    const [no] = await tx<{ n: number }[]>`select next_branch_number(${input.branchId}, 'order')::int as n`;
    const [order] = await tx<{ id: string }[]>`
      insert into orders (branch_id, order_no, type, table_id, waiter_user_id, guest_count, note, client_uuid)
      values (${input.branchId}, ${no!.n}, ${input.type}, ${input.tableId ?? null}, ${actor.userId},
              ${input.guestCount ?? null}, ${input.note ?? ""}, ${input.clientUuid ?? null})
      returning id`;
    await tx`insert into order_items ${tx(lines.map((l) => ({ ...l, order_id: order!.id })))}`;
    return order!.id;
  });
}

export async function addItems(sql: Sql, actor: Actor, orderId: string, items: OrderLineInput[]): Promise<void> {
  requirePermission(actor, "order.create");
  await withTenant(sql, actor, async (tx) => {
    const [order] = await tx<{ branch_id: string; status: string }[]>`
      select branch_id, status from orders where id = ${orderId} for update`;
    if (!order) throw new DomainError("not_found");
    if (order.status !== "open") throw new DomainError("order_closed");
    const lines = await buildLines(tx, order.branch_id, items);
    await tx`insert into order_items ${tx(lines.map((l) => ({ ...l, order_id: orderId })))}`;
    await tx`update orders set bill_requested_at = null where id = ${orderId}`;
  });
}

async function loadOrder(tx: Tx, orderId: string): Promise<OrderView | null> {
  const [order] = await tx<Omit<OrderView, "items">[]>`
    select o.id, o.branch_id, o.order_no::int as order_no, o.type, o.table_id, t.name as table_name,
           o.waiter_user_id, u.full_name as waiter_name, o.status, o.bill_requested_at, o.note, o.created_at
    from orders o
    left join dining_tables t on t.id = o.table_id
    left join users u on u.id = o.waiter_user_id
    where o.id = ${orderId}`;
  if (!order) return null;
  const items = await tx<OrderItemView[]>`
    select oi.id, oi.name_am, oi.name_en, oi.variant_name, oi.modifiers_text, oi.unit_price_santim::int as unit_price_santim,
           oi.quantity, oi.discount_santim::int as discount_santim, oi.notes, oi.station, oi.status, oi.void_reason,
           (select bi.bill_id from bill_items bi join bills b on b.id = bi.bill_id
            where bi.order_item_id = oi.id and b.status <> 'void' limit 1) as bill_id,
           oi.created_at
    from order_items oi where oi.order_id = ${orderId} order by oi.seq`;
  return { ...order, items };
}

export async function getOrder(sql: Sql, actor: Actor, orderId: string): Promise<OrderView | null> {
  return withTenant(sql, actor, (tx) => loadOrder(tx, orderId));
}

export interface OpenOrderSummary {
  id: string;
  order_no: number;
  type: OrderType;
  table_name: string | null;
  waiter_name: string | null;
  created_at: Date;
  bill_requested: boolean;
  total_santim: number;
}

export async function listOpenOrders(sql: Sql, actor: Actor, branchId: string): Promise<OpenOrderSummary[]> {
  return withTenant(sql, actor, (tx) => tx<OpenOrderSummary[]>`
    select o.id, o.order_no::int as order_no, o.type, t.name as table_name, u.full_name as waiter_name, o.created_at,
           o.bill_requested_at is not null as bill_requested,
           coalesce((select sum(oi.unit_price_santim * oi.quantity - oi.discount_santim) from order_items oi
                     where oi.order_id = o.id and oi.status <> 'voided'), 0)::int as total_santim
    from orders o
    left join dining_tables t on t.id = o.table_id
    left join users u on u.id = o.waiter_user_id
    where o.branch_id = ${branchId} and o.status = 'open'
    order by o.created_at`);
}

const NEXT_STATUS: Record<string, ItemStatus[]> = {
  new: ["preparing", "ready", "served"],
  preparing: ["ready", "served"],
  ready: ["served"],
  served: [],
  voided: [],
};

/** Kitchen / bar flow: new -> preparing -> ready -> served. */
export async function setItemStatus(sql: Sql, actor: Actor, itemId: string, status: ItemStatus): Promise<void> {
  if (!actor.permissions.includes("order.create")) requirePermission(actor, "kitchen.manage");
  if (status === "voided") throw new DomainError("use_void");
  await withTenant(sql, actor, async (tx) => {
    const [item] = await tx<{ status: string }[]>`select status from order_items where id = ${itemId} for update`;
    if (!item) throw new DomainError("not_found");
    if (!NEXT_STATUS[item.status]?.includes(status)) throw new DomainError("invalid_status_change");
    await tx`update order_items set status = ${status} where id = ${itemId}`;
  });
}

async function assertNotBilled(tx: Tx, itemId: string) {
  const [billed] = await tx`
    select 1 from bill_items bi join bills b on b.id = bi.bill_id
    where bi.order_item_id = ${itemId} and b.status <> 'void'`;
  if (billed) throw new DomainError("item_already_billed");
}

/** Void a line. Needs order.void; always audited with the reason. */
export async function voidItem(sql: Sql, actor: Actor, itemId: string, reason: string): Promise<void> {
  requirePermission(actor, "order.void");
  if (!reason.trim()) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [item] = await tx`
      select oi.id, oi.name_en, oi.quantity, oi.unit_price_santim, oi.status, o.status as order_status
      from order_items oi join orders o on o.id = oi.order_id where oi.id = ${itemId} for update of oi`;
    if (!item) throw new DomainError("not_found");
    if (item.status === "voided") return;
    if (item.order_status !== "open") throw new DomainError("order_closed");
    await assertNotBilled(tx, itemId);
    await tx`update order_items set status = 'voided', void_reason = ${reason.trim()}, voided_by = ${actor.userId}
             where id = ${itemId}`;
    await tx`insert into audit_logs (action, entity, entity_id, before, reason)
             values ('order.item.void', 'order_item', ${itemId}, ${tx.json(item as never)}, ${reason.trim()})`;
  });
}

/** Discount a line by an amount in santim. Needs order.discount; always audited. */
export async function discountItem(sql: Sql, actor: Actor, itemId: string, amountSantim: number, reason: string): Promise<void> {
  requirePermission(actor, "order.discount");
  if (!reason.trim()) throw new DomainError("reason_required");
  if (!Number.isSafeInteger(amountSantim) || amountSantim < 0) throw new DomainError("invalid_amount");
  await withTenant(sql, actor, async (tx) => {
    const [item] = await tx<{ discount_santim: number; line: number; status: string }[]>`
      select discount_santim::int as discount_santim, (unit_price_santim * quantity)::int as line, status
      from order_items where id = ${itemId} for update`;
    if (!item) throw new DomainError("not_found");
    if (item.status === "voided") throw new DomainError("item_voided");
    if (amountSantim > item.line) throw new DomainError("discount_too_large");
    await assertNotBilled(tx, itemId);
    await tx`update order_items set discount_santim = ${amountSantim} where id = ${itemId}`;
    await tx`insert into audit_logs (action, entity, entity_id, before, after, reason)
             values ('order.item.discount', 'order_item', ${itemId},
                     ${tx.json({ discount_santim: item.discount_santim })}, ${tx.json({ discount_santim: amountSantim })},
                     ${reason.trim()})`;
  });
}

export async function requestBill(sql: Sql, actor: Actor, orderId: string): Promise<void> {
  requirePermission(actor, "order.create");
  await withTenant(sql, actor, (tx) => tx`
    update orders set bill_requested_at = coalesce(bill_requested_at, now()) where id = ${orderId} and status = 'open'`);
}

/** Move an open order to another free table. */
export async function transferOrder(sql: Sql, actor: Actor, orderId: string, toTableId: string): Promise<void> {
  requirePermission(actor, "order.create");
  await withTenant(sql, actor, async (tx) => {
    const [busy] = await tx`select 1 from orders where table_id = ${toTableId} and status = 'open'`;
    if (busy) throw new DomainError("table_occupied");
    const res = await tx`update orders set table_id = ${toTableId}, type = 'dine_in'
                         where id = ${orderId} and status = 'open' returning table_id`;
    if (!res.length) throw new DomainError("not_found");
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('order.transfer', 'order', ${orderId}, ${tx.json({ table_id: toTableId })})`;
  });
}

/** Merge one open order into another (for joined tables). The source order is cancelled. */
export async function mergeOrders(sql: Sql, actor: Actor, fromOrderId: string, intoOrderId: string): Promise<void> {
  requirePermission(actor, "order.create");
  if (fromOrderId === intoOrderId) throw new DomainError("same_order");
  await withTenant(sql, actor, async (tx) => {
    const orders = await tx<{ id: string; status: string; billed: boolean }[]>`
      select o.id, o.status, exists (select 1 from bills b where b.order_id = o.id and b.status <> 'void') as billed
      from orders o where o.id in (${fromOrderId}, ${intoOrderId}) for update of o`;
    if (orders.length !== 2 || orders.some((o) => o.status !== "open")) throw new DomainError("order_closed");
    if (orders.some((o) => o.billed)) throw new DomainError("order_has_bill");
    await tx`update order_items set order_id = ${intoOrderId} where order_id = ${fromOrderId}`;
    await tx`update orders set status = 'cancelled', closed_at = now(), note = ${"Merged into another order"}
             where id = ${fromOrderId}`;
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('order.merge', 'order', ${fromOrderId}, ${tx.json({ into: intoOrderId })})`;
  });
}

/** Cancel an order with no remaining (non-void) items. */
export async function cancelOrder(sql: Sql, actor: Actor, orderId: string, reason: string): Promise<void> {
  requirePermission(actor, "order.void");
  await withTenant(sql, actor, async (tx) => {
    const [live] = await tx`select 1 from order_items where order_id = ${orderId} and status <> 'voided'`;
    if (live) throw new DomainError("order_has_items");
    await tx`update orders set status = 'cancelled', closed_at = now() where id = ${orderId} and status = 'open'`;
    await tx`insert into audit_logs (action, entity, entity_id, reason) values ('order.cancel', 'order', ${orderId}, ${reason})`;
  });
}

export interface KitchenTicketItem {
  id: string;
  order_id: string;
  order_no: number;
  table_name: string | null;
  type: OrderType;
  name_am: string;
  name_en: string;
  variant_name: string;
  modifiers_text: string;
  quantity: number;
  notes: string;
  status: ItemStatus;
  created_at: Date;
}

/** Items the kitchen, bar or barista still has to prepare or hand over, oldest first. */
export async function kitchenQueue(sql: Sql, actor: Actor, branchId: string, station: Station): Promise<KitchenTicketItem[]> {
  if (!actor.permissions.includes("order.create")) requirePermission(actor, "kitchen.manage");
  return withTenant(sql, actor, (tx) => tx<KitchenTicketItem[]>`
    select oi.id, o.id as order_id, o.order_no::int as order_no, t.name as table_name, o.type, oi.name_am, oi.name_en,
           oi.variant_name, oi.modifiers_text, oi.quantity, oi.notes, oi.status, oi.created_at
    from order_items oi
    join orders o on o.id = oi.order_id
    left join dining_tables t on t.id = o.table_id
    where o.branch_id = ${branchId} and o.status = 'open' and oi.station = ${station}
      and oi.status in ('new', 'preparing', 'ready')
    order by oi.seq`);
}
