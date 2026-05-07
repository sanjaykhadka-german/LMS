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

  const { lmsUser } = await requireLearner();
  const row = await getAssignmentForLearner(lmsUser.id, moduleId);
  if (!row) throw new Error("Assignment not found");

  const module = await getModuleForAssignment({
    assignment: row.assignment,
    liveModule: row.module,
  });
  if (module.questions.length === 0) {
    redirect(`/app/my/modules/${module.id}`);
  }

  // Read q_<id> form fields into the AnswersMap shape that scoring.ts expects.
  // Reject anything that isn't a string of digits — defends against tampering
  // (Flask trusts the form; we don't).
  const answers: AnswersMap = {};
  for (const q of module.questions) {
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
    module,
    assignment: row.assignment,
    answers,
  });
  redirect(`/app/my/results/${result.attemptId}`);
}
