import { SYSTEM_ROLES } from "@tapserve/core";
import { listStaff } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { addStaffAction, clearPinAction, setStaffStatusAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function StaffPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, can } = await appContext(locale, "staff.manage");
  const staff = await listStaff(db(), actor);
  const roleName = (r: string) => (t.roles as Record<string, string>)[r] ?? r;
  const roles = SYSTEM_ROLES.filter((r) => r !== "Owner" || can("roles.manage"));

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={t.staff.title} />
      <FormError t={t} code={param(search.error)} />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <ul className="card divide-y divide-stone-100 p-0 dark:divide-stone-800">
          {staff.map((m) => (
            <li key={m.membership_id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.full_name || m.phone || m.email}</p>
                <p className="text-sm text-stone-500">{roleName(m.role_name)} · {m.phone ?? m.email}{m.has_pin ? ` · ${t.pin.hasPin}` : ""}</p>
              </div>
              {m.has_pin && m.user_id !== actor.userId && (
                <form action={clearPinAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="membershipId" value={m.membership_id} />
                  <button className="min-h-10 px-2 text-sm text-stone-500 underline">{t.pin.clear}</button>
                </form>
              )}
              {m.status === "disabled" && <span className="text-sm text-stone-500">{t.staff.disabled}</span>}
              {m.role_name !== "Owner" && m.user_id !== actor.userId && (
                <form action={setStaffStatusAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="membershipId" value={m.membership_id} />
                  <input type="hidden" name="status" value={m.status === "active" ? "disabled" : "active"} />
                  <button className="btn-secondary min-h-10 px-3 text-sm">{m.status === "active" ? t.staff.disable : t.staff.enable}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={addStaffAction} className="card space-y-3">
          <h2 className="font-semibold">{t.staff.add}</h2>
          <input type="hidden" name="locale" value={locale} />
          <input name="fullName" required placeholder={t.staff.name} aria-label={t.staff.name} className="input" />
          <input name="phone" type="tel" inputMode="tel" required placeholder="09xxxxxxxx" aria-label={t.staff.phone} className="input" />
          <select name="role" className="input" aria-label={t.staff.role} defaultValue="Waiter">
            {roles.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
          </select>
          <p className="hint">{t.staff.loginHint}</p>
          <button className="btn">{t.staff.add}</button>
        </form>
      </div>
    </main>
  );
}
