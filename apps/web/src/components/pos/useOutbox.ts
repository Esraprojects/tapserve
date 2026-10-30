"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { submitOrderAction, type SubmitOrderPayload } from "@/app/[locale]/(app)/pos/actions";
import { enqueue, listOutbox, type OutboxEntry, put, remove, RETRYABLE } from "./outbox";

const SYNC_EVERY_MS = 30_000;

/** Keeps the device's outbox in sync: sends on load, on reconnect, when the tab returns, and every 30 s. */
export function useOutbox() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listOutbox());
    } catch {
      setEntries([]);
    }
  }, []);

  const flush = useCallback(async () => {
    setOnline(navigator.onLine);
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      for (const entry of await listOutbox()) {
        if (entry.status !== "pending") continue;
        if (!navigator.onLine) break;
        let res;
        try {
          res = await submitOrderAction(entry.payload);
        } catch {
          break; // still unreachable; try again on the next trigger
        }
        if (res.ok) await remove(entry.clientUuid);
        else if (RETRYABLE.has(res.error)) await put({ ...entry, attempts: entry.attempts + 1 });
        else await put({ ...entry, status: "failed", error: res.error });
      }
    } catch {
      // IndexedDB unavailable (private mode on some phones): nothing queued to send.
    } finally {
      busy.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void flush();
    const onVisible = () => document.visibilityState === "visible" && void flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", flush);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(flush, SYNC_EVERY_MS);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", flush);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [flush]);

  return {
    entries,
    online,
    syncing,
    pending: entries.filter((e) => e.status === "pending").length,
    failed: entries.filter((e) => e.status === "failed"),
    async save(payload: SubmitOrderPayload) {
      await enqueue(payload);
      await refresh();
    },
    async retry(entry: OutboxEntry, patch: Partial<SubmitOrderPayload> = {}) {
      await put({ ...entry, payload: { ...entry.payload, ...patch }, status: "pending", error: undefined });
      await flush();
    },
    async discard(entry: OutboxEntry) {
      await remove(entry.clientUuid);
      await refresh();
    },
  };
}
