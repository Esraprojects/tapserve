import { notFound } from "next/navigation";
import { getBooking, getUsdRate } from "@tapserve/db";
import { format } from "@tapserve/i18n";
import { PrintButton } from "@/components/PrintButton";
import { bothCalendars } from "@/lib/dates";
import { resolveLocale } from "@/lib/locale";
import { pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { FolioTable } from "../../../(app)/hotel/FolioTable";
import { nightsLabel } from "../../../(app)/hotel/BookingList";
import "../../print.css";

type Params = Promise<{ locale: string; bookingId: string }>;

/** The guest's folio on A4, to print or save as PDF at check-out. */
export default async function FolioPrintPage({ params }: { params: Params }) {
  const { locale, t } = await resolveLocale(params as unknown as Promise<{ locale: string }>);
  const { bookingId } = await params;
  const { actor, access, branches } = await appContext(locale, "hotel.frontdesk");
  const [detail, usdRate] = await Promise.all([getBooking(db(), actor, bookingId), getUsdRate(db(), actor)]);
  if (!detail) notFound();
  const { booking: b, guest } = detail;
  const branch = branches.find((x) => x.id === b.branch_id);
  const h = t.hotel;

  return (
    <div className="min-h-dvh bg-stone-200 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 w-fit"><PrintButton label={h.printFolio} /></div>
      <article className="mx-auto max-w-2xl bg-white p-8 text-stone-900 shadow print:shadow-none">
        <header className="mb-6 flex justify-between gap-4 border-b border-stone-300 pb-4">
          <div>
            <h1 className="text-xl font-bold">{access.tenantName}</h1>
            {branch && <p className="text-sm">{branch.name}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{h.folio}</p>
            <p>{format(h.booking, { n: b.booking_no })}</p>
          </div>
        </header>
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-stone-500">{h.guest}</dt><dd>{guest.full_name}{guest.nationality !== "ET" ? ` (${guest.nationality})` : ""}</dd>
          {guest.id_type && <><dt className="text-stone-500">{h.idTypes[guest.id_type]}</dt><dd>{guest.id_number}</dd></>}
          <dt className="text-stone-500">{h.room}</dt><dd>{b.room_number ?? "—"} · {pick(locale, b.type_am, b.type_en)}</dd>
          <dt className="text-stone-500">{h.arrival}</dt><dd>{bothCalendars(b.arrival, locale)}</dd>
          <dt className="text-stone-500">{h.departure}</dt><dd>{bothCalendars(b.departure, locale)} · {nightsLabel(t, b.nights)}</dd>
          <dt className="text-stone-500">{h.status.checked_in}</dt><dd>{h.status[b.status]}</dd>
        </dl>
        <FolioTable detail={detail} locale={locale} t={t} usdRate={usdRate} />
      </article>
    </div>
  );
}
