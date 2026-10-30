"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatETB } from "@tapserve/core";
import type { Dictionary } from "@tapserve/i18n";
import type { Menu, MenuItem, MenuVariant } from "@tapserve/db";
import { submitOrderAction, type SubmitOrderPayload } from "@/app/[locale]/(app)/pos/actions";
import { enqueue, readOutbox, remove } from "./outbox";

type Locale = "am" | "en";

interface CartLine {
  key: string;
  item: MenuItem;
  variant: MenuVariant;
  quantity: number;
  notes: string;
  modifierIds: string[];
}

interface Props {
  locale: Locale;
  t: Pick<Dictionary, "pos" | "menu" | "domain" | "errors">;
  menu: Menu;
  tables: { id: string; name: string; status: string }[];
  initialTableId: string | null;
  existingOrder: { id: string; orderNo: number; tableName: string | null } | null;
}

const pick = (locale: Locale, am: string, en: string) => (locale === "am" ? am || en : en || am);

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export function PosScreen({ locale, t, menu, tables, initialTableId, existingOrder }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [fastingOnly, setFastingOnly] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [type, setType] = useState<"dine_in" | "takeaway" | "delivery">(initialTableId || !existingOrder ? "dine_in" : "takeaway");
  const [tableId, setTableId] = useState<string>(initialTableId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  // Re-send queued orders when the connection comes back.
  useEffect(() => {
    const flush = async () => {
      setOnline(navigator.onLine);
      const items = readOutbox();
      setQueued(items.length);
      if (!navigator.onLine) return;
      for (const item of items) {
        try {
          const res = await submitOrderAction(item);
          if (res.ok || res.error !== "unknown") remove(item.clientUuid);
        } catch {
          break;
        }
      }
      setQueued(readOutbox().length);
    };
    flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", flush);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", flush);
    };
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return menu.categories
      .filter((c) => categoryId === "all" || c.id === categoryId)
      .flatMap((c) => c.items)
      .filter((i) => !fastingOnly || i.is_fasting)
      .filter((i) => !q || i.name_am.toLowerCase().includes(q) || i.name_en.toLowerCase().includes(q));
  }, [menu, categoryId, query, fastingOnly]);

  const modifierGroups = useMemo(() => new Map(menu.modifierGroups.map((g) => [g.id, g])), [menu]);
  const modifierPrice = (ids: string[]) =>
    menu.modifierGroups.flatMap((g) => g.modifiers).filter((m) => ids.includes(m.id)).reduce((s, m) => s + m.price_delta_santim, 0);
  const total = cart.reduce((s, l) => s + (l.variant.price_santim + modifierPrice(l.modifierIds)) * l.quantity, 0);

  function add(item: MenuItem, variant: MenuVariant) {
    if (!item.is_available) return;
    setCart((lines) => {
      const same = lines.find((l) => l.variant.id === variant.id && !l.notes && l.modifierIds.length === 0);
      if (same) return lines.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      return [...lines, { key: newUuid(), item, variant, quantity: 1, notes: "", modifierIds: [] }];
    });
  }

  function update(key: string, patch: Partial<CartLine>) {
    setCart((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0));
  }

  function submit() {
    setError(null);
    if (!existingOrder && type === "dine_in" && !tableId) {
      setError(t.domain.table_required);
      return;
    }
    const payload: SubmitOrderPayload = {
      locale,
      clientUuid: newUuid(),
      orderId: existingOrder?.id,
      type,
      tableId: type === "dine_in" ? tableId : null,
      items: cart.map((l) => ({
        variantId: l.variant.id,
        quantity: l.quantity,
        notes: l.notes || undefined,
        modifierIds: l.modifierIds.length ? l.modifierIds : undefined,
      })),
    };
    startTransition(async () => {
      try {
        const res = await submitOrderAction(payload);
        if (res.ok) {
          setCart([]);
          router.push(`/${locale}/orders/${res.orderId}`);
        } else {
          setError((t.domain as Record<string, string>)[res.error] ?? t.errors.unknown);
        }
      } catch {
        // Network failure: keep the order on this device and send it later.
        enqueue(payload);
        setQueued(readOutbox().length);
        setCart([]);
        setError(t.pos.offline);
      }
    });
  }

  const freeTables = tables.filter((x) => x.status === "free" || x.id === initialTableId);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col md:h-dvh md:flex-row">
      <section className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.menu.search}
            aria-label={t.menu.search}
            className="input min-w-40 flex-1 py-2"
          />
          <button
            type="button"
            onClick={() => setFastingOnly((f) => !f)}
            aria-pressed={fastingOnly}
            className={`rounded-xl border px-3 text-sm font-medium ${fastingOnly ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "border-stone-300 dark:border-stone-700"}`}
          >
            {t.menu.fastingOnly}
          </button>
        </div>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="tablist">
          {[{ id: "all", label: t.menu.all }, ...menu.categories.map((c) => ({ id: c.id, label: pick(locale, c.name_am, c.name_en) }))].map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${categoryId === c.id ? "bg-brand-600 text-white" : "bg-stone-200 dark:bg-stone-800"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {items.flatMap((item) =>
            item.variants.map((variant) => (
              <button
                key={variant.id}
                onClick={() => add(item, variant)}
                disabled={!item.is_available}
                className="flex min-h-20 flex-col justify-between rounded-2xl border border-stone-200 bg-white p-3 text-left active:scale-[0.98] disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900"
              >
                <span className="font-medium leading-tight">
                  {pick(locale, item.name_am, item.name_en)}
                  {(variant.name_am || variant.name_en) && <span className="text-stone-500"> · {pick(locale, variant.name_am, variant.name_en)}</span>}
                </span>
                <span className="mt-2 flex items-center justify-between text-sm">
                  <span className="tabular-nums text-stone-600 dark:text-stone-300">{formatETB(variant.price_santim, locale)}</span>
                  {item.is_fasting && <span className="rounded-full bg-brand-50 px-2 text-xs text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">ፆም</span>}
                  {!item.is_available && <span className="text-xs">{t.menu.soldOut}</span>}
                </span>
              </button>
            )),
          )}
        </div>
      </section>

      <aside className="flex flex-col border-t border-stone-200 bg-white p-4 md:w-96 md:border-l md:border-t-0 dark:border-stone-800 dark:bg-stone-900">
        <h2 className="mb-3 text-lg font-semibold">
          {existingOrder ? t.pos.addToOrder.replace("{no}", String(existingOrder.orderNo)) : t.pos.cart}
        </h2>
        {!online && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t.pos.offline}</p>}
        {queued > 0 && online && <p className="mb-3 text-sm text-stone-500">⟳ {queued}</p>}

        {!existingOrder && (
          <div className="mb-3 space-y-2">
            <div className="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="radiogroup" aria-label={t.pos.type}>
              {(["dine_in", "takeaway", "delivery"] as const).map((x) => (
                <button key={x} role="radio" aria-checked={type === x} onClick={() => setType(x)}
                  className={`flex-1 rounded-lg py-2 text-sm font-medium ${type === x ? "bg-white shadow-sm dark:bg-stone-700" : "text-stone-500"}`}>
                  {t.pos.types[x]}
                </button>
              ))}
            </div>
            {type === "dine_in" && (
              <select value={tableId} onChange={(e) => setTableId(e.target.value)} className="input py-2" aria-label={t.pos.table}>
                <option value="">{t.pos.chooseTable}</option>
                {freeTables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
          </div>
        )}

        <ul className="min-h-24 flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 && <li className="py-6 text-center text-sm text-stone-500">{t.pos.cartEmpty}</li>}
          {cart.map((line) => (
            <li key={line.key} className="rounded-xl border border-stone-200 p-2 dark:border-stone-700">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{pick(locale, line.item.name_am, line.item.name_en)}</p>
                  <p className="text-sm tabular-nums text-stone-500">
                    {formatETB((line.variant.price_santim + modifierPrice(line.modifierIds)) * line.quantity, locale)}
                  </p>
                </div>
                <button aria-label="−" onClick={() => update(line.key, { quantity: line.quantity - 1 })} className="h-10 w-10 rounded-lg bg-stone-100 text-xl dark:bg-stone-800">−</button>
                <span className="w-6 text-center tabular-nums">{line.quantity}</span>
                <button aria-label="+" onClick={() => update(line.key, { quantity: line.quantity + 1 })} className="h-10 w-10 rounded-lg bg-stone-100 text-xl dark:bg-stone-800">+</button>
              </div>
              {line.item.modifier_group_ids.map((gid) => modifierGroups.get(gid)).filter(Boolean).map((group) => (
                <div key={group!.id} className="mt-2 flex flex-wrap gap-1">
                  {group!.modifiers.map((m) => {
                    const on = line.modifierIds.includes(m.id);
                    return (
                      <button key={m.id} aria-pressed={on}
                        onClick={() => update(line.key, { modifierIds: on ? line.modifierIds.filter((x) => x !== m.id) : [...line.modifierIds, m.id] })}
                        className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-500 bg-brand-50 dark:bg-brand-700/20" : "border-stone-300 dark:border-stone-700"}`}>
                        {pick(locale, m.name_am, m.name_en)}
                      </button>
                    );
                  })}
                </div>
              ))}
              <input value={line.notes} onChange={(e) => update(line.key, { notes: e.target.value })}
                placeholder={t.pos.notePlaceholder} aria-label={t.pos.note} maxLength={300}
                className="mt-2 w-full rounded-lg border border-stone-200 bg-transparent px-2 py-1.5 text-sm dark:border-stone-700" />
            </li>
          ))}
        </ul>

        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
        <div className="mt-3 flex items-center justify-between text-lg font-semibold">
          <span>{t.pos.total}</span>
          <span className="tabular-nums">{formatETB(total, locale)}</span>
        </div>
        <button onClick={submit} disabled={!cart.length || pending} className="btn mt-3 disabled:opacity-50">
          {pending ? "…" : t.pos.send}
        </button>
      </aside>
    </div>
  );
}
