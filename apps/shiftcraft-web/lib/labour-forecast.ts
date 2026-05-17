import "server-only";
import { and, between, eq, ne } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// ─── Pure projection math ────────────────────────────────────────────────
//
// A shift's projected cost is just (hours × rate). Hours come from the
// shift window; rate comes from the accepted employee's hourly_rate.
// Anything missing (no acceptance yet, or accepted but no rate set) is
// surfaced as a caveat counter rather than guessed at — admins want
// "what we know" not "what we hope".

export function hoursBetween(startsAt: Date, endsAt: Date): number {
  return Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000);
}

export function projectShiftCost(
  startsAt: Date,
  endsAt: Date,
  rate: number | null,
): number {
  if (rate == null) return 0;
  return hoursBetween(startsAt, endsAt) * rate;
}

export interface LabourForecast {
  totalCost: number;
  totalHours: number;
  shiftCount: number;
  /** Published shifts in range with no accepted assignment yet. */
  uncoveredCount: number;
  /** Published shifts with an accepted assignment but the employee has no hourly rate set. */
  missingRateCount: number;
  byLocation: Array<{
    locationId: string | null;
    locationName: string | null;
    cost: number;
    hours: number;
  }>;
}

// ─── DB helper ───────────────────────────────────────────────────────────
//
// Projects labour cost for one week's worth of published (non-cancelled)
// shifts, joining each shift to its accepted assignment → employee row
// to recover the hourly rate. Cancelled shifts are excluded because
// they're definitionally not happening.

export async function forecastWeek(
  tenantId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<LabourForecast> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        shiftId: scShifts.id,
        locationId: scShifts.locationId,
        locationName: scLocations.name,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        acceptedUserId: scShiftAssignments.userId,
        hourlyRate: scEmployees.hourlyRate,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .leftJoin(
        scShiftAssignments,
        and(
          eq(scShiftAssignments.shiftId, scShifts.id),
          eq(scShiftAssignments.status, "accepted"),
        ),
      )
      .leftJoin(
        scEmployees,
        and(
          eq(scEmployees.appUserId, scShiftAssignments.userId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          between(scShifts.startsAt, weekStart, weekEnd),
          ne(scShifts.status, "cancelled"),
        ),
      ),
  );

  // De-dup shifts that joined to multiple employees (shouldn't happen for
  // accepted shifts since uniqueness is on shift_id+user_id and we filter
  // status='accepted', but cheap to guard).
  const seen = new Set<string>();
  let totalCost = 0;
  let totalHours = 0;
  let uncoveredCount = 0;
  let missingRateCount = 0;
  const byLocation = new Map<
    string,
    { locationId: string | null; locationName: string | null; cost: number; hours: number }
  >();

  for (const r of rows) {
    if (seen.has(r.shiftId)) continue;
    seen.add(r.shiftId);

    const hours = hoursBetween(r.startsAt, r.endsAt);
    const rateNum = r.hourlyRate == null ? null : Number(r.hourlyRate);
    const cost = projectShiftCost(r.startsAt, r.endsAt, rateNum);

    totalHours += hours;
    totalCost += cost;
    if (r.acceptedUserId == null) uncoveredCount += 1;
    else if (rateNum == null) missingRateCount += 1;

    const key = r.locationId ?? "_none";
    const slot = byLocation.get(key) ?? {
      locationId: r.locationId,
      locationName: r.locationName,
      cost: 0,
      hours: 0,
    };
    slot.cost += cost;
    slot.hours += hours;
    byLocation.set(key, slot);
  }

  return {
    totalCost,
    totalHours,
    shiftCount: seen.size,
    uncoveredCount,
    missingRateCount,
    byLocation: Array.from(byLocation.values()).sort(
      (a, b) => b.cost - a.cost,
    ),
  };
}

export function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(h < 10 ? 1 : 0)}h`;
}
