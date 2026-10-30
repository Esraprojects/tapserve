import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  addItems,
  addStaffMember,
  clearStaffPin,
  createBill,
  createOrder,
  getMenu,
  getPublicReceipt,
  getReceipt,
  getStockCount,
  getTenantAccess,
  listExpenseCategories,
  listExpenses,
  listMovements,
  listPayments,
  listPinUsers,
  listStock,
  listUnits,
  lowStock,
  menuCosting,
  onboardBusiness,
  openShift,
  postStockCount,
  profitReport,
  recordExpense,
  recordPayments,
  recordPurchase,
  recordWaste,
  saveCategory,
  saveCountLines,
  saveInventoryItem,
  saveItem,
  saveRecipe,
  saveSupplier,
  setItemStatus,
  setOwnPin,
  setPaymentCheck,
  shiftSummary,
  signUpWithEmail,
  type Sql,
  startStockCount,
  switchUserWithPin,
  getSession,
  transferStock,
  voidExpense,
  voidItem,
  withTenant,
} from "@tapserve/db";
import { freshDatabase } from "./db";

let admin: Sql;
let app: Sql;
let owner: Actor;
let waiter: Actor;
let other: Actor;
let branchId: string;
let secondBranchId: string;
let beef: string; // inventory item ids
let butter: string;
let tibs: string; // variant id

const errorCode = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? String(e));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());
const range = { from: today, to: today };
const stockOf = async (itemId: string, branch = branchId) =>
  (await listStock(app, owner, branch)).find((i) => i.id === itemId)!;

async function actorFor(userId: string, tenantId: string): Promise<Actor> {
  const access = await getTenantAccess(app, userId, tenantId);
  return { tenantId, userId, permissions: access!.permissions };
}

beforeAll(async () => {
  ({ admin, app } = await freshDatabase());
  const base = { city: "Addis Ababa", subCity: "Bole", branchName: "Bole", locale: "en" as const };
  const u = await signUpWithEmail(app, { email: "owner@inv.et", password: "password-1", fullName: "Owner" });
  const tenantId = await onboardBusiness(app, u.id, { ...base, name: "Inv Cafe", businessType: "cafe" });
  owner = await actorFor(u.id, tenantId);
  branchId = (await withTenant(app, owner, (tx) => tx`select id from branches`))[0]!.id;
  secondBranchId = (await withTenant(app, owner, (tx) =>
    tx`insert into branches (name) values ('Piassa') returning id`))[0]!.id;
  const waiterId = await addStaffMember(app, owner, { phone: "0911000333", fullName: "Waiter", roleName: "Waiter" });
  waiter = await actorFor(waiterId, tenantId);

  const u2 = await signUpWithEmail(app, { email: "owner@inv2.et", password: "password-2", fullName: "Other" });
  const t2 = await onboardBusiness(app, u2.id, { ...base, name: "Other", businessType: "restaurant" });
  other = await actorFor(u2.id, t2);

  const units = await listUnits(app, owner);
  const kg = units.find((x) => x.code === "kg")!.id;
  beef = await saveInventoryItem(app, owner, { nameAm: "የበሬ ሥጋ", nameEn: "Beef", unitId: kg, category: "Meat", reorderLevel: 2 });
  butter = await saveInventoryItem(app, owner, { nameAm: "ቅቤ", nameEn: "Butter", unitId: kg, category: "Dairy" });

  const food = await saveCategory(app, owner, { nameAm: "ምግብ", nameEn: "Food", station: "kitchen" });
  await saveItem(app, owner, { categoryId: food, nameAm: "ጥብስ", nameEn: "Tibs", isFasting: false,
    variants: [{ nameAm: "", nameEn: "", priceSantim: 40_000 }] });
  const menu = await getMenu(app, owner, branchId);
  tibs = menu.categories[0]!.items[0]!.variants[0]!.id;
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe("defaults and isolation", () => {
  it("seeds local units and expense categories for every new business", async () => {
    const units = await listUnits(app, owner);
    expect(units.map((u) => u.code)).toEqual(expect.arrayContaining(["kg", "l", "pc", "kuna"]));
    const categories = await listExpenseCategories(app, owner);
    expect(categories.map((c) => c.code)).toEqual(expect.arrayContaining(["rent", "salary", "utilities", "gas"]));
  });

  it("keeps each business's inventory, expenses and checks private", async () => {
    expect(await listStock(app, other, branchId)).toHaveLength(0);
    for (const table of ["inventory_items", "stock_movements", "stock_levels", "expenses", "payment_checks", "units"]) {
      const rows = await withTenant(app, other, (tx) => tx`select tenant_id from ${tx(table)}`);
      expect(rows.every((r) => r.tenant_id === other.tenantId)).toBe(true);
    }
    expect(await errorCode(withTenant(app, other, (tx) =>
      tx`insert into stock_movements (tenant_id, branch_id, item_id, kind, quantity)
         values (${owner.tenantId}, ${branchId}, ${beef}, 'waste', -1)`))).toMatch(/row-level security|42501/);
  });

  it("only lets inventory managers change stock", async () => {
    expect(await errorCode(recordWaste(app, waiter, { branchId, itemId: beef, quantity: 1, reason: "x" }))).toBe("forbidden");
  });
});

describe("stock ledger", () => {
  it("receives a purchase at cost and keeps a weighted average", async () => {
    const supplier = await saveSupplier(app, owner, { name: "Shola Meat", phone: "0911223344", tin: "0011223344" });
    await recordPurchase(app, owner, {
      branchId, supplierId: supplier, purchasedOn: today, paymentMethodCode: "cash",
      lines: [{ itemId: beef, quantity: 10, lineTotalSantim: 600_000 }, { itemId: butter, quantity: 2, lineTotalSantim: 160_000 }],
    });
    let b = await stockOf(beef);
    expect(b.quantity).toBe(10);
    expect(b.avg_cost_santim).toBe(60_000); // 600 birr per kg
    await recordPurchase(app, owner, { branchId, purchasedOn: today, lines: [{ itemId: beef, quantity: 10, lineTotalSantim: 800_000 }] });
    b = await stockOf(beef);
    expect(b.quantity).toBe(20);
    expect(b.avg_cost_santim).toBe(70_000);
    expect(b.value_santim).toBe(1_400_000);
  });

  it("deducts recipe ingredients when an item is ordered and returns them on an early void", async () => {
    await saveRecipe(app, owner, tibs, [{ itemId: beef, quantity: 0.25 }, { itemId: butter, quantity: 0.05 }]);
    const costing = (await menuCosting(app, owner, branchId)).find((v) => v.variant_id === tibs)!;
    expect(costing.cost_santim).toBe(17_500 + 4_000);

    const orderId = await createOrder(app, waiter, { branchId, type: "counter", items: [{ variantId: tibs, quantity: 2 }] });
    expect((await stockOf(beef)).quantity).toBe(19.5);
    expect((await stockOf(butter)).quantity).toBeCloseTo(1.9, 3);

    const [line] = await withTenant(app, owner, (tx) => tx<{ id: string }[]>`select id from order_items where order_id = ${orderId}`);
    await voidItem(app, owner, line!.id, "Customer left");
    expect((await stockOf(beef)).quantity).toBe(20);

    // Once the kitchen has started, a void does not put the meat back.
    const second = await createOrder(app, waiter, { branchId, type: "counter", items: [{ variantId: tibs, quantity: 1 }] });
    const [l2] = await withTenant(app, owner, (tx) => tx<{ id: string }[]>`select id from order_items where order_id = ${second}`);
    await setItemStatus(app, owner, l2!.id, "preparing");
    await voidItem(app, owner, l2!.id, "Burnt");
    expect((await stockOf(beef)).quantity).toBe(19.75);
  });

  it("records waste with a reason and warns on low stock", async () => {
    expect(await errorCode(recordWaste(app, owner, { branchId, itemId: beef, quantity: 1, reason: " " }))).toBe("reason_required");
    await recordWaste(app, owner, { branchId, itemId: beef, quantity: 18, reason: "Fridge broke" });
    const b = await stockOf(beef);
    expect(b.quantity).toBe(1.75);
    expect((await lowStock(app, owner, branchId)).map((i) => i.id)).toContain(beef);
    const moves = await listMovements(app, owner, branchId, { itemId: beef, kinds: ["waste"] });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.value_santim).toBe(-1_260_000);
  });

  it("transfers between branches at the sender's cost and refuses more than is on hand", async () => {
    expect(await errorCode(transferStock(app, owner, {
      fromBranchId: branchId, toBranchId: secondBranchId, lines: [{ itemId: beef, quantity: 5 }],
    }))).toBe("insufficient_stock");
    await transferStock(app, owner, { fromBranchId: branchId, toBranchId: secondBranchId, lines: [{ itemId: butter, quantity: 0.5 }] });
    const there = await stockOf(butter, secondBranchId);
    expect(there.quantity).toBe(0.5);
    expect(there.avg_cost_santim).toBe(80_000);
  });

  it("posts a stock count as adjustments and keeps the variance", async () => {
    const countId = await startStockCount(app, owner, branchId);
    expect(await startStockCount(app, owner, branchId)).toBe(countId);
    await saveCountLines(app, owner, countId, [{ itemId: beef, countedQuantity: 1.5 }]);
    const draft = (await getStockCount(app, owner, countId))!;
    expect(draft.lines.find((l) => l.item_id === beef)!.variance_quantity).toBeCloseTo(-0.25, 3);
    const posted = await postStockCount(app, owner, countId);
    expect(posted.status).toBe("posted");
    expect(posted.lines.find((l) => l.item_id === beef)!.variance_value_santim).toBe(-17_500);
    expect((await stockOf(beef)).quantity).toBe(1.5);
    expect(await errorCode(saveCountLines(app, owner, countId, [{ itemId: beef, countedQuantity: 1 }]))).toBe("count_posted");
  });

  it("never edits or deletes the ledger", async () => {
    await expect(withTenant(app, owner, (tx) => tx`delete from stock_movements`)).rejects.toThrow(/permission denied/);
    await expect(withTenant(app, owner, (tx) => tx`update stock_movements set quantity = 1`)).rejects.toThrow(/permission denied/);
  });
});

describe("expenses and profit", () => {
  it("records expenses, takes drawer cash from the shift, and voids with a reason", async () => {
    const [rent, gas] = (await listExpenseCategories(app, owner)).filter((c) => c.code === "rent" || c.code === "gas");
    const shiftId = await openShift(app, owner, branchId, 100_000);
    await recordExpense(app, owner, { branchId, categoryId: rent!.id, amountSantim: 500_000, spentOn: today, paymentMethodCode: "bank_cbe" });
    const gasId = await recordExpense(app, owner, { branchId, categoryId: gas!.id, amountSantim: 30_000, spentOn: today, fromDrawer: true, vendor: "Gas shop" });
    expect((await shiftSummary(app, owner, shiftId))!.expectedCash).toBe(70_000);
    await voidExpense(app, owner, gasId, "Entered twice");
    expect((await shiftSummary(app, owner, shiftId))!.expectedCash).toBe(100_000);
    const list = await listExpenses(app, owner, range, branchId);
    expect(list).toHaveLength(2);
    expect(list.find((e) => e.id === gasId)!.voided_at).not.toBeNull();
    expect(await errorCode(recordExpense(app, waiter, { branchId, categoryId: rent!.id, amountSantim: 1, spentOn: today }))).toBe("forbidden");
  });

  it("works out profit from sales, ingredient cost, stock losses and expenses", async () => {
    await recordPurchase(app, owner, { branchId, purchasedOn: today, lines: [{ itemId: beef, quantity: 8.5, lineTotalSantim: 595_000 }] });
    const orderId = await createOrder(app, waiter, { branchId, type: "counter", items: [{ variantId: tibs, quantity: 1 }] });
    const billId = await createBill(app, owner, orderId);
    const bill = (await getReceipt(app, owner, billId))!.bill;
    await recordPayments(app, owner, billId, [{ methodCode: "telebirr", amountSantim: bill.total_santim, reference: "CK12AB34" }]);

    const p = await profitReport(app, owner, range, branchId);
    expect(p.net_sales_santim).toBe(bill.subtotal_santim);
    // Cost of sales: tibs portions ordered today, minus the early void (17,500 beef + 4,000 butter each).
    expect(p.cost_of_sales_santim).toBe(2 * (17_500 + 4_000));
    expect(p.stock_loss_santim).toBe(1_260_000 + 17_500);
    expect(p.expenses_santim).toBe(500_000);
    expect(p.net_profit_santim).toBe(p.net_sales_santim + p.service_charge_santim - p.cost_of_sales_santim - p.stock_loss_santim - 500_000);
    expect(p.daily.at(-1)!.profit_santim).toBe(p.net_profit_santim);
    expect(await errorCode(profitReport(app, waiter, range, branchId))).toBe("forbidden");
  });
});

describe("payments without a printer", () => {
  it("lists every payment and lets the owner tick it off against the statement", async () => {
    const all = await listPayments(app, owner, { range, branchId });
    const tele = all.find((p) => p.method_code === "telebirr")!;
    expect(tele.reference).toBe("CK12AB34");
    expect(tele.check_status).toBeNull();
    await setPaymentCheck(app, owner, tele.id, "confirmed");
    expect((await listPayments(app, owner, { range, branchId, check: "confirmed" })).map((p) => p.id)).toEqual([tele.id]);
    expect(await listPayments(app, owner, { range, branchId, check: "unchecked", methodCode: "telebirr" })).toHaveLength(0);
    expect(await errorCode(setPaymentCheck(app, waiter, tele.id, "confirmed"))).toBe("forbidden");
  });

  it("opens a digital receipt by its link only", async () => {
    const [bill] = await withTenant(app, owner, (tx) => tx<{ id: string }[]>`select id from bills where status = 'paid'`);
    const receipt = (await getReceipt(app, owner, bill!.id))!;
    const pub = (await getPublicReceipt(app, receipt.publicToken))!;
    expect(pub.business.name).toBe("Inv Cafe");
    expect(pub.bill.total_santim).toBe(receipt.bill.total_santim);
    expect(await getPublicReceipt(app, "0".repeat(32))).toBeNull();
    expect(await getPublicReceipt(app, "not-a-token")).toBeNull();
  });
});

describe("offline outbox", () => {
  it("applies a re-sent batch of added items once", async () => {
    const orderId = await createOrder(app, waiter, { branchId, type: "counter", items: [{ variantId: tibs, quantity: 1 }] });
    const batch = crypto.randomUUID();
    await addItems(app, waiter, orderId, [{ variantId: tibs, quantity: 2 }], batch);
    await addItems(app, waiter, orderId, [{ variantId: tibs, quantity: 2 }], batch);
    const rows = await withTenant(app, owner, (tx) => tx`select quantity from order_items where order_id = ${orderId}`);
    expect(rows.map((r) => r.quantity)).toEqual([1, 2]);
  });
});

describe("staff PINs", () => {
  it("switches user with a PIN and locks after repeated wrong tries", async () => {
    expect(await errorCode(setOwnPin(app, waiter, "1234"))).toBe("weak_pin");
    expect(await errorCode(setOwnPin(app, waiter, "12a4"))).toBe("invalid_pin");
    await setOwnPin(app, waiter, "4826");
    const people = await listPinUsers(app, owner);
    const w = people.find((p) => p.full_name === "Waiter")!;
    expect(w.has_pin).toBe(true);

    const { token, userId } = await switchUserWithPin(app, owner, { membershipId: w.membership_id, pin: "4826", branchId });
    expect(userId).toBe(waiter.userId);
    const session = (await getSession(app, token))!;
    expect(session.activeTenantId).toBe(owner.tenantId);
    expect(session.activeBranchId).toBe(branchId);

    for (let i = 0; i < 4; i++) {
      expect(await errorCode(switchUserWithPin(app, owner, { membershipId: w.membership_id, pin: "0000", branchId }))).toBe("wrong_pin");
    }
    expect(await errorCode(switchUserWithPin(app, owner, { membershipId: w.membership_id, pin: "0000", branchId }))).toBe("pin_locked");
    // Even the right PIN is refused while locked.
    expect(await errorCode(switchUserWithPin(app, owner, { membershipId: w.membership_id, pin: "4826", branchId }))).toBe("pin_locked");

    await clearStaffPin(app, owner, w.membership_id);
    expect(await errorCode(switchUserWithPin(app, owner, { membershipId: w.membership_id, pin: "4826", branchId }))).toBe("pin_not_set");
    expect(await errorCode(clearStaffPin(app, waiter, w.membership_id))).toBe("forbidden");
  });

  it("cannot switch into another business's staff", async () => {
    const people = await listPinUsers(app, owner);
    const w = people.find((p) => p.full_name === "Waiter")!;
    expect(await errorCode(switchUserWithPin(app, other, { membershipId: w.membership_id, pin: "4826", branchId: null }))).toBe("not_found");
  });
});

