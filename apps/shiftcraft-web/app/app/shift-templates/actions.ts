"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scShiftTemplates } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

// Time-of-day fields render as <input type="time">, which submits as
// "HH:MM" (or "HH:MM:SS" in some browsers). Parsing splits and pins
// minutes to the 15-min grid that the DB CHECK constraint enforces.
function parseTime(raw: string): { hour: number; minute: number } | null {
  if (!raw) return null;
  const [hhRaw, mmRaw = "0"] = raw.split(":");
  const hh = Number.parseInt(hhRaw ?? "", 10);
  const mm = Number.parseInt(mmRaw, 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  // Snap to the nearest of [0, 15, 30, 45] so a casual "9:00" or "9:32"
  // both produce valid CHECK-passing rows.
  const snapped = [0, 15, 30, 45].reduce((best, v) =>
    Math.abs(v - mm) < Math.abs(best - mm) ? v : best,
  );
  return { hour: hh, minute: snapped };
}

const baseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  locationId: z.string().uuid("Pick a location"),
  role: z.string().trim().min(1, "Role is required").max(80),
  startsAt: z.string().min(1, "Start time is required"),
  endsAt: z.string().min(1, "End time is required"),
  defaultNotes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function gateManagerTenant() {
  const m = await currentMembership();
  if (!m) return { ok: false as const, message: "No workspace selected." };
  if (!isAtLeastManager(m.role)) {
    return {
      ok: false as const,
      message: "Only managers can manage shift templates.",
    };
  }
  return { ok: true as const, tenantId: m.tenant.id };
}

function validateTimes(
  start: ReturnType<typeof parseTime>,
  end: ReturnType<typeof parseTime>,
): string | null {
  if (!start || !end) return "Provide both a start and end time.";
  const startMins = start.hour * 60 + start.minute;
  const endMins = end.hour * 60 + end.minute;
  // Overnight shifts allowed (end < start interpreted as next-day end).
  // For v1 we keep it simple and just require they're not identical.
  if (startMins === endMins) return "Start and end can't be the same.";
  return null;
}

export async function createShiftTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await gateManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = baseSchema.safeParse({
    name: formData.get("name"),
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    defaultNotes: formData.get("defaultNotes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const start = parseTime(parsed.data.startsAt);
  const end = parseTime(parsed.data.endsAt);
  const timeErr = validateTimes(start, end);
  if (timeErr) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { endsAt: [timeErr] },
    };
  }

  // Case-insensitive uniqueness precheck.
  const dup = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scShiftTemplates.id })
      .from(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.traceyTenantId, g.tenantId),
          sql`lower(${scShiftTemplates.name}) = lower(${parsed.data.name})`,
        ),
      )
      .limit(1),
  );
  if (dup.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["A template with this name already exists."] },
    };
  }

  await forTenant(g.tenantId).run((tx) =>
    tx.insert(scShiftTemplates).values({
      traceyTenantId: g.tenantId,
      name: parsed.data.name,
      locationId: parsed.data.locationId,
      role: parsed.data.role,
      startHour: start!.hour,
      startMinute: start!.minute,
      endHour: end!.hour,
      endMinute: end!.minute,
      defaultNotes: emptyToNull(parsed.data.defaultNotes),
    }),
  );
  await logAuditEvent({
    action: "shiftcraft.shift_template.created",
    targetKind: "sc_shift_template",
    details: { name: parsed.data.name, role: parsed.data.role },
  });
  revalidatePath("/app/shift-templates");
  revalidatePath("/app/schedule/new");
  redirect("/app/shift-templates?added=1");
}

export async function updateShiftTemplateAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await gateManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = baseSchema.safeParse({
    name: formData.get("name"),
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    defaultNotes: formData.get("defaultNotes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const start = parseTime(parsed.data.startsAt);
  const end = parseTime(parsed.data.endsAt);
  const timeErr = validateTimes(start, end);
  if (timeErr) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { endsAt: [timeErr] },
    };
  }

  // Uniqueness precheck excluding this row.
  const dup = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scShiftTemplates.id })
      .from(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.traceyTenantId, g.tenantId),
          sql`lower(${scShiftTemplates.name}) = lower(${parsed.data.name})`,
          sql`${scShiftTemplates.id} <> ${id}`,
        ),
      )
      .limit(1),
  );
  if (dup.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["Another template already uses this name."] },
    };
  }

  await forTenant(g.tenantId).run((tx) =>
    tx
      .update(scShiftTemplates)
      .set({
        name: parsed.data.name,
        locationId: parsed.data.locationId,
        role: parsed.data.role,
        startHour: start!.hour,
        startMinute: start!.minute,
        endHour: end!.hour,
        endMinute: end!.minute,
        defaultNotes: emptyToNull(parsed.data.defaultNotes),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scShiftTemplates.id, id),
          eq(scShiftTemplates.traceyTenantId, g.tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.shift_template.updated",
    targetKind: "sc_shift_template",
    targetId: id,
    details: { name: parsed.data.name },
  });
  revalidatePath("/app/shift-templates");
  revalidatePath(`/app/shift-templates/${id}/edit`);
  revalidatePath("/app/schedule/new");
  return { status: "ok", message: "Saved." };
}

export async function deleteShiftTemplateAction(
  formData: FormData,
): Promise<void> {
  const g = await gateManagerTenant();
  if (!g.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const [doomed] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ name: scShiftTemplates.name })
      .from(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.id, id),
          eq(scShiftTemplates.traceyTenantId, g.tenantId),
        ),
      )
      .limit(1),
  );
  await forTenant(g.tenantId).run((tx) =>
    tx
      .delete(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.id, id),
          eq(scShiftTemplates.traceyTenantId, g.tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.shift_template.deleted",
    targetKind: "sc_shift_template",
    targetId: id,
    details: doomed ? { name: doomed.name } : null,
  });
  revalidatePath("/app/shift-templates");
  revalidatePath("/app/schedule/new");
  redirect("/app/shift-templates");
}
