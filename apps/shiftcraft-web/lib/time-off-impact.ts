import "server-only";
import { and, asc, eq, gte, lt, ne, or } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// ─── Pure date math ──────────────────────────────────────────────────────
//
// Time-off requests use ISO date strings (no time-of-day) for [startDate,
// endDate]. To compare against shift timestamps we need to translate that
// into a [startOfStartDay, endOfEndDay) tz-naive window. Doing the
// translation in JS — rather than letting Postgres infer — keeps the
// query simpler and avoids subtle tz drift between the request's calendar
// dates (no offset) and the shift's tz-aware timestamps.

/** Convert YYYY-MM-DD into a local-tz Date at 00:00. */
export function startOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Convert YYYY-MM-DD into the next day's 00:00 (exclusive upper bound). */
export function endOfDayExclusive(iso: string): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

export interface AffectedShift {
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  role: string;
  locationName: string | null;
  status: "accepted" | "offered";
}

// ─── DB helper ───────────────────────────────────────────────────────────
//
// Lists the published (non-cancelled) shifts assigned to a user that
// overlap the calendar window [startDate, endDate]. Returns both
// accepted and offered shifts — admins want to know "if I approve this
// leave, what's the fallout?" and offers are part of that fallout (the
// employee can no longer accept them).
//
// Ordered by start time so the UI can render them as a chronological
// list without re-sorting.

export async function findAffectedShifts(
  tenantId: string,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AffectedShift[]> {
  const rangeStart = startOfDay(startDate);
  const rangeEnd = endOfDayExclusive(endDate);

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        shiftId: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
        status: scShiftAssignments.status,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, userId),
          or(
            eq(scShiftAssignments.status, "accepted"),
            eq(scShiftAssignments.status, "offered"),
          ),
          eq(scShifts.traceyTenantId, tenantId),
          ne(scShifts.status, "cancelled"),
          gte(scShifts.endsAt, rangeStart),
          lt(scShifts.startsAt, rangeEnd),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );
  return rows as AffectedShift[];
}

// ─── Batch helper ────────────────────────────────────────────────────────
//
// One round-trip variant for rendering an "impact" summary across a list
// of requests on the same page. Returns a Map keyed by requestId.

export async function findAffectedShiftsForRequests(
  tenantId: string,
  requests: Array<{ id: string; userId: string; startDate: string; endDate: string }>,
): Promise<Map<string, AffectedShift[]>> {
  const result = new Map<string, AffectedShift[]>();
  if (requests.length === 0) return result;
  // N round trips. Time-off pages are paginated/filtered to ~20 rows so
  // this is fine; if the page ever grows past ~50 pending we can switch
  // to a single CTE union — but the extra complexity isn't earning its
  // keep yet.
  await Promise.all(
    requests.map(async (r) => {
      const affected = await findAffectedShifts(
        tenantId,
        r.userId,
        r.startDate,
        r.endDate,
      );
      result.set(r.id, affected);
    }),
  );
  return result;
}
