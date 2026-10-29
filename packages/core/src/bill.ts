import { applyRate, assertSantim, divRound, type Santim } from "./money";

export type TaxType = "VAT" | "TOT" | "NONE";

export interface TaxSettings {
  /** VAT for VAT-registered businesses, TOT otherwise. */
  taxType: TaxType;
  /** Basis points: 1500 = 15% VAT, 200 = 2% TOT. */
  taxRateBp: number;
  /** When true, menu prices already include the tax. */
  pricesIncludeTax: boolean;
  serviceChargeEnabled: boolean;
  /** Basis points: 1000 = 10%. */
  serviceChargeRateBp: number;
}

export interface BillLine {
  unitPrice: Santim;
  quantity: number;
  /** Discount for the whole line, in santim. */
  discount?: Santim;
}

export interface BillTotals {
  /** Sum of lines after discounts, before service charge and tax (net of tax). */
  subtotal: Santim;
  serviceCharge: Santim;
  /** Tax amount (VAT or TOT) on subtotal plus service charge. */
  tax: Santim;
  total: Santim;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  taxType: "VAT",
  taxRateBp: 1500,
  pricesIncludeTax: true,
  serviceChargeEnabled: false,
  serviceChargeRateBp: 1000,
};

/**
 * Compute a bill. Rounding happens once per bill (not per line), half up, to the santim.
 * Service charge is charged on the net subtotal, and tax applies to subtotal plus service charge.
 */
export function computeBill(lines: BillLine[], settings: TaxSettings): BillTotals {
  let gross = 0;
  for (const line of lines) {
    assertSantim(line.unitPrice);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(`Quantity must be a positive whole number, got ${line.quantity}`);
    }
    const discount = line.discount ?? 0;
    assertSantim(discount);
    const lineTotal = line.unitPrice * line.quantity;
    if (discount < 0 || discount > lineTotal) {
      throw new RangeError("Discount must be between zero and the line total");
    }
    gross += lineTotal - discount;
  }

  const rate = settings.taxType === "NONE" ? 0 : settings.taxRateBp;
  const subtotal = settings.pricesIncludeTax ? divRound(gross * 10_000, 10_000 + rate) : gross;
  const serviceCharge = settings.serviceChargeEnabled
    ? applyRate(subtotal, settings.serviceChargeRateBp)
    : 0;
  const tax = settings.pricesIncludeTax
    ? gross - subtotal + applyRate(serviceCharge, rate)
    : applyRate(subtotal + serviceCharge, rate);

  return { subtotal, serviceCharge, tax, total: subtotal + serviceCharge + tax };
}
