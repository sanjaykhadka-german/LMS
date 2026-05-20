import "server-only";
import { eq } from "drizzle-orm";
import { db, tenants } from "@tracey/db";

/** One-shot fetch of `app.tenants.audit_mode` for code paths that don't
 *  already hold a `LearnerContext` (e.g. server actions that go through
 *  their own auth helpers, or background jobs that load the tenant id
 *  from elsewhere). Page server components and admin actions should read
 *  `ctx.tenantAuditMode` instead — it's already populated by
 *  `requireAdmin()` / `requireLearner()` with no extra round-trip. */
export async function getAuditMode(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ auditMode: tenants.auditMode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.auditMode ?? false;
}
