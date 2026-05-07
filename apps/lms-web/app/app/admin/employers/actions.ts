"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsEmployers, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import type { FormState } from "../_components/NameCrudForm";

const nameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Too long"),
});

export async function createEmployerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
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
    .select({ id: lmsEmployers.id })
    .from(lmsEmployers)
    .where(eq(lmsEmployers.name, name))
    .limit(1);
  if (existing[0]) {
    return { status: "error", message: `Employer '${name}' already exists.` };
  }

  const [row] = await db.insert(lmsEmployers).values({ name }).returning({ id: lmsEmployers.id });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employer.created",
    targetKind: "employer",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/employers");
  return { status: "ok", message: `Employer '${name}' added.` };
}

export async function deleteEmployerAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db
    .select({ id: lmsEmployers.id, name: lmsEmployers.name })
    .from(lmsEmployers)
    .where(eq(lmsEmployers.id, id))
    .limit(1);
  if (!target) throw new Error("Employer not found");

  await db.transaction(async (tx) => {
    await tx
      .update(lmsUsers)
      .set({ employerId: null })
      .where(eq(lmsUsers.employerId, id));
    await tx.delete(lmsEmployers).where(eq(lmsEmployers.id, id));
  });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employer.deleted",
    targetKind: "employer",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/employers");
}
