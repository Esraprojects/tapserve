import { notFound } from "next/navigation";
import { getRecipe, listStock, menuCosting } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale } from "@/lib/locale";
import { money, pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { saveRecipeAction } from "../../actions";

type Params = Promise<{ locale: string; variantId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const BLANK_ROWS = 4;

export default async function RecipePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { variantId } = await params;
  const search = await searchParams;
  const { actor, branchId } = await appContext(locale, "menu.manage");
  const [costing, lines, stock] = await Promise.all([
    menuCosting(db(), actor, branchId), getRecipe(db(), actor, variantId, branchId), listStock(db(), actor, branchId, { activeOnly: true }),
  ]);
  const variant = costing.find((v) => v.variant_id === variantId);
  if (!variant) notFound();
  const r = t.recipe;
  const name = pick(locale, variant.item_name_am, variant.item_name_en);
  const vName = pick(locale, variant.variant_name_am, variant.variant_name_en);
  const rows = [...lines.map((l) => ({ itemId: l.item_id, quantity: String(l.quantity) })),
    ...Array.from({ length: BLANK_ROWS }, () => ({ itemId: "", quantity: "" }))];

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader title={`${name}${vName ? ` · ${vName}` : ""}`}
        subtitle={`${r.price}: ${money(locale, variant.price_santim)} · ${r.cost}: ${money(locale, variant.cost_santim)}`}
        actions={<a href={`/${locale}/menu/costing`} className="btn-secondary">{r.back}</a>} />
      <FormError t={t} code={param(search.error)} />
      {stock.length === 0 ? (
        <p className="card text-stone-500">{t.inventory.noItems}</p>
      ) : (
        <form action={saveRecipeAction} className="card space-y-3">
          <p className="text-sm text-stone-500">{r.hint} {r.addRow}</p>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="variantId" value={variantId} />
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <select name="itemId" defaultValue={row.itemId} aria-label={`${r.ingredient} ${i + 1}`} className="input py-2">
                <option value="">—</option>
                {stock.map((s) => <option key={s.id} value={s.id}>{pick(locale, s.name_am, s.name_en)} ({pick(locale, s.unit_am, s.unit_en)})</option>)}
              </select>
              <input name="quantity" inputMode="decimal" defaultValue={row.quantity} placeholder={r.perPortion}
                aria-label={`${r.perPortion} ${i + 1}`} className="input w-32 py-2" />
            </div>
          ))}
          <button className="btn">{r.save}</button>
        </form>
      )}
    </main>
  );
}
