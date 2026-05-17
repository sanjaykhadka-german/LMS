import Link from "next/link";
import { and, asc, between, count, desc, eq, isNull, or, gt } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scAnnouncements,
  scLocations,
  scShiftAssignments,
  scShifts,
  scTimeOffRequests,
  users as appUsers,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import {
  deriveClockState,
  fmtHours,
  getEventsInRangeForTenant,
} from "~/lib/clock";
import { getNextShiftForUser } from "~/lib/next-shift";
import { Avatar } from "~/components/Avatar";
import { NextShiftCountdown } from "~/components/NextShiftCountdown";

function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  return monday;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) return null;
  const membership = await currentMembership();

  if (!membership) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}.
        </h1>
        <p className="mt-2 text-muted-foreground">
          You're signed in. Set up a workspace from the LMS to start using
          ShiftCraft features.
        </p>
      </div>
    );
  }

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);

  const ctx = forTenant(membership.tenant.id);
  const [
    [{ locations: locationsCount = 0 } = {}],
    [{ shiftsThisWeek: shiftsThisWeekCount = 0 } = {}],
    [{ pendingOffers: pendingOffersCount = 0 } = {}],
    [{ pendingTimeOff: pendingTimeOffCount = 0 } = {}],
  ] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({ locations: count() })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, membership.tenant.id)),
    ),
    ctx.run((tx) =>
      tx
        .select({ shiftsThisWeek: count() })
        .from(scShifts)
        .where(
          and(
            eq(scShifts.traceyTenantId, membership.tenant.id),
            between(scShifts.startsAt, weekStart, weekEnd),
          ),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({ pendingOffers: count() })
        .from(scShiftAssignments)
        .where(
          and(
            eq(scShiftAssignments.userId, user.id),
            eq(scShiftAssignments.status, "offered"),
          ),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({ pendingTimeOff: count() })
        .from(scTimeOffRequests)
        .where(
          and(
            eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
            eq(scTimeOffRequests.status, "pending"),
          ),
        ),
    ),
  ]);

  const nextShift = await getNextShiftForUser(membership.tenant.id, user.id);

  const upcomingMine = await ctx.run((tx) =>
    tx
      .select({
        id: scShiftAssignments.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, user.id),
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .orderBy(asc(scShifts.startsAt))
      .limit(3),
  );

  // Who's on the floor right now: read the last 24h of clock events, group
  // by user, derive each user's current state, keep those still working or
  // on break. A 24h window is enough to catch overnight shifts without
  // pulling the whole event history into memory.
  const last24h = addDays(new Date(), -1);
  const recentEvents = await getEventsInRangeForTenant(
    membership.tenant.id,
    last24h,
    new Date(Date.now() + 60_000),
  );
  const eventsByUser = new Map<string, typeof recentEvents>();
  for (const e of recentEvents) {
    const arr = eventsByUser.get(e.appUserId) ?? [];
    arr.push(e);
    eventsByUser.set(e.appUserId, arr);
  }
  const userIds = Array.from(eventsByUser.keys());
  const userRows =
    userIds.length === 0
      ? []
      : await db
          .select({
            id: appUsers.id,
            name: appUsers.name,
            email: appUsers.email,
            image: appUsers.image,
          })
          .from(appUsers)
          .innerJoin(members, eq(members.userId, appUsers.id))
          .where(eq(members.tenantId, membership.tenant.id));
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const locationById = new Map<string, string>();
  if (eventsByUser.size > 0) {
    const locs = await forTenant(membership.tenant.id).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, membership.tenant.id)),
    );
    for (const l of locs) locationById.set(l.id, l.name);
  }
  const onTheFloor: Array<{
    userId: string;
    name: string;
    email: string;
    image: string | null;
    status: "working" | "on_break";
    sinceIso: string;
    locationName: string | null;
  }> = [];
  for (const [uid, evts] of eventsByUser) {
    const state = deriveClockState(evts);
    if (state.status === "clocked_out") continue;
    const u = userById.get(uid);
    if (!u) continue;
    const lastWithLoc = [...evts].reverse().find((e) => e.locationId != null);
    onTheFloor.push({
      userId: uid,
      name: u.name ?? u.email,
      email: u.email,
      image: u.image,
      status: state.status,
      sinceIso: state.segmentStartedAt?.toISOString() ?? new Date().toISOString(),
      locationName: lastWithLoc?.locationId
        ? locationById.get(lastWithLoc.locationId) ?? null
        : null,
    });
  }
  onTheFloor.sort((a, b) => a.name.localeCompare(b.name));

  // Pinned, non-expired announcements. Limit to 3 to keep the dashboard
  // scannable — older or unpinned ones live on /app/announcements.
  const now = new Date();
  const pinnedAnnouncements = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scAnnouncements.id,
        title: scAnnouncements.title,
        body: scAnnouncements.body,
        createdAt: scAnnouncements.createdAt,
      })
      .from(scAnnouncements)
      .where(
        and(
          eq(scAnnouncements.traceyTenantId, membership.tenant.id),
          eq(scAnnouncements.pinned, true),
          or(
            isNull(scAnnouncements.expiresAt),
            gt(scAnnouncements.expiresAt, now),
          ),
        ),
      )
      .orderBy(desc(scAnnouncements.createdAt))
      .limit(3),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}.
        </h1>
        <p className="mt-2 text-muted-foreground">
          You're signed in to {membership.tenant.name} as {membership.role}.
        </p>
      </div>

      {nextShift && (
        <NextShiftCountdown
          shiftId={nextShift.id}
          startsAtIso={nextShift.startsAt.toISOString()}
          endsAtIso={nextShift.endsAt.toISOString()}
          role={nextShift.role}
          locationName={nextShift.locationName}
          locationColor={nextShift.locationColor}
        />
      )}

      {pinnedAnnouncements.length > 0 && (
        <section className="space-y-2">
          {pinnedAnnouncements.map((a) => (
            <div
              key={a.id}
              className="rounded-lg border border-amber-200 bg-amber-50/70 px-5 py-3 text-sm dark:border-amber-900/40 dark:bg-amber-900/10"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    Pinned
                  </span>
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {a.title}
                  </span>
                </div>
                <Link
                  href="/app/announcements"
                  className="text-xs text-amber-700 hover:underline dark:text-amber-300"
                >
                  All →
                </Link>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-amber-900/90 dark:text-amber-200/90">
                {a.body}
              </p>
            </div>
          ))}
        </section>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="On the floor"
          value={onTheFloor.length}
          href="/app/clock"
          highlight={onTheFloor.length > 0}
        />
        <Stat
          label="Shifts this week"
          value={shiftsThisWeekCount}
          href="/app/schedule"
        />
        <Stat
          label="Offers awaiting you"
          value={pendingOffersCount}
          href="/app/my-shifts"
          highlight={pendingOffersCount > 0}
        />
        <Stat
          label={isAdmin ? "Time-off to review" : "My pending time off"}
          value={pendingTimeOffCount}
          href="/app/time-off"
          highlight={isAdmin && pendingTimeOffCount > 0}
        />
      </div>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            Who's on the floor{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              · {locationsCount} location{locationsCount === 1 ? "" : "s"}
            </span>
          </h2>
          <Link
            href="/app/timesheets"
            className="text-xs text-primary hover:underline"
          >
            Timesheets →
          </Link>
        </div>
        {onTheFloor.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No one currently clocked in.{" "}
            <Link href="/app/clock" className="text-primary hover:underline">
              Punch in →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {onTheFloor.map((p) => {
              const elapsedMs = Date.now() - new Date(p.sinceIso).getTime();
              return (
                <li
                  key={p.userId}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={p.name}
                      email={p.email}
                      image={p.image}
                      sizeClass="h-8 w-8"
                      textClass="text-xs"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.status === "working" ? "Working" : "On break"}
                        {p.locationName ? ` · ${p.locationName}` : ""} ·{" "}
                        since{" "}
                        {new Date(p.sinceIso).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtHours(elapsedMs)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">My next shifts</h2>
          <Link
            href="/app/my-shifts"
            className="text-xs text-primary hover:underline"
          >
            View all →
          </Link>
        </div>
        {upcomingMine.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No accepted shifts coming up.
            {pendingOffersCount > 0
              ? " You have pending offers — respond from My shifts."
              : ""}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {upcomingMine.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <div className="text-sm font-medium">
                  {s.startsAt.toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  –{" "}
                  {s.endsAt.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.role}
                  {s.locationName ? ` · ${s.locationName}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  highlight,
}: {
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-lg border ${
        highlight ? "border-primary/40 bg-primary/5" : "border-border bg-card"
      } p-4 shadow-sm transition-colors hover:bg-muted`}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </Link>
  );
}
