import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@tapserve/i18n";

export type LocaleParams = Promise<{ locale: string }>;

export async function resolveLocale(params: LocaleParams): Promise<{ locale: Locale; t: ReturnType<typeof getDictionary> }> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, t: getDictionary(locale) };
}

/** Read a single string search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
