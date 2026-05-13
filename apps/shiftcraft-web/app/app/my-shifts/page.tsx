import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import {
  acceptOfferAction,
  declineOfferAction,
} from "../schedule/actions";

export const metadata = { title: "My shifts · ShiftCraft" };

const ASSIGN_BADGE: Record<string, string> = {
  offered: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  accepted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  swapped: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  no_show: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

function fmt(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MyShiftsPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();

  const rows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        assignmentId: scShiftAssignments.id,
        assignmentStatus: scShiftAssignments.status,
        respondedAt: scShiftAssignments.respondedAt,
        shiftId: scShifts.id,
        shiftStatus: scShifts.status,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, user.id),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  const pending = rows.filter((r) => r.assignmentStatus === "offered");
  const upcoming = rows.filter(
    (r) =>
      r.assignmentStatus === "accepted" &&
      r.shiftStatus !== "cancelled" &&
      r.startsAt >= new Date(),
  );
  const past = rows.filter(
    (r) => r.startsAt < new Date() || r.assignmentStatus === "declined",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My shifts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Respond to offers, see what's upcoming, review past shifts.
        </p>
      </div>

      <Section
        title={`Offers awaiting your response (${pending.length})`}
        empty="No pending offers."
      >
        {pending.map((r) => (
          <li key={r.assignmentId} className="px-5 py-4">
            <Row row={r} />
            <div className="mt-3 flex items-center gap-2">
              <form action={acceptOfferAction}>
                <input type="hidden" name="id" value={r.assignmentId} />
                <Button type="submit" size="sm">
                  Accept
                </Button>
              </form>
              <form action={declineOfferAction}>
                <input type="hidden" name="id" value={r.assignmentId} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  Decline
                </Button>
              </form>
            </div>
          </li>
        ))}
      </Section>

      <Section
        title={`Upcoming (${upcoming.length})`}
        empty="No upcoming shifts."
      >
        {upcoming.map((r) => (
          <li key={r.assignmentId} className="px-5 py-4">
            <Row row={r} />
          </li>
        ))}
      </Section>

      {past.length > 0 && (
        <Section title={`Past & declined (${past.length})`} empty="—">
          {past.map((r) => (
            <li key={r.assignmentId} className="px-5 py-4 opacity-70">
              <Row row={r} />
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some((c) => !!c);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-3 text-base font-semibold">
        {title}
      </div>
      {hasItems ? (
        <ul className="divide-y divide-border">{children}</ul>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function Row({
  row,
}: {
  row: {
    assignmentStatus: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    locationName: string | null;
    shiftStatus: string;
  };
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {fmt(row.startsAt)} – {fmt(row.endsAt).split(", ").pop()}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.role}
          {row.locationName ? ` · ${row.locationName}` : ""}
          {row.shiftStatus === "cancelled" ? " · shift cancelled" : ""}
        </div>
        {row.notes && (
          <div className="mt-1 text-xs text-muted-foreground">{row.notes}</div>
        )}
      </div>
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ASSIGN_BADGE[row.assignmentStatus] ?? ""}`}
      >
        {row.assignmentStatus.replace("_", " ")}
      </span>
    </div>
  );
}
