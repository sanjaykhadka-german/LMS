import Link from "next/link";
import { Upload } from "lucide-react";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  lmsDepartments,
  lmsEmployers,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NewEmployeeForm } from "./_new-form";
import { RowActions } from "./_row-actions";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const [employees, departments, employers, positions] = await Promise.all([
    db
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        role: lmsUsers.role,
        isActiveFlag: lmsUsers.isActiveFlag,
        departmentName: lmsDepartments.name,
        employerName: lmsEmployers.name,
        positionName: lmsPositions.name,
      })
      .from(lmsUsers)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .leftJoin(lmsEmployers, eq(lmsEmployers.id, lmsUsers.employerId))
      .leftJoin(lmsPositions, eq(lmsPositions.id, lmsUsers.positionId))
      .orderBy(desc(lmsUsers.role), asc(lmsUsers.name)),
    db.select().from(lmsDepartments).orderBy(asc(lmsDepartments.name)),
    db.select().from(lmsEmployers).orderBy(asc(lmsEmployers.name)),
    db
      .select({ id: lmsPositions.id, name: lmsPositions.name })
      .from(lmsPositions)
      .orderBy(asc(lmsPositions.name)),
  ]);

  const activeCount = employees.filter((e) => e.isActiveFlag).length;
  const disabledCount = employees.length - activeCount;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            {employees.length} total · {activeCount} active · {disabledCount} disabled
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/admin/employees/bulk">
            <Upload className="mr-1 h-4 w-4" /> Bulk upload
          </Link>
        </Button>
      </div>

      {error && <ErrorBanner code={error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add an employee</CardTitle>
          <CardDescription>
            They&rsquo;ll be emailed a temporary password to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewEmployeeForm
            departments={departments}
            employers={employers}
            positions={positions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All employees ({employees.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Name</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-6 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="px-6 py-3 align-middle">
                      <div className="font-medium">
                        <Link href={`/app/admin/employees/${e.id}`} className="hover:underline">
                          {e.name}
                        </Link>
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">{e.email}</div>
                    </td>
                    <td className="px-3 py-3 align-middle">{e.departmentName ?? "—"}</td>
                    <td className="px-3 py-3 align-middle">{e.positionName ?? "—"}</td>
                    <td className="px-3 py-3 align-middle">
                      <RoleBadge role={e.role} />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {e.isActiveFlag ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </td>
                    <td className="px-6 py-3 align-middle text-right">
                      <RowActions
                        id={e.id}
                        isActive={e.isActiveFlag ?? true}
                        currentRole={e.role}
                      />
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No employees yet. Add one above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Badge>Admin</Badge>;
  if (role === "qaqc") return <Badge variant="warning">QA/QC</Badge>;
  return <Badge variant="secondary">Employee</Badge>;
}

function ErrorBanner({ code }: { code: string }) {
  const messages: Record<string, string> = {
    self_toggle: "You can't disable your own account.",
    self_role: "You can't change your own role.",
    forbidden: "Only owners can promote or modify admin accounts.",
  };
  return (
    <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
      {messages[code] ?? "Action blocked."}
    </div>
  );
}

