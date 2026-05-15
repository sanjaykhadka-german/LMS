"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { forTenant, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];

/**
 * Collect the 7-day grid from the form into an `availability` jsonb.
 * Blank cells drop out; the resulting object is null when every day is
 * empty so "unspecified" reads cleanly.
 */
function collectAvailability(formData: FormData): Record<Weekday, string> | null {
  const out: Record<string, string> = {};
  let anyPresent = false;
  for (const day of WEEKDAYS) {
    const raw = String(formData.get(`availability_${day}`) ?? "").trim();
    if (raw.length > 0) {
      out[day] = raw.slice(0, 80);
      anyPresent = true;
    }
  }
  return anyPresent ? (out as Record<Weekday, string>) : null;
}

/**
 * Employee-facing: update *my own* availability on the sc_employees row
 * keyed by `app_user_id`. Admins editing other employees' availability
 * still go through the existing `updateEmployeeAction` on
 * /app/employees/[id]/edit.
 *
 * If the caller has no sc_employees row in this tenant we don't create
 * one — the roster is admin-managed. The page handles that case with a
 * friendly "ask your manager" message and won't render the form, so
 * this action only ever runs for users who already have a row.
 */
export async function updateMyAvailabilityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Not signed in." };
  const membership = await currentMembership();
  if (!membership) {
    return { status: "error", message: "No workspace selected." };
  }
  const tenantId = membership.tenant.id;

  const availability = collectAvailability(formData);

  const result = await forTenant(tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({ availability, updatedAt: new Date() })
      .where(
        and(
          eq(scEmployees.appUserId, user.id),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .returning({ id: scEmployees.id }),
  );

  if (result.length === 0) {
    // No employee row to update. Treat as "ask your manager" rather than
    // auto-creating — the page should have prevented this branch.
    return {
      status: "error",
      message:
        "You're not on the ShiftCraft roster yet. Ask a manager to add you.",
    };
  }

  await logAuditEvent({
    action: "shiftcraft.availability.updated",
    targetKind: "sc_employee",
    targetId: result[0]!.id,
    details: { byEmployee: true },
  });

  revalidatePath("/app/availability");
  return { status: "ok", message: "Availability saved." };
}
