import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scTimesheetApprovals,
  users,
  type ScTimesheetApprovalStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { isAtLeastManager } from "~/lib/roles";
import {
  addDays,
  deriveSegments,
  fmtHours,
  fmtIsoDate,
  getEventsInRangeForTenant,
  getEventsInRangeForUser,
  parseIsoDate,
  splitSegmentByDay,
  startOfWeek,
} from "~/lib/clock";
import {
  approveTimesheetAction,
  clearTimesheetApprovalAction,
  disputeTimesheetAction,
} from "./actions";

export const metadata = { title: "Timesheets · ShiftCraft" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface RowTotals {
  userId: string;
  name: string;
  email: string;
  /** workMs per day index 0..6 (Mon..Sun). */
  perDay: number[];
  totalWorkMs: number;
  totalBreakMs: number;
  approvalStatus: ScTimesheetApprovalStatus | null;
  approvalNotes: string | null;
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const isAdmin =
    membership.role === "owner" || membership.role === "admin";
  const tenantId = membership.tenant.id;

  const { week } = await searchParams;
  const weekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  // Resolve which users to show. Admins: everyone in the tenant. Non-admins:
  // just themselves.
  const memberRows = isAdmin
    ? await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.tenantId, tenantId))
    : [
        {
          userId: user.id,
          name: user.name,
          email: user.email,
        },
      ];

  // Fetch events: one query for admin (whole tenant), one for self.
  const userIdSet = new Set(memberRows.map((m) => m.userId));
  const allEvents = isAdmin
    ? await getEventsInRangeForTenant(tenantId, weekStart, weekEnd)
    : await getEventsInRangeForUser(tenantId, user.id, weekStart, weekEnd);

  const weekStartIso = fmtIsoDate(weekStart);
  const approvalRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeUserId: scTimesheetApprovals.employeeUserId,
        status: scTimesheetApprovals.status,
        notes: scTimesheetApprovals.notes,
      })
      .from(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, tenantId),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      ),
  );
  const approvalByUser = new Map(
    approvalRows.map((r) => [
      r.employeeUserId,
      {
        status: r.status as ScTimesheetApprovalStatus,
        notes: r.notes,
      },
    ]),
  );

  // Group events by user, then compute per-day work ms.
  const byUser = new Map<string, typeof allEvents>();
  for (const e of allEvents) {
    if (!userIdSet.has(e.appUserId)) continue;
    const arr = byUser.get(e.appUserId) ?? [];
    arr.push(e);
    byUser.set(e.appUserId, arr);
  }

  const rows: RowTotals[] = memberRows.map((m) => {
    const userEvents = byUser.get(m.userId) ?? [];
    // Close any segment still open at the end of the week — same convention
    // as the live clock page.
    const segments = deriveSegments(userEvents, weekEnd);
    const perDay = Array.from({ length: 7 }, () => 0);
    let totalWork = 0;
    let totalBreak = 0;
    for (const seg of segments) {
      for (const chunk of splitSegmentByDay(seg)) {
        const dayIdx = Math.floor(
          (chunk.startedAt.getTime() - weekStart.getTime()) / 86_400_000,
        );
        if (dayIdx < 0 || dayIdx > 6) continue;
        const ms = chunk.endedAt.getTime() - chunk.startedAt.getTime();
        if (seg.kind === "work") {
          perDay[dayIdx]! += ms;
          totalWork += ms;
        } else {
          totalBreak += ms;
        }
      }
    }
    const approval = approvalByUser.get(m.userId);
    return {
      userId: m.userId,
      name: m.name ?? m.email,
      email: m.email,
      perDay,
      totalWorkMs: totalWork,
      totalBreakMs: totalBreak,
      approvalStatus: approval?.status ?? null,
      approvalNotes: approval?.notes ?? null,
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  const visibleRows = rows.filter(
    (r) => r.totalWorkMs > 0 || r.totalBreakMs > 0 || isAdmin,
  );

  const weekLabel = formatWeekLabel(weekStart, weekEnd);
  const exportHref = `/api/timesheets/export?week=${fmtIsoDate(weekStart)}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Hours per employee for the selected week, auto-built from clock punches."
              : "Your hours for the selected week, auto-built from your clock punches."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/timesheets?week=${fmtIsoDate(prevWeek)}`}>
              ← Previous
            </Link>
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
            {weekLabel}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/timesheets?week=${fmtIsoDate(nextWeek)}`}>
              Next →
            </Link>
          </Button>
          <Button asChild size="sm">
            <a href={exportHref}>Export CSV</a>
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {visibleRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No clock activity recorded for this week.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  {WEEKDAYS.map((d, i) => (
                    <th key={d} className="px-3 py-2 font-medium">
                      <div>{d}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {fmtIsoDate(addDays(weekStart, i))}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Work</th>
                  <th className="px-3 py-2 font-medium">Break</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-4 py-2">
                      <div className="text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.email}
                      </div>
                    </td>
                    {r.perDay.map((ms, i) => (
                      <td
                        key={i}
                        className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
                      >
                        {ms > 0 ? fmtHours(ms) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-mono text-sm tabular-nums font-semibold">
                      {fmtHours(r.totalWorkMs)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {fmtHours(r.totalBreakMs)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ApprovalCell
                        userId={r.userId}
                        weekStartIso={weekStartIso}
                        status={r.approvalStatus}
                        notes={r.approvalNotes}
                        canManage={isAtLeastManager(membership.role)}
                        hasActivity={r.totalWorkMs > 0 || r.totalBreakMs > 0}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Hours are derived from the append-only clock-event stream. Overnight
        shifts are split at midnight so each day's total is contained within
        that calendar date. Managers can approve, dispute, or reset each
        employee's week — the status column reflects the latest state and
        is included in the CSV export.
      </p>
    </div>
  );
}

function ApprovalCell({
  userId,
  weekStartIso,
  status,
  notes,
  canManage,
  hasActivity,
}: {
  userId: string;
  weekStartIso: string;
  status: ScTimesheetApprovalStatus | null;
  notes: string | null;
  canManage: boolean;
  hasActivity: boolean;
}) {
  const chipBase =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider";
  const badge =
    status === "approved" ? (
      <span className={`${chipBase} bg-emerald-600 text-white`}>Approved</span>
    ) : status === "disputed" ? (
      <span className={`${chipBase} bg-amber-500 text-white`}>Disputed</span>
    ) : hasActivity ? (
      <span className={`${chipBase} bg-slate-500 text-white`}>Pending</span>
    ) : (
      <span className="text-[10px] text-muted-foreground/60">—</span>
    );

  if (!canManage) {
    return (
      <div className="space-y-1">
        {badge}
        {status === "disputed" && notes && (
          <p className="max-w-[14rem] text-[10px] text-muted-foreground">
            {notes}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {badge}
      {status === "disputed" && notes && (
        <p className="max-w-[14rem] text-[10px] text-muted-foreground">
          {notes}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {status !== "approved" && hasActivity && (
          <form action={approveTimesheetAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700"
            >
              Approve
            </button>
          </form>
        )}
        {status !== "disputed" && hasActivity && (
          <form action={disputeTimesheetAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <input
              type="hidden"
              name="notes"
              value="Flagged by manager — please review punches."
            />
            <button
              type="submit"
              className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-amber-600"
            >
              Dispute
            </button>
          </form>
        )}
        {status != null && (
          <form action={clearTimesheetApprovalAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <button
              type="submit"
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
            >
              Reset
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function formatWeekLabel(start: Date, end: Date): string {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth();
  const opts: Intl.DateTimeFormatOptions = sameMonth
    ? { day: "numeric" }
    : { day: "numeric", month: "short" };
  return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${last.toLocaleDateString(undefined, sameMonth ? opts : { day: "numeric", month: "short" })}`;
}
