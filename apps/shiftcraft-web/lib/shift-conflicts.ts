import "server-only";
import { and, eq, gt, lt, ne, or } from "drizzle-orm";
import { forTenant, scLocations, scShiftAssignments, scShifts } from "@tracey/db";

// ─── Pure overlap predicate ──────────────────────────────────────────────
//
// Two time windows [aStart, aEnd) and [bStart, bEnd) overlap iff
// aStart < bEnd AND aEnd > bStart. Touching at a single instant
// (e.g. one ends 17:00 and the other starts 17:00) is NOT an overlap —
// back-to-back shifts are routine and shouldn't trip the guard.

export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export interface ConflictingShift {
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  role: string;
  locationName: string | null;
}

// ─── DB helper ───────────────────────────────────────────────────────────
//
// Finds accepted shifts for `userId` in the tenant that overlap the
// proposed [startsAt, endsAt) window. Excludes cancelled shifts and the
// caller's own row (when re-checking an existing assignment).
//
// Returns 0..N conflicts — usually 0, occasionally 1, rarely more.
// Caller decides whether to surface as a warning, skip silently, or
// block outright.

export async function findOverlappingAccepted(
  tenantId: string,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  excludeShiftId?: string,
): Promise<ConflictingShift[]> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        shiftId: scShifts.id,
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
          eq(scShiftAssignments.userId, userId),
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.traceyTenantId, tenantId),
          ne(scShifts.status, "cancelled"),
          lt(scShifts.startsAt, endsAt),
          gt(scShifts.endsAt, startsAt),
          excludeShiftId ? ne(scShifts.id, excludeShiftId) : undefined,
        ),
      ),
  );
  return rows;
}

// ─── Batch helper ────────────────────────────────────────────────────────
//
// One round-trip variant: given a list of (userId, shiftWindow) pairs,
// returns the user IDs that have at least one overlap. Used by the
// bulk-offer flow to skip conflicted users without paying N round trips.
//
// For the simple case where every entry shares the same shift window
// (bulk-offering ONE shift to many users), pass that shift's window as
// `startsAt`/`endsAt` and the list of `userIds`.

export async function findConflictedUserIds(
  tenantId: string,
  userIds: string[],
  startsAt: Date,
  endsAt: Date,
  excludeShiftId?: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ userId: scShiftAssignments.userId })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.traceyTenantId, tenantId),
          ne(scShifts.status, "cancelled"),
          lt(scShifts.startsAt, endsAt),
          gt(scShifts.endsAt, startsAt),
          excludeShiftId ? ne(scShifts.id, excludeShiftId) : undefined,
          or(...userIds.map((uid) => eq(scShiftAssignments.userId, uid))),
        ),
      ),
  );
  return new Set(rows.map((r) => r.userId));
}
