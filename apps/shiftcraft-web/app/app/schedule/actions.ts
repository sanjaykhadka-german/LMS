"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
} from "@tracey/db";
import { currentMembership, currentUser, requireUser } from "~/lib/auth/current";
import { notifyShiftOffered } from "~/lib/email";

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

export async function bulkPublishWeekAction(formData: FormData): Promise<void> {
  const weekStart = String(formData.get("weekStart") ?? "");
  const weekEnd = String(formData.get("weekEnd") ?? "");
  const locationId = String(formData.get("location") ?? "");
  if (!weekStart || !weekEnd) return;

  // Admin-only: surface the same error message as single-shift publish.
  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (membership.role !== "admin" && membership.role !== "owner") {
    throw new Error("Only admins can publish shifts.");
  }

  const conditions = [
    eq(scShifts.traceyTenantId, membership.tenant.id),
    eq(scShifts.status, "draft"),
    // Drizzle's between() expects Date|number, so we parse ISO strings here.
    sql`${scShifts.startsAt} >= ${new Date(weekStart)}`,
    sql`${scShifts.startsAt} < ${new Date(weekEnd)}`,
  ];
  if (locationId) conditions.push(eq(scShifts.locationId, locationId));

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: "published", updatedAt: new Date() })
      .where(and(...conditions)),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
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

export async function duplicateShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const weeks = Number(formData.get("weeks") ?? 1);
  if (!id) return;
  const tenant = await requireTenant();
  const user = await currentUser();
  const offsetMs = weeks * 7 * 24 * 60 * 60 * 1000;

  const [source] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
      })
      .from(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)))
      .limit(1),
  );
  if (!source) return;

  const [created] = await forTenant(tenant.id).run((tx) =>
    tx
      .insert(scShifts)
      .values({
        traceyTenantId: tenant.id,
        locationId: source.locationId,
        role: source.role,
        startsAt: new Date(source.startsAt.getTime() + offsetMs),
        endsAt: new Date(source.endsAt.getTime() + offsetMs),
        notes: source.notes,
        createdByUserId: user?.id ?? null,
      })
      .returning({ id: scShifts.id }),
  );

  revalidatePath("/app/schedule");
  if (created) redirect(`/app/schedule/${created.id}/edit`);
}

// ─── Assignments ───

async function requireAdminMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (m.role !== "admin" && m.role !== "owner") {
    throw new Error("Only admins can assign shifts.");
  }
  return m;
}

const assignSchema = z.object({
  shiftId: z.string().uuid(),
  userId: z.string().uuid("Pick an employee"),
});

export async function assignEmployeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignSchema.safeParse({
    shiftId: formData.get("shiftId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please pick an employee.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireAdminMembership();
  try {
    await forTenant(membership.tenant.id).run((tx) =>
      tx.insert(scShiftAssignments).values({
        shiftId: parsed.data.shiftId,
        userId: parsed.data.userId,
      }),
    );
  } catch (err) {
    // Unique index sc_shift_user_uq triggers on duplicate (shift, user).
    if (err instanceof Error && err.message.includes("sc_shift_user_uq")) {
      return {
        status: "error",
        message: "That employee is already assigned to this shift.",
      };
    }
    throw err;
  }

  // Email after commit. Both lookups are best-effort — if either fails or
  // the user has no email, the offer still exists in the DB and the
  // employee will see it next time they open /app/my-shifts.
  const [recipientRow] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);
  if (recipientRow) {
    const [shiftRow] = await forTenant(membership.tenant.id).run((tx) =>
      tx
        .select({
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          role: scShifts.role,
          locationName: scLocations.name,
        })
        .from(scShifts)
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(eq(scShifts.id, parsed.data.shiftId))
        .limit(1),
    );
    if (shiftRow) {
      await notifyShiftOffered({ to: recipientRow, shift: shiftRow });
    }
  }

  revalidatePath(`/app/schedule/${parsed.data.shiftId}/edit`);
  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return { status: "ok", message: "Offer sent." };
}

export async function unassignAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!id) return;
  const membership = await requireAdminMembership();
  await forTenant(membership.tenant.id).run((tx) =>
    tx.delete(scShiftAssignments).where(eq(scShiftAssignments.id, id)),
  );
  if (shiftId) revalidatePath(`/app/schedule/${shiftId}/edit`);
  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
}

async function respondToOffer(
  assignmentId: string,
  next: "accepted" | "declined",
) {
  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  const user = await requireUser();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShiftAssignments)
      .set({ status: next, respondedAt: new Date() })
      .where(
        and(
          eq(scShiftAssignments.id, assignmentId),
          eq(scShiftAssignments.userId, user.id),
          eq(scShiftAssignments.status, "offered"),
        ),
      ),
  );
  revalidatePath("/app/my-shifts");
  revalidatePath("/app/schedule");
}

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await respondToOffer(id, "accepted");
}

export async function declineOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await respondToOffer(id, "declined");
}
