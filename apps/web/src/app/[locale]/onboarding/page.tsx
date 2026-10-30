import Link from "next/link";
import { listMemberships } from "@tapserve/db";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";
import { createBusinessAction, saveTaxAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;
const TYPES = ["restaurant", "cafe", "bar", "hotel", "hotel_restaurant"] as const;

export default async function OnboardingPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const session = await requireUser(locale);
  const hasBusiness = (await listMemberships(db(), session.user.id)).length > 0;
  const requested = param(search.step);
  const step = !hasBusiness ? "business" : requested === "done" ? "done" : "tax";
  const steps = [t.onboarding.stepBusiness, t.onboarding.stepTax, t.onboarding.stepDone];
  const current = step === "business" ? 0 : step === "tax" ? 1 : 2;
  const o = t.onboarding;

  return (
    <AuthShell locale={locale} title={o.title} tagline={steps.map((s, i) => `${i + 1}. ${s}`).join("  ·  ")}>
      <ol className="mb-5 flex gap-2" aria-label={o.title}>
        {steps.map((s, i) => (
          <li key={s} className={`h-1.5 flex-1 rounded-full ${i <= current ? "bg-brand-500" : "bg-stone-200 dark:bg-stone-700"}`}>
            <span className="sr-only">{s}</span>
          </li>
        ))}
      </ol>
      <FormError t={t} code={param(search.error)} />

      {step === "business" && (
        <form action={createBusinessAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <div>
            <label htmlFor="name" className="label">{o.businessName}</label>
            <input id="name" name="name" required maxLength={120} className="input" />
          </div>
          <fieldset>
            <legend className="label">{o.businessType}</legend>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((type, i) => (
                <label key={type} className="flex min-h-12 items-center gap-2 rounded-xl border border-stone-300 px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:border-stone-700 dark:has-[:checked]:bg-brand-700/20">
                  <input type="radio" name="businessType" value={type} defaultChecked={i === 0} className="accent-brand-600" />
                  <span className="text-sm">{o.types[type]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="city" className="label">{o.city}</label>
              <input id="city" name="city" defaultValue="Addis Ababa" className="input" />
            </div>
            <div>
              <label htmlFor="subCity" className="label">{o.subCity}</label>
              <input id="subCity" name="subCity" className="input" />
            </div>
          </div>
          <div>
            <label htmlFor="tin" className="label">{o.tin} <span className="font-normal text-stone-400">({t.common.optional})</span></label>
            <input id="tin" name="tin" inputMode="numeric" pattern="\d{10}" maxLength={10} className="input" />
            <p className="hint">{o.tinHint}</p>
          </div>
          <div>
            <label htmlFor="branchName" className="label">{o.branchName}</label>
            <input id="branchName" name="branchName" defaultValue={o.branchNameDefault} className="input" />
          </div>
          <button className="btn">{t.common.continue}</button>
        </form>
      )}

      {step === "tax" && (
        <form action={saveTaxAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <fieldset className="space-y-2">
            <legend className="label">{o.taxType}</legend>
            {([["VAT", o.taxVat], ["TOT", o.taxTot], ["NONE", o.taxNone]] as const).map(([value, label]) => (
              <label key={value} className="flex min-h-12 items-center gap-3 rounded-xl border border-stone-300 px-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:border-stone-700 dark:has-[:checked]:bg-brand-700/20">
                <input type="radio" name="taxType" value={value} defaultChecked={value === "VAT"} className="accent-brand-600" />
                {label}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="taxRate" className="label">{o.taxRate}</label>
            <input id="taxRate" name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={15} className="input" />
          </div>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="pricesIncludeTax" defaultChecked className="h-5 w-5 accent-brand-600" />
            {o.pricesIncludeTax}
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="serviceChargeEnabled" className="h-5 w-5 accent-brand-600" />
            {o.serviceCharge}
          </label>
          <div>
            <label htmlFor="serviceChargeRate" className="label">{o.serviceChargeRate}</label>
            <input id="serviceChargeRate" name="serviceChargeRate" type="number" min={0} max={100} step="0.01" defaultValue={10} className="input" />
          </div>
          <button className="btn">{t.common.continue}</button>
        </form>
      )}

      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-4xl" aria-hidden>✓</p>
          <h2 className="text-xl font-semibold">{o.doneTitle}</h2>
          <p className="text-stone-500">{o.doneBody}</p>
          <Link href={`/${locale}/dashboard`} className="btn">{o.goToDashboard}</Link>
        </div>
      )}
    </AuthShell>
  );
}
