import { redirect } from "next/navigation";
import { currentSession } from "@/server/session";
import { resolveLocale, type LocaleParams } from "@/lib/locale";

export default async function Home({ params }: { params: LocaleParams }) {
  const { locale } = await resolveLocale(params);
  redirect((await currentSession()) ? `/${locale}/dashboard` : `/${locale}/login`);
}
