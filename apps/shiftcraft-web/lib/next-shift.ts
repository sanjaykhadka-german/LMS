import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// ─── Pure formatter (testable without a DB) ──────────────────────────────
//
// Renders a label for the dashboard countdown card. Branches:
//   - now < startsAt  → "Starts in 2 days 4 hours"
//   - now < startsAt+30s → "Starting now"
//   - now < endsAt    → "In progress · ends in 1h 23m"
//   - now < endsAt+1h → "Finished N min ago"   (kept around briefly so
//                        someone clocking out late still sees something)
//   - otherwise       → null (caller hides the card)
//
// Granularity is human-readable. Once you're under an hour we tick in
// minutes; once you're under a minute we tick in seconds; days+hours
// for anything bigger.

export type CountdownTone = "upcoming" | "imminent" | "working" | "finished";

export interface CountdownResult {
  tone: CountdownTone;
  label: string;
  /** Header line — short, punchy, never empty. */
  headline: string;
}

export function countdownFor(
  now: Date,
  startsAt: Date,
  endsAt: Date,
): CountdownResult | null {
  const nowMs = now.getTime();
  const startMs = startsAt.getTime();
  const endMs = endsAt.getTime();

  // Hide once an hour has passed since the shift ended — at that point
  // the schedule has moved on.
  if (nowMs > endMs + 60 * 60 * 1000) return null;

  if (nowMs < startMs) {
    const remaining = startMs - nowMs;
    if (remaining < 30 * 1000) {
      return {
        tone: "imminent",
        headline: "Starting now",
        label: "Time to clock in.",
      };
    }
    return {
      tone: remaining < 60 * 60 * 1000 ? "imminent" : "upcoming",
      headline: "Up next",
      label: `Starts in ${humanise(remaining)}`,
    };
  }

  if (nowMs <= endMs) {
    const remaining = endMs - nowMs;
    return {
      tone: "working",
      headline: "Currently working",
      label: `Ends in ${humanise(remaining)}`,
    };
  }

  const since = nowMs - endMs;
  return {
    tone: "finished",
    headline: "Just finished",
    label: `Wrapped ${humanise(since)} ago`,
  };
}

/**
 * Human-readable duration. Picks the largest two units that make sense:
 *   - days + hours when ≥ 1 day
 *   - hours + minutes when ≥ 1 hour
 *   - minutes when ≥ 1 minute
 *   - seconds for the last 60s
 */
export function humanise(ms: number): string {
  const abs = Math.max(0, ms);
  const totalSec = Math.floor(abs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (days > 0) {
    return hours > 0
      ? `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`
      : `${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours > 0) {
    return minutes > 0
      ? `${hours}h ${minutes}m`
      : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// ─── DB helper ───────────────────────────────────────────────────────────

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
