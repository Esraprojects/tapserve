"use server";

import { z } from "zod";
import { addItems, createBill, createOrder, DomainError, openOrderForTable } from "@tapserve/db";
import { isLocale } from "@tapserve/i18n";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

const line = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
  notes: z.string().max(300).optional(),
  modifierIds: z.array(z.string().uuid()).max(20).optional(),
});

const payload = z.object({
  locale: z.string(),
  clientUuid: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  type: z.enum(["dine_in", "takeaway", "delivery", "counter"]),
  tableId: z.string().uuid().nullable().optional(),
  guestCount: z.number().int().min(1).max(500).nullable().optional(),
  note: z.string().max(300).optional(),
  items: z.array(line).min(1).max(200),
  /** Set when a waiter resolves an offline conflict: the table got an order meanwhile, so add to it. */
  appendIfTableBusy: z.boolean().optional(),
});

export type SubmitOrderPayload = z.infer<typeof payload>;
export type SubmitOrderResult = { ok: true; orderId: string } | { ok: false; error: string };

/**
 * Called by the POS screen and its offline outbox. Prices always come from the server, and the
 * device's clientUuid makes a re-send safe. Counter sales get their bill straight away so the
 * cashier lands on the payment screen.
 */
export async function submitOrderAction(input: SubmitOrderPayload): Promise<SubmitOrderResult> {
  const parsed = payload.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const locale = isLocale(data.locale) ? data.locale : "am";
  try {
    const { actor, branchId, can } = await appContext(locale);
    if (data.orderId) {
      await addItems(db(), actor, data.orderId, data.items, data.clientUuid);
      return { ok: true, orderId: data.orderId };
    }
    const tableId = data.type === "dine_in" ? data.tableId ?? null : null;
    let orderId: string;
    try {
      orderId = await createOrder(db(), actor, {
        branchId,
        type: data.type,
        tableId,
        guestCount: data.guestCount ?? null,
        note: data.note,
        clientUuid: data.clientUuid,
        items: data.items,
      });
    } catch (err) {
      if (!(err instanceof DomainError && err.code === "table_occupied" && data.appendIfTableBusy && tableId)) throw err;
      const open = await openOrderForTable(db(), actor, tableId);
      if (!open) throw err;
      await addItems(db(), actor, open, data.items, data.clientUuid);
      return { ok: true, orderId: open };
    }
    if (data.type === "counter" && can("payment.record")) {
      try {
        await createBill(db(), actor, orderId);
      } catch (err) {
        // A re-sent counter order already has its bill.
        if (!(err instanceof DomainError && err.code === "nothing_to_bill")) throw err;
      }
    }
    return { ok: true, orderId };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.code };
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error(err);
    return { ok: false, error: "unknown" };
  }
}
