/**
 * Demo data for local testing: one owner with a demo café and a demo hotel-restaurant,
 * an Ethiopian menu, tables, staff, and a week of sample sales for the dashboard.
 * Run after migrations: pnpm db:seed (uses DATABASE_URL, the RLS-restricted app role).
 */
import { birrToSantim } from "@tapserve/core";
import {
  AuthError, type Actor, completeOnboarding, createBill, createOrder, createSql, getMenu, getTenantAccess,
  onboardBusiness, openShift, closeShift, shiftSummary, recordPayments, saveCategory, saveItem, saveModifierGroup, saveTable,
  addStaffMember, setItemStatus, signUpWithEmail, withTenant, type Sql,
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
      await recordPayments(sql, owner, billId, [{ methodCode: methods[Math.floor(rand(methods.length))]!, amountSantim: bill!.total }]);
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
      await sampleSales(sql, owner, waiterId);
    }
  }
  console.log(`Seeded. Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("Staff phone logins (code printed in the server log): 0911000001 waiter, 0911000002 cashier, 0911000003 kitchen");
} finally {
  await sql.end();
}
