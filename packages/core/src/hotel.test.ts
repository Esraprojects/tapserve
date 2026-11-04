import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_SETTINGS } from "./bill";
import { isWeekendNight, nightlyRate, roomCharge, stayNights, toUsdCents } from "./hotel";

const type = {
  local_rate_santim: 150_000,
  foreign_rate_santim: 300_000,
  weekend_local_rate_santim: 180_000,
  weekend_foreign_rate_santim: null,
};

describe("hotel rates", () => {
  it("lists the nights of a stay, departure excluded", () => {
    expect(stayNights("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(stayNights("2026-10-30", "2026-10-30")).toEqual([]);
  });

  it("treats Friday and Saturday nights as the weekend", () => {
    expect(isWeekendNight("2026-10-30")).toBe(true); // Friday
    expect(isWeekendNight("2026-10-31")).toBe(true); // Saturday
    expect(isWeekendNight("2026-11-01")).toBe(false); // Sunday
  });

  it("uses weekday, weekend, foreigner and agreed rates", () => {
    expect(nightlyRate(type, [], "2026-11-02", "local")).toBe(150_000);
    expect(nightlyRate(type, [], "2026-10-30", "local")).toBe(180_000);
    // No weekend foreigner rate set, so the normal foreigner rate applies.
    expect(nightlyRate(type, [], "2026-10-30", "foreign")).toBe(300_000);
    expect(nightlyRate(type, [], "2026-10-30", "foreign", 250_000)).toBe(250_000);
  });

  it("lets the latest season win over weekend rates", () => {
    const seasons = [
      { starts_on: "2026-12-20", ends_on: "2027-01-31", local_rate_santim: 200_000, foreign_rate_santim: 400_000 },
      { starts_on: "2027-01-17", ends_on: "2027-01-20", local_rate_santim: 250_000, foreign_rate_santim: 500_000 },
    ];
    expect(nightlyRate(type, seasons, "2026-12-25", "local")).toBe(200_000);
    expect(nightlyRate(type, seasons, "2027-01-19", "foreign")).toBe(500_000);
    expect(nightlyRate(type, seasons, "2027-02-01", "local")).toBe(150_000);
  });

  it("splits VAT out of an inclusive rate, or adds it", () => {
    expect(roomCharge(115_000, DEFAULT_TAX_SETTINGS)).toEqual({ amount: 115_000, tax: 15_000 });
    expect(roomCharge(100_000, { ...DEFAULT_TAX_SETTINGS, pricesIncludeTax: false })).toEqual({ amount: 115_000, tax: 15_000 });
    expect(roomCharge(100_000, { ...DEFAULT_TAX_SETTINGS, serviceChargeEnabled: true })).toEqual({ amount: 100_000, tax: 13_043 });
  });

  it("converts to dollars at the business's rate", () => {
    expect(toUsdCents(1_550_000, 15_500)).toBe(10_000);
  });
});
