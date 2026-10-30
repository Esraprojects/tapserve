import { computeBill, type TaxSettings } from "./bill";
import type { Santim } from "./money";

export type RateCategory = "local" | "foreign";

export interface RoomTypeRates {
  local_rate_santim: Santim;
  foreign_rate_santim: Santim;
  weekend_local_rate_santim: Santim | null;
  weekend_foreign_rate_santim: Santim | null;
}

export interface RateSeason {
  starts_on: string;
  ends_on: string;
  local_rate_santim: Santim;
  foreign_rate_santim: Santim;
}

/** ISO date (YYYY-MM-DD) plus some days. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The nights of a stay: arrival up to, but not including, departure. */
export function stayNights(arrival: string, departure: string): string[] {
  const nights: string[] = [];
  for (let d = arrival; d < departure; d = addDaysIso(d, 1)) nights.push(d);
  return nights;
}

/** Friday and Saturday nights count as the weekend. */
export function isWeekendNight(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

/**
 * Price of one night. An agreed rate on the booking wins; then a season covering the night
 * (the one that started last, if seasons overlap); then the weekend rate; then the normal rate.
 */
export function nightlyRate(
  type: RoomTypeRates, seasons: readonly RateSeason[], night: string, category: RateCategory, agreed: Santim | null = null,
): Santim {
  if (agreed !== null) return agreed;
  const season = seasons
    .filter((s) => s.starts_on <= night && night <= s.ends_on)
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1))[0];
  if (season) return category === "foreign" ? season.foreign_rate_santim : season.local_rate_santim;
  if (isWeekendNight(night)) {
    const weekend = category === "foreign" ? type.weekend_foreign_rate_santim : type.weekend_local_rate_santim;
    if (weekend !== null) return weekend;
  }
  return category === "foreign" ? type.foreign_rate_santim : type.local_rate_santim;
}

/** What the guest pays for a night at this rate, and the tax inside it. No service charge on rooms. */
export function roomCharge(rate: Santim, settings: TaxSettings): { amount: Santim; tax: Santim } {
  if (rate === 0) return { amount: 0, tax: 0 };
  const totals = computeBill([{ unitPrice: rate, quantity: 1 }], { ...settings, serviceChargeEnabled: false });
  return { amount: totals.total, tax: totals.tax };
}

/** A birr amount shown in US dollars at the business's own exchange rate (santim per dollar), in cents. */
export function toUsdCents(santim: Santim, usdRateSantim: number): number {
  return Math.round((santim * 100) / usdRateSantim);
}
