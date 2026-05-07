import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import {
  db,
  lmsAssignments,
  lmsAttempts,
  lmsDepartments,
  lmsEmployers,
  lmsMachines,
  lmsModules,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export const metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  await requireAdmin();

  const [
    [{ employeeCount = 0 } = {}],
    [{ activeCount = 0 } = {}],
    [{ deptCount = 0 } = {}],
    [{ employerCount = 0 } = {}],
    [{ machineCount = 0 } = {}],
    [{ positionCount = 0 } = {}],
    [{ moduleCount = 0 } = {}],
    [{ assignmentCount = 0 } = {}],
    [{ attemptCount = 0 } = {}],
  ] = await Promise.all([
    db.select({ employeeCount: sql<number>`count(*)::int` }).from(lmsUsers),
    db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(lmsUsers)
      .where(eq(lmsUsers.isActiveFlag, true)),
    db.select({ deptCount: sql<number>`count(*)::int` }).from(lmsDepartments),
    db.select({ employerCount: sql<number>`count(*)::int` }).from(lmsEmployers),
    db.select({ machineCount: sql<number>`count(*)::int` }).from(lmsMachines),
    db.select({ positionCount: sql<number>`count(*)::int` }).from(lmsPositions),
    db.select({ moduleCount: sql<number>`count(*)::int` }).from(lmsModules),
    db.select({ assignmentCount: sql<number>`count(*)::int` }).from(lmsAssignments),
    db.select({ attemptCount: sql<number>`count(*)::int` }).from(lmsAttempts),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Manage your training programme.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Employees" value={employeeCount} hint={`${activeCount} active`} href="/app/admin/employees" />
        <StatCard label="Modules" value={moduleCount} hint={`${assignmentCount} assignments`} />
        <StatCard label="Attempts" value={attemptCount} hint="all time" />
        <StatCard label="Departments" value={deptCount} href="/app/admin/departments" />
        <StatCard label="Employers" value={employerCount} href="/app/admin/employers" />
        <StatCard label="Positions" value={positionCount} href="/app/admin/positions" />
        <StatCard label="Machines" value={machineCount} href="/app/admin/machines" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming next</CardTitle>
          <CardDescription>
            Modules + AI Studio, assignments, WHS register, audit logs, and the
            CSV bulk-upload flow are still served by the Flask portal until
            their Phase&nbsp;4 sub-slices land. Use the SSO bridge for those.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 transition-colors hover:bg-[color:var(--secondary)]">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
