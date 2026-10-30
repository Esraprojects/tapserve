import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicReceipt } from "@tapserve/db";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ReceiptSlip } from "@/components/ReceiptSlip";
import { resolveLocale } from "@/lib/locale";
import { db } from "@/server/db";
import "../../print.css";

type Params = Promise<{ locale: string; token: string }>;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The customer's digital receipt: opened from the QR code or link, no sign-in. */
export default async function PublicReceiptPage({ params }: { params: Params }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { token } = await params;
  const r = await getPublicReceipt(db(), token);
  if (!r) notFound();
  const paid = r.bill.status === "paid";

  return (
    <div className="min-h-dvh bg-stone-200 px-4 py-6">
      <div className="mx-auto mb-3 flex max-w-sm items-center justify-between">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${paid ? "bg-brand-600 text-white" : "bg-amber-100 text-amber-900"}`}>
          {paid ? `✓ ${t.receipt.paid}` : t.receipt.unpaid}
        </span>
        <LanguageSwitch locale={locale} />
      </div>
      <ReceiptSlip r={r} t={t} locale={locale} width="w80" className="rounded-lg !text-[13px]" />
    </div>
  );
}
