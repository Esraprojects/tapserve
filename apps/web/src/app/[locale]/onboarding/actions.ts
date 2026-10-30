"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { BUSINESS_TYPES, completeOnboarding, onboardBusiness, saveTaxSettings, setActiveTenant } from "@tapserve/db";
import { isLocale, type Locale } from "@tapserve/i18n";
import { db } from "@/server/db";
import { requireTenant, requireUser, sessionToken } from "@/server/session";

function localeOf(form: FormData): Locale {
  const value = form.get("locale");
  return typeof value === "string" && isLocale(value) ? value : "am";
}

const businessForm = z.object({
  name: z.string().trim().min(1).max(120),
  businessType: z.enum(BUSINESS_TYPES),
  city: z.string().trim().max(80).default(""),
  subCity: z.string().trim().max(80).default(""),
  tin: z.string().trim().regex(/^(\d{10})?$/).optional(),
  branchName: z.string().trim().max(80).default(""),
});

export async function createBusinessAction(form: FormData) {
  const locale = localeOf(form);
  const session = await requireUser(locale);
  const parsed = businessForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`/${locale}/onboarding?error=invalid_input`);
  const tenantId = await onboardBusiness(db(), session.user.id, { ...parsed.data, locale });
  const token = await sessionToken();
  if (token) await setActiveTenant(db(), token, tenantId);
  redirect(`/${locale}/onboarding?step=tax`);
}

const percent = z.coerce.number().min(0).max(100).transform((p) => Math.round(p * 100));
const taxForm = z.object({
  taxType: z.enum(["VAT", "TOT", "NONE"]),
  taxRate: percent,
  pricesIncludeTax: z.literal("on").optional(),
  serviceChargeEnabled: z.literal("on").optional(),
  serviceChargeRate: percent,
});

export async function saveTaxAction(form: FormData) {
  const locale = localeOf(form);
  const { session, access } = await requireTenant(locale);
  if (!access.permissions.includes("settings.manage")) redirect(`/${locale}/dashboard`);
  const parsed = taxForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`/${locale}/onboarding?step=tax&error=invalid_input`);
  const ctx = { tenantId: access.tenantId, userId: session.user.id };
  await saveTaxSettings(db(), ctx, {
    taxType: parsed.data.taxType,
    taxRateBp: parsed.data.taxType === "NONE" ? 0 : parsed.data.taxRate,
    pricesIncludeTax: parsed.data.pricesIncludeTax === "on",
    serviceChargeEnabled: parsed.data.serviceChargeEnabled === "on",
    serviceChargeRateBp: parsed.data.serviceChargeRate,
  });
  await completeOnboarding(db(), ctx);
  redirect(`/${locale}/onboarding?step=done`);
}
