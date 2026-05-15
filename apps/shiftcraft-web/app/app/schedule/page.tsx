import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, between, eq, sql } from "drizzle-orm";
import { forTenant, scLocations, scShiftAssignments, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { bulkPublishWeekAction, duplicateWeekAction } from "./actions";

export const metadata = { title: "Schedule · ShiftCraft" };

// Returns the Monday 00:00 (local) of the week containing `d`.
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
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

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtDayHeader(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-500 text-white",
  published: "bg-emerald-600 text-white",
  cancelled: "bg-rose-600 text-white line-through",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    location?: string;
    copied?: string;
    skipped?: string;
  }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const {
    week,
    location: locationFilter,
    copied,
    skipped,
  } = await searchParams;
  const copiedCount = Number.parseInt(copied ?? "", 10);
  const skippedCount = Number.parseInt(skipped ?? "", 10);
  const showCopyFlash = Number.isFinite(copiedCount) && copied !== undefined;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const weekStart = startOfWeek(isNaN(anchor.getTime()) ? new Date() : anchor);
  const weekEnd = addDays(weekStart, 7); // exclusive

  const qs = (overrides: { week?: string; location?: string | null }) => {
    const params = new URLSearchParams();
    const w = overrides.week ?? week;
    if (w) params.set("week", w);
    const loc =
      overrides.location === null
        ? undefined
        : (overrides.location ?? locationFilter);
    if (loc) params.set("location", loc);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const prevWeek = fmtIsoDate(addDays(weekStart, -7));
  const nextWeek = fmtIsoDate(addDays(weekStart, 7));
  const thisWeek = fmtIsoDate(startOfWeek(new Date()));

  const ctx = forTenant(membership.tenant.id);
  const acceptedCount = sql<number>`(
    SELECT count(*)::int FROM ${scShiftAssignments}
    WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
      AND ${scShiftAssignments.status} = 'accepted'
  )`;
  const offeredCount = sql<number>`(
    SELECT count(*)::int FROM ${scShiftAssignments}
    WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
      AND ${scShiftAssignments.status} = 'offered'
  )`;
  const [shifts, locations] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({
          id: scShifts.id,
          locationId: scShifts.locationId,
          role: scShifts.role,
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          status: scShifts.status,
          locationName: scLocations.name,
          locationColor: scLocations.color,
          acceptedCount,
          offeredCount,
        })
        .from(scShifts)
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(
          and(
            eq(scShifts.traceyTenantId, membership.tenant.id),
            between(scShifts.startsAt, weekStart, weekEnd),
            locationFilter ? eq(scShifts.locationId, locationFilter) : undefined,
          ),
        )
        .orderBy(asc(scShifts.startsAt)),
    ),
    ctx.run((tx) =>
      tx
        .select({
          id: scLocations.id,
          name: scLocations.name,
          color: scLocations.color,
        })
        .from(scLocations)
        .orderBy(asc(scLocations.name)),
    ),
  ]);

  // Group shifts by day index (0=Mon … 6=Sun).
  const days: Array<{ date: Date; shifts: typeof shifts }> = Array.from(
    { length: 7 },
    (_, i) => ({ date: addDays(weekStart, i), shifts: [] }),
  );
  for (const s of shifts) {
    const idx = Math.floor((s.startsAt.getTime() - weekStart.getTime()) / 86400000);
    const day = days[idx];
    if (day) day.shifts.push(s);
  }

  const canCreate = locations.length > 0;
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const draftCount = shifts.filter((s) => s.status === "draft").length;
  const activeLocation = locationFilter
    ? locations.find((l) => l.id === locationFilter)
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtRange(weekStart, addDays(weekStart, 6))} ·{" "}
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
            {activeLocation ? ` · ${activeLocation.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: prevWeek })}`}>← Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: thisWeek })}`}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: nextWeek })}`}>Next →</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/schedule/export?from=${fmtIsoDate(weekStart)}&to=${fmtIsoDate(weekEnd)}${locationFilter ? `&location=${locationFilter}` : ""}`}
            >
              Export CSV
            </a>
          </Button>
          {isAdmin && draftCount > 0 && (
            <form action={bulkPublishWeekAction}>
              <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
              <input type="hidden" name="weekEnd" value={weekEnd.toISOString()} />
              {locationFilter && (
                <input type="hidden" name="location" value={locationFilter} />
              )}
              <Button type="submit" variant="outline" size="sm">
                Publish {draftCount} draft{draftCount === 1 ? "" : "s"}
              </Button>
            </form>
          )}
          {isAdmin && shifts.length > 0 && (
            <form action={duplicateWeekAction}>
              <input
                type="hidden"
                name="weekStart"
                value={weekStart.toISOString()}
              />
              {locationFilter && (
                <input type="hidden" name="location" value={locationFilter} />
              )}
              <Button type="submit" variant="outline" size="sm">
                Copy to next week
              </Button>
            </form>
          )}
          {canCreate ? (
            <Button asChild size="sm">
              <Link href="/app/schedule/new">New shift</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/locations">Add a location first</Link>
            </Button>
          )}
        </div>
      </div>

      {showCopyFlash && (
        <div className="rounded-md border-2 border-emerald-500/60 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          {copiedCount > 0 ? (
            <>
              Copied {copiedCount} shift{copiedCount === 1 ? "" : "s"} into
              this week as drafts.
              {skippedCount > 0 && (
                <span className="text-emerald-800/80 dark:text-emerald-200/80">
                  {" "}
                  Skipped {skippedCount} that already had a matching shift.
                </span>
              )}{" "}
              Review and publish when ready.
            </>
          ) : (
            <>
              No new shifts to copy — this week already has every slot that
              last week did
              {skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : ""}.
            </>
          )}
        </div>
      )}

      {locations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Location:
          </span>
          <Button
            asChild
            size="sm"
            variant={locationFilter ? "outline" : "default"}
          >
            <Link href={`/app/schedule${qs({ location: null })}`}>All</Link>
          </Button>
          {locations.map((loc) => (
            <Button
              asChild
              key={loc.id}
              size="sm"
              variant={locationFilter === loc.id ? "default" : "outline"}
            >
              <Link
                href={`/app/schedule${qs({ location: loc.id })}`}
                className="inline-flex items-center gap-1.5"
              >
                {loc.color && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: loc.color }}
                  />
                )}
                {loc.name}
              </Link>
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => (
          <section
            key={d.date.toISOString()}
            className="rounded-lg border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border px-4 py-2 text-sm font-medium">
              {fmtDayHeader(d.date)}
            </div>
            {d.shifts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No shifts</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.shifts.map((s) => (
                  <li
                    key={s.id}
                    className="relative px-4 py-3"
                    style={
                      s.locationColor
                        ? { boxShadow: `inset 3px 0 0 ${s.locationColor}` }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {s.locationColor && (
                            <span
                              aria-hidden
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: s.locationColor }}
                            />
                          )}
                          <span>
                            {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} ·{" "}
                            {s.role}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.locationName ?? "—"}
                          {" · "}
                          {s.acceptedCount} accepted
                          {s.offeredCount > 0 ? ` · ${s.offeredCount} pending` : ""}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[s.status] ?? ""}`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/app/schedule/${s.id}/edit`}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
