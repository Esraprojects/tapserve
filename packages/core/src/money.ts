/**
 * Money is always an integer number of santim (1 birr = 100 santim).
 * Never store or add birr as floating point.
 */
export type Santim = number;

export function assertSantim(value: number): asserts value is Santim {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a whole number of santim, got ${value}`);
  }
}

/** Divide two non-negative integers and round half up. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError("denominator must be positive");
  if (numerator < 0) return -divRound(-numerator, denominator);
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Apply a rate in basis points (1500 = 15%) and round half up to the santim. */
export function applyRate(amount: Santim, rateBp: number): Santim {
  return divRound(amount * rateBp, 10_000);
}

export function birrToSantim(birr: string | number): Santim {
  const text = typeof birr === "number" ? birr.toFixed(2) : birr.trim().replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new RangeError(`Not a valid birr amount: ${birr}`);
  const [, sign, whole, frac = ""] = match;
  const santim = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign ? -santim : santim;
}

export function formatETB(amount: Santim, locale: "am" | "en" = "en"): string {
  assertSantim(amount);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  const number = `${negative ? "-" : ""}${whole}.${frac}`;
  return locale === "am" ? `${number} ብር` : `ETB ${number}`;
}
