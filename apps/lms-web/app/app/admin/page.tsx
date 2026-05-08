import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
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
import { buildDashboardModel } from "~/lib/lms/dashboard";
import { AssignmentReminderButton } from "./_components/ReminderButtons";
import { DashboardFilters } from "./_components/DashboardFilters";
import { DashboardCharts } from "./_components/DashboardCharts";
import { Badge } from "~/components/ui/badge";

export const metadata = { title: "Admin" };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Search = {
  reminders?: string;
  from?: string;
  to?: string;
  dept?: string;
  module?: string;
  reset?: string;
};

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const sp = await searchParams;

  // Resolve filters with defaults: last 30 days, no dept/module narrowing.
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + MS_PER_DAY);
  const isReset = sp.reset === "1";
  const defaultFrom = new Date(today.getTime() - 30 * MS_PER_DAY);
  const from = isReset ? defaultFrom : parseDate(sp.from) ?? defaultFrom;
  const to = isReset ? tomorrow : parseDate(sp.to) ?? tomorrow;
  const deptId =
    !isReset && sp.dept && sp.dept !== "all" ? Number(sp.dept) : null;
  const moduleId =
    !isReset && sp.module && sp.module !== "all" ? Number(sp.module) : null;

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
    departments,
    modules,
    model,
  ] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ employeeCount: sql<number>`count(*)::int` })
        .from(lmsUsers)
        .where(eq(lmsUsers.traceyTenantId, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ activeCount: sql<number>`count(*)::int` })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.isActiveFlag, true), eq(lmsUsers.traceyTenantId, tid))),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ deptCount: sql<number>`count(*)::int` })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ employerCount: sql<number>`count(*)::int` })
        .from(lmsEmployers)
        .where(tenantWhere(lmsEmployers, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ machineCount: sql<number>`count(*)::int` })
        .from(lmsMachines)
        .where(tenantWhere(lmsMachines, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ positionCount: sql<number>`count(*)::int` })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ moduleCount: sql<number>`count(*)::int` })
        .from(lmsModules)
        .where(tenantWhere(lmsModules, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ assignmentCount: sql<number>`count(*)::int` })
        .from(lmsAssignments)
        .where(tenantWhere(lmsAssignments, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ attemptCount: sql<number>`count(*)::int` })
        .from(lmsAttempts)
        .where(tenantWhere(lmsAttempts, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsDepartments.id, name: lmsDepartments.name })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(tenantWhere(lmsModules, tid))
        .orderBy(asc(lmsModules.title)),
    ),
    buildDashboardModel({ tid, from, to, deptId, moduleId }),
  ]);

  const fromStr = toIsoDate(from);
  const toStr = toIsoDate(new Date(to.getTime() - MS_PER_DAY)); // inclusive end
  const deptStr = deptId != null ? String(deptId) : "all";
  const moduleStr = moduleId != null ? String(moduleId) : "all";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Manage your training programme.
          </p>
        </div>
        <AssignmentReminderButton />
      </div>

      {sp.reminders !== undefined && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Sent reminders to {sp.reminders} employee
          {sp.reminders === "1" ? "" : "s"}.
        </div>
      )}

      <SectionTitle>Workspace</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Employees"
          value={employeeCount}
          hint={`${activeCount} active`}
          href="/app/admin/employees"
        />
        <StatCard
          label="Modules"
          value={moduleCount}
          hint={`${assignmentCount} assignments`}
          href="/app/admin/modules"
        />
        <StatCard label="Attempts" value={attemptCount} hint="all time" />
        <StatCard label="Departments" value={deptCount} href="/app/admin/departments" />
        <StatCard label="Employers" value={employerCount} href="/app/admin/employers" />
        <StatCard label="Positions" value={positionCount} href="/app/admin/positions" />
        <StatCard label="Machines" value={machineCount} href="/app/admin/machines" />
      </div>

      <SectionTitle>Training insights</SectionTitle>
      <DashboardFilters
        from={fromStr}
        to={toStr}
        deptId={deptStr}
        moduleId={moduleStr}
        departments={departments.map((d) => ({ id: d.id, label: d.name }))}
        modules={modules.map((m) => ({ id: m.id, label: m.title }))}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Attempts" value={model.attemptsInWindow} hint="in window" />
        <KpiCard
          label="Pass rate"
          value={`${Math.round(model.passRate * 100)}%`}
          hint="in window"
        />
        <KpiCard
          label="Avg score"
          value={Math.round(model.avgScore)}
          hint="in window"
        />
        <KpiCard
          label="Active learners"
          value={model.activeLearners}
          hint="in window"
        />
        <KpiCard
          label="Overdue"
          value={model.overdue}
          hint="assignments past due"
          variant={model.overdue > 0 ? "destructive" : undefined}
        />
        <KpiCard
          label="Expiring 30d"
          value={model.expiring30d}
          hint="completed certs nearing expiry"
          variant={model.expiring30d > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Completion"
          value={`${Math.round(model.completionPct * 100)}%`}
          hint={`${model.completedAssignments}/${model.totalAssignments}`}
        />
        <KpiCard
          label="Need retrain"
          value={model.usersNeedingRetrain}
          hint="overdue + expiring"
          variant={model.usersNeedingRetrain > 0 ? "warning" : undefined}
        />
      </div>

      <DashboardCharts
        timeseries={model.timeseries}
        assignmentStatus={model.assignmentStatus}
        passRateByModule={model.passRateByModule.map((m) => ({
          title: m.title,
          attempts: m.attempts,
          passRate: m.passRate,
        }))}
        passRateByDept={model.passRateByDept.map((d) => ({
          name: d.name,
          attempts: d.attempts,
          passRate: d.passRate,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Top 5 learners" empty="No learner data in window.">
          {model.topLearners.length > 0 && (
            <SimpleTable
              head={["Learner", "Attempts", "Avg score", "Pass %"]}
              rows={model.topLearners.map((l) => [
                l.name,
                String(l.attempts),
                String(Math.round(l.avgScore)),
                `${Math.round(l.passRate * 100)}%`,
              ])}
            />
          )}
        </TableCard>

        <TableCard
          title="Modules needing attention"
          empty="No attempts in window."
        >
          {model.problemModules.length > 0 && (
            <SimpleTable
              head={["Module", "Attempts", "Pass %"]}
              rows={model.problemModules.map((m) => [
                m.title,
                String(m.attempts),
                `${Math.round(m.passRate * 100)}%`,
              ])}
            />
          )}
        </TableCard>

        <TableCard
          title="Users needing retrain"
          empty="No outstanding overdue or expiring training."
        >
          {model.usersNeedingRetrainList.length > 0 && (
            <SimpleTable
              head={["User", "Overdue", "Expiring 30d"]}
              rows={model.usersNeedingRetrainList.map((u) => [
                u.name,
                String(u.overdueCount),
                String(u.expiringCount),
              ])}
            />
          )}
        </TableCard>

        <TableCard
          title="Recent attempts"
          empty="No attempts recorded yet."
        >
          {model.recentAttempts.length > 0 && (
            <div className="divide-y divide-[color:var(--border)]">
              {model.recentAttempts.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-4 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <strong>{r.userName}</strong> → {r.moduleTitle}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {r.createdAt.toLocaleString("en-AU")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-3">
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {r.score}
                    </span>
                    <Badge variant={r.passed ? "success" : "destructive"}>
                      {r.passed ? "Pass" : "Fail"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableCard>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
      {children}
    </h2>
  );
}

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 transition-colors hover:bg-[color:var(--secondary)]">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          {hint}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function KpiCard({
  label,
  value,
  hint,
  variant,
}: {
  label: string;
  value: number | string;
  hint?: string;
  variant?: "destructive" | "warning";
}) {
  const accent =
    variant === "destructive"
      ? "border-red-300 dark:border-red-800"
      : variant === "warning"
        ? "border-amber-300 dark:border-amber-800"
        : "border-[color:var(--border)]";
  return (
    <div className={`rounded-xl border ${accent} bg-[color:var(--card)] p-4`}>
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          {hint}
        </div>
      )}
    </div>
  );
}

function TableCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasContent = children !== false && children !== null && children !== undefined;
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
      <div className="border-b border-[color:var(--border)] px-4 py-3 text-sm font-semibold">
        {title}
      </div>
      {hasContent ? (
        children
      ) : (
        <div className="px-4 py-6 text-center text-sm text-[color:var(--muted-foreground)]">
          {empty}
        </div>
      )}
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2 align-middle">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return startOfDay(new Date(t));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
