import { headers } from "next/headers";
import QRCode from "qrcode";
import type { Dictionary, Locale } from "@tapserve/i18n";
import { CopyButton } from "./CopyButton";

/** QR code and link to the customer's digital receipt, for businesses without a printer. */
export async function ReceiptQr({ token, locale, t }: { token: string; locale: Locale; t: Dictionary }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/${locale}/r/${token}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return (
    <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
      <p className="text-sm font-semibold">{t.receipt.digital}</p>
      <p className="mb-2 text-xs text-stone-500">{t.receipt.digitalHint}</p>
      <div className="flex items-center gap-3">
        <div className="h-28 w-28 shrink-0 rounded-lg bg-white p-1" role="img" aria-label={t.receipt.digital}
          dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="flex flex-col gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-sm">{t.receipt.open}</a>
          <CopyButton text={url} label={t.receipt.copyLink} done={t.receipt.copied} />
        </div>
      </div>
    </div>
  );
}
