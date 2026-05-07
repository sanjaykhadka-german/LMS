import { auditEvents, db, lmsAuditLogs } from "@tracey/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "~/lib/auth/admin";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export const metadata = { title: "Audit logs" };

interface UnifiedRow {
  source: "tracey" | "flask";
  id: string;
  createdAt: Date;
  actorEmail: string | null;
  action: string;
  entity: string;
  summary: string;
}

export default async function AuditLogsPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [tracey, flask] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        actorEmail: auditEvents.actorEmail,
        action: auditEvents.action,
        targetKind: auditEvents.targetKind,
        targetId: auditEvents.targetId,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tid))
      .orderBy(desc(auditEvents.createdAt))
      .limit(200),
    db
      .select({
        id: lmsAuditLogs.id,
        createdAt: lmsAuditLogs.createdAt,
        actorEmail: lmsAuditLogs.actorEmail,
        action: lmsAuditLogs.action,
        entityType: lmsAuditLogs.entityType,
        entityId: lmsAuditLogs.entityId,
        summary: lmsAuditLogs.summary,
      })
      .from(lmsAuditLogs)
      .where(eq(lmsAuditLogs.traceyTenantId, tid))
      .orderBy(desc(lmsAuditLogs.createdAt))
      .limit(200),
  ]);

  const unified: UnifiedRow[] = [];
  for (const t of tracey) {
    unified.push({
      source: "tracey",
      id: `tracey-${t.id}`,
      createdAt: t.createdAt ?? new Date(0),
      actorEmail: t.actorEmail ?? null,
      action: t.action,
      entity: [t.targetKind, t.targetId].filter(Boolean).join("#") || "—",
      summary:
        t.details && typeof t.details === "object"
          ? JSON.stringify(t.details)
          : "",
    });
  }
  for (const f of flask) {
    unified.push({
      source: "flask",
      id: `flask-${f.id}`,
      createdAt: f.createdAt,
      actorEmail: f.actorEmail || null,
      action: f.action,
      entity: [f.entityType, f.entityId].filter((x) => x !== null && x !== undefined).join("#") || "—",
      summary: f.summary ?? "",
    });
  }
  unified.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const rows = unified.slice(0, 300);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit logs</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Unified view of Tracey-side <code>app.audit_events</code> (subscription
          + invitation events) and Flask-side <code>public.audit_logs</code>{" "}
          (admin actions). Showing the most recent 300.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent events ({rows.length})</CardTitle>
          <CardDescription>
            Tracey events surface in the platform-admin /platform/audit page too;
            this page is the per-tenant slice.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">When</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-6 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No audit events yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-6 py-2 align-middle">
                        {r.createdAt.toLocaleString("en-AU")}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Badge variant={r.source === "tracey" ? "default" : "secondary"}>
                          {r.source}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 align-middle">{r.actorEmail ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">
                        <code className="text-xs">{r.action}</code>
                      </td>
                      <td className="px-3 py-2 align-middle text-xs">{r.entity}</td>
                      <td className="px-6 py-2 align-middle text-xs text-[color:var(--muted-foreground)] max-w-md truncate">
                        {r.summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
