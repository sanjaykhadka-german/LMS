"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scShifts } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const shiftSchema = z
  .object({
    locationId: z.string().uuid("Pick a location"),
    role: z.string().trim().min(1, "Role is required").max(80),
    startsAt: z
      .string()
      .min(1, "Start time is required")
      .transform((s) => new Date(s)),
    endsAt: z
      .string()
      .min(1, "End time is required")
      .transform((s) => new Date(s)),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((v) => v.startsAt instanceof Date && !isNaN(v.startsAt.getTime()), {
    path: ["startsAt"],
    message: "Invalid start time",
  })
  .refine((v) => v.endsAt instanceof Date && !isNaN(v.endsAt.getTime()), {
    path: ["endsAt"],
    message: "Invalid end time",
  })
  .refine((v) => v.endsAt > v.startsAt, {
    path: ["endsAt"],
    message: "End must be after start",
  });

async function requireTenant() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace to manage shifts.");
  return m.tenant;
}

export async function createShiftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shiftSchema.safeParse({
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  const user = await currentUser();
  await forTenant(tenant.id).run((tx) =>
    tx.insert(scShifts).values({
      traceyTenantId: tenant.id,
      locationId: parsed.data.locationId,
      role: parsed.data.role,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      notes: parsed.data.notes?.length ? parsed.data.notes : null,
      createdByUserId: user?.id ?? null,
    }),
  );
  revalidatePath("/app/schedule");
  redirect("/app/schedule");
}

export async function updateShiftAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shiftSchema.safeParse({
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({
        locationId: parsed.data.locationId,
        role: parsed.data.role,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        notes: parsed.data.notes?.length ? parsed.data.notes : null,
        updatedAt: new Date(),
      })
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  revalidatePath(`/app/schedule/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

async function setShiftStatus(
  id: string,
  next: "draft" | "published" | "cancelled",
) {
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  revalidatePath(`/app/schedule/${id}/edit`);
}

export async function publishShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setShiftStatus(id, "published");
}

export async function cancelShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setShiftStatus(id, "cancelled");
}

export async function deleteShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  redirect("/app/schedule");
}
