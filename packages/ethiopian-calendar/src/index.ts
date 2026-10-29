/**
 * Ethiopian calendar (EC) conversion. Dates are stored in UTC and converted for display only.
 * The EC has 12 months of 30 days plus Pagume, which has 5 days (6 in a leap year).
 * An EC year is a leap year when year % 4 === 3.
 */

export interface EthiopianDate {
  year: number;
  /** 1 = Meskerem ... 13 = Pagume */
  month: number;
  day: number;
}

/** Julian day number of 1 Meskerem, year 1 (Amete Mihret era). */
const EPOCH = 1_724_221;
/** Julian day number of 1970-01-01. */
const UNIX_EPOCH_JDN = 2_440_588;
const MS_PER_DAY = 86_400_000;
/** Addis Ababa is UTC+3 all year (no daylight saving). */
export const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

export const MONTHS_AM = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት", "መጋቢት",
  "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
] as const;

export const MONTHS_EN = [
  "Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit",
  "Miyazya", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume",
] as const;

export function isEthiopianLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

export function daysInEthiopianMonth(year: number, month: number): number {
  if (month < 1 || month > 13) throw new RangeError(`Month must be 1-13, got ${month}`);
  if (month < 13) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function isValidEthiopianDate({ year, month, day }: EthiopianDate): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 13 &&
    day >= 1 &&
    day <= daysInEthiopianMonth(year, month)
  );
}

function ethiopianToJdn({ year, month, day }: EthiopianDate): number {
  return EPOCH + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day - 1;
}

function jdnToEthiopian(jdn: number): EthiopianDate {
  const offset = jdn - EPOCH;
  const cycle = Math.floor(offset / 1461);
  const r = offset - cycle * 1461;
  // Each 4-year cycle is 365, 365, 366 (leap, year % 4 === 3), 365 days long.
  const yearInCycle = r < 730 ? Math.floor(r / 365) : r < 1096 ? 2 : 3;
  const n = r - [0, 365, 730, 1096][yearInCycle]!;
  return { year: 4 * cycle + yearInCycle + 1, month: Math.floor(n / 30) + 1, day: (n % 30) + 1 };
}

/** Convert an instant to the EC date in Addis Ababa. */
export function toEthiopian(instant: Date): EthiopianDate {
  const local = instant.getTime() + ADDIS_OFFSET_MS;
  return jdnToEthiopian(Math.floor(local / MS_PER_DAY) + UNIX_EPOCH_JDN);
}

/** Convert an EC date to the Gregorian calendar date, as a Date at 00:00 UTC of that day. */
export function toGregorian(date: EthiopianDate): Date {
  if (!isValidEthiopianDate(date)) throw new RangeError(`Invalid Ethiopian date: ${JSON.stringify(date)}`);
  return new Date((ethiopianToJdn(date) - UNIX_EPOCH_JDN) * MS_PER_DAY);
}

export function formatEthiopianDate(date: EthiopianDate, locale: "am" | "en" = "am"): string {
  const months = locale === "am" ? MONTHS_AM : MONTHS_EN;
  return `${months[date.month - 1]} ${date.day}, ${date.year}`;
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

const DAY_PARTS_AM: Record<DayPart, string> = {
  morning: "ጠዋት",
  afternoon: "ከሰዓት",
  evening: "ማታ",
  night: "ሌሊት",
};

/**
 * Ethiopian local time: the 12-hour cycle starts at 6:00 (sunrise),
 * so 7:00 AM is 1:00 in the morning and 6:00 PM is 12:00 in the evening.
 */
export function toEthiopianTime(instant: Date): { hour: number; minute: number; part: DayPart } {
  const local = new Date(instant.getTime() + ADDIS_OFFSET_MS);
  const h = local.getUTCHours();
  const hour = ((h + 6) % 12) || 12;
  const part: DayPart = h >= 6 && h < 12 ? "morning" : h >= 12 && h < 18 ? "afternoon" : h >= 18 ? "evening" : "night";
  return { hour, minute: local.getUTCMinutes(), part };
}

export function formatEthiopianTime(instant: Date, locale: "am" | "en" = "am"): string {
  const { hour, minute, part } = toEthiopianTime(instant);
  const time = `${hour}:${String(minute).padStart(2, "0")}`;
  return locale === "am" ? `${DAY_PARTS_AM[part]} ${time}` : `${time} (${part})`;
}
