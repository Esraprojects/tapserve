import type { Dictionary, Locale } from "@tapserve/i18n";
import { SubNav } from "@/components/SubNav";

export function InventoryTabs({ locale, t, active }: { locale: Locale; t: Dictionary; active: string }) {
  const base = `/${locale}/inventory`;
  const tabs = t.inventory.tabs;
  return (
    <SubNav active={active} items={[
      { key: "stock", href: base, label: tabs.stock },
      { key: "purchases", href: `${base}/purchases`, label: tabs.purchases },
      { key: "counts", href: `${base}/counts`, label: tabs.counts },
      { key: "movements", href: `${base}/movements`, label: tabs.movements },
    ]} />
  );
}
