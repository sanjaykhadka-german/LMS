import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  getAssignmentForLearner,
  getModuleForAssignment,
  requireLearner,
} from "~/lib/lms/learner";
import { ContentRenderer, Media } from "../../_components/ContentRenderer";

export const metadata = { title: "Training module" };

export default async function MyModulePage({
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
  const hasQuiz = module.questions.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link
        href="/app/my/modules"
        className="text-sm text-[color:var(--muted-foreground)] underline"
      >
        ← Back to my training
      </Link>

      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Training module
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{module.title}</h1>
        {module.description && (
          <p className="mt-2 whitespace-pre-line text-[color:var(--muted-foreground)]">
            {module.description}
          </p>
        )}
      </header>

      {module.coverPath && (
        <div>
          <Media filePath={module.coverPath} />
        </div>
      )}

      {module.mediaItems.length > 0 && (
        <div className="space-y-3">
          {module.mediaItems.map((m) => (
            <Media key={m.id} filePath={m.filePath} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
        <ContentRenderer items={module.contentItems} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/my/modules"
          className="text-sm text-[color:var(--muted-foreground)] underline"
        >
          ← Back to my training
        </Link>
        {hasQuiz ? (
          <Button asChild size="lg">
            <Link href={`/app/my/modules/${module.id}/quiz`}>Take the quiz</Link>
          </Button>
        ) : (
          <span className="text-sm italic text-[color:var(--muted-foreground)]">
            This module has no quiz yet.
          </span>
        )}
      </div>
    </div>
  );
}
