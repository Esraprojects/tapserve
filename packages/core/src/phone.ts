/**
 * Ethiopian mobile numbers: 09xxxxxxxx (Ethio telecom) or 07xxxxxxxx (Safaricom),
 * also written as +2519xxxxxxxx, 2519xxxxxxxx or 9xxxxxxxx.
 * Returns the E.164 form (+2519xxxxxxxx) or null when the number is not valid.
 */
export function normalizeEthiopianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  const match = /^(?:\+?251|0)?([79]\d{8})$/.exec(digits);
  return match ? `+251${match[1]}` : null;
}

export function isEthiopianPhone(input: string): boolean {
  return normalizeEthiopianPhone(input) !== null;
}
