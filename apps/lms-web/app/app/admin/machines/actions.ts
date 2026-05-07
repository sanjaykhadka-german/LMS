"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db, lmsMachineModules, lmsMachines, lmsModules } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import type { FormState } from "../_components/NameCrudForm";

export async function createMachineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  const parsed = z
    .object({ name: z.string().trim().min(1, "Name is required").max(100) })
    .safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const name = parsed.data.name;

  const existing = await db
    .select({ id: lmsMachines.id })
    .from(lmsMachines)
    .where(eq(lmsMachines.name, name))
    .limit(1);
  if (existing[0]) {
    return { status: "error", message: `Machine '${name}' already exists.` };
  }

  const [row] = await db.insert(lmsMachines).values({ name }).returning({ id: lmsMachines.id });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.created",
    targetKind: "machine",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/machines");
  return { status: "ok", message: `Machine '${name}' added.` };
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required").max(100),
  departmentId: z.string().optional(),
  moduleIds: z.array(z.string()).default([]),
});

export async function updateMachineAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    departmentId: formData.get("department_id") ?? "",
    moduleIds: formData.getAll("module_ids").map(String),
  });
  if (!parsed.success) throw new Error("Invalid machine form");
  const { id, name } = parsed.data;
  const departmentId = parsed.data.departmentId && /^\d+$/.test(parsed.data.departmentId)
    ? parseInt(parsed.data.departmentId, 10)
    : null;
  const moduleIds = parsed.data.moduleIds.filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));

  // Reject duplicate names against any other machine.
  const dupe = await db
    .select({ id: lmsMachines.id })
    .from(lmsMachines)
    .where(and(eq(lmsMachines.name, name), ne(lmsMachines.id, id)))
    .limit(1);
  if (dupe[0]) {
    redirect(`/app/admin/machines/${id}/edit?error=duplicate`);
  }

  // Sync the M2M to exactly the chosen module ids — clear-and-reinsert is
  // simpler than diffing and is fine for a small set.
  await db.transaction(async (tx) => {
    await tx
      .update(lmsMachines)
      .set({ name, departmentId })
      .where(eq(lmsMachines.id, id));
    await tx.delete(lmsMachineModules).where(eq(lmsMachineModules.machineId, id));
    if (moduleIds.length > 0) {
      // Defensive filter: only link to modules that actually exist.
      const realModules = await tx
        .select({ id: lmsModules.id })
        .from(lmsModules)
        .where(inArray(lmsModules.id, moduleIds));
      const realIds = realModules.map((r) => r.id);
      if (realIds.length > 0) {
        await tx.insert(lmsMachineModules).values(
          realIds.map((moduleId) => ({ machineId: id, moduleId })),
        );
      }
    }
  });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.updated",
    targetKind: "machine",
    targetId: String(id),
    details: { name, moduleIdsLinked: moduleIds.length },
  });
  revalidatePath("/app/admin/machines");
  redirect("/app/admin/machines");
}

export async function deleteMachineAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db
    .select({ id: lmsMachines.id, name: lmsMachines.name })
    .from(lmsMachines)
    .where(eq(lmsMachines.id, id))
    .limit(1);
  if (!target) throw new Error("Machine not found");

  // FK cascades on user_machines / machine_modules drop their rows.
  await db.delete(lmsMachines).where(eq(lmsMachines.id, id));

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.deleted",
    targetKind: "machine",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/machines");
}
