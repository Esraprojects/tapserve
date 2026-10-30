import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  addCashMovement,
  addItems,
  addStaffMember,
  closeShift,
  createBill,
  createOrder,
  discountItem,
  getMenu,
  getOrder,
  getReceipt,
  getTenantAccess,
  kitchenQueue,
  listTables,
  mergeOrders,
  onboardBusiness,
  openShift,
  recordPayments,
  salesReport,
  saveCategory,
  saveItem,
  saveTable,
  setItemStatus,
  signUpWithEmail,
  type Sql,
  transferOrder,
  voidBill,
  voidItem,
  withTenant,
} from "@tapserve/db";
import { freshDatabase } from "./db";

let admin: Sql;
let app: Sql;
let owner: Actor;
let waiter: Actor;
let other: Actor; // a different business
let branchId: string;
let otherBranchId: string;
let tables: string[] = [];
let tibs: string; // variant ids
let shiro: string;
let macchiato: string;

const errorCode = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? String(e));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());

async function actorFor(userId: string, tenantId: string): Promise<Actor> {
  const access = await getTenantAccess(app, userId, tenantId);
  return { tenantId, userId, permissions: access!.permissions };
}

beforeAll(async () => {
  ({ admin, app } = await freshDatabase());
  const u = await signUpWithEmail(app, { email: "owner@cafe.et", password: "password-1", fullName: "Owner" });
  const base = { city: "Addis Ababa", subCity: "Bole", branchName: "Bole", locale: "en" as const };
  const tenantId = await onboardBusiness(app, u.id, { ...base, name: "Cafe", businessType: "restaurant" });
  owner = await actorFor(u.id, tenantId);
  branchId = (await withTenant(app, owner, (tx) => tx`select id from branches`))[0]!.id;

  const waiterId = await addStaffMember(app, owner, { phone: "0911000222", fullName: "Waiter", roleName: "Waiter" });
  waiter = await actorFor(waiterId, tenantId);

  const u2 = await signUpWithEmail(app, { email: "owner@other.et", password: "password-2", fullName: "Other" });
  const t2 = await onboardBusiness(app, u2.id, { ...base, name: "Other", businessType: "bar" });
  other = await actorFor(u2.id, t2);
  otherBranchId = (await withTenant(app, other, (tx) => tx`select id from branches`))[0]!.id;

  const food = await saveCategory(app, owner, { nameAm: "ምግብ", nameEn: "Food", station: "kitchen" });
  const drinks = await saveCategory(app, owner, { nameAm: "መጠጥ", nameEn: "Drinks", station: "barista" });
  await saveItem(app, owner, { categoryId: food, nameAm: "ጥብስ", nameEn: "Tibs", isFasting: false,
    variants: [{ nameAm: "", nameEn: "", priceSantim: 35_000 }] });
  await saveItem(app, owner, { categoryId: food, nameAm: "ሽሮ", nameEn: "Shiro", isFasting: true,
    variants: [{ nameAm: "", nameEn: "", priceSantim: 18_000 }] });
  await saveItem(app, owner, { categoryId: drinks, nameAm: "ማኪያቶ", nameEn: "Macchiato", isFasting: false,
    variants: [{ nameAm: "", nameEn: "", priceSantim: 4_000 }] });
  const menu = await getMenu(app, owner, branchId);
  const variant = (en: string) => menu.categories.flatMap((c) => c.items).find((i) => i.name_en === en)!.variants[0]!.id;
  [tibs, shiro, macchiato] = [variant("Tibs"), variant("Shiro"), variant("Macchiato")];
  for (const name of ["T1", "T2", "T3"]) tables.push(await saveTable(app, owner, { branchId, name, seats: 4, areaId: null }));
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe("menu", () => {
  it("lists categories and marks fasting items", async () => {
    const menu = await getMenu(app, owner, branchId);
    expect(menu.categories.map((c) => c.name_en)).toEqual(["Drinks", "Food"]);
    const shiroItem = menu.categories.flatMap((c) => c.items).find((i) => i.name_en === "Shiro");
    expect(shiroItem?.is_fasting).toBe(true);
  });

  it("only menu managers can change the menu", async () => {
    const menu = await getMenu(app, waiter, branchId);
    expect(await errorCode(saveCategory(app, waiter, { nameAm: "", nameEn: "X", station: "bar" }))).toBe("forbidden");
    expect(menu.categories.length).toBe(2);
  });

  it("other businesses cannot see the menu", async () => {
    expect((await getMenu(app, other, otherBranchId)).categories).toHaveLength(0);
  });
});

describe("orders, kitchen and tables", () => {
  let orderId: string;

  it("creates a dine-in order priced from the menu, not the client", async () => {
    orderId = await createOrder(app, waiter, {
      branchId, type: "dine_in", tableId: tables[0]!, clientUuid: "00000000-0000-4000-8000-000000000001",
      items: [{ variantId: tibs, quantity: 2, notes: "no onion" }, { variantId: macchiato, quantity: 1 }],
    });
    const order = await getOrder(app, waiter, orderId);
    expect(order?.items.map((i) => [i.name_en, i.quantity, i.unit_price_santim, i.station])).toEqual([
      ["Tibs", 2, 35_000, "kitchen"],
      ["Macchiato", 1, 4_000, "barista"],
    ]);
    expect(order?.order_no).toBe(1);
  });

  it("is idempotent for the same device order id (safe retries and offline sync)", async () => {
    const again = await createOrder(app, waiter, {
      branchId, type: "dine_in", tableId: tables[0]!, clientUuid: "00000000-0000-4000-8000-000000000001",
      items: [{ variantId: tibs, quantity: 2 }],
    });
    expect(again).toBe(orderId);
  });

  it("allows only one open order per table", async () => {
    expect(await errorCode(createOrder(app, waiter, { branchId, type: "dine_in", tableId: tables[0]!, items: [{ variantId: shiro, quantity: 1 }] })))
      .toBe("table_occupied");
  });

  it("shows live table status", async () => {
    const list = await listTables(app, waiter, branchId);
    expect(list.find((t) => t.id === tables[0])).toMatchObject({ status: "occupied", running_total_santim: 74_000 });
    expect(list.find((t) => t.id === tables[1])?.status).toBe("free");
  });

  it("routes items to kitchen and barista and moves them through statuses", async () => {
    const kitchen = await kitchenQueue(app, owner, branchId, "kitchen");
    const barista = await kitchenQueue(app, owner, branchId, "barista");
    expect(kitchen.map((i) => i.name_en)).toEqual(["Tibs"]);
    expect(barista.map((i) => i.name_en)).toEqual(["Macchiato"]);
    await setItemStatus(app, owner, kitchen[0]!.id, "preparing");
    await setItemStatus(app, owner, kitchen[0]!.id, "ready");
    expect(await errorCode(setItemStatus(app, owner, kitchen[0]!.id, "new"))).toBe("invalid_status_change");
    await setItemStatus(app, owner, kitchen[0]!.id, "served");
    expect(await kitchenQueue(app, owner, branchId, "kitchen")).toHaveLength(0);
  });

  it("waiters cannot void or discount; managers can, and it is audited", async () => {
    await addItems(app, waiter, orderId, [{ variantId: shiro, quantity: 1 }]);
    const order = (await getOrder(app, owner, orderId))!;
    const shiroLine = order.items.find((i) => i.name_en === "Shiro")!;
    expect(await errorCode(voidItem(app, waiter, shiroLine.id, "mistake"))).toBe("forbidden");
    expect(await errorCode(voidItem(app, owner, shiroLine.id, " "))).toBe("reason_required");
    await voidItem(app, owner, shiroLine.id, "Customer changed mind");
    const tibsLine = order.items.find((i) => i.name_en === "Tibs")!;
    expect(await errorCode(discountItem(app, waiter, tibsLine.id, 5_000, "regular"))).toBe("forbidden");
    await discountItem(app, owner, tibsLine.id, 5_000, "Regular customer");
    const audit = await withTenant(app, owner, (tx) => tx`select action, reason from audit_logs where action like 'order.item.%' order by id`);
    expect(audit).toEqual([
      { action: "order.item.void", reason: "Customer changed mind" },
      { action: "order.item.discount", reason: "Regular customer" },
    ]);
  });

  it("transfers an order to another table and merges two tables", async () => {
    const second = await createOrder(app, waiter, { branchId, type: "dine_in", tableId: tables[1]!, items: [{ variantId: macchiato, quantity: 2 }] });
    await transferOrder(app, waiter, second, tables[2]!);
    let list = await listTables(app, waiter, branchId);
    expect(list.find((t) => t.id === tables[1])?.status).toBe("free");
    expect(list.find((t) => t.id === tables[2])?.status).toBe("occupied");
    await mergeOrders(app, waiter, second, orderId);
    list = await listTables(app, waiter, branchId);
    expect(list.find((t) => t.id === tables[2])?.status).toBe("free");
    const merged = (await getOrder(app, owner, orderId))!;
    expect(merged.items.filter((i) => i.status !== "voided").map((i) => i.name_en).sort()).toEqual(["Macchiato", "Macchiato", "Tibs"]);
  });

  it("other businesses cannot see or touch these orders", async () => {
    expect(await getOrder(app, other, orderId)).toBeNull();
    expect(await kitchenQueue(app, other, branchId, "barista")).toHaveLength(0);
    expect(await errorCode(addItems(app, other, orderId, [{ variantId: tibs, quantity: 1 }]))).toBe("not_found");
  });
});

describe("bills, payments and shifts", () => {
  let orderId: string;

  it("needs an open shift before taking payment", async () => {
    orderId = await createOrder(app, owner, { branchId, type: "takeaway", items: [{ variantId: tibs, quantity: 1 }, { variantId: shiro, quantity: 2 }] });
    const bill = await createBill(app, owner, orderId);
    expect(await errorCode(recordPayments(app, owner, bill, [{ methodCode: "cash", amountSantim: 100 }]))).toBe("no_open_shift");
    await voidBill(app, owner, bill, "Split instead");
  });

  it("splits a bill by items and accepts mixed payments", async () => {
    await openShift(app, owner, branchId, 50_000);
    expect(await errorCode(openShift(app, owner, branchId, 0))).toBe("shift_already_open");
    const order = (await getOrder(app, owner, orderId))!;
    const [tibsLine, shiroLine] = [order.items.find((i) => i.name_en === "Tibs")!, order.items.find((i) => i.name_en === "Shiro")!];

    // VAT 15% included in prices by default: 350 birr -> 304.35 net + 45.65 VAT.
    const billA = await createBill(app, owner, orderId, [tibsLine.id]);
    expect(await errorCode(createBill(app, owner, orderId, [tibsLine.id]))).toBe("item_not_billable");
    const paidA = await recordPayments(app, owner, billA, [
      { methodCode: "cash", amountSantim: 20_000 },
      { methodCode: "telebirr", amountSantim: 15_000, reference: "TB123" },
    ]);
    expect(paidA).toMatchObject({ status: "paid", total_santim: 35_000, subtotal_santim: 30_435, tax_santim: 4_565 });
    expect((await getOrder(app, owner, orderId))?.status).toBe("open");

    const billB = await createBill(app, owner, orderId, [shiroLine.id]);
    expect(await errorCode(recordPayments(app, owner, billB, [{ methodCode: "cash", amountSantim: 36_001 }]))).toBe("overpayment");
    expect(await errorCode(recordPayments(app, owner, billB, [{ methodCode: "bitcoin", amountSantim: 100 }]))).toBe("unknown_payment_method");
    expect(await errorCode(recordPayments(app, owner, billB, [{ methodCode: "cbe_birr", amountSantim: 36_000 }]))).toBe("reference_required");
    await recordPayments(app, owner, billB, [{ methodCode: "cbe_birr", amountSantim: 36_000, reference: "FT26303ABCD" }]);
    expect((await getOrder(app, owner, orderId))?.status).toBe("paid");

    const receipt = (await getReceipt(app, owner, billA))!;
    expect(receipt.business.name).toBe("Cafe");
    expect(receipt.lines.map((l) => l.name_en)).toEqual(["Tibs"]);
    expect(receipt.payments.map((p) => [p.name_en, p.amount_santim, p.reference])).toEqual([
      ["Cash", 20_000, ""],
      ["Telebirr", 15_000, "TB123"],
    ]);
  });

  it("payments cannot be edited or deleted by the app", async () => {
    await expect(withTenant(app, owner, (tx) => tx`delete from payments`)).rejects.toThrow(/permission denied/);
  });

  it("closes the shift with expected cash and variance", async () => {
    const shiftId = (await withTenant(app, owner, (tx) => tx`select id from shifts where closed_at is null`))[0]!.id as string;
    await addCashMovement(app, owner, shiftId, "pay_out", 5_000, "Charcoal");
    // Expected: 500 float + 200 cash sales - 50 pay-out = 650 birr. Counted 640 -> 10 birr short.
    const summary = await closeShift(app, owner, shiftId, 64_000);
    expect(summary.expectedCash).toBe(65_000);
    expect(summary.shift.variance_santim).toBe(-1_000);
    expect(summary.byMethod.map((m) => [m.code, m.total_santim])).toEqual([["cash", 20_000], ["telebirr", 15_000], ["cbe_birr", 36_000]]);
  });

  it("reports today's sales by method, item and waiter", async () => {
    const report = await salesReport(app, owner, { from: today, to: today }, branchId);
    expect(report.totals).toMatchObject({ bills: 2, gross_santim: 71_000 });
    expect(report.byMethod.map((m) => m.code)).toEqual(["cbe_birr", "cash", "telebirr"]);
    expect(report.topItems[0]).toMatchObject({ name_en: "Shiro", quantity: 2, revenue_santim: 36_000 });
    expect(report.daily).toHaveLength(1);
    expect(await errorCode(salesReport(app, waiter, { from: today, to: today }, branchId))).toBe("forbidden");
    const otherReport = await salesReport(app, other, { from: today, to: today }, null);
    expect(otherReport.totals.bills).toBe(0);
  });
});
