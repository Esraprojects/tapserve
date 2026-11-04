import { type Sql, withTenant } from "../client";
import { type Actor, DomainError, requirePermission } from "../restaurant/common";
import { addisToday, requireAny, text } from "./common";
import type { HousekeepingStatus } from "./setup";

/**
 * Housekeeping: each room is clean, dirty, inspected or out of order. Check-out and the night
 * audit make rooms dirty; housekeepers clean them from a phone; tasks can be given to a person.
 */

export interface HousekeepingRoom {
  id: string;
  number: string;
  floor: string;
  type_am: string;
  type_en: string;
  hk_status: HousekeepingStatus;
  note: string;
  occupancy: "vacant" | "occupied" | "arriving" | "departing";
  guest_name: string | null;
}

export interface HousekeepingTask {
  id: string;
  room_id: string;
  room_number: string;
  kind: "clean" | "inspect" | "repair";
  note: string;
  assigned_to: string | null;
  assignee_name: string | null;
  created_at: Date;
}

export interface HousekeepingBoard {
  rooms: HousekeepingRoom[];
  tasks: HousekeepingTask[];
  staff: { user_id: string; name: string }[];
}

export async function housekeepingBoard(sql: Sql, actor: Actor, branchId: string): Promise<HousekeepingBoard> {
  requireAny(actor, "hotel.housekeeping", "hotel.frontdesk");
  return withTenant(sql, actor, async (tx) => {
    const today = await addisToday(tx);
    const rooms = await tx<HousekeepingRoom[]>`
      select r.id, r.number, r.floor, t.name_am as type_am, t.name_en as type_en, r.hk_status, r.note,
             case when ih.id is not null and ih.departure <= ${today}::date then 'departing'
                  when ih.id is not null then 'occupied'
                  when exists (select 1 from bookings a where a.room_id = r.id and a.status = 'reserved' and a.arrival <= ${today}::date) then 'arriving'
                  else 'vacant' end as occupancy,
             g.full_name as guest_name
      from rooms r join room_types t on t.id = r.room_type_id
      left join bookings ih on ih.room_id = r.id and ih.status = 'checked_in'
      left join guests g on g.id = ih.guest_id
      where r.branch_id = ${branchId} and r.is_active
      order by r.floor, length(r.number), r.number`;
    const tasks = await tx<HousekeepingTask[]>`
      select k.id, k.room_id, r.number as room_number, k.kind, k.note, k.assigned_to,
             coalesce(nullif(u.full_name, ''), u.phone, u.email) as assignee_name, k.created_at
      from housekeeping_tasks k join rooms r on r.id = k.room_id left join users u on u.id = k.assigned_to
      where k.branch_id = ${branchId} and k.status = 'open'
      order by k.created_at`;
    const staff = await tx<{ user_id: string; name: string }[]>`
      select m.user_id, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as name
      from memberships m join users u on u.id = m.user_id
      where m.status = 'active'
        and exists (select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_key = 'hotel.housekeeping')
      order by 2`;
    return { rooms, tasks, staff };
  });
}

/** Set a room's status. Cleaning or inspecting a room closes its open cleaning tasks. */
export async function setRoomStatus(sql: Sql, actor: Actor, roomId: string, status: HousekeepingStatus, note = ""): Promise<void> {
  requireAny(actor, "hotel.housekeeping", "hotel.frontdesk");
  if (!["clean", "dirty", "inspected", "out_of_order"].includes(status)) throw new DomainError("invalid_input");
  // Only a supervisor confirms a room as inspected or takes it out of service.
  if (status === "inspected" || status === "out_of_order") requireAny(actor, "hotel.frontdesk", "hotel.manage");
  await withTenant(sql, actor, async (tx) => {
    const [room] = await tx<{ hk_status: string; occupied: boolean }[]>`
      select hk_status, exists (select 1 from bookings b where b.room_id = r.id and b.status = 'checked_in') as occupied
      from rooms r where id = ${roomId} for update`;
    if (!room) throw new DomainError("not_found");
    if (status === "out_of_order" && room.occupied) throw new DomainError("room_occupied");
    await tx`update rooms set hk_status = ${status}, note = ${status === "out_of_order" ? text(note, 200) : tx`case when hk_status = 'out_of_order' then '' else note end`}
             where id = ${roomId}`;
    if (status === "clean" || status === "inspected") {
      await tx`update housekeeping_tasks set status = 'done', done_by = current_app_user_id(), done_at = now()
               where room_id = ${roomId} and status = 'open' and kind in ('clean', ${status === "inspected" ? "inspect" : "clean"})`;
    }
    if (status === "out_of_order" || room.hk_status === "out_of_order") {
      await tx`insert into audit_logs (action, entity, entity_id, before, after, reason)
               values ('room.status', 'room', ${roomId}, ${tx.json({ hk_status: room.hk_status })}, ${tx.json({ hk_status: status })}, ${text(note, 200)})`;
    }
  });
}

export async function createHousekeepingTask(sql: Sql, actor: Actor, input: {
  branchId: string; roomId: string; kind: HousekeepingTask["kind"]; assignedTo: string | null; note?: string;
}): Promise<void> {
  requireAny(actor, "hotel.frontdesk", "hotel.manage");
  if (!["clean", "inspect", "repair"].includes(input.kind)) throw new DomainError("invalid_input");
  await withTenant(sql, actor, (tx) => tx`
    insert into housekeeping_tasks (branch_id, room_id, kind, assigned_to, note)
    values (${input.branchId}, ${input.roomId}, ${input.kind}, ${input.assignedTo || null}, ${text(input.note, 200)})`);
}

export async function assignHousekeepingTask(sql: Sql, actor: Actor, taskId: string, userId: string | null): Promise<void> {
  requireAny(actor, "hotel.frontdesk", "hotel.manage");
  await withTenant(sql, actor, (tx) => tx`update housekeeping_tasks set assigned_to = ${userId || null} where id = ${taskId} and status = 'open'`);
}

/** Finish a task. A finished clean makes the room clean, an inspection makes it inspected, a repair puts it back in service to be cleaned. */
export async function completeHousekeepingTask(sql: Sql, actor: Actor, taskId: string): Promise<void> {
  requirePermission(actor, "hotel.housekeeping");
  await withTenant(sql, actor, async (tx) => {
    const [task] = await tx<{ room_id: string; kind: string; status: string }[]>`
      select room_id, kind, status from housekeeping_tasks where id = ${taskId} for update`;
    if (!task) throw new DomainError("not_found");
    if (task.status === "done") return;
    await tx`update housekeeping_tasks set status = 'done', done_by = current_app_user_id(), done_at = now() where id = ${taskId}`;
    const next = task.kind === "clean" ? "clean" : task.kind === "inspect" ? "inspected" : "dirty";
    await tx`update rooms set hk_status = ${next}, note = case when hk_status = 'out_of_order' then '' else note end where id = ${task.room_id}`;
  });
}
