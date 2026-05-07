import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db, lmsAssignments, lmsModules, lmsQuestions } from "@tracey/db";
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

  const modules = await db
    .select({
      id: lmsModules.id,
      title: lmsModules.title,
      description: lmsModules.description,
      isPublished: lmsModules.isPublished,
      createdAt: lmsModules.createdAt,
      questionCount: sql<number>`(
        select count(*)::int from ${lmsQuestions}
          where ${lmsQuestions.moduleId} = ${lmsModules.id}
      )`,
      assignmentCount: sql<number>`(
        select count(*)::int from ${lmsAssignments}
          where ${lmsAssignments.moduleId} = ${lmsModules.id}
      )`,
    })
    .from(lmsModules)
    .where(tenantWhere(lmsModules, tid))
    .orderBy(asc(lmsModules.title));

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

