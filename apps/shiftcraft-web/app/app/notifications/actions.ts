"use server";

import { revalidatePath } from "next/cache";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  markAllNotificationsRead,
  markNotificationsRead,
} from "~/lib/notifications-feed";

export async function markReadAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const m = await currentMembership();
  if (!m) return;
  // Form sends one or more `id` fields (FormData handles repeats).
  const ids = formData.getAll("id").map((v) => String(v)).filter(Boolean);
  if (ids.length === 0) return;
  await markNotificationsRead(m.tenant.id, me.id, ids);
  // Revalidate the layout so the bell badge updates everywhere.
  revalidatePath("/app", "layout");
}

export async function markAllReadAction(): Promise<void> {
  const me = await currentUser();
  if (!me) return;
  const m = await currentMembership();
  if (!m) return;
  await markAllNotificationsRead(m.tenant.id, me.id);
  revalidatePath("/app", "layout");
}
