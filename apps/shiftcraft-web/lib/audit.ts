import "server-only";
import { auditEvents, db } from "@tracey/db";
import { currentMembership, currentUser } from "./auth/current";

// Best-effort writer for the shared `app.audit_events` log. Lives in the
// `app` schema (not per-tenant) — see the comment in
// packages/db/src/schema.ts for why. Tenant scoping is via the
// `tenant_id` column.
//
// Patterns matching how lms-web / platform-admin log events:
//   - action: dotted lowercase string ("employee.deleted", "task.deleted")
//   - targetKind: the model name ("sc_employee", "sc_task", …)
//   - targetId: the row id (text — audit table is polymorphic)
//   - details: jsonb for any extra context (name, before/after, etc.)
//
// We always swallow errors here — audit failures must never break the
// underlying action that triggered them. Surfaces show "audit log
// unavailable" if the table is missing, otherwise it's a no-op return.

export interface AuditWriteInput {
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logAuditEvent(input: AuditWriteInput): Promise<void> {
  try {
    const me = await currentUser();
    const membership = await currentMembership();
    await db.insert(auditEvents).values({
      tenantId: membership?.tenant.id ?? null,
      actorUserId: me?.id ?? null,
      actorEmail: me?.email ?? null,
      action: input.action,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      details: (input.details ?? null) as never,
    });
  } catch (err) {
    console.error("[audit] insert failed:", input.action, err);
  }
}
