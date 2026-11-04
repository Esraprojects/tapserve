import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Actor,
  addFolioCharge,
  addRoomRange,
  addStaffMember,
  availableRooms,
  cancelBooking,
  checkIn,
  checkOut,
  completeHousekeepingTask,
  createBill,
  createBooking,
  createOrder,
  frontDesk,
  getBooking,
  getMenu,
  getTenantAccess,
  housekeepingBoard,
  listInHouseGuests,
  listPaymentMethods,
  listPayments,
  listRooms,
  onboardBusiness,
  openShift,
  quoteStay,
  recordFolioPayment,
  recordPayments,
  refundFolioCredit,
  roomReport,
  runNightAudit,
  saveCategory,
  saveGuest,
  saveItem,
  saveRoomType,
  setRoomStatus,
  signUpWithEmail,
  type Sql,
  updateBooking,
  voidFolioCharge,
  withTenant,
} from "@tapserve/db";
import { freshDatabase } from "./db";

let admin: Sql;
let app: Sql;
let owner: Actor;
let reception: Actor;
let housekeeper: Actor;
let cafe: Actor;
let branchId: string;
let standard: string; // room type ids
let suite: string;
let tibs: string;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const errorCode = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? String(e));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());
const tomorrow = addDaysIso(today, 1);
const ethiopian = { fullName: "Abebe Kebede", phone: "0911223344", nationality: "ET", idType: "fayda" as const, idNumber: "1234 5678 9012" };
const foreigner = { fullName: "Jane Smith", nationality: "GB", idType: "passport" as const, idNumber: "123456789" };

async function actorFor(userId: string, tenantId: string): Promise<Actor> {
  const access = await getTenantAccess(app, userId, tenantId);
  return { tenantId, userId, permissions: access!.permissions };
}

const roomId = async (number: string) => (await listRooms(app, owner, branchId)).find((r) => r.number === number)!.id;

beforeAll(async () => {
  ({ admin, app } = await freshDatabase());
  const base = { city: "Bahir Dar", subCity: "", branchName: "Lakeside", locale: "en" as const };
  const u = await signUpWithEmail(app, { email: "owner@hotel.et", password: "password-1", fullName: "Owner" });
  const tenantId = await onboardBusiness(app, u.id, { ...base, name: "Tana View", businessType: "hotel_restaurant" });
  owner = await actorFor(u.id, tenantId);
  branchId = (await withTenant(app, owner, (tx) => tx`select id from branches`))[0]!.id;
  reception = await actorFor(await addStaffMember(app, owner, { phone: "0911000501", fullName: "Hana", roleName: "Receptionist" }), tenantId);
  housekeeper = await actorFor(await addStaffMember(app, owner, { phone: "0911000502", fullName: "Tigist", roleName: "Housekeeping" }), tenantId);

  const u2 = await signUpWithEmail(app, { email: "owner@cafe.et", password: "password-2", fullName: "Cafe" });
  cafe = await actorFor(u2.id, await onboardBusiness(app, u2.id, { ...base, name: "Buna Bet", businessType: "cafe" }));

  standard = await saveRoomType(app, owner, {
    nameAm: "መደበኛ", nameEn: "Standard", capacity: 2, localRateSantim: 230_000, foreignRateSantim: 460_000,
    weekendLocalRateSantim: null, weekendForeignRateSantim: null,
  });
  suite = await saveRoomType(app, owner, {
    nameAm: "ስዊት", nameEn: "Suite", capacity: 3, localRateSantim: 460_000, foreignRateSantim: 920_000,
    weekendLocalRateSantim: null, weekendForeignRateSantim: null,
  });
  await addRoomRange(app, owner, { branchId, roomTypeId: standard, from: 101, to: 104, floor: "1" });
  await addRoomRange(app, owner, { branchId, roomTypeId: suite, from: 201, to: 201, floor: "2" });

  const food = await saveCategory(app, owner, { nameAm: "ምግብ", nameEn: "Food", station: "kitchen" });
  await saveItem(app, owner, { categoryId: food, nameAm: "ጥብስ", nameEn: "Tibs", isFasting: false,
    variants: [{ nameAm: "", nameEn: "", priceSantim: 45_000 }] });
  tibs = (await getMenu(app, owner, branchId)).categories[0]!.items[0]!.variants[0]!.id;
  await openShift(app, reception, branchId, 0);
  await openShift(app, owner, branchId, 0);
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe("setup", () => {
  it("gives hotels a Charge to room method and keeps it from cafés", async () => {
    expect((await listPaymentMethods(app, owner)).map((m) => m.kind)).toContain("room_charge");
    expect((await listPaymentMethods(app, cafe)).map((m) => m.kind)).not.toContain("room_charge");
  });

  it("lets only owners and managers set up rooms and rates", async () => {
    expect(await errorCode(addRoomRange(app, reception, { branchId, roomTypeId: standard, from: 105, to: 106, floor: "1" }))).toBe("forbidden");
    expect((await listRooms(app, owner, branchId)).map((r) => r.number)).toEqual(["101", "102", "103", "104", "201"]);
  });

  it("keeps each business's rooms, guests and folios private", async () => {
    for (const table of ["rooms", "room_types", "guests", "bookings", "folio_charges", "housekeeping_tasks"]) {
      const rows = await withTenant(app, cafe, (tx) => tx`select tenant_id from ${tx(table)}`);
      expect(rows.every((r) => r.tenant_id === cafe.tenantId)).toBe(true);
    }
    expect(await errorCode(withTenant(app, cafe, (tx) =>
      tx`insert into rooms (tenant_id, branch_id, room_type_id, number) values (${owner.tenantId}, ${branchId}, ${standard}, '999')`)))
      .toMatch(/row-level security|42501/);
  });
});

describe("reservations", () => {
  it("prices residents and foreigners differently", async () => {
    const local = await quoteStay(app, reception, { roomTypeId: standard, arrival: today, departure: addDaysIso(today, 2), rateCategory: "local", nightlyRateSantim: null });
    const foreign = await quoteStay(app, reception, { roomTypeId: standard, arrival: today, departure: addDaysIso(today, 2), rateCategory: "foreign", nightlyRateSantim: null });
    expect(local.total).toBe(460_000);
    expect(foreign.total).toBe(920_000);
  });

  it("never double-books a room", async () => {
    const room = await roomId("102");
    await createBooking(app, reception, { branchId, guest: ethiopian, roomTypeId: standard, roomId: room,
      arrival: addDaysIso(today, 10), departure: addDaysIso(today, 13), adults: 2, source: "phone" });
    expect(await errorCode(createBooking(app, reception, { branchId, guest: foreigner, roomTypeId: standard, roomId: room,
      arrival: addDaysIso(today, 12), departure: addDaysIso(today, 14), adults: 1, source: "booking_com" }))).toBe("room_not_available");
    const free = await availableRooms(app, reception, branchId, addDaysIso(today, 11), addDaysIso(today, 12));
    expect(free.map((r) => r.number)).not.toContain("102");
    // Back-to-back stays are fine: departure day is the next guest's arrival day.
    await createBooking(app, reception, { branchId, guest: foreigner, roomTypeId: standard, roomId: room,
      arrival: addDaysIso(today, 13), departure: addDaysIso(today, 15), adults: 1, source: "booking_com" });
  });

  it("takes a deposit into the receptionist's shift and the payments register", async () => {
    const id = await createBooking(app, reception, { branchId, guest: { fullName: "Deposit Guest", idType: "kebele", idNumber: "AA/12" },
      roomTypeId: suite, arrival: addDaysIso(today, 20), departure: addDaysIso(today, 22), adults: 2, source: "direct",
      deposit: { methodCode: "telebirr", amountSantim: 200_000, reference: "TB998877" } });
    const detail = (await getBooking(app, reception, id))!;
    expect(detail.folio.paymentsTotal).toBe(200_000);
    expect(detail.folio.balanceAtCheckout).toBe(920_000 - 200_000);
    const register = await listPayments(app, owner, { range: { from: today, to: today }, branchId });
    expect(register.find((p) => p.booking_id === id)?.reference).toBe("TB998877");
    expect(await errorCode(recordFolioPayment(app, reception, id, { methodCode: "cbe_birr", amountSantim: 100 }))).toBe("reference_required");
    // Cancelling keeps the deposit as credit until it is refunded.
    await cancelBooking(app, reception, id, "Plans changed");
    expect((await getBooking(app, reception, id))!.folio.balance).toBe(-200_000);
  });
});

describe("front desk and folio", () => {
  let stay: string;

  it("registers the guest's ID before check-in", async () => {
    stay = await createBooking(app, reception, { branchId, guest: { fullName: "No ID Yet", nationality: "US" },
      roomTypeId: standard, roomId: await roomId("101"), arrival: today, departure: addDaysIso(today, 3), adults: 1, source: "walk_in" });
    expect(await errorCode(checkIn(app, reception, stay))).toBe("guest_id_required");
    const { booking } = (await getBooking(app, reception, stay))!;
    await saveGuest(app, reception, { id: booking.guest_id, fullName: "No ID Yet", nationality: "US", idType: "fayda", idNumber: "1" });
    expect(await errorCode(checkIn(app, reception, stay))).toBe("passport_required");
    await saveGuest(app, reception, { id: booking.guest_id, fullName: "John Doe", nationality: "US", idType: "passport", idNumber: "X123" });
    await checkIn(app, reception, stay);
    expect((await frontDesk(app, reception, branchId)).inHouse.map((b) => b.id)).toContain(stay);
    // Foreigners get the foreigner rate by default.
    expect((await getBooking(app, reception, stay))!.booking.rate_category).toBe("foreign");
  });

  it("refuses check-in for a future arrival", async () => {
    const later = await createBooking(app, reception, { branchId, guest: ethiopian, roomTypeId: standard, roomId: await roomId("104"),
      arrival: tomorrow, departure: addDaysIso(today, 2), adults: 1, source: "direct" });
    expect(await errorCode(checkIn(app, reception, later))).toBe("arrival_in_future");
  });

  it("charges a restaurant bill to the guest's room", async () => {
    const order = await createOrder(app, owner, { branchId, type: "takeaway", items: [{ variantId: tibs, quantity: 2 }] });
    const bill = await createBill(app, owner, order);
    expect(await errorCode(recordPayments(app, owner, bill, [{ methodCode: "room", amountSantim: 90_000 }]))).toBe("guest_not_in_house");
    expect((await listInHouseGuests(app, owner)).map((g) => g.room_number)).toEqual(["101"]);
    const paid = await recordPayments(app, owner, bill, [{ methodCode: "room", amountSantim: 90_000, bookingId: stay }]);
    expect(paid.status).toBe("paid");
    const { folio } = (await getBooking(app, reception, stay))!;
    expect(folio.charges.find((c) => c.kind === "restaurant")?.amount_santim).toBe(90_000);
  });

  it("closes the day with the night audit, once", async () => {
    const noShow = await createBooking(app, reception, { branchId, guest: { fullName: "Never Came", idType: "kebele", idNumber: "9" },
      roomTypeId: standard, arrival: today, departure: tomorrow, adults: 1, source: "phone" });
    const result = await runNightAudit(app, reception, branchId, today);
    expect(result).toMatchObject({ rooms_charged: 1, room_revenue_santim: 460_000, no_shows: 1 });
    expect(await errorCode(runNightAudit(app, reception, branchId, today))).toBe("audit_already_run");
    expect(await errorCode(runNightAudit(app, reception, branchId, tomorrow))).toBe("audit_in_future");
    expect((await getBooking(app, reception, noShow))!.booking.status).toBe("no_show");
    expect((await listRooms(app, owner, branchId)).find((r) => r.number === "101")!.hk_status).toBe("dirty");
  });

  it("adds extras and discounts, and voids mistakes with a reason", async () => {
    await addFolioCharge(app, reception, stay, { kind: "extra", description: "Airport pickup", amountSantim: 115_000 });
    expect(await errorCode(addFolioCharge(app, reception, stay, { kind: "discount", description: "x", amountSantim: 1 }))).toBe("forbidden");
    await addFolioCharge(app, owner, stay, { kind: "discount", description: "Loyal guest", amountSantim: 50_000 });
    const { folio } = (await getBooking(app, reception, stay))!;
    const extra = folio.charges.find((c) => c.kind === "extra")!;
    expect(extra.tax_santim).toBe(15_000);
    expect(await errorCode(voidFolioCharge(app, owner, folio.charges.find((c) => c.kind === "restaurant")!.id, "x"))).toBe("charge_not_voidable");
    await voidFolioCharge(app, owner, extra.id, "Guest took a taxi");
    expect((await getBooking(app, reception, stay))!.folio.chargesTotal).toBe(460_000 + 90_000 - 50_000);
  });

  it("checks out only when the folio balances, then sends the room to housekeeping", async () => {
    // Leaving today: only tonight is charged (the guest booked three nights).
    expect(await errorCode(checkOut(app, reception, stay))).toBe("balance_due");
    const { folio } = (await getBooking(app, reception, stay))!;
    expect(folio.balanceAtCheckout).toBe(500_000 + 2 * 460_000);
    expect(folio.balanceIfLeavingToday).toBe(500_000);
    await recordFolioPayment(app, reception, stay, { methodCode: "cash", amountSantim: 600_000 });
    expect(await errorCode(checkOut(app, reception, stay))).toBe("credit_remaining");
    expect(await errorCode(refundFolioCredit(app, reception, stay, { methodCode: "cash" }))).toBe("forbidden");
    expect(await refundFolioCredit(app, owner, stay, { methodCode: "cash" })).toBe(100_000);
    await checkOut(app, reception, stay);
    const detail = (await getBooking(app, reception, stay))!;
    expect(detail.booking).toMatchObject({ status: "checked_out", departure: tomorrow, nights: 1 });
    const board = await housekeepingBoard(app, housekeeper, branchId);
    const task = board.tasks.find((t) => t.room_number === "101")!;
    expect(task.kind).toBe("clean");
    await completeHousekeepingTask(app, housekeeper, task.id);
    expect((await listRooms(app, owner, branchId)).find((r) => r.number === "101")!.hk_status).toBe("clean");
  });

  it("charges a same-day stay for one night", async () => {
    const id = await createBooking(app, reception, { branchId, guest: ethiopian, roomTypeId: suite, roomId: await roomId("201"),
      arrival: today, departure: addDaysIso(today, 2), adults: 2, source: "walk_in",
      deposit: { methodCode: "cash", amountSantim: 460_000 } }, { checkInNow: true });
    await checkOut(app, reception, id);
    const { folio, booking } = (await getBooking(app, reception, id))!;
    expect(folio.charges.filter((c) => c.kind === "room")).toHaveLength(1);
    expect(booking.status).toBe("checked_out");
  });

  it("moves an in-house guest to another room and frees the old one", async () => {
    const id = await createBooking(app, reception, { branchId, guest: ethiopian, roomTypeId: standard, roomId: await roomId("103"),
      arrival: today, departure: tomorrow, adults: 1, source: "walk_in" }, { checkInNow: true });
    await updateBooking(app, reception, id, { roomId: await roomId("101") });
    const rooms = await listRooms(app, owner, branchId);
    expect(rooms.find((r) => r.number === "101")!.booking_id).toBe(id);
    expect(rooms.find((r) => r.number === "103")!.hk_status).toBe("dirty");
  });
});

describe("housekeeping and reports", () => {
  it("lets housekeepers clean but not take rooms out of service", async () => {
    const room = await roomId("104");
    expect(await errorCode(setRoomStatus(app, housekeeper, room, "out_of_order", "Leak"))).toBe("forbidden");
    await setRoomStatus(app, reception, room, "out_of_order", "Leaking tap");
    expect((await availableRooms(app, reception, branchId, addDaysIso(today, 30), addDaysIso(today, 31))).map((r) => r.number)).not.toContain("104");
    await setRoomStatus(app, housekeeper, room, "clean");
  });

  it("reports occupancy, ADR and RevPAR from charged nights", async () => {
    const report = await roomReport(app, owner, { from: today, to: today }, branchId);
    // Room 101 (foreigner, 4,600) and suite 201 (local, 4,600) were charged tonight; VAT is inside the rate.
    expect(report.rooms).toBe(5);
    expect(report.roomNightsSold).toBe(2);
    expect(report.occupancyBp).toBe(4000);
    expect(report.revenueSantim).toBe(800_000);
    expect(report.adrSantim).toBe(400_000);
    expect(report.revparSantim).toBe(160_000);
  });
});
