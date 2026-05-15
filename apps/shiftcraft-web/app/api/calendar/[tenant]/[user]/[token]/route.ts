import { NextResponse, type NextRequest } from "next/server";
import { and, asc, between, eq } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";
import { buildCalendar, verifyFeedToken, type ShiftEvent } from "~/lib/ics";

// ShiftCraft calendar feed. URL pattern:
//   /api/calendar/<tenantId>/<userId>/<token>.ics
//
// The .ics suffix is part of the [token] segment so the URL has the
// right MIME hint when copy-pasted into calendar apps (Outlook in
// particular cares about the extension).

const UUID_RE = /^[0-9a-f-]{36}$/i;
const RANGE_DAYS = 90;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ tenant: string; user: string; token: string }> },
) {
  const { tenant, user, token: tokenWithExt } = await ctx.params;

  // Strip optional trailing ".ics" — kept on the URL so the response is
  // recognisable as a calendar file even before content-type is read.
  const token = tokenWithExt.replace(/\.ics$/i, "");

  if (!UUID_RE.test(tenant) || !UUID_RE.test(user)) {
    return new NextResponse("Invalid feed URL.", { status: 400 });
  }
  if (!verifyFeedToken(tenant, user, token)) {
    // Avoid leaking which axis was wrong — same response for any failure.
    return new NextResponse("Forbidden.", { status: 403 });
  }

  // Range: from yesterday (so an in-progress shift remains visible until
  // it ends naturally) to RANGE_DAYS ahead. Calendar apps refresh on
  // their own schedule so the rolling window stays current.
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 1);
  const to = new Date(from);
  to.setDate(to.getDate() + RANGE_DAYS + 1);

  // Pull every accepted shift the user has within the window. The
  // forTenant() helper sets search_path so sc_* queries resolve to the
  // right tenant schema.
  const rows = await forTenant(tenant).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        notes: scShifts.notes,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, user),
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.traceyTenantId, tenant),
          eq(scShifts.status, "published"),
          between(scShifts.startsAt, from, to),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  const events: ShiftEvent[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    role: r.role,
    locationName: r.locationName ?? null,
    notes: r.notes ?? null,
  }));

  const body = buildCalendar({
    calendarName: "ShiftCraft shifts",
    events,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="shiftcraft.ics"`,
      // Calendar clients refetch on their own schedule. Cap our cache so
      // they get fresh data within an hour of changes.
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
