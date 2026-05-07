import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
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
import { tenantWhere } from "~/lib/lms/tenant-scope";

export const metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

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
    db
      .select({ employeeCount: sql<number>`count(*)::int` })
      .from(lmsUsers)
      .where(eq(lmsUsers.traceyTenantId, tid)),
    db
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(lmsUsers)
      .where(and(eq(lmsUsers.isActiveFlag, true), eq(lmsUsers.traceyTenantId, tid))),
    db
      .select({ deptCount: sql<number>`count(*)::int` })
      .from(lmsDepartments)
      .where(tenantWhere(lmsDepartments, tid)),
    db
      .select({ employerCount: sql<number>`count(*)::int` })
      .from(lmsEmployers)
      .where(tenantWhere(lmsEmployers, tid)),
    db
      .select({ machineCount: sql<number>`count(*)::int` })
      .from(lmsMachines)
      .where(tenantWhere(lmsMachines, tid)),
    db
      .select({ positionCount: sql<number>`count(*)::int` })
      .from(lmsPositions)
      .where(tenantWhere(lmsPositions, tid)),
    db
      .select({ moduleCount: sql<number>`count(*)::int` })
      .from(lmsModules)
      .where(tenantWhere(lmsModules, tid)),
    db
      .select({ assignmentCount: sql<number>`count(*)::int` })
      .from(lmsAssignments)
      .where(tenantWhere(lmsAssignments, tid)),
    db
      .select({ attemptCount: sql<number>`count(*)::int` })
      .from(lmsAttempts)
      .where(tenantWhere(lmsAttempts, tid)),
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
