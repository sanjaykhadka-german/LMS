"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  db,
  lmsDepartmentModulePolicies,
  lmsDepartments,
  lmsModules,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";

// Port of /admin/departments/policies POST (app.py:3299-3339). Form posts
// `policy_<dept>_<module>` checkboxes; we diff desired vs existing and only
// write the delta.

export async function saveDepartmentPoliciesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();

  const departments = await db
    .select({ id: lmsDepartments.id })
    .from(lmsDepartments);
  const moduleRows = await db
    .select({ id: lmsModules.id })
    .from(lmsModules)
    .where(eq(lmsModules.isPublished, true));
  const validDepartmentIds = new Set(departments.map((d) => d.id));
  const validModuleIds = new Set(moduleRows.map((m) => m.id));

  // Decode the desired set from posted checkbox keys.
  const desired = new Set<string>(); // "<dept>:<module>"
  for (const key of formData.keys()) {
    if (!key.startsWith("policy_")) continue;
    const parts = key.slice("policy_".length).split("_");
    if (parts.length !== 2) continue;
    const did = parseInt(parts[0]!, 10);
    const mid = parseInt(parts[1]!, 10);
    if (!Number.isFinite(did) || !Number.isFinite(mid)) continue;
    if (validDepartmentIds.has(did) && validModuleIds.has(mid)) {
      desired.add(`${did}:${mid}`);
    }
  }

  const existingRows = await db
    .select({
      id: lmsDepartmentModulePolicies.id,
      departmentId: lmsDepartmentModulePolicies.departmentId,
      moduleId: lmsDepartmentModulePolicies.moduleId,
    })
    .from(lmsDepartmentModulePolicies);
  const existing = new Map<string, number>();
  for (const r of existingRows) {
    existing.set(`${r.departmentId}:${r.moduleId}`, r.id);
  }

  const toAdd: Array<{ departmentId: number; moduleId: number }> = [];
  const toDeleteIds: number[] = [];
  for (const key of desired) {
    if (!existing.has(key)) {
      const [d, m] = key.split(":").map((n) => parseInt(n, 10));
      toAdd.push({ departmentId: d!, moduleId: m! });
    }
  }
  for (const [key, id] of existing) {
    if (!desired.has(key)) toDeleteIds.push(id);
  }

  if (toAdd.length === 0 && toDeleteIds.length === 0) {
    redirect("/app/admin/departments/policies?info=nochange");
  }

  await db.transaction(async (tx) => {
    if (toAdd.length > 0) {
      await tx.insert(lmsDepartmentModulePolicies).values(toAdd);
    }
    for (const id of toDeleteIds) {
      await tx
        .delete(lmsDepartmentModulePolicies)
        .where(eq(lmsDepartmentModulePolicies.id, id));
    }
  });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.policies_updated",
    targetKind: "department",
    targetId: null as unknown as string,
    details: { added: toAdd.length, removed: toDeleteIds.length },
  });

  revalidatePath("/app/admin/departments/policies");
  redirect(
    `/app/admin/departments/policies?ok=1&added=${toAdd.length}&removed=${toDeleteIds.length}`,
  );
}
