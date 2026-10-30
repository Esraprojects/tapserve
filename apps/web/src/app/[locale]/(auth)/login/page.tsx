import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { loginWithEmailAction, requestOtpAction } from "../actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const method = param(search.method) === "email" ? "email" : "phone";
  const tab = (active: boolean) =>
    `flex-1 rounded-lg py-2 text-center text-sm font-medium ${active ? "bg-white shadow-sm dark:bg-stone-700" : "text-stone-500"}`;

  return (
    <AuthShell locale={locale} title={t.auth.loginTitle} tagline={t.app.tagline}>
      <div className="mb-5 flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
        <Link href={`/${locale}/login`} className={tab(method === "phone")}>{t.auth.usePhone}</Link>
        <Link href={`/${locale}/login?method=email`} className={tab(method === "email")}>{t.auth.useEmail}</Link>
      </div>
      <FormError t={t} code={param(search.error)} />
      {method === "phone" ? (
        <form action={requestOtpAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <div>
            <label htmlFor="phone" className="label">{t.auth.phone}</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="input" placeholder="0911223344" />
            <p className="hint">{t.auth.phoneHint}</p>
          </div>
          <button className="btn">{t.auth.sendCode}</button>
        </form>
      ) : (
        <form action={loginWithEmailAction} className="space-y-4">
          <input type="hidden" name="locale" value={locale} />
          <div>
            <label htmlFor="email" className="label">{t.auth.email}</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">{t.auth.password}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
          <button className="btn">{t.auth.login}</button>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-stone-500">
        {t.auth.noAccount}{" "}
        <Link href={`/${locale}/signup`} className="font-semibold text-brand-600">{t.auth.signup}</Link>
      </p>
    </AuthShell>
  );
}
