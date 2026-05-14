"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { forTenant, scTimesheetApprovals } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { fmtIsoDate, parseIsoDate, startOfWeek } from "~/lib/clock";
import { isAtLeastManager } from "~/lib/roles";

// The actions below are bound straight to <form action={...}>, so they
// must return Promise<void>. Errors are logged server-side and the page
// is revalidated either way — the table renders the latest state on the
// next render. If a future caller needs structured results (e.g. an
// optimistic-UI client component), it can wrap these with its own
// useActionState-shaped return.

function parseWeekStartOrError(raw: string | null): Date | string {
  const parsed = parseIsoDate(raw);
  if (!parsed) return "Invalid week.";
  const aligned = startOfWeek(parsed);
  if (aligned.getTime() !== parsed.getTime()) {
    // Snap to Monday so the row's key is canonical even if a caller
    // sends a mid-week date.
    return aligned;
  }
  return aligned;
}

interface BasePayload {
  employeeUserId: string;
  weekStart: Date;
}

async function gateAndParse(
  formData: FormData,
): Promise<{ ok: true; tenantId: string; me: string; payload: BasePayload } | { ok: false; message: string }> {
  const m = await currentMembership();
  if (!m) return { ok: false, message: "Not signed in." };
  if (!isAtLeastManager(m.role)) {
    return { ok: false, message: "Only managers can change approval state." };
  }
  const me = await currentUser();
  if (!me) return { ok: false, message: "Not signed in." };

  const employeeUserId = String(formData.get("employeeUserId") ?? "").trim();
  const weekRaw = String(formData.get("weekStart") ?? "");
  if (!employeeUserId) return { ok: false, message: "Missing employee." };
  const weekParsed = parseWeekStartOrError(weekRaw);
  if (typeof weekParsed === "string") {
    return { ok: false, message: weekParsed };
  }
  return {
    ok: true,
    tenantId: m.tenant.id,
    me: me.id,
    payload: { employeeUserId, weekStart: weekParsed },
  };
}

export async function approveTimesheetAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[approveTimesheetAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);

  await forTenant(g.tenantId).run((tx) =>
    tx
      .insert(scTimesheetApprovals)
      .values({
        traceyTenantId: g.tenantId,
        employeeUserId: g.payload.employeeUserId,
        weekStart: weekStartIso,
        status: "approved",
        approvedByUserId: g.me,
        notes: null,
      })
      .onConflictDoUpdate({
        target: [
          scTimesheetApprovals.traceyTenantId,
          scTimesheetApprovals.employeeUserId,
          scTimesheetApprovals.weekStart,
        ],
        set: {
          status: "approved",
          approvedByUserId: g.me,
          approvedAt: new Date(),
          notes: null,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.timesheet.approved",
    targetKind: "sc_timesheet_approval",
    targetId: `${g.payload.employeeUserId}:${weekStartIso}`,
    details: { weekStart: weekStartIso, employeeUserId: g.payload.employeeUserId },
  });

  revalidatePath("/app/timesheets");
}

export async function disputeTimesheetAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[disputeTimesheetAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);
  const notes =
    String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;

  await forTenant(g.tenantId).run((tx) =>
    tx
      .insert(scTimesheetApprovals)
      .values({
        traceyTenantId: g.tenantId,
        employeeUserId: g.payload.employeeUserId,
        weekStart: weekStartIso,
        status: "disputed",
        approvedByUserId: g.me,
        notes,
      })
      .onConflictDoUpdate({
        target: [
          scTimesheetApprovals.traceyTenantId,
          scTimesheetApprovals.employeeUserId,
          scTimesheetApprovals.weekStart,
        ],
        set: {
          status: "disputed",
          approvedByUserId: g.me,
          approvedAt: new Date(),
          notes,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.timesheet.disputed",
    targetKind: "sc_timesheet_approval",
    targetId: `${g.payload.employeeUserId}:${weekStartIso}`,
    details: {
      weekStart: weekStartIso,
      employeeUserId: g.payload.employeeUserId,
      notes,
    },
  });

  revalidatePath("/app/timesheets");
}

export async function clearTimesheetApprovalAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[clearTimesheetApprovalAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);

  await forTenant(g.tenantId).run((tx) =>
    tx
      .delete(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, g.tenantId),
          eq(scTimesheetApprovals.employeeUserId, g.payload.employeeUserId),
          // weekStart is a date column; an ISO string compares cleanly.
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      ),
  );

  revalidatePath("/app/timesheets");
}
