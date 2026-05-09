"use server";

import { redirect } from "next/navigation";
import {
  getAssignmentForLearner,
  getModuleForAssignment,
  requireLearner,
  submitAttempt,
} from "~/lib/lms/learner";
import type { AnswersMap } from "~/lib/lms/scoring";

export async function submitQuizAction(formData: FormData): Promise<void> {
  const moduleId = parseInt(String(formData.get("moduleId") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad moduleId");

  const { lmsUser, traceyTenantId } = await requireLearner();
  const row = await getAssignmentForLearner(lmsUser.id, moduleId, traceyTenantId);
  if (!row) throw new Error("Assignment not found");

  const mod = await getModuleForAssignment({
    assignment: row.assignment,
    liveModule: row.module,
  });
  if (mod.questions.length === 0) {
    redirect(`/app/my/modules/${mod.id}`);
  }

  // Read q_<id> form fields into the AnswersMap shape that scoring.ts expects.
  // Reject anything that isn't a string of digits — defends against tampering
  // (Flask trusts the form; we don't).
  const answers: AnswersMap = {};
  for (const q of mod.questions) {
    const raw = formData.getAll(`q_${q.id}`);
    const filtered: string[] = [];
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (/^\d+$/.test(trimmed)) filtered.push(trimmed);
    }
    if (filtered.length > 0) answers[String(q.id)] = filtered;
  }

  const result = await submitAttempt({
    lmsUser,
    module: mod,
    assignment: row.assignment,
    answers,
  });
  redirect(`/app/my/results/${result.attemptId}`);
}
