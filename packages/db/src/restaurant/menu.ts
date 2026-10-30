import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission, type Station } from "./common";

export interface MenuVariant {
  id: string;
  name_am: string;
  name_en: string;
  price_santim: number;
}

export interface ModifierOption {
  id: string;
  name_am: string;
  name_en: string;
  price_delta_santim: number;
}

export interface ModifierGroup {
  id: string;
  name_am: string;
  name_en: string;
  min_select: number;
  max_select: number;
  modifiers: ModifierOption[];
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_am: string;
  name_en: string;
  description: string;
  is_fasting: boolean;
  is_available: boolean;
  variants: MenuVariant[];
  modifier_group_ids: string[];
}

export interface MenuCategory {
  id: string;
  name_am: string;
  name_en: string;
  station: Station;
  sort: number;
  items: MenuItem[];
}

export interface Menu {
  categories: MenuCategory[];
  modifierGroups: ModifierGroup[];
}

/** The full menu, with each variant priced for the given branch. */
export async function getMenu(sql: Sql, actor: Actor, branchId: string | null): Promise<Menu> {
  return withTenant(sql, actor, async (tx) => {
    const categories = await tx<Omit<MenuCategory, "items">[]>`
      select id, name_am, name_en, station, sort from menu_categories order by sort, name_en, name_am`;
    const items = await tx<Omit<MenuItem, "variants" | "modifier_group_ids">[]>`
      select id, category_id, name_am, name_en, description, is_fasting, is_available
      from menu_items order by sort, name_en, name_am`;
    const variants = await tx<(MenuVariant & { item_id: string })[]>`
      select v.id, v.item_id, v.name_am, v.name_en,
             coalesce(bp.price_santim, v.price_santim)::int as price_santim
      from menu_item_variants v
      left join branch_prices bp on bp.variant_id = v.id and bp.branch_id = ${branchId}
      order by v.sort, v.price_santim`;
    const links = await tx<{ item_id: string; group_id: string }[]>`select item_id, group_id from item_modifier_groups`;
    const groups = await tx<Omit<ModifierGroup, "modifiers">[]>`
      select id, name_am, name_en, min_select, max_select from modifier_groups order by name_en`;
    const modifiers = await tx<(ModifierOption & { group_id: string })[]>`
      select id, group_id, name_am, name_en, price_delta_santim::int as price_delta_santim from modifiers order by name_en`;

    const fullItems: MenuItem[] = items.map((item) => ({
      ...item,
      variants: variants.filter((v) => v.item_id === item.id).map(({ item_id: _, ...v }) => v),
      modifier_group_ids: links.filter((l) => l.item_id === item.id).map((l) => l.group_id),
    }));
    return {
      categories: categories.map((c) => ({ ...c, items: fullItems.filter((i) => i.category_id === c.id) })),
      modifierGroups: groups.map((g) => ({
        ...g,
        modifiers: modifiers.filter((m) => m.group_id === g.id).map(({ group_id: _, ...m }) => m),
      })),
    };
  });
}

export interface CategoryInput {
  nameAm: string;
  nameEn: string;
  station: Station;
  sort?: number;
}

export async function saveCategory(sql: Sql, actor: Actor, input: CategoryInput & { id?: string }): Promise<string> {
  requirePermission(actor, "menu.manage");
  return withTenant(sql, actor, async (tx) => {
    if (input.id) {
      const rows = await tx`
        update menu_categories set name_am = ${input.nameAm}, name_en = ${input.nameEn},
          station = ${input.station}, sort = ${input.sort ?? 0}
        where id = ${input.id} returning id`;
      if (!rows.length) throw new DomainError("not_found");
      return input.id;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into menu_categories (name_am, name_en, station, sort)
      values (${input.nameAm}, ${input.nameEn}, ${input.station}, ${input.sort ?? 0}) returning id`;
    return row!.id;
  });
}

export async function deleteCategory(sql: Sql, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "menu.manage");
  await withTenant(sql, actor, async (tx) => {
    const [count] = await tx<{ n: number }[]>`select count(*)::int as n from menu_items where category_id = ${id}`;
    if ((count?.n ?? 0) > 0) throw new DomainError("category_not_empty");
    await tx`delete from menu_categories where id = ${id}`;
  });
}

export interface ItemInput {
  categoryId: string;
  nameAm: string;
  nameEn: string;
  description?: string;
  isFasting: boolean;
  isAvailable?: boolean;
  variants: { nameAm: string; nameEn: string; priceSantim: number }[];
  modifierGroupIds?: string[];
}

/** Create or update an item. Price changes are written to the audit log. */
export async function saveItem(sql: Sql, actor: Actor, input: ItemInput & { id?: string }): Promise<string> {
  requirePermission(actor, "menu.manage");
  if (!input.variants.length) throw new DomainError("item_needs_price");
  for (const v of input.variants) {
    if (!Number.isSafeInteger(v.priceSantim) || v.priceSantim < 0) throw new DomainError("invalid_price");
  }
  return withTenant(sql, actor, async (tx) => {
    let id = input.id;
    let before: unknown = null;
    if (id) {
      before = await tx`select name_am, name_en, price_santim from menu_item_variants where item_id = ${id} order by sort`;
      const rows = await tx`
        update menu_items set category_id = ${input.categoryId}, name_am = ${input.nameAm}, name_en = ${input.nameEn},
          description = ${input.description ?? ""}, is_fasting = ${input.isFasting},
          is_available = ${input.isAvailable ?? true}
        where id = ${id} returning id`;
      if (!rows.length) throw new DomainError("not_found");
      // Variant ids are referenced by past order items only as a loose link, so replacing them is safe.
      await tx`delete from menu_item_variants where item_id = ${id}`;
      await tx`delete from item_modifier_groups where item_id = ${id}`;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into menu_items (category_id, name_am, name_en, description, is_fasting, is_available)
        values (${input.categoryId}, ${input.nameAm}, ${input.nameEn}, ${input.description ?? ""},
                ${input.isFasting}, ${input.isAvailable ?? true})
        returning id`;
      id = row!.id;
    }
    await tx`insert into menu_item_variants ${tx(
      input.variants.map((v, i) => ({ item_id: id!, name_am: v.nameAm, name_en: v.nameEn, price_santim: v.priceSantim, sort: i })),
    )}`;
    if (input.modifierGroupIds?.length) {
      await tx`insert into item_modifier_groups ${tx(input.modifierGroupIds.map((g) => ({ item_id: id!, group_id: g })))}`;
    }
    const after = input.variants.map((v) => ({ name_am: v.nameAm, name_en: v.nameEn, price_santim: v.priceSantim }));
    const priceChanged = before !== null && JSON.stringify(before) !== JSON.stringify(after);
    if (priceChanged || before === null) {
      await tx`insert into audit_logs (action, entity, entity_id, before, after)
               values (${before === null ? "menu.item.create" : "menu.item.price_change"}, 'menu_item', ${id!},
                       ${tx.json(before as never)}, ${tx.json(after)})`;
    }
    return id!;
  });
}

export async function setItemAvailability(sql: Sql, actor: Actor, itemId: string, available: boolean): Promise<void> {
  // Kitchen staff and cashiers mark items sold out, so order.create is enough here.
  requirePermission(actor, "order.create");
  await withTenant(sql, actor, (tx) => tx`update menu_items set is_available = ${available} where id = ${itemId}`);
}

export async function deleteItem(sql: Sql, actor: Actor, itemId: string): Promise<void> {
  requirePermission(actor, "menu.manage");
  await withTenant(sql, actor, async (tx) => {
    await tx`delete from menu_items where id = ${itemId}`;
    await tx`insert into audit_logs (action, entity, entity_id) values ('menu.item.delete', 'menu_item', ${itemId})`;
  });
}

export async function saveModifierGroup(
  sql: Sql,
  actor: Actor,
  input: { id?: string; nameAm: string; nameEn: string; minSelect: number; maxSelect: number;
    modifiers: { nameAm: string; nameEn: string; priceDeltaSantim: number }[] },
): Promise<string> {
  requirePermission(actor, "menu.manage");
  return withTenant(sql, actor, async (tx) => {
    let id = input.id;
    if (id) {
      await tx`update modifier_groups set name_am = ${input.nameAm}, name_en = ${input.nameEn},
                 min_select = ${input.minSelect}, max_select = ${input.maxSelect} where id = ${id}`;
      await tx`delete from modifiers where group_id = ${id}`;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into modifier_groups (name_am, name_en, min_select, max_select)
        values (${input.nameAm}, ${input.nameEn}, ${input.minSelect}, ${input.maxSelect}) returning id`;
      id = row!.id;
    }
    if (input.modifiers.length) {
      await tx`insert into modifiers ${tx(input.modifiers.map((m) => ({
        group_id: id!, name_am: m.nameAm, name_en: m.nameEn, price_delta_santim: m.priceDeltaSantim,
      })))}`;
    }
    return id!;
  });
}
