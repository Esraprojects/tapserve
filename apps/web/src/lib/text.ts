import { formatETB } from "@tapserve/core";
import { format, type Dictionary, type Locale } from "@tapserve/i18n";

/** Pick the name in the user's language, falling back to the other one. */
export function pick(locale: Locale, am: string, en: string): string {
  return locale === "am" ? am || en : en || am;
}

export function money(locale: Locale, santim: number): string {
  return formatETB(santim, locale);
}

/** Error message for an ?error= code, from domain or form errors. */
export function errorMessage(t: Dictionary, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const all = { ...t.errors, ...t.domain } as Record<string, string>;
  return all[code] ?? t.errors.unknown;
}

export { format };

/** Stock quantities: up to three decimals, no trailing zeros. */
export function quantity(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale === "am" ? "am-ET" : "en-US", { maximumFractionDigits: 3 }).format(value);
}
