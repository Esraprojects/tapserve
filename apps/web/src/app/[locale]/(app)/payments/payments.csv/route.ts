import { listPayments } from "@tapserve/db";
import { isLocale } from "@tapserve/i18n";
import { paymentFilter } from "@/lib/paymentFilter";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

const birr = (santim: number) => (santim / 100).toFixed(2);
const cell = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
const time = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Addis_Ababa", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** The payment register as CSV for Excel, for matching against Telebirr and bank statements. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "am";
  const { actor, branches } = await appContext(locale, "reports.view");
  const filter = paymentFilter(Object.fromEntries(new URL(request.url).searchParams), branches);
  const rows = await listPayments(db(), actor, filter);
  const lines: (string | number)[][] = [
    ["Time", "Branch", "Receipt no.", "Method", "Transaction no.", "Amount (ETB)", "Received by", "Check", "Checked by"],
    ...rows.map((p) => [
      time.format(p.created_at), p.branch_name, p.receipt_no, p.method_en, p.reference, birr(p.amount_santim), p.received_by,
      p.check_status ?? "unchecked", p.checked_by ?? "",
    ]),
  ];
  const csv = "﻿" + lines.map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tapserve-payments-${filter.range.from}-to-${filter.range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
