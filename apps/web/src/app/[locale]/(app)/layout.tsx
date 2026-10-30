import type { ReactNode } from "react";
import { sellsAtCounter } from "@tapserve/db";
import { AppNav } from "@/components/AppNav";
import { ServiceWorker } from "@/components/ServiceWorker";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { appContext } from "@/server/context";

export default async function AppLayout({ children, params }: { children: ReactNode; params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const ctx = await appContext(locale);
  // Cafés and bars work at the counter, so tables move out of the phone's bottom bar.
  const counter = sellsAtCounter(ctx.access.businessType);
  const items = [
    { href: "dashboard", label: t.nav.dashboard, icon: "◧", show: true, primary: true },
    { href: "pos", label: t.nav.pos, icon: "＋", show: ctx.can("order.create"), primary: true },
    { href: "tables", label: t.nav.tables, icon: "▦", show: ctx.can("order.create"), primary: !counter },
    { href: "orders", label: t.nav.orders, icon: "☰", show: ctx.can("order.create"), primary: true },
    { href: "kitchen", label: t.nav.kitchen, icon: "♨", show: ctx.can("kitchen.manage"), primary: !ctx.can("order.create") },
    { href: "shifts", label: t.nav.shifts, icon: "◷", show: ctx.can("shift.manage"), primary: false },
    { href: "payments", label: t.nav.payments, icon: "✓", show: ctx.can("reports.view"), primary: false },
    { href: "menu", label: t.nav.menu, icon: "☷", show: ctx.can("menu.manage"), primary: false },
    { href: "inventory", label: t.nav.inventory, icon: "▣", show: ctx.can("inventory.manage"), primary: false },
    { href: "expenses", label: t.nav.expenses, icon: "−", show: ctx.can("expenses.manage"), primary: false },
    { href: "reports", label: t.nav.reports, icon: "▤", show: ctx.can("reports.view"), primary: false },
    { href: "staff", label: t.nav.staff, icon: "☺", show: ctx.can("staff.manage"), primary: false },
    { href: "switch", label: t.nav.switchUser, icon: "⇄", show: true, primary: false },
  ].filter((i) => i.show);

  return (
    <div className="min-h-dvh md:flex">
      <AppNav
        locale={locale}
        items={items}
        businessName={ctx.access.tenantName}
        branches={ctx.branches}
        branchId={ctx.branchId}
        labels={{ branch: t.nav.branch, more: t.nav.more, logout: t.common.logout }}
      />
      <div className="flex-1 pb-24 md:pb-0">{children}</div>
      <ServiceWorker />
    </div>
  );
}
