"use client";

import { useState } from "react";
import { formatETB } from "@tapserve/core";
import type { Dictionary } from "@tapserve/i18n";
import type { OutboxEntry } from "./outbox";

type Locale = "am" | "en";

/** Offline status and the orders that need a person's decision before they can be sent. */
export function OutboxPanel({ locale, t, online, syncing, pending, failed, onRetry, onDiscard, describe }: {
  locale: Locale;
  t: Pick<Dictionary, "offline" | "pos" | "domain" | "errors">;
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: OutboxEntry[];
  onRetry: (entry: OutboxEntry, append?: boolean) => void;
  onDiscard: (entry: OutboxEntry) => void;
  describe: (entry: OutboxEntry) => { title: string; total: number };
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (online && !pending && !failed.length) return null;
  const reason = (code?: string) => (code && (t.domain as Record<string, string>)[code]) || t.errors.unknown;

  return (
    <div className="mb-3 space-y-2" aria-live="polite">
      {!online && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t.pos.offline}</p>
      )}
      {pending > 0 && (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          ⟳ {t.offline.queued.replace("{n}", String(pending))}{syncing ? ` · ${t.offline.sending}` : ""}
        </p>
      )}
      {failed.map((entry) => {
        const d = describe(entry);
        return (
          <div key={entry.clientUuid} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
            <p className="font-semibold text-red-800 dark:text-red-200">{t.offline.needsAttention}</p>
            <p className="mt-0.5">{d.title} · <span className="tabular-nums">{formatETB(d.total, locale)}</span></p>
            <p className="mt-0.5 text-red-700 dark:text-red-300">{reason(entry.error)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {entry.error === "table_occupied" && (
                <button type="button" onClick={() => onRetry(entry, true)} className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white">
                  {t.offline.addToOpen}
                </button>
              )}
              <button type="button" onClick={() => onRetry(entry)} className="rounded-lg border border-stone-300 px-3 py-1.5 dark:border-stone-600">
                {t.offline.retry}
              </button>
              {confirming === entry.clientUuid ? (
                <button type="button" onClick={() => onDiscard(entry)} className="rounded-lg bg-red-600 px-3 py-1.5 text-white">
                  {t.offline.discardConfirm}
                </button>
              ) : (
                <button type="button" onClick={() => setConfirming(entry.clientUuid)} className="px-2 py-1.5 text-red-700 underline dark:text-red-300">
                  {t.offline.discard}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
