import type { SubmitOrderPayload } from "@/app/[locale]/(app)/pos/actions";

/**
 * Offline outbox for orders taken while the connection is down. Entries live in IndexedDB so they
 * survive a reload or a closed browser, and each carries the device-made clientUuid, so sending it
 * twice never creates two orders (or adds the same round of items twice).
 *
 * An entry is "pending" until the server accepts it. If the server refuses it for a business reason
 * (the table was taken by someone else, an item sold out), it becomes "failed" with the reason, and
 * the waiter decides: retry, add it to the table's open order, or discard it.
 */
export interface OutboxEntry {
  clientUuid: string;
  payload: SubmitOrderPayload;
  status: "pending" | "failed";
  error?: string;
  attempts: number;
  createdAt: number;
}

const DB_NAME = "tapserve";
const STORE = "outbox";
const LEGACY_KEY = "tapserve.outbox.v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "clientUuid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Phase 1 kept the outbox in localStorage; move anything left there into IndexedDB once. */
async function migrateLegacy() {
  let legacy: SubmitOrderPayload[] = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]") as SubmitOrderPayload[];
  } catch {
    return;
  }
  if (!legacy.length) return;
  for (const payload of legacy) await put({ clientUuid: payload.clientUuid, payload, status: "pending", attempts: 0, createdAt: Date.now() });
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage blocked: the entries are already in IndexedDB, and clientUuid makes a repeat harmless.
  }
}

let migrated = false;

export async function listOutbox(): Promise<OutboxEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  if (!migrated) {
    migrated = true;
    await migrateLegacy();
  }
  const all = (await withStore<OutboxEntry[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>)) ?? [];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function put(entry: OutboxEntry): Promise<void> {
  await withStore("readwrite", (s) => s.put(entry));
}

export async function enqueue(payload: SubmitOrderPayload): Promise<void> {
  await put({ clientUuid: payload.clientUuid, payload, status: "pending", attempts: 0, createdAt: Date.now() });
}

export async function remove(clientUuid: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(clientUuid));
}

/** Errors that a later retry can fix by itself; anything else needs a person to decide. */
export const RETRYABLE = new Set(["unknown", "network"]);
