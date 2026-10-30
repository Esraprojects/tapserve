import { describe, expect, it } from "vitest";
import {
  formatEthiopianDate,
  formatEthiopianTime,
  isEthiopianLeapYear,
  isValidEthiopianDate,
  toEthiopian,
  toEthiopianTime,
  toGregorian,
} from "./index";

const at = (iso: string) => new Date(iso);

describe("Ethiopian calendar", () => {
  it.each([
    // Ethiopian New Year falls on 12 September before a Gregorian leap year, otherwise 11 September.
    ["2023-09-12T09:00:00Z", { year: 2016, month: 1, day: 1 }],
    ["2024-09-11T09:00:00Z", { year: 2017, month: 1, day: 1 }],
    ["2025-09-11T09:00:00Z", { year: 2018, month: 1, day: 1 }],
    // Christmas (Genna) is 29 Tahsas.
    ["2025-01-07T09:00:00Z", { year: 2017, month: 4, day: 29 }],
    // Pagume 6 exists in leap year 2015.
    ["2023-09-11T09:00:00Z", { year: 2015, month: 13, day: 6 }],
    ["2025-09-10T09:00:00Z", { year: 2017, month: 13, day: 5 }],
  ])("converts %s", (iso, expected) => {
    expect(toEthiopian(at(iso))).toEqual(expected);
  });

  it("uses Addis Ababa time, not UTC, to pick the day", () => {
    // 22:30 UTC on 10 Sept 2024 is already 01:30 on 11 Sept in Addis Ababa: New Year 2017.
    expect(toEthiopian(at("2024-09-10T22:30:00Z"))).toEqual({ year: 2017, month: 1, day: 1 });
  });

  it("round-trips every day across several years", () => {
    const start = Date.UTC(2020, 0, 1);
    for (let i = 0; i < 365 * 6; i++) {
      const day = new Date(start + i * 86_400_000);
      expect(toGregorian(toEthiopian(day)).getTime()).toBe(day.getTime());
    }
  });

  it("handles leap years and Pagume", () => {
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(isValidEthiopianDate({ year: 2015, month: 13, day: 6 })).toBe(true);
    expect(isValidEthiopianDate({ year: 2016, month: 13, day: 6 })).toBe(false);
    expect(() => toGregorian({ year: 2016, month: 13, day: 6 })).toThrow();
  });

  it("formats dates in Amharic and English", () => {
    const date = { year: 2017, month: 1, day: 1 };
    expect(formatEthiopianDate(date)).toBe("መስከረም 1, 2017");
    expect(formatEthiopianDate(date, "en")).toBe("Meskerem 1, 2017");
  });

  it("shows Ethiopian local time", () => {
    expect(toEthiopianTime(at("2024-01-01T04:00:00Z"))).toEqual({ hour: 1, minute: 0, part: "morning" }); // 7:00 AM
    expect(toEthiopianTime(at("2024-01-01T15:00:00Z"))).toEqual({ hour: 12, minute: 0, part: "evening" }); // 6:00 PM
    expect(toEthiopianTime(at("2024-01-01T21:15:00Z")).hour).toBe(6); // 00:15 -> 6:15 at night
    expect(formatEthiopianTime(at("2024-01-01T05:30:00Z"))).toBe("ጠዋት 2:30");
  });
});
