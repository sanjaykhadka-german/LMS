import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  db,
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsPositions,
  lmsUserMachines,
  lmsUsers,
} from "@tracey/db";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateEmployeeAction } from "../../actions";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; reset?: string; pw?: string; emailed?: string }>;
}) {
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) notFound();
  const sp = await searchParams;

  const [user] = await db.select().from(lmsUsers).where(eq(lmsUsers.id, userId)).limit(1);
  if (!user) notFound();

  const [departments, employers, positions, machines, userMachines, employer] = await Promise.all([
    db.select().from(lmsDepartments).orderBy(asc(lmsDepartments.name)),
    db.select().from(lmsEmployers).orderBy(asc(lmsEmployers.name)),
    db.select({ id: lmsPositions.id, name: lmsPositions.name }).from(lmsPositions).orderBy(asc(lmsPositions.name)),
    db.select({ id: lmsMachines.id, name: lmsMachines.name }).from(lmsMachines).orderBy(asc(lmsMachines.name)),
    db.select({ machineId: lmsUserMachines.machineId }).from(lmsUserMachines).where(eq(lmsUserMachines.userId, userId)),
    user.employerId
      ? db.select().from(lmsEmployers).where(eq(lmsEmployers.id, user.employerId)).limit(1)
      : Promise.resolve([]),
  ]);
  const linkedMachineIds = new Set(userMachines.map((m) => m.machineId));
  const employerName = employer[0]?.name ?? "";

  return (
    <div className="space-y-4">
      <Link href="/app/admin/employees" className="text-sm text-[color:var(--muted-foreground)] underline">
        ← Back to employees
      </Link>

      {sp.reset === "1" && sp.pw && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-3 text-sm dark:bg-emerald-900/10">
          <strong>Password reset.</strong> Temporary password:{" "}
          <code className="rounded bg-[color:var(--secondary)] px-1.5 py-0.5">{sp.pw}</code>
          {sp.emailed === "1" ? " (emailed to the user)" : " (email failed — share manually)"}
        </div>
      )}
      {sp.error === "date" && (
        <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
          Date format wrong. Use YYYY-MM-DD.
        </div>
      )}
      {sp.error === "missing" && (
        <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
          Some required fields are missing.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Edit {user.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateEmployeeAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="id" value={user.id} />
            <FieldText label="First name" name="first_name" defaultValue={user.firstName ?? ""} required />
            <FieldText label="Last name" name="last_name" defaultValue={user.lastName ?? ""} required />
            <FieldText label="Email (read-only)" name="_email" defaultValue={user.email} disabled />
            <FieldText label="Phone" name="phone" defaultValue={user.phone ?? ""} required />

            <div className="space-y-1.5">
              <Label htmlFor="department_id">Department *</Label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={user.departmentId ?? ""}
                required
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— Select —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employer_name">Employer *</Label>
              <Input
                id="employer_name"
                name="employer_name"
                list="emp-list"
                defaultValue={employerName}
                required
              />
              <datalist id="emp-list">
                {employers.map((e) => (
                  <option key={e.id} value={e.name} />
                ))}
              </datalist>
            </div>

            <FieldText label="Job title" name="job_title" defaultValue={user.jobTitle ?? ""} />

            <div className="space-y-1.5">
              <Label htmlFor="position_id">Position</Label>
              <select
                id="position_id"
                name="position_id"
                defaultValue={user.positionId ?? ""}
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— None —</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <FieldText
              label="Start date"
              name="start_date"
              type="date"
              defaultValue={user.startDate ?? ""}
            />
            <FieldText
              label="Termination date"
              name="termination_date"
              type="date"
              defaultValue={user.terminationDate ?? ""}
            />

            <div className="sm:col-span-2 lg:col-span-3 space-y-1.5">
              <Label>Machine competencies</Label>
              {machines.length === 0 ? (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  No machines configured yet.
                </p>
              ) : (
                <div className="grid gap-1 max-h-48 overflow-y-auto rounded-md border border-[color:var(--border)] p-3 sm:grid-cols-2">
                  {machines.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="machine_ids"
                        value={m.id}
                        defaultChecked={linkedMachineIds.has(m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 lg:col-span-3 flex gap-2">
              <Button type="submit">Save</Button>
              <Button asChild variant="outline">
                <Link href="/app/admin/employees">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function FieldText({
  label,
  name,
  defaultValue,
  type,
  required,
  disabled,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input
        id={name}
        name={name}
        type={type ?? "text"}
        defaultValue={defaultValue ?? ""}
        required={required}
        disabled={disabled}
      />
    </div>
  );
}
