"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsPositions, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import type { FormState } from "../_components/NameCrudForm";

const baseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
});

function parseOptionalInt(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

export async function createPositionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  const parsed = baseSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const name = parsed.data.name;
  const parentId = parseOptionalInt(formData.get("parent_id"));
  const departmentId = parseOptionalInt(formData.get("department_id"));

  const [row] = await db
    .insert(lmsPositions)
    .values({ name, parentId, departmentId })
    .returning({ id: lmsPositions.id });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.created",
    targetKind: "position",
    targetId: String(row?.id ?? ""),
    details: { name, parentId, departmentId },
  });
  revalidatePath("/app/admin/positions");
  return { status: "ok", message: `Position '${name}' added.` };
}

export async function updatePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseOptionalInt(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const parsed = baseSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    redirect(`/app/admin/positions/${id}/edit?error=name`);
  }
  const name = parsed.data.name;
  let parentId = parseOptionalInt(formData.get("parent_id"));
  const departmentId = parseOptionalInt(formData.get("department_id"));

  const [current] = await db.select().from(lmsPositions).where(eq(lmsPositions.id, id)).limit(1);
  if (!current) throw new Error("Position not found");

  // Cycle guard — port of app.py:1582-1593. Self-as-parent and direct-child
  // -as-parent only; deeper cycles are unlikely in practice.
  if (parentId === id) {
    parentId = current.parentId;
  } else if (parentId !== null) {
    const [candidate] = await db
      .select({ parentId: lmsPositions.parentId })
      .from(lmsPositions)
      .where(eq(lmsPositions.id, parentId))
      .limit(1);
    if (candidate?.parentId === id) {
      parentId = current.parentId;
    }
  }

  await db
    .update(lmsPositions)
    .set({ name, parentId, departmentId })
    .where(eq(lmsPositions.id, id));

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.updated",
    targetKind: "position",
    targetId: String(id),
    details: { name, parentId, departmentId },
  });
  revalidatePath("/app/admin/positions");
  redirect("/app/admin/positions");
}

export async function deletePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseOptionalInt(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const [target] = await db
    .select()
    .from(lmsPositions)
    .where(eq(lmsPositions.id, id))
    .limit(1);
  if (!target) throw new Error("Position not found");

  await db.transaction(async (tx) => {
    // Reparent children to this position's parent so they don't orphan
    // (matches Flask app.py:1613-1614).
    await tx
      .update(lmsPositions)
      .set({ parentId: target.parentId })
      .where(eq(lmsPositions.parentId, id));
    // Users hold this position via FK; clearing position_id is the visible
    // effect the audit message describes.
    await tx
      .update(lmsUsers)
      .set({ positionId: null })
      .where(eq(lmsUsers.positionId, id));
    await tx.delete(lmsPositions).where(eq(lmsPositions.id, id));
  });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.deleted",
    targetKind: "position",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/positions");
}
