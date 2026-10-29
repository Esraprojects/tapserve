import { describe, expect, it } from "vitest";
import { applyRate, birrToSantim, divRound, formatETB } from "./money";

describe("money", () => {
  it("rounds half up", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(-5, 2)).toBe(-3);
  });

  it("applies basis-point rates", () => {
    expect(applyRate(10_000, 1500)).toBe(1500);
    expect(applyRate(333, 1500)).toBe(50); // 49.95 -> 50
  });

  it("parses birr strings without floating point errors", () => {
    expect(birrToSantim("1,234.5")).toBe(123_450);
    expect(birrToSantim("0.1")).toBe(10);
    expect(birrToSantim(19.99)).toBe(1999);
    expect(() => birrToSantim("12.345")).toThrow();
  });

  it("formats birr in English and Amharic", () => {
    expect(formatETB(123_450)).toBe("ETB 1,234.50");
    expect(formatETB(5, "am")).toBe("0.05 ብር");
    expect(() => formatETB(1.5)).toThrow();
  });
});
