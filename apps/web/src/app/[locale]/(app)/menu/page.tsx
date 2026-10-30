import Link from "next/link";
import { getMenu, type MenuItem } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { deleteCategoryAction, deleteItemAction, saveCategoryAction, saveItemAction, toggleAvailabilityAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

function sizesText(item: MenuItem): string {
  if (item.variants.length === 1 && !item.variants[0]!.name_am && !item.variants[0]!.name_en) return "";
  return item.variants
    .map((v) => `${[v.name_am, v.name_en].filter(Boolean).join(" / ")} = ${(v.price_santim / 100).toFixed(2)}`)
    .join("\n");
}

export default async function MenuPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "menu.manage");
  const menu = await getMenu(db(), actor, branchId);
  const editId = param(search.edit);
  const editing = menu.categories.flatMap((c) => c.items).find((i) => i.id === editId);
  const m = t.menu;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader title={m.title} actions={<a href={`/${locale}/menu/costing`} className="btn-secondary">{t.recipe.title}</a>} />
      <FormError t={t} code={param(search.error)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-6">
          {menu.categories.length === 0 && <p className="text-stone-500">{m.empty}</p>}
          {menu.categories.map((cat) => (
            <div key={cat.id} className="card p-0">
              <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-5 py-3 dark:border-stone-800">
                <h2 className="font-semibold">
                  {pick(locale, cat.name_am, cat.name_en)}
                  <span className="ml-2 text-sm font-normal text-stone-500">{m.stations[cat.station]}</span>
                </h2>
                {cat.items.length === 0 && (
                  <form action={deleteCategoryAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="id" value={cat.id} />
                    <button className="text-sm text-red-600">{m.delete}</button>
                  </form>
                )}
              </div>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {cat.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {pick(locale, item.name_am, item.name_en)}
                        {item.is_fasting && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{m.fasting}</span>}
                        {!item.is_available && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs dark:bg-stone-700">{m.soldOut}</span>}
                      </p>
                      <p className="text-sm text-stone-500">
                        {item.variants.map((v) => `${pick(locale, v.name_am, v.name_en)}${v.name_am || v.name_en ? " " : ""}${money(locale, v.price_santim)}`).join(" · ")}
                      </p>
                    </div>
                    <form action={toggleAvailabilityAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="available" value={String(!item.is_available)} />
                      <button className="btn-secondary min-h-10 px-3 text-sm">{item.is_available ? m.markSoldOut : m.markAvailable}</button>
                    </form>
                    <Link href={`/${locale}/menu?edit=${item.id}`} className="btn-secondary min-h-10 px-3 text-sm">{m.editItem}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <aside className="space-y-6">
          {menu.categories.length > 0 && (
            <form action={saveItemAction} className="card space-y-3" key={editing?.id ?? "new"}>
              <h2 className="font-semibold">{editing ? m.editItem : m.addItem}</h2>
              <input type="hidden" name="locale" value={locale} />
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label className="label" htmlFor="categoryId">{m.category}</label>
                <select id="categoryId" name="categoryId" className="input" defaultValue={editing?.category_id}>
                  {menu.categories.map((c) => <option key={c.id} value={c.id}>{pick(locale, c.name_am, c.name_en)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="nameAm">{m.nameAm}</label>
                <input id="nameAm" name="nameAm" className="input" lang="am" defaultValue={editing?.name_am} />
              </div>
              <div>
                <label className="label" htmlFor="nameEn">{m.nameEn}</label>
                <input id="nameEn" name="nameEn" className="input" defaultValue={editing?.name_en} />
              </div>
              <div>
                <label className="label" htmlFor="price">{m.price}</label>
                <input id="price" name="price" inputMode="decimal" className="input"
                  defaultValue={editing && !sizesText(editing) ? (editing.variants[0]!.price_santim / 100).toFixed(2) : ""} />
              </div>
              <div>
                <label className="label" htmlFor="sizes">{m.sizes}</label>
                <textarea id="sizes" name="sizes" rows={3} className="input" defaultValue={editing ? sizesText(editing) : ""} />
                <p className="hint">{m.sizesHint}</p>
              </div>
              <label className="flex min-h-12 items-center gap-3">
                <input type="checkbox" name="isFasting" defaultChecked={editing?.is_fasting} className="h-5 w-5 accent-brand-600" />
                {m.fasting}
              </label>
              <button className="btn">{t.common.save}</button>
              {editing && (
                <div className="flex justify-between text-sm">
                  <Link href={`/${locale}/menu`} className="text-stone-500">{t.common.back}</Link>
                </div>
              )}
            </form>
          )}
          {editing && (
            <form action={deleteItemAction} className="text-right">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={editing.id} />
              <button className="text-sm text-red-600">{m.delete}</button>
            </form>
          )}

          <form action={saveCategoryAction} className="card space-y-3">
            <h2 className="font-semibold">{m.addCategory}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input name="nameAm" className="input" placeholder={m.nameAm} lang="am" aria-label={m.nameAm} />
            <input name="nameEn" className="input" placeholder={m.nameEn} aria-label={m.nameEn} />
            <div>
              <label className="label" htmlFor="station">{m.station}</label>
              <select id="station" name="station" className="input">
                {(["kitchen", "bar", "barista"] as const).map((s) => <option key={s} value={s}>{m.stations[s]}</option>)}
              </select>
            </div>
            <button className="btn">{m.addCategory}</button>
          </form>
        </aside>
      </div>
    </main>
  );
}
