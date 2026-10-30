import { describe, expect, it } from "vitest";
import { computeBill, type TaxSettings } from "./bill";

const vatInclusive: TaxSettings = {
  taxType: "VAT",
  taxRateBp: 1500,
  pricesIncludeTax: true,
  serviceChargeEnabled: false,
  serviceChargeRateBp: 1000,
};

describe("computeBill", () => {
  it("splits VAT out of tax-inclusive prices", () => {
    expect(computeBill([{ unitPrice: 11_500, quantity: 1 }], vatInclusive)).toEqual({
      subtotal: 10_000,
      serviceCharge: 0,
      tax: 1_500,
      total: 11_500,
    });
  });

  it("adds service charge and VAT on tax-exclusive prices", () => {
    const settings = { ...vatInclusive, pricesIncludeTax: false, serviceChargeEnabled: true };
    expect(computeBill([{ unitPrice: 5_000, quantity: 2 }], settings)).toEqual({
      subtotal: 10_000,
      serviceCharge: 1_000,
      tax: 1_650,
      total: 12_650,
    });
  });

  it("gives the same total for inclusive prices with service charge", () => {
    const settings = { ...vatInclusive, serviceChargeEnabled: true };
    expect(computeBill([{ unitPrice: 11_500, quantity: 1 }], settings).total).toBe(12_650);
  });

  it("supports TOT businesses", () => {
    const settings: TaxSettings = { ...vatInclusive, taxType: "TOT", taxRateBp: 200, pricesIncludeTax: false };
    expect(computeBill([{ unitPrice: 10_000, quantity: 1 }], settings).tax).toBe(200);
  });

  it("rounds once per bill, half up", () => {
    // 3 x 10.00 birr inclusive: net 26.087 -> 26.09, VAT 3.91
    const totals = computeBill([{ unitPrice: 1_000, quantity: 3 }], vatInclusive);
    expect(totals).toMatchObject({ subtotal: 2_609, tax: 391, total: 3_000 });
  });

  it("applies line discounts before tax", () => {
    const totals = computeBill([{ unitPrice: 11_500, quantity: 2, discount: 11_500 }], vatInclusive);
    expect(totals.total).toBe(11_500);
  });

  it("rejects bad input", () => {
    expect(() => computeBill([{ unitPrice: 100, quantity: 0 }], vatInclusive)).toThrow();
    expect(() => computeBill([{ unitPrice: 100.5, quantity: 1 }], vatInclusive)).toThrow();
    expect(() => computeBill([{ unitPrice: 100, quantity: 1, discount: 200 }], vatInclusive)).toThrow();
  });
});
