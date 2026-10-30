import { notFound } from "next/navigation";
import { getReceipt } from "@tapserve/db";
import { PrintButton } from "@/components/PrintButton";
import { param, resolveLocale } from "@/lib/locale";
import { ReceiptSlip } from "@/components/ReceiptSlip";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import "../../print.css";

type Params = Promise<{ locale: string; billId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** Receipt for 80 mm or 58 mm thermal printers. */
export default async function ReceiptPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { billId } = await params;
  const width = param((await searchParams).w) === "58" ? "w58" : "w80";
  const { actor } = await appContext(locale, "order.create");
  const r = await getReceipt(db(), actor, billId);
  if (!r) notFound();
  const b = t.bill;

  return (
    <div className="min-h-dvh bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto w-fit"><PrintButton label={b.print} /></div>
      <ReceiptSlip r={r} t={t} locale={locale} width={width} />
    </div>
  );
}
