"use client";

import { useState } from "react";
import { birrToSantim, formatETB } from "@tapserve/core";
import type { Dictionary } from "@tapserve/i18n";

interface Row {
  method: string;
  amount: string;
  reference: string;
}

function toSantim(text: string): number {
  try {
    return text.trim() ? birrToSantim(text) : 0;
  } catch {
    return 0;
  }
}

const birr = (santim: number) => (santim / 100).toFixed(2);

/** Mixed payments (part cash, part Telebirr...) with a cash change calculator. */
export function PaymentForm({ action, locale, orderId, billId, dueSantim, methods, t }: {
  action: (form: FormData) => Promise<void>;
  locale: "am" | "en";
  orderId: string;
  billId: string;
  dueSantim: number;
  methods: { code: string; name: string; kind: string }[];
  t: Dictionary["bill"];
}) {
  const [rows, setRows] = useState<Row[]>([{ method: methods[0]?.code ?? "cash", amount: birr(dueSantim), reference: "" }]);
  const [tendered, setTendered] = useState("");
  const entered = rows.reduce((s, r) => s + toSantim(r.amount), 0);
  const remaining = dueSantim - entered;
  const cashSantim = rows.filter((r) => methods.find((m) => m.code === r.method)?.kind === "cash").reduce((s, r) => s + toSantim(r.amount), 0);
  const change = toSantim(tendered) - cashSantim;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-2 border-t border-stone-200 pt-3 dark:border-stone-800">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="billId" value={billId} />
      {rows.map((row, i) => {
        const kind = methods.find((m) => m.code === row.method)?.kind;
        return (
          <div key={i} className="space-y-1 rounded-xl bg-stone-50 p-2 dark:bg-stone-800/50">
            <div className="flex gap-2">
              <select name="method" value={row.method} onChange={(e) => set(i, { method: e.target.value })} className="input py-2 text-sm" aria-label={t.method}>
                {methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
              <input name="amount" inputMode="decimal" value={row.amount} onChange={(e) => set(i, { amount: e.target.value })}
                className="input w-28 py-2 text-right text-sm tabular-nums" aria-label={t.amount} />
            </div>
            {kind !== "cash" && (
              <input name="reference" value={row.reference} onChange={(e) => set(i, { reference: e.target.value })}
                required={kind === "mobile_money" || kind === "bank_transfer"}
                placeholder={kind === "mobile_money" || kind === "bank_transfer" ? `${t.reference} *` : t.reference}
                aria-label={t.reference} className="input py-2 text-sm" />
            )}
            {kind === "cash" && <input type="hidden" name="reference" value="" />}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" className="text-brand-600"
          onClick={() => setRows((rs) => [...rs, { method: methods.find((m) => m.kind !== "cash")?.code ?? "cash", amount: remaining > 0 ? birr(remaining) : "", reference: "" }])}>
          + {t.addPayment}
        </button>
      </div>
      <div className="flex justify-between text-sm">
        <span>{t.due}</span>
        <span className={`tabular-nums ${remaining < 0 ? "text-red-600" : ""}`}>{formatETB(remaining, locale)}</span>
      </div>
      {cashSantim > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={`tendered-${billId}`} className="flex-1">{t.tendered}</label>
          <input id={`tendered-${billId}`} inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)}
            className="input w-28 py-2 text-right tabular-nums" />
        </div>
      )}
      {cashSantim > 0 && change > 0 && (
        <p className="flex justify-between rounded-xl bg-brand-50 px-3 py-2 font-semibold dark:bg-brand-700/20">
          <span>{t.change}</span><span className="tabular-nums">{formatETB(change, locale)}</span>
        </p>
      )}
      <button className="btn" disabled={entered <= 0 || remaining < 0}>{t.recordPayment}</button>
    </form>
  );
}
