"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsDepartments, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const nameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Too long"),
});

export async function createDepartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const name = parsed.data.name;

  const existing = await db
    .select({ id: lmsDepartments.id })
    .from(lmsDepartments)
    .where(and(eq(lmsDepartments.name, name), tenantWhere(lmsDepartments, tid)))
    .limit(1);
  if (existing[0]) {
    return { status: "error", message: `Department '${name}' already exists.` };
  }

  const [row] = await db
    .insert(lmsDepartments)
    .values({ name, traceyTenantId: tid })
    .returning({ id: lmsDepartments.id });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.created",
    targetKind: "department",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/departments");
  return { status: "ok", message: `Department '${name}' added.` };
}

export async function deleteDepartmentAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db
    .select({ id: lmsDepartments.id, name: lmsDepartments.name })
    .from(lmsDepartments)
    .where(and(eq(lmsDepartments.id, id), tenantWhere(lmsDepartments, tid)))
    .limit(1);
  if (!target) throw new Error("Department not found");

  // Reassign users with this department to NULL — matches Flask delete path
  // (app.py:3351). Done in one tx so a partial fail leaves nothing dangling.
  await db.transaction(async (tx) => {
    await tx
      .update(lmsUsers)
      .set({ departmentId: null })
      .where(and(eq(lmsUsers.departmentId, id), eq(lmsUsers.traceyTenantId, tid)));
    await tx
      .delete(lmsDepartments)
      .where(and(eq(lmsDepartments.id, id), tenantWhere(lmsDepartments, tid)));
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.deleted",
    targetKind: "department",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/departments");
}
