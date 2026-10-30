import { addDays, addisToday, isIsoDate } from "./dates";

/** Read from/to/branch search params, defaulting to the last 7 days; at most one year. */
export function reportRange(search: Record<string, string | string[] | undefined>, branches: { id: string }[]) {
  const get = (k: string) => (Array.isArray(search[k]) ? search[k]![0] : search[k]) as string | undefined;
  const today = addisToday();
  let to = isIsoDate(get("to")) ? get("to")! : today;
  let from = isIsoDate(get("from")) ? get("from")! : addDays(to, -6);
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -366)) from = addDays(to, -366);
  const branchParam = get("branch");
  const branchId = branchParam && branches.some((b) => b.id === branchParam) ? branchParam : null;
  return { from, to, branchId };
}
