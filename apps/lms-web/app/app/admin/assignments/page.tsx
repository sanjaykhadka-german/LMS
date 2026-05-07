import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { deleteAssignmentAction } from "./actions";

export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const rows = await db
    .select({
      id: lmsAssignments.id,
      moduleId: lmsAssignments.moduleId,
      moduleTitle: lmsModules.title,
      userId: lmsAssignments.userId,
      userName: lmsUsers.name,
      userEmail: lmsUsers.email,
      assignedAt: lmsAssignments.assignedAt,
      dueAt: lmsAssignments.dueAt,
      completedAt: lmsAssignments.completedAt,
    })
    .from(lmsAssignments)
    .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
    .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
    .where(tenantWhere(lmsAssignments, tid))
    .orderBy(asc(lmsModules.title), asc(lmsUsers.name));

  // Also expose the most-recent assignments at the top.
  const recent = await db
    .select({
      id: lmsAssignments.id,
      moduleTitle: lmsModules.title,
      userName: lmsUsers.name,
      assignedAt: lmsAssignments.assignedAt,
    })
    .from(lmsAssignments)
    .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
    .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
    .where(tenantWhere(lmsAssignments, tid))
    .orderBy(desc(lmsAssignments.assignedAt))
    .limit(5);

  const now = Date.now();
  const soonMs = 14 * 24 * 60 * 60 * 1000;
  let total = 0;
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  for (const r of rows) {
    total += 1;
    if (r.completedAt) completed += 1;
    else if (r.dueAt) {
      const t = r.dueAt.getTime();
      if (t < now) overdue += 1;
      else if (t < now + soonMs) dueSoon += 1;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Every (user, module) pair across the workspace. Use a module page to
          bulk-assign. Use this page to spot-check status and unassign individual rows.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="Total" value={total} />
        <SummaryStat label="Completed" value={completed} variant="success" />
        <SummaryStat label="Overdue" value={overdue} variant="destructive" />
        <SummaryStat label="Due ≤14d" value={dueSoon} variant="warning" />
      </div>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recently assigned</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)] p-0">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-6 py-2 text-sm">
                <span>
                  <strong>{r.userName}</strong> → {r.moduleTitle}
                </span>
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {r.assignedAt ? r.assignedAt.toLocaleString("en-AU") : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All assignments ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Module</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Assigned</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-6 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No assignments yet — use a module page to assign training.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const status = r.completedAt
                      ? "completed"
                      : r.dueAt && r.dueAt.getTime() < now
                        ? "overdue"
                        : r.dueAt && r.dueAt.getTime() < now + soonMs
                          ? "due_soon"
                          : "open";
                    return (
                      <tr key={r.id}>
                        <td className="px-6 py-3 align-middle">
                          <Link
                            href={`/app/admin/modules/${r.moduleId}`}
                            className="font-medium hover:underline"
                          >
                            {r.moduleTitle}
                          </Link>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div>{r.userName}</div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">{r.userEmail}</div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {r.assignedAt ? r.assignedAt.toLocaleDateString("en-AU") : "—"}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          {r.dueAt ? r.dueAt.toLocaleDateString("en-AU") : "—"}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-6 py-3 align-middle text-right">
                          <DeleteRowForm
                            action={deleteAssignmentAction}
                            id={r.id}
                            label="Unassign"
                            confirmMessage={`Unassign ${r.userName} from '${r.moduleTitle}'?`}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "success" | "destructive" | "warning";
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {variant && <Badge variant={variant}>{label}</Badge>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge variant="success">Completed</Badge>;
  if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (status === "due_soon") return <Badge variant="warning">Due soon</Badge>;
  return <Badge variant="outline">Open</Badge>;
}
