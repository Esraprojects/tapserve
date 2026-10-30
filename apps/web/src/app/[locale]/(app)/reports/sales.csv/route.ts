import { salesReport } from "@tapserve/db";
import { isLocale } from "@tapserve/i18n";
import { reportRange } from "@/lib/reportParams";
import { db } from "@/server/db";
import { appContext } from "@/server/context";

const birr = (santim: number) => (santim / 100).toFixed(2);
const cell = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);

/** Daily sales, payment methods and top items as CSV that opens in Excel (UTF-8 with BOM for Amharic). */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "am";
  const { actor, branches } = await appContext(locale, "reports.view");
  const search = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to, branchId } = reportRange(search, branches);
  const r = await salesReport(db(), actor, { from, to }, branchId);

  const rows: (string | number)[][] = [
    ["Date", "Bills", "Net sales (ETB)", "Tax (ETB)", "Gross sales (ETB)"],
    ...r.daily.map((d) => [d.day, d.bills, birr(d.net_santim), birr(d.tax_santim), birr(d.gross_santim)]),
    [],
    ["Payment method", "Payments", "Amount (ETB)"],
    ...r.byMethod.map((m) => [`${m.name_en} / ${m.name_am}`, m.count, birr(m.total_santim)]),
    [],
    ["Item", "Quantity", "Revenue (ETB)"],
    ...r.topItems.map((i) => [`${i.name_en} / ${i.name_am}`, i.quantity, birr(i.revenue_santim)]),
  ];
  const csv = "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tapserve-sales-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
