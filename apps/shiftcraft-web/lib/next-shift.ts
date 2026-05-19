import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// Re-export the pure formatter so server callers (and tests that already
// import from this path) keep working. Client components should import
// directly from "./next-shift-format" to avoid pulling server-only in.
export {
  countdownFor,
  humanise,
  type CountdownTone,
  type CountdownResult,
} from "./next-shift-format";

export interface NextShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  role: string;
  locationName: string | null;
  locationColor: string | null;
}

/**
 * Find the caller's nearest still-relevant accepted shift in this
 * tenant. "Still relevant" = the shift ends in the future (so a shift
 * in progress is returned, but one that finished hours ago is not).
 * Returns null when nothing matches.
 */
export async function getNextShiftForUser(
  tenantId: string,
  userId: string,
): Promise<NextShift | null> {
  const now = new Date();
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
        locationColor: scLocations.color,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, userId),
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.traceyTenantId, tenantId),
          eq(scShifts.status, "published"),
          gte(scShifts.endsAt, now),
        ),
      )
      .orderBy(asc(scShifts.startsAt))
      .limit(1),
  );
  return rows[0] ?? null;
}
