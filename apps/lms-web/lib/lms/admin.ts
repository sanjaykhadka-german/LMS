import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsDepartmentModulePolicies,
  lmsModules,
} from "@tracey/db";

const DEFAULT_ASSIGNMENT_VALIDITY_DAYS = 180;

function computeDueAt(validForDays: number | null | undefined, now: Date): Date | null {
  // Mirror assignment_due_from (app.py:209-215): module.valid_for_days
  // overrides default; null means "never expires".
  const days = validForDays ?? DEFAULT_ASSIGNMENT_VALIDITY_DAYS;
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Port of auto_assign_for_department (app.py:259-300). Idempotent — relies
 *  on the unique (user_id, module_id) constraint to ignore duplicates that
 *  win a race. Returns count of new assignments created.
 *
 *  Module.is_published is respected (only published modules are assigned).
 *  Modules already assigned to the user are skipped, regardless of
 *  completed_at status. */
export async function autoAssignForDepartment(opts: {
  userId: number;
  departmentId: number | null;
}): Promise<number> {
  if (!opts.departmentId) return 0;

  const policyRows = await db
    .select({ moduleId: lmsDepartmentModulePolicies.moduleId })
    .from(lmsDepartmentModulePolicies)
    .where(eq(lmsDepartmentModulePolicies.departmentId, opts.departmentId));
  const policyModuleIds = policyRows.map((r) => r.moduleId);
  if (policyModuleIds.length === 0) return 0;

  const existingRows = await db
    .select({ moduleId: lmsAssignments.moduleId })
    .from(lmsAssignments)
    .where(eq(lmsAssignments.userId, opts.userId));
  const existing = new Set(existingRows.map((r) => r.moduleId));

  const candidateIds = policyModuleIds.filter((mid) => !existing.has(mid));
  if (candidateIds.length === 0) return 0;

  const candidateModules = await db
    .select({
      id: lmsModules.id,
      isPublished: lmsModules.isPublished,
      validForDays: lmsModules.validForDays,
    })
    .from(lmsModules)
    .where(inArray(lmsModules.id, candidateIds));

  const now = new Date();
  const valuesToInsert = candidateModules
    .filter((m) => m.isPublished === true)
    .map((m) => ({
      userId: opts.userId,
      moduleId: m.id,
      assignedAt: now,
      dueAt: computeDueAt(m.validForDays, now),
    }));

  if (valuesToInsert.length === 0) return 0;
  // Insert in one batch; if a concurrent insert wins the race on
  // (user_id, module_id), Postgres raises 23505 — swallow and refetch
  // count to stay idempotent.
  try {
    const inserted = await db
      .insert(lmsAssignments)
      .values(valuesToInsert)
      .onConflictDoNothing({ target: [lmsAssignments.userId, lmsAssignments.moduleId] })
      .returning({ id: lmsAssignments.id });
    return inserted.length;
  } catch (err) {
    console.error("[autoAssignForDepartment]", err);
    return 0;
  }
}

/** True iff (departmentId, moduleId) is currently in
 *  department_module_policies. Use to avoid unnecessary writes when an
 *  admin re-saves an unchanged checkbox grid. */
export async function policyExists(
  departmentId: number,
  moduleId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: lmsDepartmentModulePolicies.id })
    .from(lmsDepartmentModulePolicies)
    .where(
      and(
        eq(lmsDepartmentModulePolicies.departmentId, departmentId),
        eq(lmsDepartmentModulePolicies.moduleId, moduleId),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}
