import Link from "next/link";
import { hasOwnPin, listPinUsers } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { setPinAction, switchUserAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Shared-device screen: tap your name, enter your PIN. Also where you set your own PIN. */
export default async function SwitchUserPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, session } = await appContext(locale);
  const [people, ownPin] = await Promise.all([listPinUsers(db(), actor), hasOwnPin(db(), actor)]);
  const selected = people.find((p) => p.membership_id === param(search.m) && p.has_pin);
  const p = t.pin;
  const roleName = (r: string) => (t.roles as Record<string, string>)[r] ?? r;
  const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title={p.title} subtitle={p.hint} />
      <FormError t={t} code={param(search.error)} />

      {selected ? (
        <form action={switchUserAction} className="card mx-auto max-w-sm space-y-4 text-center">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="membershipId" value={selected.membership_id} />
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-800 dark:bg-brand-700/30 dark:text-brand-100">
            {initials(selected.full_name)}
          </div>
          <p className="text-lg font-semibold">{selected.full_name}</p>
          <label className="label" htmlFor="pin">{p.enter}</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} required autoFocus
            autoComplete="off" className="input text-center text-2xl tracking-[0.5em]" />
          <button className="btn">{p.switch}</button>
          <Link href={`/${locale}/switch`} className="block text-sm text-stone-500">{p.back}</Link>
        </form>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {people.map((person) => {
            const me = person.user_id === session.user.id;
            const body = (
              <>
                <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800 dark:bg-brand-700/30 dark:text-brand-100">
                  {initials(person.full_name)}
                </span>
                <span className="block font-medium">{person.full_name}</span>
                <span className="block text-xs text-stone-500">{roleName(person.role_name)}{person.has_pin ? "" : ` · ${p.noPin}`}</span>
              </>
            );
            return (
              <li key={person.membership_id}>
                {person.has_pin && !me ? (
                  <Link href={`/${locale}/switch?m=${person.membership_id}`} className="card block py-4 text-center hover:border-brand-500">{body}</Link>
                ) : (
                  <div className="card py-4 text-center opacity-60">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form action={setPinAction} className="card mx-auto mt-8 max-w-sm space-y-2">
        <h2 className="font-semibold">{p.setTitle}{ownPin ? ` · ✓ ${p.hasPin}` : ""}</h2>
        <p className="text-sm text-stone-500">{p.setHint}</p>
        {param(search.pin) === "saved" && <p className="text-sm text-brand-700" role="status">✓ {p.saved}</p>}
        <input type="hidden" name="locale" value={locale} />
        <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} required autoComplete="new-password"
          aria-label={p.newPin} placeholder={p.newPin} className="input text-center tracking-[0.4em]" />
        <button className="btn-secondary w-full">{p.save}</button>
      </form>
    </main>
  );
}
