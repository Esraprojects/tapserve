import type { Guest } from "@tapserve/db";
import type { Dictionary } from "@tapserve/i18n";

const ID_TYPES = ["kebele", "fayda", "passport", "driving_license", "other"] as const;

/** Name, contact and ID details. Ethiopian guests by default; foreigners give a country code and passport. */
export function GuestFields({ t, guest, requireId = false }: { t: Dictionary; guest?: Guest | null; requireId?: boolean }) {
  const h = t.hotel;
  const foreign = guest ? guest.nationality !== "ET" : false;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {guest && <input type="hidden" name="guestId" value={guest.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="fullName">{h.guestName}</label>
        <input id="fullName" name="fullName" required defaultValue={guest?.full_name} className="input py-2" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="phone">{h.phone}</label>
        <input id="phone" name="phone" inputMode="tel" defaultValue={guest?.phone} className="input py-2" />
      </div>
      <div>
        <label className="label" htmlFor="email">{h.email}</label>
        <input id="email" name="email" type="email" defaultValue={guest?.email} className="input py-2" />
      </div>
      <div>
        <label className="label" htmlFor="nationality">{h.nationality}</label>
        <select id="nationality" name="nationality" defaultValue={foreign ? "other" : "ET"} className="input py-2">
          <option value="ET">{h.ethiopian}</option>
          <option value="other">{h.otherCountry}</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="country">{h.otherCountry}</label>
        <input id="country" name="country" maxLength={2} defaultValue={foreign ? guest?.nationality : ""} placeholder="US"
          className="input py-2 uppercase" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="idType">{h.idType}</label>
        <select id="idType" name="idType" defaultValue={guest?.id_type ?? ""} required={requireId} className="input py-2">
          <option value="">—</option>
          {ID_TYPES.map((k) => <option key={k} value={k}>{h.idTypes[k]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="idNumber">{h.idNumber}</label>
        <input id="idNumber" name="idNumber" defaultValue={guest?.id_number} required={requireId} className="input py-2" autoComplete="off" />
      </div>
      <p className="text-xs text-stone-500 sm:col-span-2">{h.idHint}</p>
    </div>
  );
}
