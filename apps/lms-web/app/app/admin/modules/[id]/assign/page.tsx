import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { bulkAssignModuleAction, unassignModuleAction } from "./actions";

export const metadata = { title: "Assign module" };

export default async function AssignModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; created?: string; requested?: string; info?: string }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();
  const sp = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [module] = await db
    .select()
    .from(lmsModules)
    .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
    .limit(1);
  if (!module) notFound();

  const [employees, currentRows] = await Promise.all([
    db
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        isActiveFlag: lmsUsers.isActiveFlag,
        departmentName: lmsDepartments.name,
      })
      .from(lmsUsers)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .where(eq(lmsUsers.traceyTenantId, tid))
      .orderBy(asc(lmsUsers.name)),
    db
      .select({
        id: lmsAssignments.id,
        userId: lmsAssignments.userId,
        userName: lmsUsers.name,
        userEmail: lmsUsers.email,
        assignedAt: lmsAssignments.assignedAt,
        dueAt: lmsAssignments.dueAt,
        completedAt: lmsAssignments.completedAt,
      })
      .from(lmsAssignments)
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
      .where(
        and(
          eq(lmsAssignments.moduleId, moduleId),
          tenantWhere(lmsAssignments, tid),
        ),
      )
      .orderBy(asc(lmsUsers.name)),
  ]);
  const alreadyAssigned = new Set(currentRows.map((r) => r.userId));

  return (
    <div className="space-y-6">
      <Link
        href={`/app/admin/modules/${moduleId}`}
        className="text-sm text-[color:var(--muted-foreground)] underline"
      >
        ← Back to edit
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assign “{module.title}”</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Pick staff to assign this module to. Existing assignees are
          listed at the bottom — tick more from the table to extend the list.
        </p>
      </div>

      {sp.ok === "1" && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Created {sp.created} new assignment{sp.created === "1" ? "" : "s"}{" "}
          (requested {sp.requested}; duplicates skipped silently).
        </div>
      )}
      {sp.info === "nochosen" && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] px-4 py-2 text-sm">
          No staff selected.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pick staff to assign</CardTitle>
          <CardDescription>
            Already-assigned staff are pre-checked and disabled — re-checking them does nothing
            (the unique (user, module) constraint silently skips duplicates).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={bulkAssignModuleAction} className="space-y-3">
            <input type="hidden" name="module_id" value={module.id} />
            <div className="max-h-96 overflow-y-auto rounded-md border border-[color:var(--border)] p-3">
              {employees.length === 0 ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  No staff in this workspace yet.
                </p>
              ) : (
                <ul className="divide-y divide-[color:var(--border)]">
                  {employees.map((e) => {
                    const already = alreadyAssigned.has(e.id);
                    return (
                      <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          name="user_ids"
                          value={e.id}
                          defaultChecked={already}
                          disabled={already}
                          className="h-4 w-4"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {e.name}
                            {!e.isActiveFlag && (
                              <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">(disabled)</span>
                            )}
                          </div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            {e.email}
                            {e.departmentName && <> · {e.departmentName}</>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Button type="submit">Assign selected</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Already assigned ({currentRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {currentRows.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No assignments yet.
            </p>
          ) : (
            currentRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.userName}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {r.userEmail}
                    {r.dueAt && <> · Due {r.dueAt.toLocaleDateString("en-AU")}</>}
                    {r.completedAt && <> · Completed {r.completedAt.toLocaleDateString("en-AU")}</>}
                  </div>
                </div>
                <form action={unassignModuleAction}>
                  <input type="hidden" name="module_id" value={module.id} />
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" variant="outline" size="sm">Unassign</Button>
                </form>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
