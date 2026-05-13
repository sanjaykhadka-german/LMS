import { NextResponse, type NextRequest } from "next/server";
import { and, asc, between, eq, sql } from "drizzle-orm";
import {
  forTenant,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";

// CSV cell escape: wrap in quotes if value contains comma, quote, or newline;
// double up any embedded quotes.
function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtTimeOnly(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export async function GET(req: NextRequest) {
  const membership = await currentMembership();
  if (!membership) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD
  const to = url.searchParams.get("to"); // YYYY-MM-DD exclusive
  const locationId = url.searchParams.get("location") || undefined;

  // Default: this week through next week (14 days).
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setHours(0, 0, 0, 0);
  defaultFrom.setDate(defaultFrom.getDate() - ((defaultFrom.getDay() + 6) % 7));
  const defaultTo = new Date(defaultFrom);
  defaultTo.setDate(defaultTo.getDate() + 14);

  const fromDate = from ? new Date(`${from}T00:00:00`) : defaultFrom;
  const toDate = to ? new Date(`${to}T00:00:00`) : defaultTo;

  const rows = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        status: scShifts.status,
        notes: scShifts.notes,
        locationName: scLocations.name,
        assigned: sql<string>`COALESCE(
          (
            SELECT string_agg(COALESCE(${users.name}, ${users.email}), '; ' ORDER BY COALESCE(${users.name}, ${users.email}))
            FROM ${scShiftAssignments}
            JOIN ${users} ON ${users.id} = ${scShiftAssignments.userId}
            WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
              AND ${scShiftAssignments.status} = 'accepted'
          ),
          ''
        )`,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.traceyTenantId, membership.tenant.id),
          between(scShifts.startsAt, fromDate, toDate),
          locationId ? eq(scShifts.locationId, locationId) : undefined,
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  const header = [
    "Date",
    "Start",
    "End",
    "Role",
    "Location",
    "Status",
    "Assigned",
    "Notes",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        csvCell(fmtDateOnly(r.startsAt)),
        csvCell(fmtTimeOnly(r.startsAt)),
        csvCell(fmtTimeOnly(r.endsAt)),
        csvCell(r.role),
        csvCell(r.locationName),
        csvCell(r.status),
        csvCell(r.assigned),
        csvCell(r.notes),
      ].join(","),
    ),
  ];
  const body = lines.join("\r\n") + "\r\n";

  const filename = `schedule-${fmtDateOnly(fromDate)}-to-${fmtDateOnly(toDate)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
