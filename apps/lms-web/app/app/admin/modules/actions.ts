"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsModules } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
});

export async function createModuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const parsed = createSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: parsed.error.flatten().fieldErrors.title ?? [] },
    };
  }

  const [row] = await db
    .insert(lmsModules)
    .values({
      title: parsed.data.title,
      isPublished: false,
      createdById: ctx.lmsUser.id,
      traceyTenantId: tid,
    })
    .returning({ id: lmsModules.id });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.created",
    targetKind: "module",
    targetId: String(row?.id ?? ""),
    details: { title: parsed.data.title },
  });
  revalidatePath("/app/admin/modules");
  if (row?.id) redirect(`/app/admin/modules/${row.id}`);
  return { status: "ok", message: "Module created." };
}

export async function deleteModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db
    .select({ id: lmsModules.id, title: lmsModules.title })
    .from(lmsModules)
    .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)))
    .limit(1);
  if (!target) throw new Error("Module not found");

  // FK cascades on content_items, questions, assignments, etc. drop their rows.
  await db
    .delete(lmsModules)
    .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.deleted",
    targetKind: "module",
    targetId: String(id),
    details: { title: target.title },
  });
  revalidatePath("/app/admin/modules");
}
