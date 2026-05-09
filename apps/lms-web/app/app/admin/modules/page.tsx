import Link from "next/link";
import { and, asc, inArray, sql } from "drizzle-orm";
import { lmsAssignments, lmsModules, lmsQuestions } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NameCrudForm } from "../_components/NameCrudForm";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { createModuleAction, deleteModuleAction } from "./actions";

export const metadata = { title: "Modules" };

export default async function ModulesPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  // Fetch modules first, then compute question + assignment counts in
  // separate aggregated queries. The previous correlated-subquery shape
  // returned 0 in the rendered count column for every module — drizzle
  // interpolated the inner table reference in a way that escaped the
  // outer tenant context. GROUP BY on a tenant-filtered SELECT is the
  // bulletproof shape and avoids the inline-subquery edge case.
  const baseRows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsModules.id,
        title: lmsModules.title,
        description: lmsModules.description,
        isPublished: lmsModules.isPublished,
        createdAt: lmsModules.createdAt,
      })
      .from(lmsModules)
      .where(tenantWhere(lmsModules, tid))
      .orderBy(asc(lmsModules.title)),
  );

  const moduleIds = baseRows.map((m) => m.id);
  const [questionCounts, assignmentCounts] = await Promise.all([
    moduleIds.length === 0
      ? Promise.resolve([] as Array<{ moduleId: number; count: number }>)
      : ctx.db.run((tx) =>
          tx
            .select({
              moduleId: lmsQuestions.moduleId,
              count: sql<number>`count(*)::int`,
            })
            .from(lmsQuestions)
            .where(
              and(
                tenantWhere(lmsQuestions, tid),
                inArray(lmsQuestions.moduleId, moduleIds),
              ),
            )
            .groupBy(lmsQuestions.moduleId),
        ),
    moduleIds.length === 0
      ? Promise.resolve([] as Array<{ moduleId: number; count: number }>)
      : ctx.db.run((tx) =>
          tx
            .select({
              moduleId: lmsAssignments.moduleId,
              count: sql<number>`count(*)::int`,
            })
            .from(lmsAssignments)
            .where(
              and(
                tenantWhere(lmsAssignments, tid),
                inArray(lmsAssignments.moduleId, moduleIds),
              ),
            )
            .groupBy(lmsAssignments.moduleId),
        ),
  ]);
  const questionCountByModule = new Map(
    questionCounts.map((r) => [r.moduleId, r.count]),
  );
  const assignmentCountByModule = new Map(
    assignmentCounts.map((r) => [r.moduleId, r.count]),
  );
  const modules = baseRows.map((m) => ({
    ...m,
    questionCount: questionCountByModule.get(m.id) ?? 0,
    assignmentCount: assignmentCountByModule.get(m.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            The training units staff complete. Each module has content sections, an
            optional quiz, and can be assigned to specific staff or auto-assigned
            via department policy.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/admin/modules/ai-studio">AI Studio →</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a module</CardTitle>
          <CardDescription>
            New modules start unpublished. Add content + questions, then publish from the edit page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NameCrudForm
            action={createModuleAction}
            label="Module title"
            placeholder="e.g. Knife safety basics"
            submitLabel="Create"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All modules ({modules.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {modules.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No modules yet.
            </p>
          ) : (
            modules.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/admin/modules/${m.id}`}
                    className="font-medium hover:underline"
                  >
                    {m.title}
                  </Link>
                  <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                    {m.questionCount} question{m.questionCount === 1 ? "" : "s"} ·{" "}
                    {m.assignmentCount} assignment{m.assignmentCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.isPublished ? (
                    <Badge variant="success">Published</Badge>
                  ) : (
                    <Badge variant="secondary">Draft</Badge>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/admin/modules/${m.id}`}>Edit</Link>
                  </Button>
                  <DeleteRowForm
                    action={deleteModuleAction}
                    id={m.id}
                    confirmMessage={`Delete '${m.title}'? Content, questions, and assignments will be removed.`}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

