import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { signUpWithEmailAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SignupPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  return (
    <AuthShell locale={locale} title={t.auth.signupTitle} tagline={t.app.tagline}>
      <FormError t={t} code={param(search.error)} />
      <form action={signUpWithEmailAction} className="space-y-4">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="fullName" className="label">{t.auth.fullName}</label>
          <input id="fullName" name="fullName" autoComplete="name" required className="input" />
        </div>
        <div>
          <label htmlFor="email" className="label">{t.auth.email}</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div>
          <label htmlFor="password" className="label">{t.auth.password}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="input" />
          <p className="hint">{t.auth.passwordHint}</p>
        </div>
        <button className="btn">{t.auth.signup}</button>
      </form>
      <p className="mt-5 text-center text-sm text-stone-500">
        {t.auth.haveAccount}{" "}
        <Link href={`/${locale}/login`} className="font-semibold text-brand-600">{t.auth.login}</Link>
      </p>
      <p className="mt-2 text-center text-sm text-stone-500">
        <Link href={`/${locale}/login`} className="text-brand-600">{t.auth.usePhone}</Link>
      </p>
    </AuthShell>
  );
}
