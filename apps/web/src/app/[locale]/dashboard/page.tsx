import { redirect } from "next/navigation";
import { formatETB } from "@tapserve/core";
import { formatEthiopianDate, toEthiopian } from "@tapserve/ethiopian-calendar";
import { format } from "@tapserve/i18n";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { resolveLocale, type LocaleParams } from "@/lib/locale";
import { requireTenant } from "@/server/session";
import { logoutAction } from "../(auth)/actions";

export default async function DashboardPage({ params }: { params: LocaleParams }) {
  const { locale, t } = await resolveLocale(params);
  const { session, access } = await requireTenant(locale);
  if (!access.onboardingCompleted) redirect(`/${locale}/onboarding?step=tax`);

  const now = new Date();
  const ec = formatEthiopianDate(toEthiopian(now), locale);
  const gc = new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", {
    dateStyle: "long",
    timeZone: "Africa/Addis_Ababa",
  }).format(now);
  const name = session.user.full_name || session.user.phone || session.user.email || "";

  // Real figures arrive with orders and payments in phase 1's next step.
  const kpis = [
    { label: t.dashboard.salesToday, value: formatETB(0, locale) },
    { label: t.dashboard.orders, value: "0" },
    { label: t.dashboard.openTables, value: "0" },
    { label: t.dashboard.profitEstimate, value: formatETB(0, locale) },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{access.tenantName}</p>
          <h1 className="text-2xl font-bold">{format(t.dashboard.welcome, { name })}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {t.common.today}: {ec} · {gc}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch locale={locale} />
          <form action={logoutAction}>
            <input type="hidden" name="locale" value={locale} />
            <button className="btn-secondary">{t.common.logout}</button>
          </form>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card">
            <p className="text-sm text-stone-500">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </section>

      <p className="mt-6 text-sm text-stone-500">{format(t.dashboard.role, { role: (t.roles as Record<string, string>)[access.roleName] ?? access.roleName })}</p>
      <p className="mt-2 text-stone-600 dark:text-stone-400">{t.dashboard.comingSoon}</p>
    </main>
  );
}
