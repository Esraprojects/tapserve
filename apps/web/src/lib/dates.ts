import { formatEthiopianDate, MONTHS_AM, MONTHS_EN, toEthiopian } from "@tapserve/ethiopian-calendar";
import type { Locale } from "@tapserve/i18n";

/** Today's date in Addis Ababa as YYYY-MM-DD. */
export function addisToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Noon UTC keeps the Addis calendar day stable when converting a plain date. */
const noon = (isoDate: string) => new Date(`${isoDate}T09:00:00Z`);

/** Short chart label: Ethiopian calendar in Amharic, Gregorian in English. */
export function shortDay(isoDate: string, locale: Locale): string {
  if (locale === "am") {
    const ec = toEthiopian(noon(isoDate));
    return `${MONTHS_AM[ec.month - 1]!.slice(0, 3)} ${ec.day}`;
  }
  const d = noon(isoDate);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/** "Tikimt 19, 2019 EC · 29 Oct 2026" - both calendars, as on receipts and reports. */
export function bothCalendars(isoDate: string, locale: Locale): string {
  const ec = formatEthiopianDate(toEthiopian(noon(isoDate)), locale);
  const gc = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
  return `${ec} · ${gc}`;
}

export { MONTHS_EN };
