import type { ReactNode } from "react";
import { LanguageSwitch } from "./LanguageSwitch";

export function AuthShell({ locale, title, tagline, children }: {
  locale: "am" | "en";
  title: string;
  tagline: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <div className="mb-8 flex items-center justify-between">
        <span className="text-xl font-bold text-brand-700 dark:text-brand-500">Tapserve</span>
        <LanguageSwitch locale={locale} />
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mb-6 mt-1 text-stone-500 dark:text-stone-400">{tagline}</p>
      <div className="card">{children}</div>
    </main>
  );
}
