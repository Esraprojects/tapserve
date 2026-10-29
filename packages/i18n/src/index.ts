import { am } from "./am";
import { en, type Dictionary } from "./en";

export const LOCALES = ["am", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "am";
export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = { am, en };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "am" || value === "en";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Replace {name} placeholders. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
