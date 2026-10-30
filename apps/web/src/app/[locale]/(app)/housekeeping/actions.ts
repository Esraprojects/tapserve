"use server";

import {
  assignHousekeepingTask, completeHousekeepingTask, createHousekeepingTask, type HousekeepingStatus, setRoomStatus,
} from "@tapserve/db";
import { db } from "@/server/db";
import { appContext } from "@/server/context";
import { localeOf, runAction, str } from "@/server/actions";

const back = (form: FormData) => `/${localeOf(form)}/housekeeping${str(form, "view") ? `?view=${str(form, "view")}` : ""}`;

export async function setRoomStatusAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await setRoomStatus(db(), actor, str(form, "roomId"), str(form, "status") as HousekeepingStatus, str(form, "note"));
  });
}

export async function completeTaskAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form), "hotel.housekeeping");
    await completeHousekeepingTask(db(), actor, str(form, "taskId"));
  });
}

export async function assignTaskAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor } = await appContext(localeOf(form));
    await assignHousekeepingTask(db(), actor, str(form, "taskId"), str(form, "userId") || null);
  });
}

export async function createTaskAction(form: FormData) {
  await runAction(back(form), async () => {
    const { actor, branchId } = await appContext(localeOf(form));
    await createHousekeepingTask(db(), actor, {
      branchId, roomId: str(form, "roomId"), kind: str(form, "kind") as "clean" | "inspect" | "repair",
      assignedTo: str(form, "userId") || null, note: str(form, "note"),
    });
  });
}
