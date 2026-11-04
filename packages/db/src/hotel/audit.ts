import { addDaysIso, type RateCategory, stayNights } from "@tapserve/core";
import { type Sql, withTenant } from "../client";
import type { DateRange } from "../restaurant/reports";
import { type Actor, DomainError, requirePermission } from "../restaurant/common";
import { addisToday, isoDate } from "./common";
import { postNights } from "./folio";

/**
 * Night audit (the hotel's daily close) and room reports: occupancy, ADR and RevPAR.
 */

export interface NightAuditResult {
  business_date: string;
  rooms_charged: number;
  room_revenue_santim: number;
  no_shows: number;
  /** Guests still in house after their departure date, for the front desk to follow up. */
  overstays: number;
}

/**
 * Close a business day: charge every in-house guest for the night, mark reservations that never
 * arrived as no-shows, and send occupied rooms to housekeeping. Runs once per branch and day.
 */
export async function runNightAudit(sql: Sql, actor: Actor, branchId: string, businessDate: string): Promise<NightAuditResult> {
  requirePermission(actor, "hotel.frontdesk");
  const date = isoDate(businessDate);
  return withTenant(sql, actor, async (tx) => {
    const today = await addisToday(tx);
    if (date > today) throw new DomainError("audit_in_future");
    // Lock the branch's audits so two receptionists pressing the button post the night once.
    await tx`select pg_advisory_xact_lock(hashtext(${`night_audit:${branchId}`}))`;
    const [done] = await tx`select 1 from night_audits where branch_id = ${branchId} and business_date = ${date}`;
    if (done) throw new DomainError("audit_already_run");

    const stays = await tx<{ id: string; room_type_id: string; rate_category: RateCategory; nightly_rate_santim: number | null;
      arrival: string; departure: string }[]>`
      select id, room_type_id, rate_category, nightly_rate_santim::int as nightly_rate_santim,
             to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure
      from bookings where branch_id = ${branchId} and status = 'checked_in' and arrival <= ${date}::date for update`;
    let charged = 0;
    let revenue = 0;
    for (const stay of stays) {
      // Every night from arrival up to this one, in case an earlier audit was skipped.
      const posted = await postNights(tx, stay, stayNights(stay.arrival, addDaysIso(date, 1)));
      const tonight = posted.find((p) => p.night === date);
      if (tonight) {
        charged++;
        revenue += tonight.amount_santim;
      }
    }
    const noShows = await tx`
      update bookings set status = 'no_show' where branch_id = ${branchId} and status = 'reserved' and arrival <= ${date}::date returning id`;
    await tx`
      update rooms set hk_status = 'dirty'
      where branch_id = ${branchId} and hk_status in ('clean', 'inspected')
        and id in (select room_id from bookings where status = 'checked_in' and branch_id = ${branchId})`;
    await tx`
      insert into night_audits (branch_id, business_date, rooms_charged, room_revenue_santim, no_shows)
      values (${branchId}, ${date}, ${charged}, ${revenue}, ${noShows.length})`;
    return {
      business_date: date,
      rooms_charged: charged,
      room_revenue_santim: revenue,
      no_shows: noShows.length,
      overstays: stays.filter((s) => s.departure <= date).length,
    };
  });
}

export interface NightAuditRow {
  business_date: string;
  rooms_charged: number;
  room_revenue_santim: number;
  no_shows: number;
  ran_by: string;
  ran_at: Date;
}

export async function listNightAudits(sql: Sql, actor: Actor, branchId: string): Promise<NightAuditRow[]> {
  requirePermission(actor, "hotel.frontdesk");
  return withTenant(sql, actor, (tx) => tx<NightAuditRow[]>`
    select to_char(a.business_date, 'YYYY-MM-DD') as business_date, a.rooms_charged, a.room_revenue_santim::int as room_revenue_santim,
           a.no_shows, coalesce(nullif(u.full_name, ''), u.phone, u.email, '') as ran_by, a.ran_at
    from night_audits a join users u on u.id = a.ran_by
    where a.branch_id = ${branchId} order by a.business_date desc limit 30`);
}

export interface RoomReport {
  rooms: number;
  roomNightsAvailable: number;
  roomNightsSold: number;
  /** Room revenue before tax. */
  revenueSantim: number;
  taxSantim: number;
  occupancyBp: number;
  adrSantim: number;
  revparSantim: number;
  daily: { day: string; sold: number; revenue_santim: number }[];
  bySource: { source: string; nights: number; revenue_santim: number }[];
  byCategory: { category: string; nights: number; revenue_santim: number }[];
}

/** Occupancy, average daily rate (ADR) and revenue per available room (RevPAR) from charged room nights. */
export async function roomReport(sql: Sql, actor: Actor, range: DateRange, branchId: string | null): Promise<RoomReport> {
  requirePermission(actor, "reports.view");
  return withTenant(sql, actor, async (tx) => {
    const [r] = await tx<{ rooms: number }[]>`
      select count(*)::int as rooms from rooms where is_active and (${branchId}::uuid is null or branch_id = ${branchId}::uuid)`;
    const days = stayNights(range.from, addDaysIso(range.to, 1)).length;
    const charges = tx`
      folio_charges c join bookings b on b.id = c.booking_id
      where c.kind = 'room' and c.voided_at is null and c.night_date between ${range.from}::date and ${range.to}::date
        and (${branchId}::uuid is null or b.branch_id = ${branchId}::uuid)`;
    const [t] = await tx<{ sold: number; revenue: number; tax: number }[]>`
      select count(*)::int as sold, coalesce(sum(c.amount_santim - c.tax_santim), 0)::int as revenue,
             coalesce(sum(c.tax_santim), 0)::int as tax
      from ${charges}`;
    const daily = await tx<RoomReport["daily"]>`
      select to_char(d, 'YYYY-MM-DD') as day, count(x.id)::int as sold, coalesce(sum(x.net), 0)::int as revenue_santim
      from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
      left join (select c.id, c.night_date, c.amount_santim - c.tax_santim as net from ${charges}) x on x.night_date = d::date
      group by d order by d`;
    const bySource = await tx<RoomReport["bySource"]>`
      select b.source, count(*)::int as nights, sum(c.amount_santim - c.tax_santim)::int as revenue_santim
      from ${charges} group by b.source order by revenue_santim desc`;
    const byCategory = await tx<RoomReport["byCategory"]>`
      select b.rate_category as category, count(*)::int as nights, sum(c.amount_santim - c.tax_santim)::int as revenue_santim
      from ${charges} group by b.rate_category order by revenue_santim desc`;
    const available = r!.rooms * days;
    return {
      rooms: r!.rooms,
      roomNightsAvailable: available,
      roomNightsSold: t!.sold,
      revenueSantim: t!.revenue,
      taxSantim: t!.tax,
      occupancyBp: available ? Math.round((t!.sold * 10_000) / available) : 0,
      adrSantim: t!.sold ? Math.round(t!.revenue / t!.sold) : 0,
      revparSantim: available ? Math.round(t!.revenue / available) : 0,
      daily,
      bySource,
      byCategory,
    };
  });
}

export interface HotelToday {
  rooms: number;
  inHouse: number;
  arrivals: number;
  departures: number;
  dirty: number;
  outOfOrder: number;
  /** Whether last night has been closed by the night audit. */
  lastAudit: string | null;
}

export async function hotelToday(sql: Sql, actor: Actor, branchId: string): Promise<HotelToday> {
  return withTenant(sql, actor, async (tx) => {
    const today = await addisToday(tx);
    const [row] = await tx<HotelToday[]>`
      select (select count(*) from rooms where branch_id = ${branchId} and is_active)::int as rooms,
             (select count(*) from bookings where branch_id = ${branchId} and status = 'checked_in')::int as "inHouse",
             (select count(*) from bookings where branch_id = ${branchId} and status = 'reserved' and arrival <= ${today}::date)::int as arrivals,
             (select count(*) from bookings where branch_id = ${branchId} and status = 'checked_in' and departure <= ${today}::date)::int as departures,
             (select count(*) from rooms where branch_id = ${branchId} and is_active and hk_status = 'dirty')::int as dirty,
             (select count(*) from rooms where branch_id = ${branchId} and is_active and hk_status = 'out_of_order')::int as "outOfOrder",
             (select to_char(max(business_date), 'YYYY-MM-DD') from night_audits where branch_id = ${branchId}) as "lastAudit"`;
    return row!;
  });
}
