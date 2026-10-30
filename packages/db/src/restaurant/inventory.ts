import { type Sql, type Tx, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "./common";

/**
 * Inventory: ingredients in configurable units, recipes that deduct stock on every sale,
 * purchases, transfers between branches, wastage and stock counts.
 * Stock moves only through the stock_movements ledger; its trigger keeps branch levels and
 * the weighted-average cost up to date.
 */

/** Quantities keep three decimals (grams of a kilo, millilitres of a litre). */
function qty(value: number, { allowZero = false } = {}): string {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > 1e9) {
    throw new DomainError("invalid_quantity");
  }
  return (Math.round(value * 1000) / 1000).toFixed(3);
}

function text(value: string | undefined, max = 200) {
  return (value ?? "").trim().slice(0, max);
}

// Units ----------------------------------------------------------------------------------

export interface Unit {
  id: string;
  code: string;
  name_am: string;
  name_en: string;
}

export async function listUnits(sql: Sql, actor: Actor): Promise<Unit[]> {
  return withTenant(sql, actor, (tx) => tx<Unit[]>`select id, code, name_am, name_en from units order by sort, name_en`);
}

export async function addUnit(sql: Sql, actor: Actor, input: { nameAm: string; nameEn: string }): Promise<string> {
  requirePermission(actor, "inventory.manage");
  const nameAm = text(input.nameAm, 40);
  const nameEn = text(input.nameEn, 40);
  if (!nameAm && !nameEn) throw new DomainError("name_required");
  const code = (nameEn || nameAm).toLowerCase().replace(/\s+/g, "_");
  return withTenant(sql, actor, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into units (code, name_am, name_en, sort)
      values (${code}, ${nameAm}, ${nameEn}, (select coalesce(max(sort), 0) + 1 from units))
      on conflict (tenant_id, code) do update set name_am = excluded.name_am
      returning id`;
    return row!.id;
  });
}

// Ingredients and stock ----------------------------------------------------------------------

export interface StockItem {
  id: string;
  name_am: string;
  name_en: string;
  unit_id: string;
  unit_am: string;
  unit_en: string;
  category: string;
  reorder_level: number;
  is_active: boolean;
  quantity: number;
  avg_cost_santim: number;
  value_santim: number;
  low: boolean;
}

/** Every ingredient with its stock at one branch. */
export async function listStock(sql: Sql, actor: Actor, branchId: string, { activeOnly = false } = {}): Promise<StockItem[]> {
  return withTenant(sql, actor, async (tx) => {
    const rows = await tx<StockItem[]>`
      select i.id, i.name_am, i.name_en, i.unit_id, u.name_am as unit_am, u.name_en as unit_en, i.category,
             i.reorder_level::float8 as reorder_level, i.is_active,
             coalesce(l.quantity, 0)::float8 as quantity, coalesce(l.avg_cost_santim, 0)::float8 as avg_cost_santim,
             round(greatest(coalesce(l.quantity, 0), 0) * coalesce(l.avg_cost_santim, 0))::int as value_santim,
             (i.is_active and (coalesce(l.quantity, 0) < 0 or (i.reorder_level > 0 and coalesce(l.quantity, 0) <= i.reorder_level))) as low
      from inventory_items i
      join units u on u.id = i.unit_id
      left join stock_levels l on l.item_id = i.id and l.branch_id = ${branchId}
      where (not ${activeOnly} or i.is_active)
      order by i.category, coalesce(nullif(i.name_en, ''), i.name_am)`;
    return rows;
  });
}

/** Ingredients at or below their reorder level (or negative because sales outran recorded purchases). */
export async function lowStock(sql: Sql, actor: Actor, branchId: string): Promise<StockItem[]> {
  return (await listStock(sql, actor, branchId, { activeOnly: true })).filter((i) => i.low);
}

export interface InventoryItemInput {
  id?: string;
  nameAm: string;
  nameEn: string;
  unitId: string;
  category?: string;
  reorderLevel?: number;
}

export async function saveInventoryItem(sql: Sql, actor: Actor, input: InventoryItemInput): Promise<string> {
  requirePermission(actor, "inventory.manage");
  const nameAm = text(input.nameAm, 120);
  const nameEn = text(input.nameEn, 120);
  if (!nameAm && !nameEn) throw new DomainError("name_required");
  const reorder = qty(input.reorderLevel ?? 0, { allowZero: true });
  const category = text(input.category, 60);
  return withTenant(sql, actor, async (tx) => {
    const [unit] = await tx`select 1 from units where id = ${input.unitId}`;
    if (!unit) throw new DomainError("unknown_unit");
    if (input.id) {
      const [row] = await tx<{ id: string }[]>`
        update inventory_items set name_am = ${nameAm}, name_en = ${nameEn}, unit_id = ${input.unitId},
               category = ${category}, reorder_level = ${reorder}
        where id = ${input.id} returning id`;
      if (!row) throw new DomainError("not_found");
      return row.id;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into inventory_items (name_am, name_en, unit_id, category, reorder_level)
      values (${nameAm}, ${nameEn}, ${input.unitId}, ${category}, ${reorder}) returning id`;
    return row!.id;
  });
}

export async function setInventoryItemActive(sql: Sql, actor: Actor, itemId: string, active: boolean): Promise<void> {
  requirePermission(actor, "inventory.manage");
  await withTenant(sql, actor, (tx) => tx`update inventory_items set is_active = ${active} where id = ${itemId}`);
}

/** Starting balance when a business begins using inventory (or adds a new ingredient). */
export async function setOpeningStock(
  sql: Sql, actor: Actor, input: { branchId: string; itemId: string; quantity: number; unitCostSantim: number },
): Promise<void> {
  requirePermission(actor, "inventory.manage");
  const q = qty(input.quantity);
  if (!Number.isFinite(input.unitCostSantim) || input.unitCostSantim < 0) throw new DomainError("invalid_amount");
  await withTenant(sql, actor, async (tx) => {
    await tx`insert into stock_movements (branch_id, item_id, kind, quantity, unit_cost_santim, reason)
             values (${input.branchId}, ${input.itemId}, 'opening', ${q}, ${input.unitCostSantim}, 'opening')`;
  });
}

// Suppliers ----------------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  tin: string;
  note: string;
  is_active: boolean;
}

export async function listSuppliers(sql: Sql, actor: Actor): Promise<Supplier[]> {
  return withTenant(sql, actor, (tx) => tx<Supplier[]>`
    select id, name, phone, tin, note, is_active from suppliers order by is_active desc, name`);
}

export async function saveSupplier(
  sql: Sql, actor: Actor, input: { id?: string; name: string; phone?: string; tin?: string; note?: string },
): Promise<string> {
  requirePermission(actor, "inventory.manage");
  const name = text(input.name, 120);
  if (!name) throw new DomainError("name_required");
  const tin = text(input.tin, 10);
  if (tin && !/^[0-9]{10}$/.test(tin)) throw new DomainError("invalid_tin");
  const values = { name, phone: text(input.phone, 20), tin, note: text(input.note, 300) };
  return withTenant(sql, actor, async (tx) => {
    if (input.id) {
      const [row] = await tx<{ id: string }[]>`update suppliers set ${tx(values)} where id = ${input.id} returning id`;
      if (!row) throw new DomainError("not_found");
      return row.id;
    }
    const [row] = await tx<{ id: string }[]>`insert into suppliers ${tx(values)} returning id`;
    return row!.id;
  });
}

// Recipes ------------------------------------------------------------------------------------

export interface RecipeLine {
  item_id: string;
  name_am: string;
  name_en: string;
  unit_am: string;
  unit_en: string;
  quantity: number;
  cost_santim: number;
}

/** A variant's ingredients, costed at the branch's current average cost. */
export async function getRecipe(sql: Sql, actor: Actor, variantId: string, branchId: string): Promise<RecipeLine[]> {
  return withTenant(sql, actor, (tx) => tx<RecipeLine[]>`
    select rl.item_id, i.name_am, i.name_en, u.name_am as unit_am, u.name_en as unit_en, rl.quantity::float8 as quantity,
           round(rl.quantity * coalesce(l.avg_cost_santim, 0))::int as cost_santim
    from recipe_lines rl
    join inventory_items i on i.id = rl.item_id
    join units u on u.id = i.unit_id
    left join stock_levels l on l.item_id = rl.item_id and l.branch_id = ${branchId}
    where rl.variant_id = ${variantId}
    order by coalesce(nullif(i.name_en, ''), i.name_am)`);
}

/** Replace a variant's recipe. Quantities are per one portion, in each ingredient's unit. */
export async function saveRecipe(
  sql: Sql, actor: Actor, variantId: string, lines: { itemId: string; quantity: number }[],
): Promise<void> {
  if (!actor.permissions.includes("menu.manage")) requirePermission(actor, "inventory.manage");
  const unique = new Map<string, string>();
  for (const l of lines) {
    if (l.quantity === 0) continue;
    unique.set(l.itemId, qty(l.quantity));
  }
  await withTenant(sql, actor, async (tx) => {
    const [variant] = await tx`select 1 from menu_item_variants where id = ${variantId}`;
    if (!variant) throw new DomainError("not_found");
    await tx`delete from recipe_lines where variant_id = ${variantId}`;
    if (unique.size) {
      await tx`insert into recipe_lines ${tx([...unique].map(([item_id, quantity]) => ({ variant_id: variantId, item_id, quantity })))}`;
    }
  });
}

export interface VariantCost {
  variant_id: string;
  item_name_am: string;
  item_name_en: string;
  variant_name_am: string;
  variant_name_en: string;
  price_santim: number;
  cost_santim: number;
  ingredients: number;
}

/** Food cost per menu variant at a branch, for the menu costing table. */
export async function menuCosting(sql: Sql, actor: Actor, branchId: string): Promise<VariantCost[]> {
  return withTenant(sql, actor, (tx) => tx<VariantCost[]>`
    select v.id as variant_id, mi.name_am as item_name_am, mi.name_en as item_name_en,
           v.name_am as variant_name_am, v.name_en as variant_name_en,
           coalesce(bp.price_santim, v.price_santim)::int as price_santim,
           coalesce(round(sum(rl.quantity * coalesce(l.avg_cost_santim, 0))), 0)::int as cost_santim,
           count(rl.item_id)::int as ingredients
    from menu_item_variants v
    join menu_items mi on mi.id = v.item_id
    join menu_categories c on c.id = mi.category_id
    left join branch_prices bp on bp.variant_id = v.id and bp.branch_id = ${branchId}
    left join recipe_lines rl on rl.variant_id = v.id
    left join stock_levels l on l.item_id = rl.item_id and l.branch_id = ${branchId}
    group by v.id, mi.id, c.sort, bp.price_santim
    order by c.sort, mi.sort, v.sort`);
}

// Purchases ----------------------------------------------------------------------------------

export interface PurchaseInput {
  branchId: string;
  supplierId?: string | null;
  invoiceRef?: string;
  /** YYYY-MM-DD */
  purchasedOn: string;
  paymentMethodCode?: string | null;
  note?: string;
  lines: { itemId: string; quantity: number; lineTotalSantim: number }[];
}

/** Goods received: adds stock at the price paid, which moves the average cost. */
export async function recordPurchase(sql: Sql, actor: Actor, input: PurchaseInput): Promise<string> {
  requirePermission(actor, "inventory.manage");
  if (!input.lines.length) throw new DomainError("purchase_empty");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) throw new DomainError("invalid_date");
  const lines = input.lines.map((l) => {
    if (!Number.isSafeInteger(l.lineTotalSantim) || l.lineTotalSantim < 0) throw new DomainError("invalid_amount");
    return { item_id: l.itemId, quantity: qty(l.quantity), line_total_santim: l.lineTotalSantim };
  });
  const total = lines.reduce((s, l) => s + l.line_total_santim, 0);
  return withTenant(sql, actor, async (tx) => {
    let methodId: string | null = null;
    if (input.paymentMethodCode) {
      const [m] = await tx<{ id: string }[]>`select id from payment_methods where code = ${input.paymentMethodCode}`;
      if (!m) throw new DomainError("unknown_payment_method");
      methodId = m.id;
    }
    const [purchase] = await tx<{ id: string }[]>`
      insert into purchases (branch_id, supplier_id, invoice_ref, purchased_on, total_santim, payment_method_id, note)
      values (${input.branchId}, ${input.supplierId ?? null}, ${text(input.invoiceRef, 60)}, ${input.purchasedOn},
              ${total}, ${methodId}, ${text(input.note, 300)})
      returning id`;
    await tx`insert into purchase_lines ${tx(lines.map((l) => ({ ...l, purchase_id: purchase!.id })))}`;
    for (const l of lines) {
      await tx`
        insert into stock_movements (branch_id, item_id, kind, quantity, unit_cost_santim, ref_type, ref_id)
        values (${input.branchId}, ${l.item_id}, 'purchase', ${l.quantity},
                ${l.line_total_santim}::numeric / ${l.quantity}::numeric, 'purchase', ${purchase!.id})`;
    }
    return purchase!.id;
  });
}

export interface PurchaseView {
  id: string;
  purchased_on: string;
  supplier_name: string | null;
  invoice_ref: string;
  total_santim: number;
  method_en: string | null;
  method_am: string | null;
  lines: number;
  created_at: Date;
}

export async function listPurchases(sql: Sql, actor: Actor, branchId: string, limit = 50): Promise<PurchaseView[]> {
  return withTenant(sql, actor, (tx) => tx<PurchaseView[]>`
    select p.id, to_char(p.purchased_on, 'YYYY-MM-DD') as purchased_on, s.name as supplier_name, p.invoice_ref,
           p.total_santim::int as total_santim, pm.name_en as method_en, pm.name_am as method_am,
           (select count(*) from purchase_lines pl where pl.purchase_id = p.id)::int as lines, p.created_at
    from purchases p
    left join suppliers s on s.id = p.supplier_id
    left join payment_methods pm on pm.id = p.payment_method_id
    where p.branch_id = ${branchId}
    order by p.purchased_on desc, p.created_at desc limit ${limit}`);
}

// Wastage and transfers -----------------------------------------------------------------------

/** Spoiled, spilled or expired stock. Always needs a reason; valued at the current average cost. */
export async function recordWaste(
  sql: Sql, actor: Actor, input: { branchId: string; itemId: string; quantity: number; reason: string },
): Promise<void> {
  requirePermission(actor, "inventory.manage");
  const reason = text(input.reason, 200);
  if (!reason) throw new DomainError("reason_required");
  const q = qty(input.quantity);
  await withTenant(sql, actor, async (tx) => {
    await tx`insert into stock_movements (branch_id, item_id, kind, quantity, reason)
             values (${input.branchId}, ${input.itemId}, 'waste', ${"-" + q}, ${reason})`;
  });
}

/** Move stock from one branch to another. The receiving branch takes it at the sender's average cost. */
export async function transferStock(
  sql: Sql, actor: Actor,
  input: { fromBranchId: string; toBranchId: string; note?: string; lines: { itemId: string; quantity: number }[] },
): Promise<string> {
  requirePermission(actor, "inventory.manage");
  if (input.fromBranchId === input.toBranchId) throw new DomainError("same_branch");
  if (!input.lines.length) throw new DomainError("transfer_empty");
  const lines = input.lines.map((l) => ({ itemId: l.itemId, quantity: qty(l.quantity) }));
  return withTenant(sql, actor, async (tx) => {
    const branches = await tx`select id from branches where id in ${tx([input.fromBranchId, input.toBranchId])}`;
    if (branches.length !== 2) throw new DomainError("not_found");
    const [transfer] = await tx<{ id: string }[]>`
      insert into stock_transfers (from_branch_id, to_branch_id, note)
      values (${input.fromBranchId}, ${input.toBranchId}, ${text(input.note, 300)}) returning id`;
    for (const l of lines) {
      const [level] = await tx<{ quantity: string }[]>`
        select quantity from stock_levels where branch_id = ${input.fromBranchId} and item_id = ${l.itemId} for update`;
      if (!level || Number(level.quantity) < Number(l.quantity)) throw new DomainError("insufficient_stock");
      const [out] = await tx<{ unit_cost_santim: string }[]>`
        insert into stock_movements (branch_id, item_id, kind, quantity, ref_type, ref_id)
        values (${input.fromBranchId}, ${l.itemId}, 'transfer_out', ${"-" + l.quantity}, 'transfer', ${transfer!.id})
        returning unit_cost_santim`;
      await tx`
        insert into stock_movements (branch_id, item_id, kind, quantity, unit_cost_santim, ref_type, ref_id)
        values (${input.toBranchId}, ${l.itemId}, 'transfer_in', ${l.quantity}, ${out!.unit_cost_santim}, 'transfer', ${transfer!.id})`;
    }
    return transfer!.id;
  });
}

// Stock counts ----------------------------------------------------------------------------------

export interface StockCountView {
  id: string;
  branch_id: string;
  status: "draft" | "posted";
  note: string;
  created_at: Date;
  posted_at: Date | null;
  lines: {
    item_id: string;
    name_am: string;
    name_en: string;
    unit_am: string;
    unit_en: string;
    /** Current stock while a draft; stock at posting time once posted. */
    expected_quantity: number;
    counted_quantity: number | null;
    variance_quantity: number | null;
    variance_value_santim: number | null;
  }[];
}

/** Start a count for a branch. An existing draft is reused, so two people don't start two counts. */
export async function startStockCount(sql: Sql, actor: Actor, branchId: string): Promise<string> {
  requirePermission(actor, "inventory.manage");
  return withTenant(sql, actor, async (tx) => {
    const [draft] = await tx<{ id: string }[]>`
      select id from stock_counts where branch_id = ${branchId} and status = 'draft' order by created_at limit 1`;
    if (draft) return draft.id;
    const [row] = await tx<{ id: string }[]>`insert into stock_counts (branch_id) values (${branchId}) returning id`;
    return row!.id;
  });
}

async function loadCount(tx: Tx, countId: string): Promise<StockCountView | null> {
  const [count] = await tx<Omit<StockCountView, "lines">[]>`
    select id, branch_id, status, note, created_at, posted_at from stock_counts where id = ${countId}`;
  if (!count) return null;
  const lines = await tx<StockCountView["lines"]>`
    select i.id as item_id, i.name_am, i.name_en, u.name_am as unit_am, u.name_en as unit_en,
           (case when ${count.status} = 'posted' then coalesce(cl.expected_quantity, 0)
                 else coalesce(l.quantity, 0) end)::float8 as expected_quantity,
           cl.counted_quantity::float8 as counted_quantity,
           (cl.counted_quantity - case when ${count.status} = 'posted' then cl.expected_quantity
                                       else coalesce(l.quantity, 0) end)::float8 as variance_quantity,
           (case when ${count.status} = 'posted' then cl.variance_value_santim
                 else round((cl.counted_quantity - coalesce(l.quantity, 0)) * coalesce(l.avg_cost_santim, 0)) end)::int
             as variance_value_santim
    from inventory_items i
    join units u on u.id = i.unit_id
    left join stock_levels l on l.item_id = i.id and l.branch_id = ${count.branch_id}
    left join stock_count_lines cl on cl.item_id = i.id and cl.count_id = ${countId}
    where i.is_active or cl.item_id is not null
    order by i.category, coalesce(nullif(i.name_en, ''), i.name_am)`;
  return { ...count, lines };
}

export async function getStockCount(sql: Sql, actor: Actor, countId: string): Promise<StockCountView | null> {
  return withTenant(sql, actor, (tx) => loadCount(tx, countId));
}

/** Save counted quantities on a draft. A null quantity clears that line (not counted). */
export async function saveCountLines(
  sql: Sql, actor: Actor, countId: string, lines: { itemId: string; countedQuantity: number | null }[],
): Promise<void> {
  requirePermission(actor, "inventory.manage");
  await withTenant(sql, actor, async (tx) => {
    const [count] = await tx<{ status: string }[]>`select status from stock_counts where id = ${countId} for update`;
    if (!count) throw new DomainError("not_found");
    if (count.status !== "draft") throw new DomainError("count_posted");
    for (const l of lines) {
      if (l.countedQuantity === null) {
        await tx`delete from stock_count_lines where count_id = ${countId} and item_id = ${l.itemId}`;
      } else {
        const counted = qty(l.countedQuantity, { allowZero: true });
        await tx`
          insert into stock_count_lines (count_id, item_id, counted_quantity) values (${countId}, ${l.itemId}, ${counted})
          on conflict (count_id, item_id) do update set counted_quantity = excluded.counted_quantity`;
      }
    }
  });
}

/** Post a count: every counted line is adjusted to the counted quantity and the variance is kept. */
export async function postStockCount(sql: Sql, actor: Actor, countId: string, note = ""): Promise<StockCountView> {
  requirePermission(actor, "inventory.manage");
  return withTenant(sql, actor, async (tx) => {
    const [count] = await tx<{ branch_id: string; status: string }[]>`
      select branch_id, status from stock_counts where id = ${countId} for update`;
    if (!count) throw new DomainError("not_found");
    if (count.status !== "draft") throw new DomainError("count_posted");
    const lines = await tx<{ item_id: string; counted_quantity: string }[]>`
      select item_id, counted_quantity from stock_count_lines where count_id = ${countId}`;
    if (!lines.length) throw new DomainError("count_empty");
    for (const line of lines) {
      await tx`insert into stock_levels (branch_id, item_id) values (${count.branch_id}, ${line.item_id})
               on conflict (branch_id, item_id) do nothing`;
      const [level] = await tx<{ quantity: string; avg: string }[]>`
        select quantity, avg_cost_santim as avg from stock_levels
        where branch_id = ${count.branch_id} and item_id = ${line.item_id} for update`;
      const diff = Number(line.counted_quantity) - Number(level!.quantity);
      const rounded = Math.round(diff * 1000) / 1000;
      if (rounded !== 0) {
        await tx`
          insert into stock_movements (branch_id, item_id, kind, quantity, ref_type, ref_id, reason)
          values (${count.branch_id}, ${line.item_id}, 'count_adjustment', ${rounded.toFixed(3)}, 'stock_count', ${countId}, 'count')`;
      }
      await tx`
        update stock_count_lines set expected_quantity = ${level!.quantity},
               variance_value_santim = round(${rounded.toFixed(3)}::numeric * ${level!.avg}::numeric)
        where count_id = ${countId} and item_id = ${line.item_id}`;
    }
    await tx`update stock_counts set status = 'posted', posted_at = now(), note = ${text(note, 300)} where id = ${countId}`;
    return (await loadCount(tx, countId))!;
  });
}

export interface StockCountSummary {
  id: string;
  status: "draft" | "posted";
  created_at: Date;
  posted_at: Date | null;
  lines: number;
  variance_value_santim: number;
}

export async function listStockCounts(sql: Sql, actor: Actor, branchId: string): Promise<StockCountSummary[]> {
  return withTenant(sql, actor, (tx) => tx<StockCountSummary[]>`
    select c.id, c.status, c.created_at, c.posted_at,
           (select count(*) from stock_count_lines cl where cl.count_id = c.id)::int as lines,
           coalesce((select sum(variance_value_santim) from stock_count_lines cl where cl.count_id = c.id), 0)::int
             as variance_value_santim
    from stock_counts c where c.branch_id = ${branchId}
    order by c.created_at desc limit 30`);
}

// Ledger -------------------------------------------------------------------------------------

export type MovementKind =
  | "purchase" | "sale" | "void_return" | "waste" | "transfer_in" | "transfer_out" | "count_adjustment" | "opening";

export interface StockMovementView {
  id: string;
  created_at: Date;
  item_id: string;
  name_am: string;
  name_en: string;
  unit_am: string;
  unit_en: string;
  kind: MovementKind;
  quantity: number;
  value_santim: number;
  reason: string;
  user_name: string;
}

export async function listMovements(
  sql: Sql, actor: Actor, branchId: string, options: { itemId?: string; kinds?: MovementKind[]; limit?: number } = {},
): Promise<StockMovementView[]> {
  const kinds = options.kinds?.length ? options.kinds : null;
  return withTenant(sql, actor, (tx) => tx<StockMovementView[]>`
    select m.id, m.created_at, m.item_id, i.name_am, i.name_en, un.name_am as unit_am, un.name_en as unit_en, m.kind,
           m.quantity::float8 as quantity, m.value_santim::int as value_santim, m.reason,
           coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as user_name
    from stock_movements m
    join inventory_items i on i.id = m.item_id
    join units un on un.id = i.unit_id
    join users u on u.id = m.created_by
    where m.branch_id = ${branchId}
      and (${options.itemId ?? null}::uuid is null or m.item_id = ${options.itemId ?? null}::uuid)
      and (${kinds === null} or m.kind = any(${tx.array(kinds ?? [])}::text[]))
    order by m.seq desc limit ${options.limit ?? 100}`);
}
