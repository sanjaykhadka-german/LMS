"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { notifyTenantAdmins } from "~/lib/notifications";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];

const employeeSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120, "Too long"),
  email: z
    .union([z.literal(""), z.string().trim().email("Invalid email")])
    .optional(),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
  department: z.string().trim().max(80).optional().or(z.literal("")),
  employmentType: z.enum(["permanent", "casual", "labour_hire"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

function collectAvailability(formData: FormData): Record<Weekday, string> | null {
  const out: Record<string, string> = {};
  let anyPresent = false;
  for (const day of WEEKDAYS) {
    const raw = String(formData.get(`availability_${day}`) ?? "").trim();
    if (raw.length > 0) {
      out[day] = raw;
      anyPresent = true;
    }
  }
  return anyPresent ? (out as Record<Weekday, string>) : null;
}

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function createEmployeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = employeeSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    mobile: formData.get("mobile") ?? "",
    department: formData.get("department") ?? "",
    employmentType: formData.get("employmentType") ?? "permanent",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await currentMembership();
  if (!membership) {
    return {
      status: "error",
      message: "You must belong to a workspace to add employees.",
    };
  }
  const tenantId = membership.tenant.id;
  const me = await currentUser();

  const email = emptyToNull(parsed.data.email);
  const mobile = emptyToNull(parsed.data.mobile);
  const department = emptyToNull(parsed.data.department);
  const notes = emptyToNull(parsed.data.notes);
  const availability = collectAvailability(formData);

  // Pre-check email uniqueness inside the tenant — the partial unique index
  // is the source of truth, but surfacing this as a field error beats a
  // generic 500.
  if (email) {
    const existing = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            sql`lower(${scEmployees.email}) = lower(${email})`,
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["An employee with this email already exists."] },
      };
    }
  }

  try {
    await forTenant(tenantId).run((tx) =>
      tx.insert(scEmployees).values({
        traceyTenantId: tenantId,
        fullName: parsed.data.fullName,
        email,
        mobile,
        department,
        availability,
        employmentType: parsed.data.employmentType,
        createdByUserId: me?.id ?? null,
      }),
    );
  } catch (err) {
    // Catches the rare race against the unique index (two creates same email
    // submitted simultaneously). Postgres throws SQLSTATE 23505.
    const msg = (err as { code?: string; message?: string })?.message ?? "";
    if (msg.includes("sc_employees_tenant_email_uq")) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { email: ["An employee with this email already exists."] },
      };
    }
    throw err;
  }

  // Suggest-as-learner notification: only when there's an email to invite on
  // (the LMS uses email as the learner identity key) AND the person is a
  // staff member who would normally need training. Labour-hire is skipped
  // by design — they're not part of the training cohort.
  if (email && parsed.data.employmentType !== "labour_hire") {
    await notifyTenantAdmins(
      tenantId,
      {
        kind: "shiftcraft_employee_added",
        title: "New ShiftCraft employee — add to training?",
        body: `${parsed.data.fullName} (${email}) was just added in ShiftCraft. Click to add them to the LMS so training can be assigned.`,
        actionUrl: "/app/admin/employees",
      },
      { excludeUserId: me?.id ?? undefined },
    );
  }

  revalidatePath("/app/employees");
  redirect("/app/employees?added=1");
}
