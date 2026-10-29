import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { appContext } from "@/server/context";

export default async function AppLayout({ children, params }: { children: ReactNode; params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const ctx = await appContext(locale);
  const items = [
    { href: "dashboard", label: t.nav.dashboard, icon: "◧", show: true, primary: true },
    { href: "pos", label: t.nav.pos, icon: "＋", show: ctx.can("order.create"), primary: true },
    { href: "tables", label: t.nav.tables, icon: "▦", show: ctx.can("order.create"), primary: true },
    { href: "orders", label: t.nav.orders, icon: "☰", show: ctx.can("order.create"), primary: true },
    { href: "kitchen", label: t.nav.kitchen, icon: "♨", show: ctx.can("kitchen.manage"), primary: !ctx.can("order.create") },
    { href: "shifts", label: t.nav.shifts, icon: "◷", show: ctx.can("shift.manage"), primary: false },
    { href: "menu", label: t.nav.menu, icon: "☷", show: ctx.can("menu.manage"), primary: false },
    { href: "reports", label: t.nav.reports, icon: "▤", show: ctx.can("reports.view"), primary: false },
    { href: "staff", label: t.nav.staff, icon: "☺", show: ctx.can("staff.manage"), primary: false },
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
    </div>
  );
}
