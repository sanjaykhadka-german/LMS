import Link from "next/link";
import { and, asc, between, count, eq } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
  scTimeOffRequests,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Locations"
          value={locationsCount}
          href="/app/locations"
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
