import { asc } from "drizzle-orm";
import { db, lmsDepartments } from "@tracey/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NameCrudForm } from "../_components/NameCrudForm";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { createDepartmentAction, deleteDepartmentAction } from "./actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const rows = await db.select().from(lmsDepartments).orderBy(asc(lmsDepartments.name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          The teams staff belong to. Used to filter assignments and (next slice)
          drive auto-assigned modules.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a department</CardTitle>
          <CardDescription>Names must be unique.</CardDescription>
        </CardHeader>
        <CardContent>
          <NameCrudForm
            action={createDepartmentAction}
            label="Department name"
            placeholder="e.g. Production"
            submitLabel="Add"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All departments ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No departments yet.
            </p>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-6 py-3">
                <span className="text-sm font-medium">{d.name}</span>
                <DeleteRowForm
                  action={deleteDepartmentAction}
                  id={d.id}
                  confirmMessage={`Delete '${d.name}'? Staff in this department will be unassigned.`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
