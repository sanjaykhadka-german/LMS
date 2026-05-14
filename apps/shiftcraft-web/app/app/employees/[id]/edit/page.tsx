import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { forTenant, scDepartments, scEmployees } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { EmployeeForm } from "../../new/_form";
import { deleteEmployeeAction } from "../../new/actions";

export const metadata = { title: "Edit employee · ShiftCraft" };

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        email: scEmployees.email,
        mobile: scEmployees.mobile,
        departmentName: scDepartments.name,
        employmentType: scEmployees.employmentType,
        hourlyRate: scEmployees.hourlyRate,
        notes: scEmployees.notes,
        availability: scEmployees.availability,
        createdAt: scEmployees.createdAt,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(
        and(
          eq(scEmployees.id, id),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) notFound();

  const departments = await forTenant(tenantId).run((tx) =>
    tx
      .select({ name: scDepartments.name })
      .from(scDepartments)
      .where(eq(scDepartments.traceyTenantId, tenantId))
      .orderBy(asc(scDepartments.name)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit employee
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Added{" "}
            {row.createdAt.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {row.email ? ` · ${row.email}` : ""}
          </p>
        </div>
        <Link
          href="/app/employees"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to roster
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <EmployeeForm
          mode="edit"
          employeeId={row.id}
          defaultValues={{
            fullName: row.fullName,
            email: row.email,
            mobile: row.mobile,
            department: row.departmentName,
            employmentType: row.employmentType,
            hourlyRate: row.hourlyRate,
            notes: row.notes,
            availability: row.availability as Record<string, string> | null,
          }}
          departmentSuggestions={departments.map((d) => d.name)}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete employee
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Removes the row from the ShiftCraft roster. The person's auth
          account (if any) is unaffected.
        </p>
        <form action={deleteEmployeeAction} className="mt-3">
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="outline"
            className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
