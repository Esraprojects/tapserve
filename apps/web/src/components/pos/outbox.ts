import type { SubmitOrderPayload } from "@/app/[locale]/(app)/pos/actions";

/**
 * A small offline outbox: orders that could not reach the server are kept on the device and
 * re-sent when the connection returns. The order's clientUuid makes re-sending safe.
 * (Phase 2 moves this to IndexedDB with conflict handling.)
 */
const KEY = "tapserve.outbox.v1";

export function readOutbox(): SubmitOrderPayload[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SubmitOrderPayload[];
  } catch {
    return [];
  }
}

function write(items: SubmitOrderPayload[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: nothing more we can do on this device.
  }
}

export function enqueue(item: SubmitOrderPayload) {
  write([...readOutbox().filter((x) => x.clientUuid !== item.clientUuid), item]);
}

export function remove(clientUuid: string) {
  write(readOutbox().filter((x) => x.clientUuid !== clientUuid));
}
