"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  lmsContentItemMedia,
  lmsContentItems,
  lmsModules,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import {
  deleteStoredPhoto,
  PhotoUploadError,
  saveBinaryUpload,
} from "~/lib/lms/photos";

const VALID_KINDS = new Set([
  "story",
  "scenario",
  "takeaway",
  "section",
  "text",
  "link",
  "pdf",
  "doc",
  "audio",
  "video",
  "image",
]);

async function assertModuleOwned(moduleId: number, tid: string) {
  const [m] = await db
    .select({ id: lmsModules.id })
    .from(lmsModules)
    .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
    .limit(1);
  if (!m) throw new Error("Module not found");
}

export async function addContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");
  await assertModuleOwned(moduleId, tid);

  const kind = String(formData.get("kind") ?? "section");
  if (!VALID_KINDS.has(kind)) throw new Error("Invalid kind");

  // Compute the next position so the item lands at the bottom.
  const [last] = await db
    .select({ position: lmsContentItems.position })
    .from(lmsContentItems)
    .where(
      and(eq(lmsContentItems.moduleId, moduleId), tenantWhere(lmsContentItems, tid)),
    )
    .orderBy(desc(lmsContentItems.position))
    .limit(1);
  const nextPosition = (last?.position ?? 0) + 10;

  const [row] = await db
    .insert(lmsContentItems)
    .values({
      moduleId,
      kind,
      title: String(formData.get("title") ?? "New section").slice(0, 255) || "New section",
      body: "",
      filePath: "",
      position: nextPosition,
      traceyTenantId: tid,
    })
    .returning({ id: lmsContentItems.id });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.added",
    targetKind: "content_item",
    targetId: String(row?.id ?? ""),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  const [target] = await db
    .select()
    .from(lmsContentItems)
    .where(
      and(
        eq(lmsContentItems.id, id),
        eq(lmsContentItems.moduleId, moduleId),
        tenantWhere(lmsContentItems, tid),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Content not found");

  const kind = String(formData.get("kind") ?? target.kind);
  const title = String(formData.get("title") ?? "").trim().slice(0, 255);
  const body = String(formData.get("body") ?? "");

  // Optional new file replaces the existing one.
  const file = formData.get("file");
  let filePath = target.filePath ?? "";
  if (file instanceof File && file.size > 0) {
    try {
      filePath = await saveBinaryUpload({
        file,
        prefix: "content_",
        uploadedByLmsUserId: ctx.lmsUser.id,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) {
        redirect(
          `/app/admin/modules/${moduleId}?error=content_upload&msg=${encodeURIComponent(
            err.message,
          )}#content-${id}`,
        );
      }
      throw err;
    }
    if (target.filePath && target.filePath !== filePath) {
      await deleteStoredPhoto(target.filePath);
    }
  } else if (formData.get("clear_file") === "1" && target.filePath) {
    await deleteStoredPhoto(target.filePath);
    filePath = "";
  }

  await db
    .update(lmsContentItems)
    .set({ kind, title, body, filePath })
    .where(
      and(eq(lmsContentItems.id, id), tenantWhere(lmsContentItems, tid)),
    );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.updated",
    targetKind: "content_item",
    targetId: String(id),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  const [target] = await db
    .select()
    .from(lmsContentItems)
    .where(
      and(
        eq(lmsContentItems.id, id),
        eq(lmsContentItems.moduleId, moduleId),
        tenantWhere(lmsContentItems, tid),
      ),
    )
    .limit(1);
  if (!target) return;

  // Cascade-collect file_paths so we can delete the BYTEA rows after the
  // FK cascade drops the metadata.
  const media = await db
    .select({ filePath: lmsContentItemMedia.filePath })
    .from(lmsContentItemMedia)
    .where(
      and(
        eq(lmsContentItemMedia.contentItemId, id),
        tenantWhere(lmsContentItemMedia, tid),
      ),
    );

  await db
    .delete(lmsContentItems)
    .where(and(eq(lmsContentItems.id, id), tenantWhere(lmsContentItems, tid)));

  if (target.filePath) await deleteStoredPhoto(target.filePath);
  for (const m of media) {
    if (m.filePath) await deleteStoredPhoto(m.filePath);
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.deleted",
    targetKind: "content_item",
    targetId: String(id),
    details: { moduleId },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

// ─── Per-content-item media ───────────────────────────────────────────────

export async function addContentMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const contentItemId = parseInt(String(formData.get("content_item_id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(contentItemId) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  const file = formData.get("media");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/admin/modules/${moduleId}?error=media_empty#content-${contentItemId}`);
  }

  let stored: string;
  try {
    stored = await saveBinaryUpload({
      file: file as File,
      prefix: "media_",
      uploadedByLmsUserId: ctx.lmsUser.id,
      traceyTenantId: tid,
    });
  } catch (err) {
    if (err instanceof PhotoUploadError) {
      redirect(
        `/app/admin/modules/${moduleId}?error=media&msg=${encodeURIComponent(err.message)}#content-${contentItemId}`,
      );
    }
    throw err;
  }

  const ext = stored.slice(stored.lastIndexOf(".") + 1).toLowerCase();
  const kind = ["mp4", "mov", "webm"].includes(ext) ? "video" : "image";

  await db.insert(lmsContentItemMedia).values({
    contentItemId,
    filePath: stored,
    kind,
    position: 0,
    traceyTenantId: tid,
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function removeContentMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");
  await assertModuleOwned(moduleId, tid);

  const [target] = await db
    .select()
    .from(lmsContentItemMedia)
    .where(and(eq(lmsContentItemMedia.id, id), tenantWhere(lmsContentItemMedia, tid)))
    .limit(1);
  if (!target) return;

  await db
    .delete(lmsContentItemMedia)
    .where(and(eq(lmsContentItemMedia.id, id), tenantWhere(lmsContentItemMedia, tid)));
  if (target.filePath) await deleteStoredPhoto(target.filePath);
  void ctx;
  revalidatePath(`/app/admin/modules/${moduleId}`);
}
