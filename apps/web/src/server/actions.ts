import { redirect } from "next/navigation";
import { z } from "zod";
import { birrToSantim } from "@tapserve/core";
import { DomainError } from "@tapserve/db";
import { isLocale, type Locale } from "@tapserve/i18n";

export function localeOf(form: FormData): Locale {
  const value = form.get("locale");
  return typeof value === "string" && isLocale(value) ? value : "am";
}

export function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/**
 * Run a form action. Known errors come back to the page as ?error=code; anything else is logged.
 * Redirects to `success` (or back to `back`) when done.
 */
export async function runAction(
  back: string,
  fn: () => Promise<string | void>,
): Promise<never> {
  let target: string;
  try {
    const next = await fn();
    target = next ?? back;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // Next.js redirect/notFound
    const code =
      err instanceof DomainError ? err.code
      : err instanceof z.ZodError ? "invalid_input"
      : err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message
      : (console.error(err), "unknown");
    target = withParam(back, "error", code);
  }
  redirect(target);
}

/** A birr amount from a form field, in santim. Empty counts as zero. */
export function birrField(form: FormData, key: string): number {
  try {
    return birrToSantim(str(form, key) || "0");
  } catch {
    throw new DomainError("invalid_amount");
  }
}

/** A decimal quantity from a form field; null when left empty. */
export function quantityField(form: FormData, key: string): number | null {
  const raw = str(form, key).replace(",", ".");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new DomainError("invalid_quantity");
  return value;
}
