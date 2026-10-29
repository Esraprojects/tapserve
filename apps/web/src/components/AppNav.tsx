"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitch } from "./LanguageSwitch";
import { switchBranchAction } from "@/app/[locale]/(app)/actions";
import { logoutAction } from "@/app/[locale]/(auth)/actions";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  primary: boolean;
}

export function AppNav({ locale, items, businessName, branches, branchId, labels }: {
  locale: "am" | "en";
  items: NavItem[];
  businessName: string;
  branches: { id: string; name: string }[];
  branchId: string;
  labels: { branch: string; more: string; logout: string };
}) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => pathname.startsWith(`/${locale}/${href}`);
  const link = (item: NavItem, compact: boolean) => (
    <Link
      key={item.href}
      href={`/${locale}/${item.href}`}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={
        compact
          ? `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive(item.href) ? "text-brand-600" : "text-stone-500"}`
          : `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${isActive(item.href) ? "bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"}`
      }
    >
      <span aria-hidden className={compact ? "text-lg leading-none" : "w-5 text-center"}>{item.icon}</span>
      {item.label}
    </Link>
  );

  const branchPicker = branches.length > 1 && (
    <form action={switchBranchAction} className="flex items-center gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={pathname} />
      <label className="sr-only" htmlFor="branchId">{labels.branch}</label>
      <select id="branchId" name="branchId" defaultValue={branchId} className="input py-2 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </form>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-stone-200 bg-white p-4 md:flex dark:border-stone-800 dark:bg-stone-900">
        <p className="text-lg font-bold text-brand-700 dark:text-brand-500">Tapserve</p>
        <p className="mb-4 truncate text-sm text-stone-500">{businessName}</p>
        {branchPicker && <div className="mb-4">{branchPicker}</div>}
        <nav className="flex flex-1 flex-col gap-1">{items.map((i) => link(i, false))}</nav>
        <div className="flex items-center justify-between">
          <LanguageSwitch locale={locale} />
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button className="rounded-lg px-3 py-2 text-sm text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">{labels.logout}</button>
          </form>
        </div>
      </aside>

      <header className="flex items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-2 md:hidden dark:border-stone-800 dark:bg-stone-900">
        <p className="truncate font-semibold">{businessName}</p>
        <div className="flex items-center gap-1">
          {branchPicker}
          <LanguageSwitch locale={locale} />
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-stone-800 dark:bg-stone-900">
        {items.filter((i) => i.primary).map((i) => link(i, true))}
        {items.some((i) => !i.primary) && (
          <details className="group relative flex-1">
            <summary className="flex cursor-pointer list-none flex-col items-center gap-0.5 py-2 text-[11px] text-stone-500">
              <span aria-hidden className="text-lg leading-none">⋯</span>
              {labels.more}
            </summary>
            <div className="absolute bottom-full right-2 mb-2 w-52 rounded-2xl border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
              {items.filter((i) => !i.primary).map((i) => link(i, false))}
              <form action={logoutAction}>
                <input type="hidden" name="locale" value={locale} />
                <button className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-stone-500">{labels.logout}</button>
              </form>
            </div>
          </details>
        )}
      </nav>
    </>
  );
}
