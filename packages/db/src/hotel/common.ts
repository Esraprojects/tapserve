import type { Tx } from "../client";
import { type Actor, DomainError } from "../restaurant/common";

/** Today's date in Addis Ababa, which decides which night a stay is on. */
export const ADDIS_TODAY = "(now() at time zone 'Africa/Addis_Ababa')::date";

export async function addisToday(tx: Tx): Promise<string> {
  const [row] = await tx<{ d: string }[]>`select to_char((now() at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD') as d`;
  return row!.d;
}

export function requireAny(actor: Actor, ...permissions: string[]): void {
  if (!permissions.some((p) => actor.permissions.includes(p))) throw new DomainError("forbidden");
}

export function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError("invalid_date");
  return value;
}

export function text(value: string | undefined | null, max = 200): string {
  return (value ?? "").trim().slice(0, max);
}

export function santim(value: number, { allowZero = true } = {}): number {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) throw new DomainError("invalid_amount");
  return value;
}

/** Postgres refuses a second live booking on the same room and night (exclusion constraint). */
export function isOverlap(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err &&
    ((err as { code: string }).code === "23P01" ||
     ((err as { code: string; constraint_name?: string }).code === "23505" &&
      (err as { constraint_name?: string }).constraint_name === "bookings_one_in_house_per_room")));
}
