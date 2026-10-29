import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const ethiopic = Noto_Sans_Ethiopic({ subsets: ["ethiopic"], variable: "--font-ethiopic", display: "swap" });

export const metadata: Metadata = {
  title: "Tapserve",
  description: "Hotel and restaurant management",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18735a",
};

// Pages read the session cookie, so they render per request.
export const dynamic = "force-dynamic";

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: LocaleParams }) {
  const { locale } = await resolveLocale(params);
  return (
    <html lang={locale} className={`${inter.variable} ${ethiopic.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
