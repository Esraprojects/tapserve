import { listPaymentMethods, listPurchases, listStock, listSuppliers } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { bothCalendars, addisToday } from "@/lib/dates";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { purchaseAction, saveSupplierAction } from "../actions";
import { InventoryTabs } from "../tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;
const LINES = 6;

export default async function PurchasesPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "inventory.manage");
  const [items, suppliers, methods, purchases] = await Promise.all([
    listStock(db(), actor, branchId, { activeOnly: true }),
    listSuppliers(db(), actor),
    listPaymentMethods(db(), actor),
    listPurchases(db(), actor, branchId),
  ]);
  const inv = t.inventory;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader title={inv.title} />
      <InventoryTabs locale={locale} t={t} active="purchases" />
      <FormError t={t} code={param(search.error)} />
      {param(search.saved) && <p className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-700/20 dark:text-brand-100" role="status">✓ {inv.newPurchase}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {items.length === 0 ? (
            <p className="card text-stone-500">{inv.noItems}</p>
          ) : (
            <form action={purchaseAction} className="card space-y-3">
              <h2 className="font-semibold">{inv.newPurchase}</h2>
              <input type="hidden" name="locale" value={locale} />
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="supplierId">{inv.supplier}</label>
                  <select id="supplierId" name="supplierId" className="input py-2">
                    <option value="">{inv.noSupplier}</option>
                    {suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="purchasedOn">{inv.date}</label>
                  <input id="purchasedOn" name="purchasedOn" type="date" defaultValue={addisToday()} required className="input py-2" />
                </div>
                <div>
                  <label className="label" htmlFor="invoiceRef">{inv.invoice}</label>
                  <input id="invoiceRef" name="invoiceRef" className="input py-2" />
                </div>
                <div>
                  <label className="label" htmlFor="method">{inv.paidWith}</label>
                  <select id="method" name="method" defaultValue="cash" className="input py-2">
                    <option value="">{inv.notPaid}</option>
                    {methods.filter((m) => m.kind !== "house_account").map((m) => <option key={m.code} value={m.code}>{pick(locale, m.name_am, m.name_en)}</option>)}
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-stone-500">
                    <tr><th className="py-1 pr-2 font-medium">{inv.item}</th><th className="py-1 pr-2 font-medium">{inv.quantity}</th><th className="py-1 font-medium">{inv.lineTotal}</th></tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: LINES }, (_, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <select name="itemId" aria-label={`${inv.item} ${i + 1}`} className="input py-2" defaultValue="">
                            <option value="">—</option>
                            {items.map((it) => <option key={it.id} value={it.id}>{pick(locale, it.name_am, it.name_en)} ({pick(locale, it.unit_am, it.unit_en)})</option>)}
                          </select>
                        </td>
                        <td className="py-1 pr-2"><input name="quantity" inputMode="decimal" aria-label={`${inv.quantity} ${i + 1}`} className="input w-24 py-2" /></td>
                        <td className="py-1"><input name="lineTotal" inputMode="decimal" aria-label={`${inv.lineTotal} ${i + 1}`} className="input w-32 py-2" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <input name="note" placeholder={inv.note} aria-label={inv.note} className="input py-2" />
              <button className="btn">{inv.newPurchase}</button>
            </form>
          )}

          {purchases.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">{inv.recentPurchases}</h2>
              <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                <table className="w-full text-sm">
                  <thead className="bg-stone-100 text-left dark:bg-stone-800">
                    <tr>
                      <th className="px-3 py-2">{inv.date}</th><th className="px-3 py-2">{inv.supplier}</th>
                      <th className="px-3 py-2">{inv.invoice}</th><th className="px-3 py-2">{inv.paidWith}</th>
                      <th className="px-3 py-2 text-right">{inv.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id} className="border-t border-stone-100 dark:border-stone-800">
                        <td className="px-3 py-2">{bothCalendars(p.purchased_on, locale)}</td>
                        <td className="px-3 py-2">{p.supplier_name ?? "—"}</td>
                        <td className="px-3 py-2">{p.invoice_ref || "—"}</td>
                        <td className="px-3 py-2">{p.method_en ? pick(locale, p.method_am ?? "", p.method_en) : inv.notPaid}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(locale, p.total_santim)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <form action={saveSupplierAction} className="card space-y-2">
            <h2 className="font-semibold">{inv.addSupplier}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input name="name" required placeholder={inv.supplierName} aria-label={inv.supplierName} className="input py-2" />
            <input name="phone" inputMode="tel" placeholder={inv.phone} aria-label={inv.phone} className="input py-2" />
            <input name="tin" inputMode="numeric" placeholder={inv.tin} aria-label={inv.tin} className="input py-2" />
            <button className="btn-secondary w-full">{inv.save}</button>
          </form>
          {suppliers.length > 0 && (
            <section className="card">
              <h2 className="mb-2 font-semibold">{inv.tabs.suppliers}</h2>
              <ul className="space-y-2 text-sm">
                {suppliers.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-stone-500">{[s.phone, s.tin && `${inv.tin} ${s.tin}`].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
