import { addDaysIso, nightlyRate, type RateCategory, roomCharge, stayNights, type TaxType } from "@tapserve/core";
import { type Sql, type Tx, withTenant } from "../client";
import { REFERENCE_REQUIRED } from "../restaurant/billing";
import { type Actor, DomainError, requirePermission } from "../restaurant/common";
import { santim, text } from "./common";

/**
 * The guest folio: room nights, restaurant and bar bills charged to the room, extras and
 * discounts on one side; deposits and payments on the other. Check-out needs a zero balance.
 */

interface StayForCharges {
  id: string;
  room_type_id: string;
  rate_category: RateCategory;
  nightly_rate_santim: number | null;
}

export interface Pricing {
  type: { local_rate_santim: number; foreign_rate_santim: number; weekend_local_rate_santim: number | null; weekend_foreign_rate_santim: number | null };
  seasons: { starts_on: string; ends_on: string; local_rate_santim: number; foreign_rate_santim: number }[];
  tax: { taxType: TaxType; taxRateBp: number; pricesIncludeTax: boolean; serviceChargeEnabled: boolean; serviceChargeRateBp: number };
}

export async function loadPricing(tx: Tx, roomTypeId: string): Promise<Pricing> {
  const [type] = await tx<Pricing["type"][]>`
    select local_rate_santim::int as local_rate_santim, foreign_rate_santim::int as foreign_rate_santim,
           weekend_local_rate_santim::int as weekend_local_rate_santim, weekend_foreign_rate_santim::int as weekend_foreign_rate_santim
    from room_types where id = ${roomTypeId}`;
  if (!type) throw new DomainError("not_found");
  const seasons = await tx<Pricing["seasons"]>`
    select to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
           local_rate_santim::int as local_rate_santim, foreign_rate_santim::int as foreign_rate_santim
    from rate_seasons where room_type_id = ${roomTypeId}`;
  const [s] = await tx<{ tax_type: TaxType; tax_rate_bp: number; prices_include_tax: boolean }[]>`
    select tax_type, tax_rate_bp, prices_include_tax from tenant_settings`;
  if (!s) throw new DomainError("settings_missing");
  return {
    type,
    seasons,
    tax: { taxType: s.tax_type, taxRateBp: s.tax_rate_bp, pricesIncludeTax: s.prices_include_tax, serviceChargeEnabled: false, serviceChargeRateBp: 0 },
  };
}

export interface NightPrice {
  night: string;
  amount_santim: number;
  tax_santim: number;
}

/** What each night costs the guest, tax included. */
export function priceNights(pricing: Pricing, stay: Omit<StayForCharges, "id" | "room_type_id">, nights: string[]): NightPrice[] {
  return nights.map((night) => {
    const rate = nightlyRate(pricing.type, pricing.seasons, night, stay.rate_category, stay.nightly_rate_santim);
    const { amount, tax } = roomCharge(rate, pricing.tax);
    return { night, amount_santim: amount, tax_santim: tax };
  });
}

/** Room nights of this stay that are not on the folio yet. */
async function unpostedNights(tx: Tx, bookingId: string, nights: string[]): Promise<string[]> {
  if (!nights.length) return [];
  const posted = await tx<{ night: string }[]>`
    select to_char(night_date, 'YYYY-MM-DD') as night from folio_charges
    where booking_id = ${bookingId} and kind = 'room' and voided_at is null`;
  const done = new Set(posted.map((p) => p.night));
  return nights.filter((n) => !done.has(n));
}

/** Post room charges for the given nights; nights already charged are skipped. Returns what was posted. */
export async function postNights(tx: Tx, stay: StayForCharges, nights: string[]): Promise<NightPrice[]> {
  const todo = await unpostedNights(tx, stay.id, nights);
  if (!todo.length) return [];
  const priced = priceNights(await loadPricing(tx, stay.room_type_id), stay, todo);
  await tx`insert into folio_charges ${tx(priced.map((p) => ({
    booking_id: stay.id, kind: "room", night_date: p.night, amount_santim: p.amount_santim, tax_santim: p.tax_santim,
    description: "",
  })))} on conflict do nothing`;
  return priced;
}

/** Charges minus payments; negative means the guest has credit (for example an unused deposit). */
export async function folioBalance(tx: Tx, bookingId: string): Promise<number> {
  const [row] = await tx<{ balance: number }[]>`
    select (coalesce((select sum(amount_santim) from folio_charges where booking_id = ${bookingId} and voided_at is null), 0)
          - coalesce((select sum(amount_santim) from payments where booking_id = ${bookingId}), 0))::int as balance`;
  return row!.balance;
}

/** Called from billing: a restaurant or bar bill paid by charging it to an in-house guest's room. */
export async function chargeBillToRoom(
  tx: Tx, input: { bookingId: string; billId: string; paymentId: string; amountSantim: number; receiptNo: number },
): Promise<void> {
  await tx`
    insert into folio_charges (booking_id, kind, description, amount_santim, tax_santim, bill_id, payment_id)
    values (${input.bookingId}, 'restaurant', ${`#${input.receiptNo}`}, ${input.amountSantim}, 0, ${input.billId}, ${input.paymentId})`;
}

export interface InHouseGuest {
  booking_id: string;
  room_number: string;
  guest_name: string;
  branch_id: string;
}

/** Guests who can have a bill charged to their room right now. */
export async function listInHouseGuests(sql: Sql, actor: Actor): Promise<InHouseGuest[]> {
  return withTenant(sql, actor, (tx) => tx<InHouseGuest[]>`
    select b.id as booking_id, r.number as room_number, g.full_name as guest_name, b.branch_id
    from bookings b join rooms r on r.id = b.room_id join guests g on g.id = b.guest_id
    where b.status = 'checked_in'
    order by length(r.number), r.number`);
}

export interface FolioCharge {
  id: string;
  kind: "room" | "restaurant" | "extra" | "discount" | "refund";
  description: string;
  night_date: string | null;
  amount_santim: number;
  tax_santim: number;
  bill_id: string | null;
  order_id: string | null;
  created_at: Date;
  created_by: string;
  voided_at: Date | null;
  void_reason: string | null;
}

export interface FolioPayment {
  id: string;
  method_code: string;
  method_am: string;
  method_en: string;
  amount_santim: number;
  reference: string;
  created_at: Date;
  received_by: string;
}

export interface Folio {
  charges: FolioCharge[];
  payments: FolioPayment[];
  chargesTotal: number;
  paymentsTotal: number;
  balance: number;
  /** Nights not charged yet, priced as check-out (or the night audit) will charge them. */
  pending: NightPrice[];
  /** The balance once the pending nights are charged: what the guest pays at check-out. */
  balanceAtCheckout: number;
  /** What an in-house guest pays if they check out today (early, on time or late). */
  balanceIfLeavingToday: number;
}

export async function loadFolio(tx: Tx, bookingId: string): Promise<Folio> {
  const charges = await tx<FolioCharge[]>`
    select c.id, c.kind, c.description, to_char(c.night_date, 'YYYY-MM-DD') as night_date,
           c.amount_santim::int as amount_santim, c.tax_santim::int as tax_santim, c.bill_id, bl.order_id,
           c.created_at, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as created_by, c.voided_at, c.void_reason
    from folio_charges c join users u on u.id = c.created_by left join bills bl on bl.id = c.bill_id
    where c.booking_id = ${bookingId} order by coalesce(c.night_date, (c.created_at at time zone 'Africa/Addis_Ababa')::date), c.seq`;
  const payments = await tx<FolioPayment[]>`
    select p.id, pm.code as method_code, pm.name_am as method_am, pm.name_en as method_en, p.amount_santim::int as amount_santim,
           p.reference, p.created_at, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as received_by
    from payments p join payment_methods pm on pm.id = p.method_id join users u on u.id = p.received_by
    where p.booking_id = ${bookingId} order by p.seq`;
  const chargesTotal = charges.filter((c) => !c.voided_at).reduce((s, c) => s + c.amount_santim, 0);
  const paymentsTotal = payments.reduce((s, p) => s + p.amount_santim, 0);

  const [stay] = await tx<(StayForCharges & { status: string; arrival: string; departure: string; today: string })[]>`
    select id, room_type_id, rate_category, nightly_rate_santim::int as nightly_rate_santim, status,
           to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure,
           to_char((now() at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as today
    from bookings where id = ${bookingId}`;
  let pending: NightPrice[] = [];
  let leavingToday: NightPrice[] = [];
  if (stay && (stay.status === "reserved" || stay.status === "checked_in")) {
    const pricing = await loadPricing(tx, stay.room_type_id);
    pending = priceNights(pricing, stay, await unpostedNights(tx, stay.id, stayNights(stay.arrival, stay.departure)));
    if (stay.status === "checked_in") {
      // Same rule as checkOut: leaving on the arrival day still counts as one night.
      const departure = stay.today <= stay.arrival ? addDaysIso(stay.arrival, 1) : stay.today;
      leavingToday = priceNights(pricing, stay, await unpostedNights(tx, stay.id, stayNights(stay.arrival, departure)));
    }
  }
  const balance = chargesTotal - paymentsTotal;
  const sum = (nights: NightPrice[]) => nights.reduce((s, n) => s + n.amount_santim, 0);
  return { charges, payments, chargesTotal, paymentsTotal, balance, pending,
    balanceAtCheckout: balance + sum(pending), balanceIfLeavingToday: balance + sum(leavingToday) };
}

async function liveBooking(tx: Tx, bookingId: string) {
  const [b] = await tx<{ id: string; branch_id: string; status: string }[]>`
    select id, branch_id, status from bookings where id = ${bookingId} for update`;
  if (!b) throw new DomainError("not_found");
  if (b.status !== "reserved" && b.status !== "checked_in") throw new DomainError("booking_closed");
  return b;
}

/** An extra (laundry, airport pickup, minibar) or a discount on the stay. */
export async function addFolioCharge(sql: Sql, actor: Actor, bookingId: string, input: {
  kind: "extra" | "discount"; description: string; amountSantim: number;
}): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  if (input.kind === "discount") requirePermission(actor, "order.discount");
  const description = text(input.description, 120);
  if (!description) throw new DomainError("description_required");
  const amount = santim(input.amountSantim, { allowZero: false });
  await withTenant(sql, actor, async (tx) => {
    await liveBooking(tx, bookingId);
    let tax = 0;
    if (input.kind === "extra") {
      const [s] = await tx<{ tax_type: TaxType; tax_rate_bp: number }[]>`select tax_type, tax_rate_bp from tenant_settings`;
      // Extras are entered as the price the guest pays, so the tax is split out of it.
      if (s && s.tax_type !== "NONE") tax = amount - Math.round((amount * 10_000) / (10_000 + s.tax_rate_bp));
    }
    await tx`
      insert into folio_charges (booking_id, kind, description, amount_santim, tax_santim)
      values (${bookingId}, ${input.kind}, ${description}, ${input.kind === "discount" ? -amount : amount}, ${input.kind === "discount" ? 0 : tax})`;
  });
}

/** Void a wrong charge. Restaurant charges are undone from the restaurant side, not here. */
export async function voidFolioCharge(sql: Sql, actor: Actor, chargeId: string, reason: string): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  requirePermission(actor, "order.void");
  if (!reason.trim()) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [c] = await tx<{ booking_id: string; kind: string; amount_santim: number; voided_at: Date | null }[]>`
      select booking_id, kind, amount_santim::int as amount_santim, voided_at from folio_charges where id = ${chargeId} for update`;
    if (!c) throw new DomainError("not_found");
    if (c.voided_at) return;
    if (c.kind === "restaurant" || c.kind === "refund") throw new DomainError("charge_not_voidable");
    await liveBooking(tx, c.booking_id);
    await tx`update folio_charges set voided_at = now(), void_reason = ${reason.trim().slice(0, 200)}, voided_by = current_app_user_id()
             where id = ${chargeId}`;
    await tx`insert into audit_logs (action, entity, entity_id, before, reason)
             values ('folio.charge_void', 'folio_charge', ${chargeId}, ${tx.json({ kind: c.kind, amount_santim: c.amount_santim })}, ${reason.trim()})`;
  });
}

/**
 * A deposit or folio payment. Like restaurant payments it lands on the receptionist's open shift,
 * so cash is counted in their drawer and Telebirr or bank payments need the transaction number.
 */
export async function recordFolioPayment(sql: Sql, actor: Actor, bookingId: string, input: {
  methodCode: string; amountSantim: number; reference?: string;
}): Promise<void> {
  requirePermission(actor, "payment.record");
  const amount = santim(input.amountSantim, { allowZero: false });
  await withTenant(sql, actor, (tx) => insertFolioPayment(tx, actor, bookingId, { ...input, amountSantim: amount }));
}

export async function insertFolioPayment(tx: Tx, actor: Actor, bookingId: string, input: {
  methodCode: string; amountSantim: number; reference?: string;
}): Promise<void> {
  const booking = await liveBooking(tx, bookingId);
  const [shift] = await tx<{ id: string }[]>`
    select id from shifts where branch_id = ${booking.branch_id} and cashier_user_id = ${actor.userId} and closed_at is null`;
  if (!shift) throw new DomainError("no_open_shift");
  const [method] = await tx<{ id: string; kind: string }[]>`
    select id, kind from payment_methods where enabled and code = ${input.methodCode}`;
  if (!method || method.kind === "room_charge") throw new DomainError("unknown_payment_method");
  const reference = text(input.reference, 100);
  if (REFERENCE_REQUIRED.includes(method.kind) && !reference) throw new DomainError("reference_required");
  await tx`
    insert into payments (booking_id, method_id, amount_santim, reference, shift_id)
    values (${bookingId}, ${method.id}, ${input.amountSantim}, ${reference}, ${shift.id})`;
}

/**
 * Give back an unused deposit or overpayment so the folio can close. Cash comes out of the
 * receptionist's drawer as a pay-out; other methods are recorded with their reference.
 */
export async function refundFolioCredit(sql: Sql, actor: Actor, bookingId: string, input: { methodCode: string; reference?: string }): Promise<number> {
  requirePermission(actor, "payment.refund");
  return withTenant(sql, actor, async (tx) => {
    const [b] = await tx<{ branch_id: string; status: string }[]>`select branch_id, status from bookings where id = ${bookingId} for update`;
    if (!b) throw new DomainError("not_found");
    const balance = await folioBalance(tx, bookingId);
    if (balance >= 0) throw new DomainError("no_credit");
    const credit = -balance;
    const [method] = await tx<{ id: string; kind: string; name_en: string }[]>`
      select id, kind, name_en from payment_methods where enabled and code = ${input.methodCode}`;
    if (!method || method.kind === "room_charge" || method.kind === "house_account") throw new DomainError("unknown_payment_method");
    const reference = text(input.reference, 100);
    if (REFERENCE_REQUIRED.includes(method.kind) && !reference) throw new DomainError("reference_required");
    if (method.kind === "cash") {
      const [shift] = await tx<{ id: string }[]>`
        select id from shifts where branch_id = ${b.branch_id} and cashier_user_id = ${actor.userId} and closed_at is null`;
      if (!shift) throw new DomainError("no_open_shift");
      await tx`insert into cash_movements (shift_id, kind, amount_santim, reason)
               values (${shift.id}, 'pay_out', ${credit}, ${`Refund, booking ${bookingId.slice(0, 8)}`})`;
    }
    await tx`insert into folio_charges (booking_id, kind, description, amount_santim)
             values (${bookingId}, 'refund', ${[method.name_en, reference].filter(Boolean).join(" · ")}, ${credit})`;
    await tx`insert into audit_logs (action, entity, entity_id, after)
             values ('folio.refund', 'booking', ${bookingId}, ${tx.json({ amount_santim: credit, method: input.methodCode })})`;
    return credit;
  });
}

