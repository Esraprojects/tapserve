import type { PaymentFilter } from "@tapserve/db";
import { reportRange } from "./reportParams";

const CHECKS = ["unchecked", "confirmed", "not_found"] as const;

/** Payment register filters from the URL: date range, branch, method and check status. */
export function paymentFilter(search: Record<string, string | string[] | undefined>, branches: { id: string }[]): PaymentFilter {
  const get = (k: string) => (Array.isArray(search[k]) ? search[k]![0] : search[k]) as string | undefined;
  const { from, to, branchId } = reportRange(search, branches);
  const method = get("method");
  const check = CHECKS.find((c) => c === get("check")) ?? null;
  return { range: { from, to }, branchId, methodCode: method && /^[a-z_]+$/.test(method) ? method : null, check };
}

export function paymentQuery(f: PaymentFilter): string {
  return new URLSearchParams({
    from: f.range.from, to: f.range.to,
    ...(f.branchId ? { branch: f.branchId } : {}),
    ...(f.methodCode ? { method: f.methodCode } : {}),
    ...(f.check ? { check: f.check } : {}),
  }).toString();
}
