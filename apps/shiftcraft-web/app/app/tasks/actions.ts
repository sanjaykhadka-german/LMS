"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scTasks,
  type ScTaskPriority,
  type ScTaskStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const TASK_STATUSES: ScTaskStatus[] = ["open", "in_progress", "done"];
const TASK_PRIORITIES: ScTaskPriority[] = ["low", "normal", "high", "urgent"];

const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  status: z.enum(["open", "in_progress", "done"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  assigneeUserId: z.string().trim().optional().or(z.literal("")),
  locationId: z.string().trim().optional().or(z.literal("")),
  dueDate: z.string().trim().optional().or(z.literal("")),
});

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireTenant() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace to manage tasks.");
  return m.tenant;
}

function parseDateOrNull(v: string | null): string | null {
  // Date column accepts YYYY-MM-DD strings — pass through, or null.
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function createTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    status: formData.get("status") ?? "open",
    priority: formData.get("priority") ?? "normal",
    assigneeUserId: formData.get("assigneeUserId") ?? "",
    locationId: formData.get("locationId") ?? "",
    dueDate: formData.get("dueDate") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenant = await requireTenant();
  const me = await currentUser();

  await forTenant(tenant.id).run((tx) =>
    tx.insert(scTasks).values({
      traceyTenantId: tenant.id,
      title: parsed.data.title,
      description: emptyToNull(parsed.data.description),
      status: parsed.data.status,
      priority: parsed.data.priority,
      assigneeUserId: emptyToNull(parsed.data.assigneeUserId),
      locationId: emptyToNull(parsed.data.locationId),
      dueDate: parseDateOrNull(emptyToNull(parsed.data.dueDate)),
      createdByUserId: me?.id ?? null,
      completedAt: parsed.data.status === "done" ? new Date() : null,
    }),
  );

  revalidatePath("/app/tasks");
  redirect("/app/tasks?added=1");
}

export async function updateTaskAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    status: formData.get("status") ?? "open",
    priority: formData.get("priority") ?? "normal",
    assigneeUserId: formData.get("assigneeUserId") ?? "",
    locationId: formData.get("locationId") ?? "",
    dueDate: formData.get("dueDate") ?? "",
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
      .update(scTasks)
      .set({
        title: parsed.data.title,
        description: emptyToNull(parsed.data.description),
        status: parsed.data.status,
        priority: parsed.data.priority,
        assigneeUserId: emptyToNull(parsed.data.assigneeUserId),
        locationId: emptyToNull(parsed.data.locationId),
        dueDate: parseDateOrNull(emptyToNull(parsed.data.dueDate)),
        // Stamp completed_at on the transition to done; clear on transition
        // back. Using a CASE so we don't overwrite an existing
        // completed_at when the row already had status='done'.
        completedAt:
          parsed.data.status === "done"
            ? (sql`COALESCE(${scTasks.completedAt}, now())` as unknown as Date)
            : null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(scTasks.id, id), eq(scTasks.traceyTenantId, tenant.id)),
      ),
  );
  revalidatePath("/app/tasks");
  revalidatePath(`/app/tasks/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

export async function moveTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const nextStatus = String(formData.get("status") ?? "");
  if (!id || !(TASK_STATUSES as string[]).includes(nextStatus)) return;
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scTasks)
      .set({
        status: nextStatus as ScTaskStatus,
        completedAt:
          nextStatus === "done"
            ? (sql`COALESCE(${scTasks.completedAt}, now())` as unknown as Date)
            : null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(scTasks.id, id), eq(scTasks.traceyTenantId, tenant.id)),
      ),
  );
  revalidatePath("/app/tasks");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tenant = await requireTenant();
  const [doomed] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({ title: scTasks.title })
      .from(scTasks)
      .where(and(eq(scTasks.id, id), eq(scTasks.traceyTenantId, tenant.id)))
      .limit(1),
  );
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scTasks)
      .where(
        and(eq(scTasks.id, id), eq(scTasks.traceyTenantId, tenant.id)),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.task.deleted",
    targetKind: "sc_task",
    targetId: id,
    details: doomed ? { title: doomed.title } : null,
  });
  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}

export { TASK_STATUSES, TASK_PRIORITIES };
