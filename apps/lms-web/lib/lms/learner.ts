import "server-only";
import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import {
  db,
  lmsAssignments,
  lmsAttempts,
  lmsChoices,
  lmsContentItems,
  lmsContentItemMedia,
  lmsModuleMedia,
  lmsModules,
  lmsModuleVersions,
  lmsQuestions,
  lmsUploadedFiles,
  lmsUsers,
  type LmsAssignment,
  type LmsModule,
  type LmsUser,
} from "@tracey/db";
import { requireTenant, requireUser } from "~/lib/auth/current";
import {
  attemptReview,
  scoreAttempt,
  type AnswersMap,
  type QuizQuestion,
  type ReviewEntry,
  type ScoreResult,
} from "./scoring";
import { PASS_THRESHOLD } from "~/lib/site-config";
import { notifyAttempt } from "./notify";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LearnerMediaItem {
  id: number;
  kind: string;
  filePath: string;
}

export interface LearnerContentItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  filePath: string;
  position: number;
  mediaItems: LearnerMediaItem[];
}

export interface LearnerModule {
  id: number;
  title: string;
  description: string;
  isPublished: boolean;
  coverPath: string;
  mediaItems: LearnerMediaItem[];
  contentItems: LearnerContentItem[];
  questions: QuizQuestion[];
}

export interface LearnerContext {
  traceyUserId: string;
  traceyTenantId: string;
  lmsUser: LmsUser;
}

// ─── Provisioning ─────────────────────────────────────────────────────────

/** Mirrors Flask /sso/callback's auto-provision path (app.py:1362-1390).
 *  Resolution order: tracey_user_id → email → INSERT. Race-safe via
 *  ON CONFLICT DO NOTHING + refetch by email. */
export async function getOrProvisionLmsUser(opts: {
  traceyUserId: string;
  traceyTenantId: string;
  email: string;
  name: string | null;
}): Promise<LmsUser> {
  const email = opts.email.toLowerCase().trim();
  const name = (opts.name ?? email).trim();

  const bySub = await db
    .select()
    .from(lmsUsers)
    .where(eq(lmsUsers.traceyUserId, opts.traceyUserId))
    .limit(1);
  if (bySub[0]) return bySub[0];

  // Existing legacy row (admin imported the user before SSO ever ran).
  // Link tracey_user_id and return.
  const byEmail = await db
    .select()
    .from(lmsUsers)
    .where(eq(lmsUsers.email, email))
    .limit(1);
  if (byEmail[0]) {
    const linked = await db
      .update(lmsUsers)
      .set({ traceyUserId: opts.traceyUserId, traceyTenantId: opts.traceyTenantId })
      .where(eq(lmsUsers.id, byEmail[0].id))
      .returning();
    return linked[0] ?? byEmail[0];
  }

  // First-time learner. The bcrypt hash is intentionally unreachable —
  // password login is for legacy Flask-imported admins; SSO learners use
  // Tracey only.
  const [first, ...rest] = name.split(/\s+/);
  const last = rest.join(" ");
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 12);

  const inserted = await db
    .insert(lmsUsers)
    .values({
      email,
      name,
      firstName: first ?? "",
      lastName: last ?? "",
      passwordHash,
      role: "employee",
      isActiveFlag: true,
      traceyUserId: opts.traceyUserId,
      traceyTenantId: opts.traceyTenantId,
    })
    .onConflictDoNothing({ target: lmsUsers.email })
    .returning();
  if (inserted[0]) return inserted[0];

  // Lost the race against another concurrent provision — refetch.
  const refetch = await db
    .select()
    .from(lmsUsers)
    .where(eq(lmsUsers.email, email))
    .limit(1);
  if (!refetch[0]) {
    throw new Error("Failed to provision LMS user (race lost and refetch empty).");
  }
  return refetch[0];
}

/** One-stop helper for learner pages: requires Tracey auth + active tenant,
 *  ensures a Flask `users` row exists, returns the trio. Redirects to
 *  /sign-in / /onboarding via the underlying helpers if preconditions fail. */
export async function requireLearner(): Promise<LearnerContext> {
  const user = await requireUser();
  const { tenant } = await requireTenant();
  const lmsUser = await getOrProvisionLmsUser({
    traceyUserId: user.id,
    traceyTenantId: tenant.id,
    email: user.email,
    name: user.name,
  });
  if (!lmsUser.isActiveFlag) {
    // Match Flask: a deactivated learner can't proceed.
    redirect("/sign-in?reason=deactivated");
  }
  return { traceyUserId: user.id, traceyTenantId: tenant.id, lmsUser };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export interface AssignmentRow {
  assignment: LmsAssignment;
  module: LmsModule;
  attempts: number;
  bestScore: number | null;
  lastAttemptAt: Date | null;
}

export async function listAssignmentsForUser(lmsUserId: number): Promise<AssignmentRow[]> {
  const rows = await db
    .select({ assignment: lmsAssignments, module: lmsModules })
    .from(lmsAssignments)
    .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
    .where(eq(lmsAssignments.userId, lmsUserId))
    .orderBy(desc(lmsAssignments.assignedAt));

  if (rows.length === 0) return [];

  const moduleIds = rows.map((r) => r.module.id);
  const aggs = await db
    .select({
      moduleId: lmsAttempts.moduleId,
      attempts: sql<number>`count(*)::int`,
      bestScore: sql<number | null>`max(${lmsAttempts.score})`,
      lastAt: sql<Date | null>`max(${lmsAttempts.createdAt})`,
    })
    .from(lmsAttempts)
    .where(and(eq(lmsAttempts.userId, lmsUserId), inArray(lmsAttempts.moduleId, moduleIds)))
    .groupBy(lmsAttempts.moduleId);

  const aggByModule = new Map(aggs.map((a) => [a.moduleId, a]));

  return rows.map((r) => {
    const a = aggByModule.get(r.module.id);
    return {
      assignment: r.assignment,
      module: r.module,
      attempts: a?.attempts ?? 0,
      bestScore: a?.bestScore ?? null,
      lastAttemptAt: a?.lastAt ?? null,
    };
  });
}

export async function getAttemptAggregates(
  lmsUserId: number,
): Promise<{ total: number; avgScore: number; passRate: number }> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      avg: sql<number>`coalesce(avg(${lmsAttempts.score}), 0)::float`,
      passed: sql<number>`count(*) filter (where ${lmsAttempts.passed} = true)::int`,
    })
    .from(lmsAttempts)
    .where(eq(lmsAttempts.userId, lmsUserId));
  const total = rows[0]?.total ?? 0;
  if (total === 0) return { total: 0, avgScore: 0, passRate: 0 };
  return {
    total,
    avgScore: Math.round((rows[0]?.avg ?? 0) * 10) / 10,
    passRate: Math.round(((rows[0]?.passed ?? 0) * 1000) / total) / 10,
  };
}

export async function listRecentAttempts(
  lmsUserId: number,
  limit = 5,
): Promise<Array<{ id: number; moduleId: number; moduleTitle: string | null; score: number; passed: boolean; createdAt: Date }>> {
  const rows = await db
    .select({
      id: lmsAttempts.id,
      moduleId: lmsAttempts.moduleId,
      moduleTitle: lmsModules.title,
      score: lmsAttempts.score,
      passed: lmsAttempts.passed,
      createdAt: lmsAttempts.createdAt,
    })
    .from(lmsAttempts)
    .leftJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
    .where(eq(lmsAttempts.userId, lmsUserId))
    .orderBy(desc(lmsAttempts.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.moduleId,
    moduleTitle: r.moduleTitle ?? null,
    score: r.score ?? 0,
    passed: r.passed ?? false,
    createdAt: r.createdAt ?? new Date(0),
  }));
}

export async function getAssignmentForLearner(
  lmsUserId: number,
  moduleId: number,
): Promise<{ assignment: LmsAssignment; module: LmsModule } | null> {
  const rows = await db
    .select({ assignment: lmsAssignments, module: lmsModules })
    .from(lmsAssignments)
    .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
    .where(and(eq(lmsAssignments.userId, lmsUserId), eq(lmsAssignments.moduleId, moduleId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Port of module_for_assignment (app.py:716): returns the pinned snapshot
 *  if the assignment has a version_id, otherwise the live module. Falls
 *  back to live on JSON parse error (matches Flask try/except). */
export async function getModuleForAssignment(opts: {
  assignment: LmsAssignment;
  liveModule: LmsModule;
}): Promise<LearnerModule> {
  if (opts.assignment.versionId !== null && opts.assignment.versionId !== undefined) {
    const snap = await db
      .select()
      .from(lmsModuleVersions)
      .where(eq(lmsModuleVersions.id, opts.assignment.versionId))
      .limit(1);
    if (snap[0]) {
      const hydrated = tryHydrateSnapshot(snap[0].snapshotJson, opts.liveModule);
      if (hydrated) return hydrated;
    }
  }
  return loadLiveModule(opts.liveModule);
}

async function loadLiveModule(m: LmsModule): Promise<LearnerModule> {
  const [contentItems, mediaItems, questions] = await Promise.all([
    db
      .select()
      .from(lmsContentItems)
      .where(eq(lmsContentItems.moduleId, m.id))
      .orderBy(lmsContentItems.position),
    db
      .select()
      .from(lmsModuleMedia)
      .where(eq(lmsModuleMedia.moduleId, m.id))
      .orderBy(lmsModuleMedia.position),
    db
      .select()
      .from(lmsQuestions)
      .where(eq(lmsQuestions.moduleId, m.id))
      .orderBy(lmsQuestions.position),
  ]);

  const ciIds = contentItems.map((c) => c.id);
  const ciMedia = ciIds.length
    ? await db
        .select()
        .from(lmsContentItemMedia)
        .where(inArray(lmsContentItemMedia.contentItemId, ciIds))
        .orderBy(lmsContentItemMedia.position)
    : [];
  const ciMediaByItem = new Map<number, LearnerMediaItem[]>();
  for (const x of ciMedia) {
    const arr = ciMediaByItem.get(x.contentItemId) ?? [];
    arr.push({ id: x.id, kind: x.kind ?? "", filePath: x.filePath });
    ciMediaByItem.set(x.contentItemId, arr);
  }

  const qIds = questions.map((q) => q.id);
  const choices = qIds.length
    ? await db
        .select()
        .from(lmsChoices)
        .where(inArray(lmsChoices.questionId, qIds))
        .orderBy(lmsChoices.position)
    : [];
  const choicesByQ = new Map<number, QuizQuestion["choices"]>();
  for (const c of choices) {
    const arr = choicesByQ.get(c.questionId) ?? [];
    arr.push({ id: c.id, text: c.text, isCorrect: c.isCorrect ?? false });
    choicesByQ.set(c.questionId, arr);
  }

  return {
    id: m.id,
    title: m.title,
    description: m.description ?? "",
    isPublished: m.isPublished ?? true,
    coverPath: m.coverPath ?? "",
    mediaItems: mediaItems.map((x) => ({
      id: x.id,
      kind: x.kind ?? "",
      filePath: x.filePath,
    })),
    contentItems: contentItems.map((ci) => ({
      id: ci.id,
      kind: ci.kind,
      title: ci.title,
      body: ci.body ?? "",
      filePath: ci.filePath ?? "",
      position: ci.position ?? 0,
      mediaItems: ciMediaByItem.get(ci.id) ?? [],
    })),
    questions: questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind ?? "single",
      position: q.position ?? 0,
      choices: choicesByQ.get(q.id) ?? [],
    })),
  };
}

function tryHydrateSnapshot(json: string, liveModule: LmsModule): LearnerModule | null {
  let snap: Record<string, unknown>;
  try {
    snap = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof snap !== "object" || snap === null) return null;

  const rawCi = Array.isArray(snap.content_items) ? snap.content_items : [];
  const rawQs = Array.isArray(snap.questions) ? snap.questions : [];
  const rawMedia = Array.isArray(snap.media_items) ? snap.media_items : [];

  return {
    // Always fall back to live id so /my/modules/<id>/quiz keeps resolving
    // (matches hydrate_module_view app.py:706).
    id: liveModule.id,
    title: typeof snap.title === "string" ? snap.title : liveModule.title,
    description:
      typeof snap.description === "string"
        ? snap.description
        : liveModule.description ?? "",
    isPublished:
      typeof snap.is_published === "boolean" ? snap.is_published : liveModule.isPublished ?? true,
    coverPath:
      typeof snap.cover_path === "string" ? snap.cover_path : liveModule.coverPath ?? "",
    mediaItems: rawMedia.map(toMedia).filter(Boolean) as LearnerMediaItem[],
    contentItems: rawCi.map(toContentItem).filter(Boolean) as LearnerContentItem[],
    questions: rawQs.map(toQuestion).filter(Boolean) as QuizQuestion[],
  };
}

function toMedia(x: unknown): LearnerMediaItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.file_path !== "string") return null;
  return {
    id: typeof o.id === "number" ? o.id : 0,
    kind: typeof o.kind === "string" ? o.kind : "",
    filePath: o.file_path,
  };
}

function toContentItem(x: unknown): LearnerContentItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  return {
    id: typeof o.id === "number" ? o.id : 0,
    kind: typeof o.kind === "string" ? o.kind : "text",
    title: typeof o.title === "string" ? o.title : "",
    body: typeof o.body === "string" ? o.body : "",
    filePath: typeof o.file_path === "string" ? o.file_path : "",
    position: typeof o.position === "number" ? o.position : 0,
    mediaItems: Array.isArray(o.media_items)
      ? (o.media_items.map(toMedia).filter(Boolean) as LearnerMediaItem[])
      : [],
  };
}

function toQuestion(x: unknown): QuizQuestion | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.prompt !== "string") return null;
  const choices = Array.isArray(o.choices)
    ? o.choices.map(toChoice).filter(Boolean)
    : [];
  return {
    id: o.id,
    prompt: o.prompt,
    kind: typeof o.kind === "string" ? o.kind : "single",
    position: typeof o.position === "number" ? o.position : 0,
    choices: choices as QuizQuestion["choices"],
  };
}

function toChoice(x: unknown): { id: number; text: string; isCorrect: boolean } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.text !== "string") return null;
  return {
    id: o.id,
    text: o.text,
    isCorrect: o.is_correct === true,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface SubmitResult {
  attemptId: number;
  score: ScoreResult;
  passed: boolean;
}

/** Submits a quiz attempt: scores, inserts attempt row, conditionally sets
 *  assignment.completed_at — all in one transaction (matches Flask's
 *  app.py:3845-3863 single-commit pattern). */
export async function submitAttempt(opts: {
  lmsUser: LmsUser;
  module: LearnerModule;
  assignment: LmsAssignment;
  answers: AnswersMap;
}): Promise<SubmitResult> {
  const score = scoreAttempt(opts.module.questions, opts.answers);
  const passed = score.percent >= PASS_THRESHOLD;

  const attemptId = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(lmsAttempts)
      .values({
        userId: opts.lmsUser.id,
        moduleId: opts.module.id,
        score: score.percent,
        correct: score.correct,
        total: score.total,
        passed,
        answersJson: JSON.stringify(opts.answers),
      })
      .returning({ id: lmsAttempts.id });
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error("Insert attempt returned no id");

    if (passed && opts.assignment.completedAt === null) {
      await tx
        .update(lmsAssignments)
        .set({ completedAt: new Date() })
        .where(eq(lmsAssignments.id, opts.assignment.id));
    }
    return id;
  });

  // Fire-and-forget — don't block the redirect on email I/O.
  void notifyAttempt({
    learnerEmail: opts.lmsUser.email,
    learnerName: opts.lmsUser.name,
    moduleTitle: opts.module.title,
    score: score.percent,
    passed,
  });

  return { attemptId, score, passed };
}

// ─── Result page helpers ──────────────────────────────────────────────────

export async function getAttemptForLearner(
  attemptId: number,
  lmsUserId: number,
): Promise<{
  attempt: typeof lmsAttempts.$inferSelect;
  module: LearnerModule;
  review: ReviewEntry[];
} | null> {
  const rows = await db
    .select()
    .from(lmsAttempts)
    .where(eq(lmsAttempts.id, attemptId))
    .limit(1);
  const attempt = rows[0];
  if (!attempt) return null;
  if (attempt.userId !== lmsUserId) return null; // 403 collapsed to 404 for the learner UI

  const moduleRow = await db
    .select()
    .from(lmsModules)
    .where(eq(lmsModules.id, attempt.moduleId))
    .limit(1);
  if (!moduleRow[0]) return null;

  const module = await loadLiveModule(moduleRow[0]);

  let answers: AnswersMap = {};
  try {
    const parsed = JSON.parse(attempt.answersJson ?? "{}");
    if (parsed && typeof parsed === "object") answers = parsed as AnswersMap;
  } catch {
    // empty
  }
  return { attempt, module, review: attemptReview(module.questions, answers) };
}

// ─── Uploads helpers ──────────────────────────────────────────────────────

/** Returns the upload row only if the filename is referenced by a module
 *  the learner is currently assigned to. Closes the obscurity-only hole
 *  in Flask's @login_required-only `/uploads/<name>`. */
export async function getUploadForLearner(
  filename: string,
  lmsUserId: number,
): Promise<typeof lmsUploadedFiles.$inferSelect | null> {
  const assignedModuleIds = (
    await db
      .select({ moduleId: lmsAssignments.moduleId })
      .from(lmsAssignments)
      .where(eq(lmsAssignments.userId, lmsUserId))
  ).map((r) => r.moduleId);
  if (assignedModuleIds.length === 0) return null;

  const referenced = await isFileReferencedByModules(filename, assignedModuleIds);
  if (!referenced) return null;

  const file = await db
    .select()
    .from(lmsUploadedFiles)
    .where(eq(lmsUploadedFiles.filename, filename))
    .limit(1);
  return file[0] ?? null;
}

/** Admin viewer: any file referenced by any module OR by any user
 *  (photo_filename) in the tenant. Photos in particular need this — they
 *  aren't referenced by any module. */
export async function getUploadForAdmin(
  filename: string,
  traceyTenantId: string,
): Promise<typeof lmsUploadedFiles.$inferSelect | null> {
  // user.photo_filename for any user in the tenant?
  const photoHit = await db
    .select({ id: lmsUsers.id })
    .from(lmsUsers)
    .where(
      and(
        eq(lmsUsers.photoFilename, filename),
        eq(lmsUsers.traceyTenantId, traceyTenantId),
      ),
    )
    .limit(1);
  if (!photoHit[0]) {
    // Fall back to checking module-referenced files for any module the
    // tenant has staff assigned to. Cheap to do via assignments → users.
    const moduleIds = (
      await db
        .selectDistinct({ moduleId: lmsAssignments.moduleId })
        .from(lmsAssignments)
        .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
        .where(eq(lmsUsers.traceyTenantId, traceyTenantId))
    ).map((r) => r.moduleId);
    if (moduleIds.length === 0) return null;
    const referenced = await isFileReferencedByModules(filename, moduleIds);
    if (!referenced) return null;
  }
  const file = await db
    .select()
    .from(lmsUploadedFiles)
    .where(eq(lmsUploadedFiles.filename, filename))
    .limit(1);
  return file[0] ?? null;
}

async function isFileReferencedByModules(
  filename: string,
  moduleIds: number[],
): Promise<boolean> {
  // Check Module.cover_path
  const cover = await db
    .select({ id: lmsModules.id })
    .from(lmsModules)
    .where(and(eq(lmsModules.coverPath, filename), inArray(lmsModules.id, moduleIds)))
    .limit(1);
  if (cover[0]) return true;

  // Check ModuleMedia.file_path
  const modMedia = await db
    .select({ id: lmsModuleMedia.id })
    .from(lmsModuleMedia)
    .where(
      and(eq(lmsModuleMedia.filePath, filename), inArray(lmsModuleMedia.moduleId, moduleIds)),
    )
    .limit(1);
  if (modMedia[0]) return true;

  // Check ContentItem.file_path (legacy single slot)
  const ci = await db
    .select({ id: lmsContentItems.id })
    .from(lmsContentItems)
    .where(
      and(
        eq(lmsContentItems.filePath, filename),
        inArray(lmsContentItems.moduleId, moduleIds),
      ),
    )
    .limit(1);
  if (ci[0]) return true;

  // Check ContentItemMedia.file_path (one extra join through content_items)
  const ciMedia = await db
    .select({ id: lmsContentItemMedia.id })
    .from(lmsContentItemMedia)
    .innerJoin(
      lmsContentItems,
      eq(lmsContentItems.id, lmsContentItemMedia.contentItemId),
    )
    .where(
      and(
        eq(lmsContentItemMedia.filePath, filename),
        inArray(lmsContentItems.moduleId, moduleIds),
      ),
    )
    .limit(1);
  return Boolean(ciMedia[0]);
}
