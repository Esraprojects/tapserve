/**
 * Demo data for local testing: one owner with a demo café and a demo hotel-restaurant,
 * an Ethiopian menu, tables, staff, and a week of sample sales for the dashboard.
 * Run after migrations: pnpm db:seed (uses DATABASE_URL, the RLS-restricted app role).
 * With DATABASE_ADMIN_URL also set, sample stock movements are back-dated to match the sample sales.
 */
import { birrToSantim } from "@tapserve/core";
import {
  AuthError, type Actor, completeOnboarding, createBill, createOrder, createSql, getMenu, getTenantAccess,
  onboardBusiness, openShift, closeShift, shiftSummary, recordPayments, saveCategory, saveItem, saveModifierGroup, saveTable,
  addStaffMember, setItemStatus, signUpWithEmail, withTenant, type Sql,
  listUnits, saveInventoryItem, setOpeningStock, saveRecipe, recordPurchase, saveSupplier, listExpenseCategories,
  recordExpense, recordWaste, setOwnPin, listPayments, setPaymentCheck, listStaff,
} from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (see .env.example)");
  process.exit(1);
}

const DEMO_EMAIL = "demo@tapserve.et";
const DEMO_PASSWORD = "demo-pass-123";

type Item = [am: string, en: string, birr: string | [string, string, string][], fasting?: boolean];

const MENU: { am: string; en: string; station: "kitchen" | "bar" | "barista"; items: Item[] }[] = [
  { am: "ቁርስ", en: "Breakfast", station: "kitchen", items: [
    ["ፍርፍር", "Firfir", "180"], ["ጨጨብሳ", "Chechebsa", "200"], ["ፉል", "Ful", "150", true], ["እንቁላል ፍርፍር", "Egg firfir", "190"],
  ] },
  { am: "ምሳ እና እራት", en: "Lunch & dinner", station: "kitchen", items: [
    ["ጥብስ", "Tibs", [["ግማሽ", "Half", "280"], ["ሙሉ", "Full", "450"]]], ["ክትፎ", "Kitfo", "520"], ["ሽሮ", "Shiro", "180", true],
    ["በያይነቱ", "Beyaynetu", "220", true], ["ዶሮ ወጥ", "Doro wot", "650"], ["ጎመን", "Gomen", "160", true],
  ] },
  { am: "ትኩስ መጠጦች", en: "Hot drinks", station: "barista", items: [
    ["ቡና", "Buna (coffee)", "40", true], ["ማኪያቶ", "Macchiato", "45"], ["ሻይ", "Tea", "30", true], ["ስፕሪስ", "Spris", "50"],
  ] },
  { am: "ለስላሳ መጠጦች", en: "Soft drinks", station: "bar", items: [
    ["ውሃ", "Water", "35", true], ["ኮካ ኮላ", "Coca-Cola", "45", true], ["አምቦ ውሃ", "Ambo mineral water", "40", true],
    ["የአቮካዶ ጭማቂ", "Avocado juice", "120", true],
  ] },
];

async function setUpMenu(sql: Sql, actor: Actor) {
  const spice = await saveModifierGroup(sql, actor, { nameAm: "ቅመም", nameEn: "Spice", minSelect: 0, maxSelect: 3, modifiers: [
    { nameAm: "ሽንኩርት አይግባ", nameEn: "No onion", priceDeltaSantim: 0 },
    { nameAm: "ተጨማሪ በርበሬ", nameEn: "Extra berbere", priceDeltaSantim: 0 },
    { nameAm: "ተጨማሪ ቅቤ", nameEn: "Extra butter", priceDeltaSantim: 2_000 },
  ] });
  for (const [i, cat] of MENU.entries()) {
    const categoryId = await saveCategory(sql, actor, { nameAm: cat.am, nameEn: cat.en, station: cat.station, sort: i });
    for (const [am, en, price, fasting] of cat.items) {
      await saveItem(sql, actor, {
        categoryId, nameAm: am, nameEn: en, isFasting: !!fasting,
        variants: typeof price === "string"
          ? [{ nameAm: "", nameEn: "", priceSantim: birrToSantim(price) }]
          : price.map(([vam, ven, p]) => ({ nameAm: vam, nameEn: ven, priceSantim: birrToSantim(p) })),
        modifierGroupIds: cat.station === "kitchen" && !fasting ? [spice] : [],
      });
    }
  }
}

async function actorFor(sql: Sql, userId: string, tenantId: string): Promise<Actor> {
  const access = await getTenantAccess(sql, userId, tenantId);
  return { tenantId, userId, permissions: access!.permissions };
}


const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date(Date.now() - n * 86_400_000));

/** Ingredients, recipes, a supplier delivery and a week of expenses so stock and profit have data. */
async function sampleInventory(sql: Sql, owner: Actor) {
  const [branch] = await withTenant(sql, owner, (tx) => tx<{ id: string }[]>`select id from branches limit 1`);
  const branchId = branch!.id;
  const units = await listUnits(sql, owner);
  const unit = (code: string) => units.find((u) => u.code === code)!.id;
  const items: Record<string, string> = {};
  const add = async (key: string, am: string, en: string, u: string, category: string, reorder: number, qty: number, costBirr: number) => {
    items[key] = await saveInventoryItem(sql, owner, { nameAm: am, nameEn: en, unitId: unit(u), category, reorderLevel: reorder });
    await setOpeningStock(sql, owner, { branchId, itemId: items[key]!, quantity: qty, unitCostSantim: costBirr * 100 });
  };
  await add("beef", "የበሬ ሥጋ", "Beef", "kg", "Meat", 3, 12, 650);
  await add("chicken", "ዶሮ", "Chicken", "pc", "Meat", 2, 6, 550);
  await add("butter", "ንጥር ቅቤ", "Spiced butter", "kg", "Dairy", 1, 4, 900);
  await add("eggs", "እንቁላል", "Eggs", "pc", "Dairy", 30, 120, 12);
  await add("injera", "እንጀራ", "Injera", "pc", "Bakery", 80, 150, 15);
  await add("shiro", "የሽሮ ዱቄት", "Shiro powder", "kg", "Dry goods", 2, 6, 280);
  await add("coffee", "ቡና (የተቆላ)", "Coffee beans (roasted)", "kg", "Coffee", 2, 5, 950);
  await add("milk", "ወተት", "Milk", "l", "Dairy", 5, 20, 70);
  await add("coke", "ኮካ ኮላ", "Coca-Cola", "bottle", "Drinks", 24, 48, 28);
  await add("water", "ውሃ", "Water", "bottle", "Drinks", 24, 60, 18);

  const menu = await getMenu(sql, owner, branchId);
  const variant = (en: string, size = "") =>
    menu.categories.flatMap((c) => c.items).find((i) => i.name_en === en)!.variants.find((v) => v.name_en === size)!.id;
  const recipes: [string, string, [string, number][]][] = [
    ["Tibs", "Half", [["beef", 0.25], ["butter", 0.03], ["injera", 1]]],
    ["Tibs", "Full", [["beef", 0.45], ["butter", 0.05], ["injera", 2]]],
    ["Kitfo", "", [["beef", 0.3], ["butter", 0.08], ["injera", 1]]],
    ["Doro wot", "", [["chicken", 0.5], ["butter", 0.1], ["eggs", 2], ["injera", 2]]],
    ["Shiro", "", [["shiro", 0.12], ["injera", 2]]],
    ["Firfir", "", [["injera", 2], ["butter", 0.03]]],
    ["Egg firfir", "", [["injera", 2], ["eggs", 2], ["butter", 0.02]]],
    ["Buna (coffee)", "", [["coffee", 0.012]]],
    ["Macchiato", "", [["coffee", 0.014], ["milk", 0.12]]],
    ["Coca-Cola", "", [["coke", 1]]],
    ["Water", "", [["water", 1]]],
  ];
  for (const [en, size, lines] of recipes) {
    await saveRecipe(sql, owner, variant(en, size), lines.map(([k, q]) => ({ itemId: items[k]!, quantity: q })));
  }

  const supplier = await saveSupplier(sql, owner, { name: "Shola Market Butchery", phone: "0911445566", tin: "0023456789" });
  await recordPurchase(sql, owner, {
    branchId, supplierId: supplier, purchasedOn: daysAgo(3), invoiceRef: "SB-1045", paymentMethodCode: "cash",
    lines: [{ itemId: items.beef!, quantity: 10, lineTotalSantim: 680_000 }, { itemId: items.butter!, quantity: 2, lineTotalSantim: 190_000 }],
  });
  await recordWaste(sql, owner, { branchId, itemId: items.milk!, quantity: 2, reason: "Spoiled overnight" });

  const categories = await listExpenseCategories(sql, owner);
  const cat = (code: string) => categories.find((c) => c.code === code)!.id;
  const expenses: [string, number, number, string, string][] = [
    ["rent", 6, 300_000, "bank_cbe", "Landlord"],
    ["salary", 6, 600_000, "bank_cbe", "Weekly wages"],
    ["utilities", 4, 180_000, "telebirr", "EEU"],
    ["gas", 3, 95_000, "cash", "Gas refill"],
    ["transport", 1, 30_000, "cash", "Delivery bajaj"],
    ["telecom", 0, 50_000, "telebirr", "Ethio telecom"],
  ];
  for (const [code, ago, amount, method, vendor] of expenses) {
    await recordExpense(sql, owner, { branchId, categoryId: cat(code), amountSantim: amount, spentOn: daysAgo(ago), paymentMethodCode: method, vendor });
  }
}

/** A week of sample orders so charts and reports have something to show. */
async function sampleSales(sql: Sql, owner: Actor, waiterId: string) {
  const waiter = await actorFor(sql, waiterId, owner.tenantId);
  const [branch] = await withTenant(sql, owner, (tx) => tx<{ id: string }[]>`select id from branches limit 1`);
  const branchId = branch!.id;
  const menu = await getMenu(sql, owner, branchId);
  const variants = menu.categories.flatMap((c) => c.items.flatMap((i) => i.variants.map((v) => v.id)));
  const tables = await withTenant(sql, owner, (tx) => tx<{ id: string }[]>`select id from dining_tables order by name`);
  const methods = ["cash", "cash", "telebirr", "cbe_birr", "pos_card"];
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 9301 + 49297) % 233280) / 233280) * n;

  const shiftId = await openShift(sql, owner, branchId, 50_000);
  for (let day = 6; day >= 0; day--) {
    const orders = 4 + Math.floor(rand(6));
    for (let o = 0; o < orders; o++) {
      const items = Array.from({ length: 1 + Math.floor(rand(4)) }, () => ({
        variantId: variants[Math.floor(rand(variants.length))]!, quantity: 1 + Math.floor(rand(2)),
      }));
      const orderId = await createOrder(sql, waiter, { branchId, type: "takeaway", items });
      for (const item of await withTenant(sql, owner, (tx) => tx<{ id: string }[]>`select id from order_items where order_id = ${orderId}`)) {
        await setItemStatus(sql, owner, item.id, "served");
      }
      const billId = await createBill(sql, owner, orderId);
      const [bill] = await withTenant(sql, owner, (tx) => tx<{ total: number }[]>`select total_santim::int as total from bills where id = ${billId}`);
      const methodCode = methods[Math.floor(rand(methods.length))]!;
      const reference = methodCode === "cash" || methodCode === "pos_card" ? "" : `FT${day}${o}${Math.floor(rand(90000) + 10000)}`;
      await recordPayments(sql, owner, billId, [{ methodCode, amountSantim: bill!.total, reference }]);
      const hour = 7 + Math.floor(rand(14));
      await withTenant(sql, owner, async (tx) => {
        const at = tx`now() - make_interval(days => ${day}) - make_interval(hours => extract(hour from now() at time zone 'Africa/Addis_Ababa')::int - ${hour})`;
        await tx`update bills set paid_at = ${at}, created_at = ${at} where id = ${billId}`;
        await tx`update orders set created_at = ${at}, closed_at = ${at} where id = ${orderId}`;
      });
    }
  }
  // Leave two tables with live orders for the floor plan.
  await createOrder(sql, waiter, { branchId, type: "dine_in", tableId: tables[0]!.id, items: [{ variantId: variants[4]!, quantity: 2 }, { variantId: variants[12]!, quantity: 2 }] });
  const second = await createOrder(sql, waiter, { branchId, type: "dine_in", tableId: tables[2]!.id, items: [{ variantId: variants[6]!, quantity: 1 }] });
  await withTenant(sql, owner, (tx) => tx`update orders set bill_requested_at = now() where id = ${second}`);
  const summary = await shiftSummary(sql, owner, shiftId);
  await closeShift(sql, owner, shiftId, summary?.expectedCash ?? 0, "Seed shift");
}

/**
 * The stock ledger is append-only for the app, so back-dating the sample movements to their
 * orders' dates needs the admin connection. Skipped when DATABASE_ADMIN_URL is not set.
 */
async function backdateSampleStock(tenantId: string) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) return;
  const admin = createSql(adminUrl, { max: 1 });
  try {
    await admin`
      update stock_movements m set created_at = o.created_at
      from order_items oi join orders o on o.id = oi.order_id
      where m.tenant_id = ${tenantId} and m.ref_type = 'order_item' and m.ref_id = oi.id`;
    await admin`update stock_movements set created_at = now() - interval '7 days' where tenant_id = ${tenantId} and kind = 'opening'`;
    await admin`update stock_movements m set created_at = p.purchased_on + time '10:00'
                from purchases p where m.tenant_id = ${tenantId} and m.ref_id = p.id`;
  } finally {
    await admin.end();
  }
}

const sql = createSql(url, { max: 2 });
try {
  let user;
  try {
    user = await signUpWithEmail(sql, { email: DEMO_EMAIL, password: DEMO_PASSWORD, fullName: "Demo Owner", locale: "am" });
  } catch (err) {
    if (err instanceof AuthError && err.code === "email_taken") {
      console.log("Demo data already exists.");
      process.exit(0);
    }
    throw err;
  }
  const base = { city: "Addis Ababa", locale: "am" as const };
  const cafe = await onboardBusiness(sql, user.id, { ...base, name: "Buna House Café", businessType: "cafe", subCity: "Bole", branchName: "Bole", tin: "0012345678" });
  const hotel = await onboardBusiness(sql, user.id, { ...base, name: "Entoto View Hotel", businessType: "hotel_restaurant", subCity: "Gullele", branchName: "Main" });
  for (const tenantId of [cafe, hotel]) {
    await completeOnboarding(sql, { tenantId, userId: user.id });
    const owner = await actorFor(sql, user.id, tenantId);
    await setUpMenu(sql, owner);
    const [branch] = await withTenant(sql, owner, (tx) => tx<{ id: string }[]>`select id from branches limit 1`);
    for (let i = 1; i <= 8; i++) await saveTable(sql, owner, { branchId: branch!.id, name: `T${i}`, seats: i <= 4 ? 4 : 6, areaId: null });
    if (tenantId === cafe) {
      const waiterId = await addStaffMember(sql, owner, { phone: "0911000001", fullName: "Selam (waiter)", roleName: "Waiter" });
      await addStaffMember(sql, owner, { phone: "0911000002", fullName: "Dawit (cashier)", roleName: "Cashier" });
      await addStaffMember(sql, owner, { phone: "0911000003", fullName: "Hana (kitchen)", roleName: "Kitchen" });
      await sampleInventory(sql, owner);
      await sampleSales(sql, owner, waiterId);
      // PINs for the shared-tablet switch: waiter 2580, cashier 4826 (owner sets their own on the Switch user page).
      const staff = await listStaff(sql, owner);
      for (const [phone, pin] of [["+251911000001", "2580"], ["+251911000002", "4826"]] as const) {
        await setOwnPin(sql, { tenantId, userId: staff.find((m) => m.phone === phone)!.user_id }, pin);
      }
      // Mark a few older Telebirr / CBE Birr payments as already checked against the statement.
      const payments = await listPayments(sql, owner, { range: { from: daysAgo(7), to: daysAgo(2) }, branchId: null });
      for (const p of payments.filter((x) => x.method_kind === "mobile_money").slice(0, 6)) {
        await setPaymentCheck(sql, owner, p.id, "confirmed");
      }
    }
  }
  await backdateSampleStock(cafe);
  console.log(`Seeded. Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("Shared-tablet PINs (Switch user): Selam 2580, Dawit 4826");
  console.log("Staff phone logins (code printed in the server log): 0911000001 waiter, 0911000002 cashier, 0911000003 kitchen");
} finally {
  await sql.end();
}
