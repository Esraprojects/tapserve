import { format } from "@tapserve/i18n";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { requestOtpAction, verifyOtpAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const phone = param(search.phone) ?? "";
  return (
    <AuthShell locale={locale} title={t.auth.verifyTitle} tagline={format(t.auth.verifySent, { phone })}>
      <FormError t={t} code={param(search.error)} />
      <form action={verifyOtpAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="phone" value={phone} />
        <div>
          <label htmlFor="code" className="label">{t.auth.code}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required
            className="input text-center text-2xl tracking-[0.5em]" />
        </div>
        <button className="btn">{t.auth.verify}</button>
      </form>
      <form action={requestOtpAction} className="mt-4 text-center">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="phone" value={phone} />
        <button className="text-sm font-semibold text-brand-600">{t.auth.resend}</button>
      </form>
    </AuthShell>
  );
}
