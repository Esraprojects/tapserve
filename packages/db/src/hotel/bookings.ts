import { addDaysIso, type RateCategory, stayNights } from "@tapserve/core";
import { type Sql, type Tx, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "../restaurant/common";
import { addisToday, isOverlap, isoDate, santim, text } from "./common";
import { type Folio, folioBalance, insertFolioPayment, loadFolio, loadPricing, type NightPrice, postNights, priceNights } from "./folio";

/**
 * Reservations and the front desk: guests with their ID details, bookings with dates, room and
 * agreed price, walk-ins, check-in and check-out. A room can never be double-booked: Postgres
 * refuses two live bookings on the same room and night.
 */

export const BOOKING_SOURCES = ["direct", "phone", "walk_in", "booking_com", "expedia", "travel_agent", "other"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export const ID_TYPES = ["kebele", "fayda", "passport", "driving_license", "other"] as const;
export type IdType = (typeof ID_TYPES)[number];
export type BookingStatus = "reserved" | "checked_in" | "checked_out" | "cancelled" | "no_show";

// Guests -------------------------------------------------------------------------------------

export interface Guest {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  nationality: string;
  id_type: IdType | null;
  id_number: string;
  note: string;
  stays: number;
  last_stay: string | null;
}

const guestColumns = (tx: Tx) => tx`
  g.id, g.full_name, g.phone, g.email, g.nationality, g.id_type, g.id_number, g.note,
  (select count(*) from bookings b where b.guest_id = g.id and b.status = 'checked_out')::int as stays,
  (select to_char(max(b.departure), 'YYYY-MM-DD') from bookings b where b.guest_id = g.id and b.status = 'checked_out') as last_stay`;

export async function searchGuests(sql: Sql, actor: Actor, query: string): Promise<Guest[]> {
  requirePermission(actor, "hotel.frontdesk");
  const q = text(query, 60);
  return withTenant(sql, actor, (tx) => tx<Guest[]>`
    select ${guestColumns(tx)} from guests g
    where ${q} = '' or g.full_name ilike ${`%${q}%`} or g.phone like ${`%${q}%`} or g.id_number ilike ${`%${q}%`}
    order by g.updated_at desc limit ${q ? 20 : 50}`);
}

export interface GuestInput {
  id?: string;
  fullName: string;
  phone?: string;
  email?: string;
  nationality?: string;
  idType?: IdType | null;
  idNumber?: string;
  note?: string;
}

function guestRow(input: GuestInput) {
  const fullName = text(input.fullName, 120);
  if (!fullName) throw new DomainError("guest_name_required");
  const nationality = text(input.nationality, 2).toUpperCase() || "ET";
  if (!/^[A-Z]{2}$/.test(nationality)) throw new DomainError("invalid_nationality");
  const idType = input.idType || null;
  if (idType && !ID_TYPES.includes(idType)) throw new DomainError("invalid_input");
  return {
    full_name: fullName,
    phone: text(input.phone, 30),
    email: text(input.email, 120),
    nationality,
    id_type: idType,
    id_number: text(input.idNumber, 40),
    note: text(input.note, 300),
  };
}

async function upsertGuest(tx: Tx, input: GuestInput): Promise<string> {
  const row = guestRow(input);
  if (input.id) {
    const [updated] = await tx<{ id: string }[]>`update guests set ${tx(row)} where id = ${input.id} returning id`;
    if (!updated) throw new DomainError("not_found");
    return updated.id;
  }
  const [created] = await tx<{ id: string }[]>`insert into guests ${tx(row)} returning id`;
  return created!.id;
}

export async function saveGuest(sql: Sql, actor: Actor, input: GuestInput): Promise<string> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, (tx) => upsertGuest(tx, input));
}

export interface GuestHistory {
  guest: Guest;
  bookings: BookingRow[];
}

export async function getGuest(sql: Sql, actor: Actor, guestId: string): Promise<GuestHistory | null> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, async (tx) => {
    const [guest] = await tx<Guest[]>`select ${guestColumns(tx)} from guests g where g.id = ${guestId}`;
    if (!guest) return null;
    const bookings = await tx<BookingRow[]>`select ${bookingColumns(tx)} ${bookingFrom(tx)} where b.guest_id = ${guestId} order by b.arrival desc`;
    return { guest, bookings };
  });
}

// Bookings -------------------------------------------------------------------------------------

export interface BookingRow {
  id: string;
  branch_id: string;
  booking_no: number;
  guest_id: string;
  guest_name: string;
  guest_phone: string;
  nationality: string;
  room_type_id: string;
  type_am: string;
  type_en: string;
  room_id: string | null;
  room_number: string | null;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  children: number;
  source: BookingSource;
  rate_category: RateCategory;
  nightly_rate_santim: number | null;
  status: BookingStatus;
  note: string;
  balance_santim: number;
  created_at: Date;
}

const bookingColumns = (tx: Tx) => tx`
  b.id, b.branch_id, b.booking_no::int as booking_no, b.guest_id, g.full_name as guest_name, g.phone as guest_phone,
  g.nationality, b.room_type_id, t.name_am as type_am, t.name_en as type_en, b.room_id, r.number as room_number,
  to_char(b.arrival, 'YYYY-MM-DD') as arrival, to_char(b.departure, 'YYYY-MM-DD') as departure,
  (b.departure - b.arrival)::int as nights, b.adults, b.children, b.source, b.rate_category,
  b.nightly_rate_santim::int as nightly_rate_santim, b.status, b.note,
  (coalesce((select sum(c.amount_santim) from folio_charges c where c.booking_id = b.id and c.voided_at is null), 0)
   - coalesce((select sum(p.amount_santim) from payments p where p.booking_id = b.id), 0))::int as balance_santim,
  b.created_at`;
const bookingFrom = (tx: Tx) => tx`
  from bookings b join guests g on g.id = b.guest_id join room_types t on t.id = b.room_type_id left join rooms r on r.id = b.room_id`;

/** Bookings that touch the given dates (for the tape chart), cancelled ones left out. */
export async function listBookings(sql: Sql, actor: Actor, branchId: string, range: { from: string; to: string }): Promise<BookingRow[]> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, (tx) => tx<BookingRow[]>`
    select ${bookingColumns(tx)} ${bookingFrom(tx)}
    where b.branch_id = ${branchId} and b.status not in ('cancelled')
      and b.arrival <= ${isoDate(range.to)}::date and b.departure > ${isoDate(range.from)}::date
    order by b.arrival, b.booking_no`);
}

export interface FrontDesk {
  today: string;
  arrivals: BookingRow[];
  inHouse: BookingRow[];
  departures: BookingRow[];
  upcoming: BookingRow[];
}

/** Today at the front desk: who arrives, who is staying, who leaves, and the next few days. */
export async function frontDesk(sql: Sql, actor: Actor, branchId: string): Promise<FrontDesk> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, async (tx) => {
    const today = await addisToday(tx);
    const rows = await tx<BookingRow[]>`
      select ${bookingColumns(tx)} ${bookingFrom(tx)}
      where b.branch_id = ${branchId}
        and (b.status = 'checked_in' or (b.status = 'reserved' and b.arrival <= ${addDaysIso(today, 7)}::date))
      order by b.arrival, r.number`;
    return {
      today,
      arrivals: rows.filter((b) => b.status === "reserved" && b.arrival <= today),
      inHouse: rows.filter((b) => b.status === "checked_in"),
      departures: rows.filter((b) => b.status === "checked_in" && b.departure <= today),
      upcoming: rows.filter((b) => b.status === "reserved" && b.arrival > today),
    };
  });
}

export interface BookingDetail {
  booking: BookingRow;
  guest: Guest;
  folio: Folio;
  today: string;
}

export async function getBooking(sql: Sql, actor: Actor, bookingId: string): Promise<BookingDetail | null> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, async (tx) => {
    const [booking] = await tx<BookingRow[]>`select ${bookingColumns(tx)} ${bookingFrom(tx)} where b.id = ${bookingId}`;
    if (!booking) return null;
    const [guest] = await tx<Guest[]>`select ${guestColumns(tx)} from guests g where g.id = ${booking.guest_id}`;
    return { booking, guest: guest!, folio: await loadFolio(tx, bookingId), today: await addisToday(tx) };
  });
}

export interface AvailableRoom {
  id: string;
  number: string;
  floor: string;
  room_type_id: string;
  type_am: string;
  type_en: string;
  capacity: number;
  hk_status: string;
}

async function freeRooms(tx: Tx, branchId: string, arrival: string, departure: string, exceptBookingId: string | null) {
  return tx<AvailableRoom[]>`
    select r.id, r.number, r.floor, r.room_type_id, t.name_am as type_am, t.name_en as type_en, t.capacity, r.hk_status
    from rooms r join room_types t on t.id = r.room_type_id
    where r.branch_id = ${branchId} and r.is_active and t.is_active and r.hk_status <> 'out_of_order'
      and not exists (
        select 1 from bookings b
        where b.room_id = r.id and b.status in ('reserved', 'checked_in')
          and (${exceptBookingId}::uuid is null or b.id <> ${exceptBookingId}::uuid)
          and daterange(b.arrival, b.departure) && daterange(${arrival}::date, ${departure}::date))
    order by t.sort, length(r.number), r.number`;
}

/** Rooms free for every night of the stay. */
export async function availableRooms(
  sql: Sql, actor: Actor, branchId: string, arrival: string, departure: string, exceptBookingId: string | null = null,
): Promise<AvailableRoom[]> {
  requirePermission(actor, "hotel.frontdesk");
  if (isoDate(departure) <= isoDate(arrival)) throw new DomainError("invalid_dates");
  return withTenant(sql, actor, (tx) => freeRooms(tx, branchId, arrival, departure, exceptBookingId));
}

/** Price a stay night by night before booking it. */
export async function quoteStay(sql: Sql, actor: Actor, input: {
  roomTypeId: string; arrival: string; departure: string; rateCategory: RateCategory; nightlyRateSantim: number | null;
}): Promise<{ nights: NightPrice[]; total: number }> {
  requirePermission(actor, "hotel.frontdesk");
  if (isoDate(input.departure) <= isoDate(input.arrival)) throw new DomainError("invalid_dates");
  return withTenant(sql, actor, async (tx) => {
    const pricing = await loadPricing(tx, input.roomTypeId);
    const nights = priceNights(pricing, { rate_category: input.rateCategory, nightly_rate_santim: input.nightlyRateSantim },
      stayNights(input.arrival, input.departure));
    return { nights, total: nights.reduce((s, n) => s + n.amount_santim, 0) };
  });
}

export interface BookingInput {
  branchId: string;
  guest: GuestInput;
  roomTypeId: string;
  roomId?: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children?: number;
  source: BookingSource;
  rateCategory?: RateCategory;
  nightlyRateSantim?: number | null;
  note?: string;
  deposit?: { methodCode: string; amountSantim: number; reference?: string } | null;
}

/** Make a reservation (or a walk-in when checkInNow is set). Returns the booking id. */
export async function createBooking(sql: Sql, actor: Actor, input: BookingInput, { checkInNow = false } = {}): Promise<string> {
  requirePermission(actor, "hotel.frontdesk");
  const arrival = isoDate(input.arrival);
  const departure = isoDate(input.departure);
  if (departure <= arrival) throw new DomainError("invalid_dates");
  if (stayNights(arrival, departure).length > 365) throw new DomainError("stay_too_long");
  if (!BOOKING_SOURCES.includes(input.source)) throw new DomainError("invalid_input");
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 20) throw new DomainError("invalid_guests");
  const children = input.children ?? 0;
  if (!Number.isInteger(children) || children < 0 || children > 20) throw new DomainError("invalid_guests");
  const agreed = input.nightlyRateSantim ? santim(input.nightlyRateSantim) : null;
  if (input.deposit) {
    requirePermission(actor, "payment.record");
    santim(input.deposit.amountSantim, { allowZero: false });
  }

  return withTenant(sql, actor, async (tx) => {
    const today = await addisToday(tx);
    if (arrival < addDaysIso(today, -1)) throw new DomainError("arrival_in_past");
    const guestId = await upsertGuest(tx, input.guest);
    const [guest] = await tx<{ nationality: string }[]>`select nationality from guests where id = ${guestId}`;
    const rateCategory: RateCategory = input.rateCategory ?? (guest!.nationality === "ET" ? "local" : "foreign");

    let roomTypeId = input.roomTypeId;
    if (input.roomId) {
      const [room] = await tx<{ room_type_id: string; branch_id: string }[]>`select room_type_id, branch_id from rooms where id = ${input.roomId}`;
      if (!room || room.branch_id !== input.branchId) throw new DomainError("not_found");
      roomTypeId = room.room_type_id;
    }
    const [no] = await tx<{ n: number }[]>`select next_branch_number(${input.branchId}, 'booking')::int as n`;
    let bookingId: string;
    try {
      const [row] = await tx<{ id: string }[]>`
        insert into bookings (branch_id, booking_no, guest_id, room_type_id, room_id, arrival, departure, adults, children,
                              source, rate_category, nightly_rate_santim, note)
        values (${input.branchId}, ${no!.n}, ${guestId}, ${roomTypeId}, ${input.roomId || null}, ${arrival}, ${departure},
                ${input.adults}, ${children}, ${input.source}, ${rateCategory}, ${agreed}, ${text(input.note, 300)})
        returning id`;
      bookingId = row!.id;
    } catch (err) {
      if (isOverlap(err)) throw new DomainError("room_not_available");
      throw err;
    }
    if (input.deposit) await insertFolioPayment(tx, actor, bookingId, input.deposit);
    if (checkInNow) await doCheckIn(tx, bookingId, today);
    return bookingId;
  });
}

/** Change dates, room or agreed price. A guest already in the room can only change departure and room. */
export async function updateBooking(sql: Sql, actor: Actor, bookingId: string, input: {
  arrival?: string; departure?: string; roomId?: string | null; nightlyRateSantim?: number | null; note?: string;
}): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  await withTenant(sql, actor, async (tx) => {
    const [b] = await tx<{ status: BookingStatus; branch_id: string; arrival: string; departure: string; room_id: string | null }[]>`
      select status, branch_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure, room_id
      from bookings where id = ${bookingId} for update`;
    if (!b) throw new DomainError("not_found");
    if (b.status !== "reserved" && b.status !== "checked_in") throw new DomainError("booking_closed");
    const today = await addisToday(tx);
    const arrival = input.arrival ? isoDate(input.arrival) : b.arrival;
    const departure = input.departure ? isoDate(input.departure) : b.departure;
    if (b.status === "checked_in" && arrival !== b.arrival) throw new DomainError("already_checked_in");
    if (departure <= arrival) throw new DomainError("invalid_dates");
    if (b.status === "checked_in" && departure <= today && departure !== b.departure) throw new DomainError("invalid_dates");
    const roomId = input.roomId === undefined ? b.room_id : input.roomId;
    if (b.status === "checked_in" && !roomId) throw new DomainError("room_required");
    let roomTypeId: string | null = null;
    if (roomId && roomId !== b.room_id) {
      const [room] = await tx<{ room_type_id: string; branch_id: string; hk_status: string }[]>`
        select room_type_id, branch_id, hk_status from rooms where id = ${roomId}`;
      if (!room || room.branch_id !== b.branch_id) throw new DomainError("not_found");
      if (room.hk_status === "out_of_order") throw new DomainError("room_out_of_order");
      roomTypeId = room.room_type_id;
    }
    try {
      await tx`
        update bookings set arrival = ${arrival}, departure = ${departure}, room_id = ${roomId},
          room_type_id = coalesce(${roomTypeId}::uuid, room_type_id),
          nightly_rate_santim = ${input.nightlyRateSantim === undefined ? tx`nightly_rate_santim` : (input.nightlyRateSantim ? santim(input.nightlyRateSantim) : null)},
          note = ${input.note === undefined ? tx`note` : text(input.note, 300)}
        where id = ${bookingId}`;
    } catch (err) {
      if (isOverlap(err)) throw new DomainError("room_not_available");
      throw err;
    }
    // A guest moved out of a room leaves it to be cleaned.
    if (b.status === "checked_in" && roomId !== b.room_id && b.room_id) await roomVacated(tx, b.branch_id, b.room_id);
  });
}

export async function cancelBooking(sql: Sql, actor: Actor, bookingId: string, reason: string): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  if (!reason.trim()) throw new DomainError("reason_required");
  await withTenant(sql, actor, async (tx) => {
    const [b] = await tx<{ status: string }[]>`select status from bookings where id = ${bookingId} for update`;
    if (!b) throw new DomainError("not_found");
    if (b.status !== "reserved") throw new DomainError("booking_closed");
    // A deposit stays on the folio as credit until it is refunded or kept as a cancellation fee.
    await tx`update bookings set status = 'cancelled', cancel_reason = ${reason.trim().slice(0, 200)} where id = ${bookingId}`;
    await tx`insert into audit_logs (action, entity, entity_id, reason) values ('booking.cancel', 'booking', ${bookingId}, ${reason.trim()})`;
  });
}

async function doCheckIn(tx: Tx, bookingId: string, today: string): Promise<void> {
  const [b] = await tx<{ status: string; arrival: string; departure: string; room_id: string | null; nationality: string;
    id_type: string | null; id_number: string; hk_status: string | null }[]>`
    select b.status, to_char(b.arrival, 'YYYY-MM-DD') as arrival, to_char(b.departure, 'YYYY-MM-DD') as departure, b.room_id,
           g.nationality, g.id_type, g.id_number, r.hk_status
    from bookings b join guests g on g.id = b.guest_id left join rooms r on r.id = b.room_id
    where b.id = ${bookingId} for update of b`;
  if (!b) throw new DomainError("not_found");
  if (b.status !== "reserved") throw new DomainError("booking_closed");
  if (b.arrival > today) throw new DomainError("arrival_in_future");
  if (!b.room_id) throw new DomainError("room_required");
  if (b.hk_status === "out_of_order") throw new DomainError("room_out_of_order");
  // Guest registration: every guest shows an ID; foreigners register with their passport.
  if (!b.id_type || !b.id_number.trim()) throw new DomainError("guest_id_required");
  if (b.nationality !== "ET" && b.id_type !== "passport") throw new DomainError("passport_required");
  if (b.departure <= today) throw new DomainError("invalid_dates");
  try {
    // A late arrival is charged from the night they actually arrive.
    await tx`update bookings set status = 'checked_in', checked_in_at = now(), arrival = greatest(arrival, ${today}::date)
             where id = ${bookingId}`;
  } catch (err) {
    if (isOverlap(err)) throw new DomainError("room_occupied");
    throw err;
  }
}

export async function checkIn(sql: Sql, actor: Actor, bookingId: string): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  await withTenant(sql, actor, async (tx) => doCheckIn(tx, bookingId, await addisToday(tx)));
}

async function roomVacated(tx: Tx, branchId: string, roomId: string) {
  await tx`update rooms set hk_status = 'dirty' where id = ${roomId} and hk_status <> 'out_of_order'`;
  const [open] = await tx`select 1 from housekeeping_tasks where room_id = ${roomId} and kind = 'clean' and status = 'open'`;
  if (!open) await tx`insert into housekeeping_tasks (branch_id, room_id, kind) values (${branchId}, ${roomId}, 'clean')`;
}

/**
 * Check out: an early departure is shortened to today, a late one extended to today, every night
 * stayed is charged, and the folio must balance to zero. The room goes to housekeeping as dirty.
 */
export async function checkOut(sql: Sql, actor: Actor, bookingId: string): Promise<void> {
  requirePermission(actor, "hotel.frontdesk");
  await withTenant(sql, actor, async (tx) => {
    const [b] = await tx<{ id: string; status: string; branch_id: string; room_id: string; room_type_id: string; arrival: string;
      departure: string; rate_category: RateCategory; nightly_rate_santim: number | null }[]>`
      select id, status, branch_id, room_id, room_type_id, to_char(arrival, 'YYYY-MM-DD') as arrival,
             to_char(departure, 'YYYY-MM-DD') as departure, rate_category, nightly_rate_santim::int as nightly_rate_santim
      from bookings where id = ${bookingId} for update`;
    if (!b) throw new DomainError("not_found");
    if (b.status !== "checked_in") throw new DomainError("not_checked_in");
    const today = await addisToday(tx);
    // Leaving on the day they arrived still counts as one night.
    const departure = today <= b.arrival ? addDaysIso(b.arrival, 1) : today;
    if (departure !== b.departure) {
      try {
        await tx`update bookings set departure = ${departure} where id = ${bookingId}`;
      } catch (err) {
        if (isOverlap(err)) throw new DomainError("room_not_available");
        throw err;
      }
    }
    await postNights(tx, b, stayNights(b.arrival, departure));
    const balance = await folioBalance(tx, bookingId);
    if (balance > 0) throw new DomainError("balance_due");
    if (balance < 0) throw new DomainError("credit_remaining");
    await tx`update bookings set status = 'checked_out', checked_out_at = now() where id = ${bookingId}`;
    await roomVacated(tx, b.branch_id, b.room_id);
  });
}
