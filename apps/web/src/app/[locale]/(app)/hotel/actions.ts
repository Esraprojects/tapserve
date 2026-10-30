"use server";

import {
  addFolioCharge, addRateSeason, addRoomRange, type BookingSource, cancelBooking, checkIn, checkOut, createBooking,
  deleteRateSeason, DomainError, type IdType, recordFolioPayment, refundFolioCredit, runNightAudit, saveGuest, saveRoom,
  saveRoomType, setUsdRate, updateBooking, voidFolioCharge,
} from "@tapserve/db";
import { format, getDictionary } from "@tapserve/i18n";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { birrField, localeOf, runAction, str } from "@/server/actions";
import { money } from "@/lib/text";

const int = (form: FormData, key: string, fallback = 0) => {
  const raw = str(form, key);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new DomainError("invalid_input");
  return n;
};
const optionalBirr = (form: FormData, key: string) => (str(form, key) ? birrField(form, key) : null);
const bookingPage = (locale: string, id: string) => `/${locale}/hotel/bookings/${id}`;

function guestFromForm(form: FormData) {
  const nationality = str(form, "nationality") === "other" ? str(form, "country").toUpperCase() : "ET";
  return {
    id: str(form, "guestId") || undefined,
    fullName: str(form, "fullName"),
    phone: str(form, "phone"),
    email: str(form, "email"),
    nationality,
    idType: (str(form, "idType") || null) as IdType | null,
    idNumber: str(form, "idNumber"),
  };
}

export async function createBookingAction(form: FormData) {
  const locale = localeOf(form);
  const walkIn = str(form, "walkIn") === "1";
  const back = `/${locale}/hotel/bookings/new?${str(form, "query")}`;
  await runAction(back, async () => {
    const { actor, branchId } = await appContext(locale, "hotel.frontdesk");
    const depositAmount = optionalBirr(form, "depositAmount");
    const id = await createBooking(db(), actor, {
      branchId,
      guest: guestFromForm(form),
      roomTypeId: str(form, "roomTypeId"),
      roomId: str(form, "roomId") || null,
      arrival: str(form, "arrival"),
      departure: str(form, "departure"),
      adults: int(form, "adults", 1),
      children: int(form, "children", 0),
      source: (walkIn ? "walk_in" : str(form, "source")) as BookingSource,
      rateCategory: str(form, "rateCategory") === "foreign" ? "foreign" : str(form, "rateCategory") === "local" ? "local" : undefined,
      nightlyRateSantim: optionalBirr(form, "agreedRate"),
      note: str(form, "note"),
      deposit: depositAmount ? { methodCode: str(form, "depositMethod"), amountSantim: depositAmount, reference: str(form, "depositReference") } : null,
    }, { checkInNow: walkIn });
    return bookingPage(locale, id);
  });
}

export async function checkInAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await checkIn(db(), actor, id);
  });
}

export async function checkOutAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await checkOut(db(), actor, id);
  });
}

export async function cancelBookingAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await cancelBooking(db(), actor, id, str(form, "reason"));
  });
}

export async function updateBookingAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await updateBooking(db(), actor, id, {
      arrival: str(form, "arrival") || undefined,
      departure: str(form, "departure") || undefined,
      roomId: form.has("roomId") ? str(form, "roomId") || null : undefined,
      nightlyRateSantim: optionalBirr(form, "agreedRate"),
      note: str(form, "note"),
    });
  });
}

export async function saveGuestAction(form: FormData) {
  const locale = localeOf(form);
  const back = str(form, "back") || `/${locale}/hotel/guests`;
  await runAction(back, async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await saveGuest(db(), actor, guestFromForm(form));
  });
}

export async function addChargeAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await addFolioCharge(db(), actor, id, {
      kind: str(form, "kind") === "discount" ? "discount" : "extra",
      description: str(form, "description"),
      amountSantim: birrField(form, "amount"),
    });
  });
}

export async function voidChargeAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(bookingPage(locale, str(form, "bookingId")), async () => {
    const { actor } = await appContext(locale, "hotel.frontdesk");
    await voidFolioCharge(db(), actor, str(form, "chargeId"), str(form, "reason"));
  });
}

export async function folioPaymentAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "payment.record");
    await recordFolioPayment(db(), actor, id, {
      methodCode: str(form, "method"), amountSantim: birrField(form, "amount"), reference: str(form, "reference"),
    });
  });
}

export async function refundAction(form: FormData) {
  const locale = localeOf(form);
  const id = str(form, "bookingId");
  await runAction(bookingPage(locale, id), async () => {
    const { actor } = await appContext(locale, "payment.refund");
    await refundFolioCredit(db(), actor, id, { methodCode: str(form, "method"), reference: str(form, "reference") });
  });
}

export async function nightAuditAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(`/${locale}/hotel/audit`, async () => {
    const { actor, branchId } = await appContext(locale, "hotel.frontdesk");
    const r = await runNightAudit(db(), actor, branchId, str(form, "date"));
    const t = getDictionary(locale);
    const done = format(t.hotel.auditDone, {
      rooms: String(r.rooms_charged), revenue: money(locale, r.room_revenue_santim), noShows: String(r.no_shows),
    });
    const extra = r.overstays ? ` ${format(t.hotel.overstays, { n: String(r.overstays) })}` : "";
    return `/${locale}/hotel/audit?done=${encodeURIComponent(done + extra)}`;
  });
}

const roomsPage = (locale: string) => `/${locale}/hotel/rooms`;

export async function saveRoomTypeAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor } = await appContext(locale, "hotel.manage");
    await saveRoomType(db(), actor, {
      id: str(form, "id") || undefined,
      nameAm: str(form, "nameAm"),
      nameEn: str(form, "nameEn"),
      capacity: int(form, "capacity", 2),
      localRateSantim: birrField(form, "localRate"),
      foreignRateSantim: birrField(form, "foreignRate"),
      weekendLocalRateSantim: optionalBirr(form, "weekendLocal"),
      weekendForeignRateSantim: optionalBirr(form, "weekendForeign"),
      isActive: str(form, "inactive") !== "on",
    });
  });
}

export async function addSeasonAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor } = await appContext(locale, "hotel.manage");
    await addRateSeason(db(), actor, {
      roomTypeId: str(form, "roomTypeId"), name: str(form, "name"), startsOn: str(form, "startsOn"), endsOn: str(form, "endsOn"),
      localRateSantim: birrField(form, "localRate"), foreignRateSantim: birrField(form, "foreignRate"),
    });
  });
}

export async function deleteSeasonAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor } = await appContext(locale, "hotel.manage");
    await deleteRateSeason(db(), actor, str(form, "seasonId"));
  });
}

export async function addRoomsAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor, branchId } = await appContext(locale, "hotel.manage");
    const from = str(form, "from");
    const to = str(form, "to") || from;
    if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
      await addRoomRange(db(), actor, { branchId, roomTypeId: str(form, "roomTypeId"), from: Number(from), to: Number(to), floor: str(form, "floor") });
    } else {
      // Named rooms such as "Lake Suite" are added one at a time.
      await saveRoom(db(), actor, { branchId, roomTypeId: str(form, "roomTypeId"), number: from, floor: str(form, "floor") });
    }
  });
}

export async function saveRoomAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor, branchId } = await appContext(locale, "hotel.manage");
    await saveRoom(db(), actor, {
      id: str(form, "id"), branchId, roomTypeId: str(form, "roomTypeId"), number: str(form, "number"), floor: str(form, "floor"),
      note: str(form, "note"), isActive: str(form, "inactive") !== "on",
    });
  });
}

export async function setUsdRateAction(form: FormData) {
  const locale = localeOf(form);
  await runAction(roomsPage(locale), async () => {
    const { actor } = await appContext(locale, "hotel.manage");
    await setUsdRate(db(), actor, optionalBirr(form, "usdRate"));
  });
}
