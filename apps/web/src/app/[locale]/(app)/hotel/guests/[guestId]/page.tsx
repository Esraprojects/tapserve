import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuest } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { param, resolveLocale } from "@/lib/locale";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { saveGuestAction } from "../../actions";
import { BookingList } from "../../BookingList";
import { GuestFields } from "../../GuestFields";

type Params = Promise<{ locale: string; guestId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function GuestPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { guestId } = await params;
  const search = await searchParams;
  const { actor } = await appContext(locale, "hotel.frontdesk");
  const data = await getGuest(db(), actor, guestId);
  if (!data) notFound();
  const h = t.hotel;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader title={data.guest.full_name} actions={<>
        <Link href={`/${locale}/hotel/guests`} className="btn-secondary">{t.common.back}</Link>
        <Link href={`/${locale}/hotel/bookings/new?guest=${data.guest.id}`} className="btn w-auto">{h.newBooking}</Link>
      </>} />
      <FormError t={t} code={param(search.error)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={saveGuestAction} className="card space-y-2">
          <h2 className="font-semibold">{h.editGuest}</h2>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="back" value={`/${locale}/hotel/guests/${data.guest.id}`} />
          <GuestFields t={t} guest={data.guest} />
          <button className="btn-secondary">{h.save}</button>
        </form>
        <section className="card">
          <h2 className="mb-2 font-semibold">{h.history}</h2>
          <BookingList rows={data.bookings} locale={locale} t={t} empty={h.noGuests} />
        </section>
      </div>
    </main>
  );
}
