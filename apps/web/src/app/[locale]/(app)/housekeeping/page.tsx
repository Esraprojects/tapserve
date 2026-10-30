import Link from "next/link";
import { redirect } from "next/navigation";
import { housekeepingBoard } from "@tapserve/db";
import { FormError } from "@/components/FormError";
import { PageHeader } from "@/components/PageHeader";
import { SubNav } from "@/components/SubNav";
import { param, resolveLocale, type LocaleParams } from "@/lib/locale";
import { pick } from "@/lib/text";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { HK_STATUS_STYLE } from "../hotel/tabs";
import { assignTaskAction, completeTaskAction, createTaskAction, setRoomStatusAction } from "./actions";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Phone-first board for housekeepers: big buttons, one card per room, their own tasks on top. */
export default async function HousekeepingPage({ params, searchParams }: { params: LocaleParams; searchParams: Search }) {
  const { locale, t } = await resolveLocale(params);
  const search = await searchParams;
  const { actor, branchId, can, session } = await appContext(locale);
  const supervisor = can("hotel.frontdesk");
  if (!supervisor && !can("hotel.housekeeping")) redirect(`/${locale}/dashboard?error=forbidden`);
  const board = await housekeepingBoard(db(), actor, branchId);
  const k = t.housekeeping;
  const view = param(search.view) ?? (supervisor ? "all" : "mine");
  const mine = board.tasks.filter((x) => x.assigned_to === session.user.id || (!x.assigned_to && !supervisor));
  const tasks = view === "mine" ? mine : board.tasks;
  const rooms = view === "dirty" ? board.rooms.filter((r) => r.hk_status === "dirty") : board.rooms;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="view" value={view} />
    </>
  );
  const statusButton = (roomId: string, status: string, label: string, primary = false) => (
    <form action={setRoomStatusAction}>
      {hidden}
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="status" value={status} />
      <button className={`${primary ? "btn" : "btn-secondary"} min-h-11 w-full px-2 text-sm`}>{label}</button>
    </form>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader title={k.title} />
      <SubNav active={view} items={[
        { key: "mine", href: "?view=mine", label: `${k.myTasks} (${mine.length})` },
        { key: "dirty", href: "?view=dirty", label: `${k.filterDirty} (${board.rooms.filter((r) => r.hk_status === "dirty").length})` },
        { key: "all", href: "?view=all", label: k.filterAll },
      ]} />
      <FormError t={t} code={param(search.error)} />

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">{view === "mine" ? k.myTasks : k.tasks}</h2>
        {tasks.length === 0 ? <p className="card text-sm text-stone-500">{k.noTasks}</p> : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="card flex flex-wrap items-center gap-3">
                <span className="w-14 rounded-lg bg-stone-100 py-2 text-center text-lg font-semibold dark:bg-stone-800">{task.room_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{k.kinds[task.kind]}</span>
                  <span className="block text-xs text-stone-500">{[task.assignee_name ?? k.unassigned, task.note].filter(Boolean).join(" · ")}</span>
                </span>
                {supervisor && (
                  <form action={assignTaskAction} className="flex gap-1">
                    {hidden}
                    <input type="hidden" name="taskId" value={task.id} />
                    <select name="userId" defaultValue={task.assigned_to ?? ""} aria-label={k.assignTo} className="input py-2 text-sm">
                      <option value="">{k.unassigned}</option>
                      {board.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                    </select>
                    <button className="btn-secondary min-h-10 px-2 text-sm">{t.common.save}</button>
                  </form>
                )}
                {can("hotel.housekeeping") && (
                  <form action={completeTaskAction}>
                    {hidden}
                    <input type="hidden" name="taskId" value={task.id} />
                    <button className="btn min-h-11 px-4">✓ {k.done}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{k.filterAll}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rooms.map((r) => (
            <div key={r.id} className="card space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-bold">{r.number}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${HK_STATUS_STYLE[r.hk_status]}`}>{k.statuses[r.hk_status]}</span>
              </div>
              <p className="text-xs text-stone-500">
                {pick(locale, r.type_am, r.type_en)} · {k.occupancy[r.occupancy]}
                {r.guest_name && supervisor ? ` · ${r.guest_name}` : ""}
                {r.hk_status === "out_of_order" && r.note ? ` · ${r.note}` : ""}
              </p>
              {r.hk_status === "dirty" && statusButton(r.id, "clean", k.markClean, true)}
              {r.hk_status === "clean" && supervisor && statusButton(r.id, "inspected", k.markInspected)}
              {(r.hk_status === "clean" || r.hk_status === "inspected") && (
                <form action={setRoomStatusAction}>
                  {hidden}
                  <input type="hidden" name="roomId" value={r.id} />
                  <input type="hidden" name="status" value="dirty" />
                  <button className="min-h-10 text-sm text-stone-500 underline">{k.markDirty}</button>
                </form>
              )}
              {r.hk_status === "out_of_order" && supervisor && statusButton(r.id, "dirty", k.backInService)}
              {r.hk_status !== "out_of_order" && r.occupancy === "vacant" && supervisor && (
                <details>
                  <summary className="cursor-pointer text-xs text-red-600">{k.outOfOrder}</summary>
                  <form action={setRoomStatusAction} className="mt-1 space-y-1">
                    {hidden}
                    <input type="hidden" name="roomId" value={r.id} />
                    <input type="hidden" name="status" value="out_of_order" />
                    <input name="note" required placeholder={k.reason} aria-label={k.reason} className="input py-2 text-sm" />
                    <button className="btn-secondary min-h-10 w-full text-sm">{k.outOfOrder}</button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>

      {supervisor && board.rooms.length > 0 && (
        <details className="card mt-6">
          <summary className="cursor-pointer font-semibold">{k.newTask}</summary>
          <form action={createTaskAction} className="mt-2 grid gap-2 sm:grid-cols-4">
            {hidden}
            <select name="roomId" aria-label={t.hotel.room} className="input py-2">
              {board.rooms.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
            </select>
            <select name="kind" aria-label={k.tasks} className="input py-2">
              {(["clean", "inspect", "repair"] as const).map((x) => <option key={x} value={x}>{k.kinds[x]}</option>)}
            </select>
            <select name="userId" aria-label={k.assignTo} className="input py-2">
              <option value="">{k.unassigned}</option>
              {board.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
            </select>
            <input name="note" placeholder={t.hotel.note} aria-label={t.hotel.note} className="input py-2" />
            <button className="btn-secondary sm:col-span-4">{k.newTask}</button>
          </form>
        </details>
      )}
      {!board.rooms.length && can("hotel.manage") && (
        <p className="card text-sm"><Link className="underline" href={`/${locale}/hotel/rooms`}>{t.hotel.addRooms}</Link></p>
      )}
    </main>
  );
}
