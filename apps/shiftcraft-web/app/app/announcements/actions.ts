"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scAnnouncements } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  body: z.string().trim().min(1, "Body is required").max(4000),
  pinned: z.string().optional(), // checkbox: "on" or undefined
  expiresAt: z.string().optional().or(z.literal("")),
});

function requireAdmin(role: string): true | string {
  if (role === "owner" || role === "admin") return true;
  return "Only admins can manage announcements.";
}

function parseExpiresOrNull(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // <input type="datetime-local"> → "YYYY-MM-DDTHH:mm". Treat as local time.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createAnnouncementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const m = await currentMembership();
  if (!m) {
    return { status: "error", message: "No workspace selected." };
  }
  const gate = requireAdmin(m.role);
  if (gate !== true) return { status: "error", message: gate };

  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    pinned: formData.get("pinned") ?? undefined,
    expiresAt: formData.get("expiresAt") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const me = await currentUser();

  await forTenant(m.tenant.id).run((tx) =>
    tx.insert(scAnnouncements).values({
      traceyTenantId: m.tenant.id,
      title: parsed.data.title,
      body: parsed.data.body,
      pinned: parsed.data.pinned === "on",
      expiresAt: parseExpiresOrNull(parsed.data.expiresAt),
      createdByUserId: me?.id ?? null,
    }),
  );
  revalidatePath("/app/announcements");
  revalidatePath("/app");
  redirect("/app/announcements?added=1");
}

export async function togglePinnedAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const nextRaw = String(formData.get("pinned") ?? "");
  if (!id) return;
  const m = await currentMembership();
  if (!m) return;
  if (requireAdmin(m.role) !== true) return;

  const nextPinned = nextRaw === "true";
  await forTenant(m.tenant.id).run((tx) =>
    tx
      .update(scAnnouncements)
      .set({ pinned: nextPinned, updatedAt: new Date() })
      .where(
        and(
          eq(scAnnouncements.id, id),
          eq(scAnnouncements.traceyTenantId, m.tenant.id),
        ),
      ),
  );
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

export async function deleteAnnouncementAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const m = await currentMembership();
  if (!m) return;
  if (requireAdmin(m.role) !== true) return;

  await forTenant(m.tenant.id).run((tx) =>
    tx
      .delete(scAnnouncements)
      .where(
        and(
          eq(scAnnouncements.id, id),
          eq(scAnnouncements.traceyTenantId, m.tenant.id),
        ),
      ),
  );
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}
