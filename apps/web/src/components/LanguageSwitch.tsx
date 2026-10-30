"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LanguageSwitch({ locale }: { locale: "am" | "en" }) {
  const pathname = usePathname() ?? "/";
  const other = locale === "am" ? "en" : "am";
  const rest = pathname.replace(/^\/(am|en)/, "");
  return (
    <Link
      href={`/${other}${rest}`}
      onClick={() => {
        document.cookie = `locale=${other}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
      hrefLang={other}
    >
      {other === "am" ? "አማርኛ" : "English"}
    </Link>
  );
}
