import { listNightAudits } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { addisToday, bothCalendars } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { nightAuditAction } from "../actions";
import { HotelTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function NightAuditPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can } = await appContext(locale, "hotel.frontdesk");
  const audits = await listNightAudits(db(), actor, branchId);
  const today = addisToday();
  const h = t.hotel;
  const done = param(search.done);
  const time = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { timeStyle: "short", dateStyle: "short", timeZone: "Africa/Addis_Ababa" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={h.title} />
      <HotelTabs locale={locale} t={t} active="audit" canManage={can("hotel.manage")} />
      <FormError t={t} code={param(search.error)} />
      {done && <p className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-700/20 dark:text-brand-100" role="status">✓ {done}</p>}

      <form action={nightAuditAction} className="card mb-6 space-y-2">
        <h2 className="font-semibold">{h.auditTitle}</h2>
        <p className="text-sm text-stone-500">{h.auditHint}</p>
        <input type="hidden" name="locale" value={locale} />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="date">{h.businessDate}</label>
            <input id="date" name="date" type="date" defaultValue={today} max={today} required className="input py-2" />
          </div>
          <button className="btn">{h.runAudit}</button>
        </div>
      </form>

      <h2 className="mb-2 font-semibold">{h.auditHistory}</h2>
      {audits.length === 0 ? <p className="card text-sm text-stone-500">{h.notAudited}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left dark:bg-stone-800">
              <tr>
                <th className="px-3 py-2">{h.businessDate}</th>
                <th className="px-3 py-2 text-right">{h.roomsCharged}</th>
                <th className="px-3 py-2 text-right">{h.roomRevenue}</th>
                <th className="px-3 py-2 text-right">{h.noShows}</th>
                <th className="px-3 py-2">{h.closedBy}</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.business_date} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="px-3 py-2">{bothCalendars(a.business_date, locale)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.rooms_charged}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(locale, a.room_revenue_santim)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.no_shows}</td>
                  <td className="px-3 py-2">{a.ran_by}<span className="block text-xs text-stone-500">{time.format(a.ran_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
