import type { Dictionary, Locale } from "@tapserve/i18n";
import { SubNav } from "@/components/SubNav";

export function HotelTabs({ locale, t, active, canManage }: { locale: Locale; t: Dictionary; active: string; canManage: boolean }) {
  const base = `/${locale}/hotel`;
  const tabs = t.hotel.tabs;
  return (
    <SubNav active={active} items={[
      { key: "today", href: base, label: tabs.today },
      { key: "calendar", href: `${base}/calendar`, label: tabs.calendar },
      { key: "guests", href: `${base}/guests`, label: tabs.guests },
      { key: "audit", href: `${base}/audit`, label: tabs.audit },
      ...(canManage ? [{ key: "rooms", href: `${base}/rooms`, label: tabs.rooms }] : []),
    ]} />
  );
}

export const BOOKING_STATUS_STYLE: Record<string, string> = {
  reserved: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  checked_in: "bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100",
  checked_out: "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  no_show: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

export const HK_STATUS_STYLE: Record<string, string> = {
  clean: "bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100",
  inspected: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  dirty: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  out_of_order: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
};
