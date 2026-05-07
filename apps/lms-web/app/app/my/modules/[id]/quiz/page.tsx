import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  getAssignmentForLearner,
  getModuleForAssignment,
  requireLearner,
} from "~/lib/lms/learner";
import { submitQuizAction } from "./actions";

export const metadata = { title: "Quiz" };

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();

  const { lmsUser } = await requireLearner();
  const row = await getAssignmentForLearner(lmsUser.id, moduleId);
  if (!row) notFound();

  const module = await getModuleForAssignment({
    assignment: row.assignment,
    liveModule: row.module,
  });

  // Match Flask: empty-quiz redirects back to the module page.
  if (module.questions.length === 0) redirect(`/app/my/modules/${module.id}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Knowledge check
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{module.title}</h1>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Answer every question. You can retake the quiz later if needed.
        </p>
      </header>

      <form action={submitQuizAction} className="space-y-4">
        <input type="hidden" name="moduleId" value={module.id} />
        {module.questions.map((q, i) => (
          <fieldset
            key={q.id}
            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5"
          >
            <legend className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Question {String(i + 1).padStart(2, "0")}
            </legend>
            <div className="mt-2 font-medium">{q.prompt}</div>
            <div className="mt-3 space-y-2">
              {q.choices.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    className="h-4 w-4"
                    type={q.kind === "multi" ? "checkbox" : "radio"}
                    name={`q_${q.id}`}
                    value={c.id}
                  />
                  {c.text}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex items-center justify-between gap-3">
          <Button asChild variant="outline">
            <Link href={`/app/my/modules/${module.id}`}>Cancel</Link>
          </Button>
          <Button type="submit" size="lg">
            Submit quiz
          </Button>
        </div>
      </form>
    </div>
  );
}
