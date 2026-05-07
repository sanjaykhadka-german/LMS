"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  lmsEmployers,
  lmsMachines,
  lmsUserMachines,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { sendInviteEmail, sendPasswordResetEmail } from "~/lib/lms/notify-admin";
import { deleteStoredPhoto, PhotoUploadError, saveUserPhoto } from "~/lib/lms/photos";
import { autoAssignForDepartment } from "~/lib/lms/admin";
import type { FormState } from "../_components/NameCrudForm";

const VALID_ROLES = ["admin", "qaqc", "employee"] as const;
type LmsRole = (typeof VALID_ROLES)[number];

const intish = z
  .string()
  .optional()
  .transform((s) => (s && /^\d+$/.test(s) ? parseInt(s, 10) : null));

const dateish = z
  .string()
  .optional()
  .transform((s) => {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      throw new z.ZodError([
        { code: "custom", path: ["date"], message: "Use YYYY-MM-DD" },
      ]);
    }
    return t;
  });

const createSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().min(1, "Phone is required"),
  departmentId: intish.refine((v) => v !== null, "Department is required"),
  employerName: z.string().trim().min(1, "Employer is required"),
  role: z.string().refine((r) => (VALID_ROLES as readonly string[]).includes(r), {
    message: "Invalid role",
  }),
  jobTitle: z.string().trim().optional(),
  positionId: intish,
  startDate: dateish.optional(),
  terminationDate: dateish.optional(),
});

async function getOrCreateEmployer(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Employer name required");
  const existing = await db
    .select({ id: lmsEmployers.id })
    .from(lmsEmployers)
    .where(eq(lmsEmployers.name, trimmed))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db
    .insert(lmsEmployers)
    .values({ name: trimmed })
    .returning({ id: lmsEmployers.id });
  return row!.id;
}

function generateTempPassword(): string {
  // Same shape as Flask's secrets.token_urlsafe(9): ~12 url-safe chars.
  return crypto.randomBytes(9).toString("base64url");
}

export async function createEmployeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();

  let parsed;
  try {
    parsed = createSchema.safeParse({
      firstName: formData.get("first_name"),
      lastName: formData.get("last_name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      departmentId: String(formData.get("department_id") ?? ""),
      employerName: formData.get("employer_name"),
      role: formData.get("role") ?? "employee",
      jobTitle: formData.get("job_title") ?? "",
      positionId: String(formData.get("position_id") ?? ""),
      startDate: formData.get("start_date") ?? "",
      terminationDate: formData.get("termination_date") ?? "",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        status: "error",
        message: "Date format wrong: use YYYY-MM-DD.",
      };
    }
    throw err;
  }
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Tracey admins can't create another `admin` (matches Flask behavior:
  // it warns and downgrades). For Tracey we just refuse.
  let role: LmsRole = data.role as LmsRole;
  if (role === "admin" && ctx.role !== "owner") {
    role = "qaqc";
  }

  const dupe = await db
    .select({ id: lmsUsers.id })
    .from(lmsUsers)
    .where(eq(lmsUsers.email, data.email))
    .limit(1);
  if (dupe[0]) {
    return { status: "error", message: "A user with this email already exists." };
  }

  const employerId = await getOrCreateEmployer(data.employerName);
  const fullName = `${data.firstName} ${data.lastName}`.trim();
  const tempPw = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPw, 12);

  const [row] = await db
    .insert(lmsUsers)
    .values({
      email: data.email,
      name: fullName,
      firstName: data.firstName,
      lastName: data.lastName,
      passwordHash,
      role,
      isActiveFlag: true,
      phone: data.phone,
      departmentId: data.departmentId,
      employerId,
      startDate: data.startDate ?? null,
      terminationDate: data.terminationDate ?? null,
      jobTitle: data.jobTitle ?? "",
      positionId: data.positionId,
    })
    .returning({ id: lmsUsers.id });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.created",
    targetKind: "user",
    targetId: String(row?.id ?? ""),
    details: { email: data.email, role },
  });

  const newId = row?.id;
  const autoAssigned = newId
    ? await autoAssignForDepartment({ userId: newId, departmentId: data.departmentId })
    : 0;

  const emailed = await sendInviteEmail({
    to: data.email,
    name: fullName,
    tempPassword: tempPw,
  });

  revalidatePath("/app/admin/employees");
  const parts = [
    `${fullName} added.`,
    emailed ? "Invite emailed." : `Email not sent — temp password: ${tempPw}`,
  ];
  if (autoAssigned > 0) {
    parts.push(`${autoAssigned} module${autoAssigned === 1 ? "" : "s"} auto-assigned from department policy.`);
  }
  return { status: "ok", message: parts.join(" ") };
}

export async function toggleEmployeeActiveAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db.select().from(lmsUsers).where(eq(lmsUsers.id, id)).limit(1);
  if (!target) throw new Error("User not found");

  // Match Flask's "can't disable yourself" guard.
  if (target.id === ctx.lmsUser.id) {
    redirect("/app/admin/employees?error=self_toggle");
  }
  // Tracey admins can't disable LMS admins; only owners can.
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const next = !target.isActiveFlag;
  await db.update(lmsUsers).set({ isActiveFlag: next }).where(eq(lmsUsers.id, id));

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: next ? "employee.activated" : "employee.deactivated",
    targetKind: "user",
    targetId: String(id),
    details: { email: target.email },
  });
  revalidatePath("/app/admin/employees");
}

const roleSchema = z.object({
  id: z.coerce.number().int().positive(),
  role: z.enum(VALID_ROLES),
});

export async function changeEmployeeRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const parsed = roleSchema.safeParse({
    id: formData.get("id"),
    role: formData.get("role"),
  });
  if (!parsed.success) throw new Error("Invalid role change");
  // Tracey admins can promote/demote within (qaqc, employee). Only owners
  // can grant or remove the LMS `admin` role. Mirrors Flask's
  // @admin_required gate (app.py:2816).
  if (parsed.data.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const [target] = await db
    .select()
    .from(lmsUsers)
    .where(eq(lmsUsers.id, parsed.data.id))
    .limit(1);
  if (!target) throw new Error("User not found");
  if (target.id === ctx.lmsUser.id) {
    redirect("/app/admin/employees?error=self_role");
  }
  // Cannot remove the admin role from someone else if you're not an owner.
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  await db
    .update(lmsUsers)
    .set({ role: parsed.data.role })
    .where(eq(lmsUsers.id, parsed.data.id));

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.role_changed",
    targetKind: "user",
    targetId: String(parsed.data.id),
    details: { email: target.email, from: target.role, to: parsed.data.role },
  });
  revalidatePath("/app/admin/employees");
}

export async function resetEmployeePasswordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const [target] = await db.select().from(lmsUsers).where(eq(lmsUsers.id, id)).limit(1);
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const tempPw = generateTempPassword();
  const hash = await bcrypt.hash(tempPw, 12);
  await db.update(lmsUsers).set({ passwordHash: hash }).where(eq(lmsUsers.id, id));

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.password_reset",
    targetKind: "user",
    targetId: String(id),
    details: { email: target.email },
  });

  // Best-effort email; the temp password also surfaces via the redirect param
  // so an admin can share it manually.
  const emailed = await sendPasswordResetEmail({
    to: target.email,
    name: target.name,
    tempPassword: tempPw,
  });
  redirect(
    `/app/admin/employees/${id}/edit?reset=1&pw=${encodeURIComponent(tempPw)}&emailed=${emailed ? "1" : "0"}`,
  );
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().trim().min(1, "Phone is required"),
  departmentId: intish.refine((v) => v !== null, "Department is required"),
  employerName: z.string().trim().min(1, "Employer is required"),
  jobTitle: z.string().trim().optional(),
  positionId: intish,
  startDate: dateish.optional(),
  terminationDate: dateish.optional(),
});

export async function updateEmployeeAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  let parsed;
  try {
    parsed = updateSchema.safeParse({
      id: formData.get("id"),
      firstName: formData.get("first_name"),
      lastName: formData.get("last_name"),
      phone: formData.get("phone"),
      departmentId: String(formData.get("department_id") ?? ""),
      employerName: formData.get("employer_name"),
      jobTitle: formData.get("job_title") ?? "",
      positionId: String(formData.get("position_id") ?? ""),
      startDate: formData.get("start_date") ?? "",
      terminationDate: formData.get("termination_date") ?? "",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const id = parseInt(String(formData.get("id") ?? "0"), 10);
      redirect(`/app/admin/employees/${id}/edit?error=date`);
    }
    throw err;
  }
  if (!parsed.success) {
    const id = parseInt(String(formData.get("id") ?? "0"), 10);
    redirect(`/app/admin/employees/${id}/edit?error=missing`);
  }
  const data = parsed.data;

  const [target] = await db.select().from(lmsUsers).where(eq(lmsUsers.id, data.id)).limit(1);
  if (!target) throw new Error("User not found");
  if (target.role === "admin" && ctx.role !== "owner") {
    redirect("/app/admin/employees?error=forbidden");
  }

  const employerId = await getOrCreateEmployer(data.employerName);
  const machineIds = formData
    .getAll("machine_ids")
    .map(String)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));

  // Photo handling. Three branches: new file uploaded → save + replace;
  // remove_photo checkbox checked → null + delete previous; otherwise leave
  // the column alone.
  const photoEntry = formData.get("photo");
  const removePhoto = formData.get("remove_photo") === "1";
  let nextPhotoFilename: string | null | undefined = undefined;
  if (photoEntry instanceof File && photoEntry.size > 0) {
    try {
      nextPhotoFilename = await saveUserPhoto({
        file: photoEntry,
        uploadedByLmsUserId: ctx.lmsUser.id,
        previousFilename: target.photoFilename,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) {
        redirect(`/app/admin/employees/${data.id}/edit?error=photo&msg=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }
  } else if (removePhoto && target.photoFilename) {
    nextPhotoFilename = null;
    await deleteStoredPhoto(target.photoFilename);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(lmsUsers)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        name: `${data.firstName} ${data.lastName}`.trim(),
        phone: data.phone,
        departmentId: data.departmentId,
        employerId,
        startDate: data.startDate ?? null,
        terminationDate: data.terminationDate ?? null,
        jobTitle: data.jobTitle ?? "",
        positionId: data.positionId,
        ...(nextPhotoFilename !== undefined ? { photoFilename: nextPhotoFilename } : {}),
      })
      .where(eq(lmsUsers.id, data.id));

    // Sync user_machines M2M.
    await tx.delete(lmsUserMachines).where(eq(lmsUserMachines.userId, data.id));
    if (machineIds.length > 0) {
      const real = await tx
        .select({ id: lmsMachines.id })
        .from(lmsMachines)
        .where(inArray(lmsMachines.id, machineIds));
      const realIds = real.map((r) => r.id);
      if (realIds.length > 0) {
        await tx.insert(lmsUserMachines).values(
          realIds.map((machineId) => ({ userId: data.id, machineId })),
        );
      }
    }
  });

  await logAuditEvent({
    tenantId: ctx.traceyTenantId,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employee.updated",
    targetKind: "user",
    targetId: String(data.id),
    details: { email: target.email },
  });

  // If the user moved to a different department, auto-assign any new
  // department-policy modules. Same condition Flask uses (app.py:2924).
  if (target.departmentId !== data.departmentId) {
    await autoAssignForDepartment({ userId: data.id, departmentId: data.departmentId });
  }

  revalidatePath("/app/admin/employees");
  redirect("/app/admin/employees");
}

