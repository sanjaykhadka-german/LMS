import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, between, eq } from "drizzle-orm";
import { forTenant, scLocations, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";

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
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 line-through",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const { week } = await searchParams;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const weekStart = startOfWeek(isNaN(anchor.getTime()) ? new Date() : anchor);
  const weekEnd = addDays(weekStart, 7); // exclusive

  const prevWeek = fmtIsoDate(addDays(weekStart, -7));
  const nextWeek = fmtIsoDate(addDays(weekStart, 7));
  const thisWeek = fmtIsoDate(startOfWeek(new Date()));

  const ctx = forTenant(membership.tenant.id);
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
        })
        .from(scShifts)
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(
          and(
            eq(scShifts.traceyTenantId, membership.tenant.id),
            between(scShifts.startsAt, weekStart, weekEnd),
          ),
        )
        .orderBy(asc(scShifts.startsAt)),
    ),
    ctx.run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtRange(weekStart, addDays(weekStart, 6))} ·{" "}
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule?week=${prevWeek}`}>← Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule?week=${thisWeek}`}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule?week=${nextWeek}`}>Next →</Link>
          </Button>
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
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} · {s.role}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.locationName ?? "—"}
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
