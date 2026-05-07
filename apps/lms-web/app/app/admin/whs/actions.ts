"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, lmsWhsRecords } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

const VALID_KINDS = new Set(["high_risk_licence", "fire_warden", "first_aider", "incident"]);
const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

const dateOpt = z
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

const whsSchema = z.object({
  kind: z.string().refine((k) => VALID_KINDS.has(k)),
  title: z.string().trim().min(1).max(200),
  userId: z.string().optional(),
  issuedOn: dateOpt.optional(),
  expiresOn: dateOpt.optional(),
  notes: z.string().optional(),
  incidentDate: dateOpt.optional(),
  severity: z.string().optional(),
  reportedById: z.string().optional(),
});

function intOrNull(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

export async function createWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  let parsed;
  try {
    parsed = whsSchema.safeParse({
      kind: formData.get("kind"),
      title: formData.get("title"),
      userId: String(formData.get("user_id") ?? ""),
      issuedOn: formData.get("issued_on") ?? "",
      expiresOn: formData.get("expires_on") ?? "",
      notes: formData.get("notes") ?? "",
      incidentDate: formData.get("incident_date") ?? "",
      severity: formData.get("severity") ?? "",
      reportedById: String(formData.get("reported_by_id") ?? ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) redirect("/app/admin/whs/new?error=date");
    throw err;
  }
  if (!parsed.success) redirect("/app/admin/whs/new?error=invalid");

  const data = parsed.data;
  const severity = data.severity && VALID_SEVERITIES.has(data.severity) ? data.severity : null;

  const [row] = await db
    .insert(lmsWhsRecords)
    .values({
      kind: data.kind,
      title: data.title,
      userId: intOrNull(formData.get("user_id")),
      issuedOn: data.issuedOn ?? null,
      expiresOn: data.expiresOn ?? null,
      notes: data.notes ?? "",
      incidentDate: data.incidentDate ?? null,
      severity,
      reportedById: intOrNull(formData.get("reported_by_id")),
      traceyTenantId: tid,
    })
    .returning({ id: lmsWhsRecords.id });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.created",
    targetKind: "whs_record",
    targetId: String(row?.id ?? ""),
    details: { kind: data.kind, title: data.title },
  });
  revalidatePath("/app/admin/whs");
  redirect("/app/admin/whs?ok=created");
}

export async function updateWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = intOrNull(formData.get("id"));
  if (!id) throw new Error("Bad id");

  let parsed;
  try {
    parsed = whsSchema.safeParse({
      kind: formData.get("kind"),
      title: formData.get("title"),
      userId: String(formData.get("user_id") ?? ""),
      issuedOn: formData.get("issued_on") ?? "",
      expiresOn: formData.get("expires_on") ?? "",
      notes: formData.get("notes") ?? "",
      incidentDate: formData.get("incident_date") ?? "",
      severity: formData.get("severity") ?? "",
      reportedById: String(formData.get("reported_by_id") ?? ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) redirect(`/app/admin/whs/${id}/edit?error=date`);
    throw err;
  }
  if (!parsed.success) redirect(`/app/admin/whs/${id}/edit?error=invalid`);
  const data = parsed.data;
  const severity = data.severity && VALID_SEVERITIES.has(data.severity) ? data.severity : null;

  const [target] = await db
    .select()
    .from(lmsWhsRecords)
    .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)))
    .limit(1);
  if (!target) throw new Error("Record not found");

  await db
    .update(lmsWhsRecords)
    .set({
      kind: data.kind,
      title: data.title,
      userId: intOrNull(formData.get("user_id")),
      issuedOn: data.issuedOn ?? null,
      expiresOn: data.expiresOn ?? null,
      notes: data.notes ?? "",
      incidentDate: data.incidentDate ?? null,
      severity,
      reportedById: intOrNull(formData.get("reported_by_id")),
    })
    .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.updated",
    targetKind: "whs_record",
    targetId: String(id),
    details: { kind: data.kind, title: data.title },
  });
  revalidatePath("/app/admin/whs");
  redirect("/app/admin/whs?ok=updated");
}

export async function deleteWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = intOrNull(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const [target] = await db
    .select({ title: lmsWhsRecords.title })
    .from(lmsWhsRecords)
    .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)))
    .limit(1);
  if (!target) return;

  await db
    .delete(lmsWhsRecords)
    .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.deleted",
    targetKind: "whs_record",
    targetId: String(id),
    details: { title: target.title },
  });
  revalidatePath("/app/admin/whs");
}

