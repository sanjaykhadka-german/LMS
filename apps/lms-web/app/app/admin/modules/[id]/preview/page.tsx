import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  lmsChoices,
  lmsContentItemMedia,
  lmsContentItems,
  lmsModuleMedia,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { ContentRenderer, Media } from "../../../../my/_components/ContentRenderer";

export const metadata = { title: "Preview module" };

export default async function ModulePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [module] = await db
    .select()
    .from(lmsModules)
    .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
    .limit(1);
  if (!module) notFound();

  const [contentItems, mediaItems, questions] = await Promise.all([
    db
      .select()
      .from(lmsContentItems)
      .where(and(eq(lmsContentItems.moduleId, moduleId), tenantWhere(lmsContentItems, tid)))
      .orderBy(asc(lmsContentItems.position)),
    db
      .select()
      .from(lmsModuleMedia)
      .where(and(eq(lmsModuleMedia.moduleId, moduleId), tenantWhere(lmsModuleMedia, tid)))
      .orderBy(asc(lmsModuleMedia.position)),
    db
      .select()
      .from(lmsQuestions)
      .where(and(eq(lmsQuestions.moduleId, moduleId), tenantWhere(lmsQuestions, tid)))
      .orderBy(asc(lmsQuestions.position)),
  ]);

  const ciIds = contentItems.map((c) => c.id);
  const ciMedia = ciIds.length
    ? await db
        .select()
        .from(lmsContentItemMedia)
        .where(
          and(
            inArray(lmsContentItemMedia.contentItemId, ciIds),
            tenantWhere(lmsContentItemMedia, tid),
          ),
        )
        .orderBy(asc(lmsContentItemMedia.position))
    : [];
  const ciMediaByItem = new Map<number, typeof ciMedia>();
  for (const m of ciMedia) {
    const arr = ciMediaByItem.get(m.contentItemId) ?? [];
    arr.push(m);
    ciMediaByItem.set(m.contentItemId, arr);
  }

  const renderItems = contentItems.map((ci) => ({
    id: ci.id,
    kind: ci.kind,
    title: ci.title,
    body: ci.body ?? "",
    filePath: ci.filePath ?? "",
    position: ci.position ?? 0,
    mediaItems: (ciMediaByItem.get(ci.id) ?? []).map((m) => ({
      id: m.id,
      kind: m.kind ?? "",
      filePath: m.filePath,
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/app/admin/modules/${module.id}`}
          className="text-sm text-[color:var(--muted-foreground)] underline"
        >
          ← Back to edit
        </Link>
        <span className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Preview — exactly what employees see
        </span>
      </div>

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

      {module.coverPath && <Media filePath={module.coverPath} />}

      {mediaItems.length > 0 && (
        <div className="space-y-3">
          {mediaItems.map((m) => (
            <Media key={m.id} filePath={m.filePath} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
        <ContentRenderer items={renderItems} />
      </div>

      {questions.length > 0 && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] p-4 text-sm">
          The quiz on this module has {questions.length} question{questions.length === 1 ? "" : "s"}.
          Run it in this preview by clicking <strong>Take quiz</strong> below — your attempt will be
          saved (no preview-only mode in slice 4).
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/app/admin/modules/${module.id}`}>Back to edit</Link>
        </Button>
        {questions.length > 0 && (
          <Button asChild>
            <Link href={`/app/my/modules/${module.id}/quiz`}>Take quiz as me</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
