"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  lmsChoices,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

async function assertModuleOwned(moduleId: number, tid: string) {
  const [m] = await db
    .select({ id: lmsModules.id })
    .from(lmsModules)
    .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
    .limit(1);
  if (!m) throw new Error("Module not found");
}

export async function addQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");
  await assertModuleOwned(moduleId, tid);

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return;
  const kind = formData.get("kind") === "multi" ? "multi" : "single";

  const [last] = await db
    .select({ position: lmsQuestions.position })
    .from(lmsQuestions)
    .where(and(eq(lmsQuestions.moduleId, moduleId), tenantWhere(lmsQuestions, tid)))
    .orderBy(desc(lmsQuestions.position))
    .limit(1);
  const nextPosition = (last?.position ?? 0) + 10;

  const [row] = await db
    .insert(lmsQuestions)
    .values({
      moduleId,
      prompt,
      kind,
      position: nextPosition,
      traceyTenantId: tid,
    })
    .returning({ id: lmsQuestions.id });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.added",
    targetKind: "question",
    targetId: String(row?.id ?? ""),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return;
  const kind = formData.get("kind") === "multi" ? "multi" : "single";

  await db
    .update(lmsQuestions)
    .set({ prompt, kind })
    .where(
      and(
        eq(lmsQuestions.id, id),
        eq(lmsQuestions.moduleId, moduleId),
        tenantWhere(lmsQuestions, tid),
      ),
    );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.updated",
    targetKind: "question",
    targetId: String(id),
    details: { moduleId },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  // FK cascades on choices drop their rows.
  await db
    .delete(lmsQuestions)
    .where(
      and(
        eq(lmsQuestions.id, id),
        eq(lmsQuestions.moduleId, moduleId),
        tenantWhere(lmsQuestions, tid),
      ),
    );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.deleted",
    targetKind: "question",
    targetId: String(id),
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

// ─── Choices ──────────────────────────────────────────────────────────────

async function questionInModule(questionId: number, moduleId: number, tid: string) {
  const [q] = await db
    .select({ id: lmsQuestions.id })
    .from(lmsQuestions)
    .where(
      and(
        eq(lmsQuestions.id, questionId),
        eq(lmsQuestions.moduleId, moduleId),
        tenantWhere(lmsQuestions, tid),
      ),
    )
    .limit(1);
  return Boolean(q);
}

export async function addChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const questionId = parseInt(String(formData.get("question_id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(questionId) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  if (!(await questionInModule(questionId, moduleId, tid))) throw new Error("Question not found");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  const isCorrect = formData.get("is_correct") === "1";

  const [last] = await db
    .select({ position: lmsChoices.position })
    .from(lmsChoices)
    .where(and(eq(lmsChoices.questionId, questionId), tenantWhere(lmsChoices, tid)))
    .orderBy(desc(lmsChoices.position))
    .limit(1);
  const nextPosition = (last?.position ?? 0) + 10;

  await db.insert(lmsChoices).values({
    questionId,
    text,
    isCorrect,
    position: nextPosition,
    traceyTenantId: tid,
  });
  void ctx;
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  // Verify the choice belongs to a question in this module + tenant.
  const [choice] = await db
    .select({ id: lmsChoices.id, questionId: lmsChoices.questionId })
    .from(lmsChoices)
    .innerJoin(lmsQuestions, eq(lmsQuestions.id, lmsChoices.questionId))
    .where(
      and(
        eq(lmsChoices.id, id),
        eq(lmsQuestions.moduleId, moduleId),
        tenantWhere(lmsChoices, tid),
      ),
    )
    .limit(1);
  if (!choice) throw new Error("Choice not found");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  const isCorrect = formData.get("is_correct") === "1";

  await db
    .update(lmsChoices)
    .set({ text, isCorrect })
    .where(and(eq(lmsChoices.id, id), tenantWhere(lmsChoices, tid)));
  void ctx;
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  await db
    .delete(lmsChoices)
    .where(and(eq(lmsChoices.id, id), tenantWhere(lmsChoices, tid)));
  void ctx;
  revalidatePath(`/app/admin/modules/${moduleId}`);
}
