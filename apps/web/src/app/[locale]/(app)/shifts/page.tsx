import { currentShift, listShifts, shiftSummary } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { cashMovementAction, closeShiftAction, openShiftAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ShiftsPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "shift.manage");
  const shift = await currentShift(db(), actor, branchId);
  const summary = shift ? await shiftSummary(db(), actor, shift.id) : null;
  const closedId = param(search.closed);
  const closed = closedId ? await shiftSummary(db(), actor, closedId) : null;
  const history = await listShifts(db(), actor, branchId, 15);
  const dt = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" });
  const s = t.shift;
  const varianceLabel = (v: number) => (v === 0 ? s.balanced : v < 0 ? s.short : s.over);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <PageHeader title={s.title} />
      <FormError t={t} code={param(search.error)} />

      {closed && closed.shift.variance_santim !== null && (
        <div className={`mb-6 rounded-2xl p-4 ${closed.shift.variance_santim === 0 ? "bg-brand-50 dark:bg-brand-700/20" : "bg-amber-50 dark:bg-amber-900/30"}`} role="status">
          <p className="font-semibold">{format(s.closedSummary, { expected: money(locale, closed.shift.expected_cash_santim ?? 0), counted: money(locale, closed.shift.counted_cash_santim ?? 0) })}</p>
          <p className="mt-1">{s.variance}: {money(locale, closed.shift.variance_santim)} ({varianceLabel(closed.shift.variance_santim)})</p>
        </div>
      )}

      {!shift || !summary ? (
        <form action={openShiftAction} className="card max-w-md space-y-3">
          <p className="text-stone-500">{s.none}</p>
          <input type="hidden" name="locale" value={locale} />
          <label className="label" htmlFor="float">{s.openingFloat}</label>
          <input id="float" name="float" inputMode="decimal" defaultValue="0" className="input" />
          <button className="btn">{s.open}</button>
        </form>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="font-semibold">{s.current}</h2>
            <p className="text-sm text-stone-500">{s.openedAt}: {dt.format(shift.opened_at)}</p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>{s.openingFloat}</dt><dd className="tabular-nums">{money(locale, shift.opening_float_santim)}</dd></div>
              {summary.byMethod.map((m) => (
                <div key={m.code} className="flex justify-between"><dt>{pick(locale, m.name_am, m.name_en)} ({m.count})</dt><dd className="tabular-nums">{money(locale, m.total_santim)}</dd></div>
              ))}
              {summary.payIns > 0 && <div className="flex justify-between"><dt>{s.payIn}</dt><dd className="tabular-nums">{money(locale, summary.payIns)}</dd></div>}
              {summary.payOuts > 0 && <div className="flex justify-between"><dt>{s.payOut}</dt><dd className="tabular-nums">−{money(locale, summary.payOuts)}</dd></div>}
              <div className="flex justify-between border-t border-stone-200 pt-2 text-base font-semibold dark:border-stone-800">
                <dt>{s.expectedCash}</dt><dd className="tabular-nums">{money(locale, summary.expectedCash)}</dd>
              </div>
            </dl>
          </section>

          <div className="space-y-4">
            <form action={cashMovementAction} className="card space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="shiftId" value={shift.id} />
              <div className="flex gap-2">
                <select name="kind" className="input py-2" aria-label={s.payOut}>
                  <option value="pay_out">{s.payOut}</option>
                  <option value="pay_in">{s.payIn}</option>
                </select>
                <input name="amount" inputMode="decimal" required placeholder="0.00" aria-label={t.bill.amount} className="input w-28 py-2" />
              </div>
              <input name="reason" required placeholder={s.movementReason} aria-label={s.movementReason} className="input py-2" />
              <button className="btn-secondary w-full">{s.addMovement}</button>
            </form>

            <form action={closeShiftAction} className="card space-y-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="shiftId" value={shift.id} />
              <label className="label" htmlFor="counted">{s.countedCash}</label>
              <input id="counted" name="counted" inputMode="decimal" required className="input" />
              <button className="btn">{s.close}</button>
            </form>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-semibold">{s.history}</h2>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 text-left dark:bg-stone-800">
                <tr>
                  <th className="px-3 py-2">{s.cashier}</th><th className="px-3 py-2">{s.openedAt}</th><th className="px-3 py-2">{s.closedAt}</th>
                  <th className="px-3 py-2 text-right">{s.expectedCash}</th><th className="px-3 py-2 text-right">{s.variance}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="px-3 py-2">{h.cashier_name}</td>
                    <td className="px-3 py-2">{dt.format(h.opened_at)}</td>
                    <td className="px-3 py-2">{h.closed_at ? dt.format(h.closed_at) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h.expected_cash_santim !== null ? money(locale, h.expected_cash_santim) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${h.variance_santim && h.variance_santim < 0 ? "text-red-600" : ""}`}>
                      {h.variance_santim !== null ? money(locale, h.variance_santim) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
