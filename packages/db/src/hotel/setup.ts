import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "../restaurant/common";
import { isoDate, santim, text } from "./common";

/**
 * Room setup: room types with local and foreigner rates (weekday, weekend and seasonal),
 * the rooms themselves, and the business's own dollar exchange rate for foreign guests.
 */

export interface RoomType {
  id: string;
  name_am: string;
  name_en: string;
  capacity: number;
  local_rate_santim: number;
  foreign_rate_santim: number;
  weekend_local_rate_santim: number | null;
  weekend_foreign_rate_santim: number | null;
  is_active: boolean;
  room_count: number;
}

export async function listRoomTypes(sql: Sql, actor: Actor): Promise<RoomType[]> {
  return withTenant(sql, actor, (tx) => tx<RoomType[]>`
    select t.id, t.name_am, t.name_en, t.capacity, t.local_rate_santim::int as local_rate_santim,
           t.foreign_rate_santim::int as foreign_rate_santim,
           t.weekend_local_rate_santim::int as weekend_local_rate_santim,
           t.weekend_foreign_rate_santim::int as weekend_foreign_rate_santim, t.is_active,
           (select count(*) from rooms r where r.room_type_id = t.id and r.is_active)::int as room_count
    from room_types t order by t.sort, t.name_en`);
}

export interface RoomTypeInput {
  id?: string;
  nameAm: string;
  nameEn: string;
  capacity: number;
  localRateSantim: number;
  foreignRateSantim: number;
  weekendLocalRateSantim: number | null;
  weekendForeignRateSantim: number | null;
  isActive?: boolean;
}

export async function saveRoomType(sql: Sql, actor: Actor, input: RoomTypeInput): Promise<string> {
  requirePermission(actor, "hotel.manage");
  const nameAm = text(input.nameAm, 60);
  const nameEn = text(input.nameEn, 60);
  if (!nameAm && !nameEn) throw new DomainError("name_required");
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 20) throw new DomainError("invalid_capacity");
  const row = {
    name_am: nameAm,
    name_en: nameEn,
    capacity: input.capacity,
    local_rate_santim: santim(input.localRateSantim, { allowZero: false }),
    foreign_rate_santim: santim(input.foreignRateSantim, { allowZero: false }),
    weekend_local_rate_santim: input.weekendLocalRateSantim ? santim(input.weekendLocalRateSantim) : null,
    weekend_foreign_rate_santim: input.weekendForeignRateSantim ? santim(input.weekendForeignRateSantim) : null,
    is_active: input.isActive ?? true,
  };
  return withTenant(sql, actor, async (tx) => {
    if (input.id) {
      const [updated] = await tx<{ id: string }[]>`update room_types set ${tx(row)} where id = ${input.id} returning id`;
      if (!updated) throw new DomainError("not_found");
      return updated.id;
    }
    const [next] = await tx<{ sort: number }[]>`select coalesce(max(sort), 0) + 1 as sort from room_types`;
    const [created] = await tx<{ id: string }[]>`insert into room_types ${tx({ ...row, sort: next!.sort })} returning id`;
    return created!.id;
  });
}

export interface RateSeasonView {
  id: string;
  room_type_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  local_rate_santim: number;
  foreign_rate_santim: number;
}

export async function listRateSeasons(sql: Sql, actor: Actor): Promise<RateSeasonView[]> {
  return withTenant(sql, actor, (tx) => tx<RateSeasonView[]>`
    select id, room_type_id, name, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
           local_rate_santim::int as local_rate_santim, foreign_rate_santim::int as foreign_rate_santim
    from rate_seasons order by starts_on, name`);
}

export async function addRateSeason(sql: Sql, actor: Actor, input: {
  roomTypeId: string; name: string; startsOn: string; endsOn: string; localRateSantim: number; foreignRateSantim: number;
}): Promise<string> {
  requirePermission(actor, "hotel.manage");
  const name = text(input.name, 60);
  if (!name) throw new DomainError("name_required");
  const startsOn = isoDate(input.startsOn);
  const endsOn = isoDate(input.endsOn);
  if (endsOn < startsOn) throw new DomainError("invalid_dates");
  return withTenant(sql, actor, async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into rate_seasons (room_type_id, name, starts_on, ends_on, local_rate_santim, foreign_rate_santim)
      values (${input.roomTypeId}, ${name}, ${startsOn}, ${endsOn},
              ${santim(input.localRateSantim, { allowZero: false })}, ${santim(input.foreignRateSantim, { allowZero: false })})
      returning id`;
    return row!.id;
  });
}

export async function deleteRateSeason(sql: Sql, actor: Actor, seasonId: string): Promise<void> {
  requirePermission(actor, "hotel.manage");
  await withTenant(sql, actor, (tx) => tx`delete from rate_seasons where id = ${seasonId}`);
}

export type HousekeepingStatus = "clean" | "dirty" | "inspected" | "out_of_order";

export interface RoomView {
  id: string;
  branch_id: string;
  number: string;
  floor: string;
  room_type_id: string;
  type_am: string;
  type_en: string;
  hk_status: HousekeepingStatus;
  is_active: boolean;
  note: string;
  /** The guest staying now, if any. */
  booking_id: string | null;
  guest_name: string | null;
  departure: string | null;
}

export async function listRooms(sql: Sql, actor: Actor, branchId: string, { activeOnly = false } = {}): Promise<RoomView[]> {
  return withTenant(sql, actor, (tx) => tx<RoomView[]>`
    select r.id, r.branch_id, r.number, r.floor, r.room_type_id, t.name_am as type_am, t.name_en as type_en,
           r.hk_status, r.is_active, r.note,
           b.id as booking_id, g.full_name as guest_name, to_char(b.departure, 'YYYY-MM-DD') as departure
    from rooms r
    join room_types t on t.id = r.room_type_id
    left join bookings b on b.room_id = r.id and b.status = 'checked_in'
    left join guests g on g.id = b.guest_id
    where r.branch_id = ${branchId} and (${!activeOnly} or r.is_active)
    order by r.floor, length(r.number), r.number`);
}

export interface RoomInput {
  id?: string;
  branchId: string;
  roomTypeId: string;
  number: string;
  floor: string;
  note?: string;
  isActive?: boolean;
}

export async function saveRoom(sql: Sql, actor: Actor, input: RoomInput): Promise<string> {
  requirePermission(actor, "hotel.manage");
  const number = text(input.number, 20);
  if (!number) throw new DomainError("room_number_required");
  const row = {
    room_type_id: input.roomTypeId,
    number,
    floor: text(input.floor, 20),
    note: text(input.note, 200),
    is_active: input.isActive ?? true,
  };
  return withTenant(sql, actor, async (tx) => {
    try {
      if (input.id) {
        const [updated] = await tx<{ id: string }[]>`update rooms set ${tx(row)} where id = ${input.id} returning id`;
        if (!updated) throw new DomainError("not_found");
        return updated.id;
      }
      const [created] = await tx<{ id: string }[]>`insert into rooms ${tx({ ...row, branch_id: input.branchId })} returning id`;
      return created!.id;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
        throw new DomainError("room_number_taken");
      }
      throw err;
    }
  });
}

/** Add many rooms at once, e.g. 101–110 on floor 1. */
export async function addRoomRange(sql: Sql, actor: Actor, input: {
  branchId: string; roomTypeId: string; from: number; to: number; floor: string;
}): Promise<number> {
  requirePermission(actor, "hotel.manage");
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 0 || input.to < input.from || input.to - input.from > 99) {
    throw new DomainError("invalid_room_range");
  }
  return withTenant(sql, actor, async (tx) => {
    const rows = [];
    for (let n = input.from; n <= input.to; n++) {
      rows.push({ branch_id: input.branchId, room_type_id: input.roomTypeId, number: String(n), floor: text(input.floor, 20) });
    }
    const inserted = await tx`insert into rooms ${tx(rows)} on conflict (branch_id, number) do nothing returning id`;
    return inserted.length;
  });
}

export async function getUsdRate(sql: Sql, actor: Actor): Promise<number | null> {
  return withTenant(sql, actor, async (tx) => {
    const [row] = await tx<{ rate: number | null }[]>`select usd_rate_santim::int as rate from tenant_settings`;
    return row?.rate ?? null;
  });
}

/** Birr per US dollar, typed in by the business (in santim); null hides dollar amounts. */
export async function setUsdRate(sql: Sql, actor: Actor, rateSantim: number | null): Promise<void> {
  requirePermission(actor, "hotel.manage");
  if (rateSantim !== null) santim(rateSantim, { allowZero: false });
  await withTenant(sql, actor, (tx) => tx`update tenant_settings set usd_rate_santim = ${rateSantim}`);
}
