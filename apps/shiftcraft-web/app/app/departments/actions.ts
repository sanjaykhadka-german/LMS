"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const departmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireManagerTenant() {
  const m = await currentMembership();
  if (!m) return { ok: false as const, message: "No workspace selected." };
  if (!isAtLeastManager(m.role)) {
    return {
      ok: false as const,
      message: "Only managers can manage departments.",
    };
  }
  return { ok: true as const, tenantId: m.tenant.id };
}

export async function createDepartmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await requireManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = departmentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Case-insensitive uniqueness precheck — surfaces a friendly error
  // before relying on the partial unique index throwing 23505.
  const existing = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scDepartments.id })
      .from(scDepartments)
      .where(
        and(
          eq(scDepartments.traceyTenantId, g.tenantId),
          sql`lower(${scDepartments.name}) = lower(${parsed.data.name})`,
        ),
      )
      .limit(1),
  );
  if (existing.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["A department with this name already exists."] },
    };
  }

  await forTenant(g.tenantId).run((tx) =>
    tx.insert(scDepartments).values({
      traceyTenantId: g.tenantId,
      name: parsed.data.name,
      description: emptyToNull(parsed.data.description),
    }),
  );
  await logAuditEvent({
    action: "shiftcraft.department.created",
    targetKind: "sc_department",
    details: { name: parsed.data.name },
  });
  revalidatePath("/app/departments");
  redirect("/app/departments?added=1");
}

export async function updateDepartmentAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await requireManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = departmentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Uniqueness precheck excluding this row.
  const dup = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scDepartments.id })
      .from(scDepartments)
      .where(
        and(
          eq(scDepartments.traceyTenantId, g.tenantId),
          sql`lower(${scDepartments.name}) = lower(${parsed.data.name})`,
          sql`${scDepartments.id} <> ${id}`,
        ),
      )
      .limit(1),
  );
  if (dup.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["Another department already uses this name."] },
    };
  }

  await forTenant(g.tenantId).run((tx) =>
    tx
      .update(scDepartments)
      .set({
        name: parsed.data.name,
        description: emptyToNull(parsed.data.description),
      })
      .where(
        and(
          eq(scDepartments.id, id),
          eq(scDepartments.traceyTenantId, g.tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.department.updated",
    targetKind: "sc_department",
    targetId: id,
    details: { name: parsed.data.name },
  });
  revalidatePath("/app/departments");
  revalidatePath(`/app/departments/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

/**
 * Delete a department. The sc_employees.department_id FK is
 * ON DELETE SET NULL so existing employees auto-detach into "no
 * department" — no data loss. The action returns the count of detached
 * employees so the UI can show a confirmation message.
 */
export async function deleteDepartmentAction(formData: FormData): Promise<void> {
  const g = await requireManagerTenant();
  if (!g.ok) {
    console.warn("[deleteDepartmentAction] refused:", g.message);
    return;
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Capture name + employee count for the audit log before delete.
  const [doomed] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({
        name: scDepartments.name,
        employeeCount: sql<number>`(
          SELECT count(*)::int FROM ${scEmployees}
          WHERE ${scEmployees.departmentId} = ${scDepartments.id}
        )`,
      })
      .from(scDepartments)
      .where(
        and(
          eq(scDepartments.id, id),
          eq(scDepartments.traceyTenantId, g.tenantId),
        ),
      )
      .limit(1),
  );

  await forTenant(g.tenantId).run((tx) =>
    tx
      .delete(scDepartments)
      .where(
        and(
          eq(scDepartments.id, id),
          eq(scDepartments.traceyTenantId, g.tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.department.deleted",
    targetKind: "sc_department",
    targetId: id,
    details: doomed
      ? { name: doomed.name, detachedEmployees: doomed.employeeCount }
      : null,
  });

  revalidatePath("/app/departments");
  revalidatePath("/app/employees");
  redirect("/app/departments");
}
