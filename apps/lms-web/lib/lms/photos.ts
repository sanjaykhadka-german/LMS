import "server-only";
import crypto from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, lmsUploadedFiles } from "@tracey/db";

// Accepts a multipart-form `File`, normalizes via sharp (auto-rotate, resize
// max 800x800, re-encode to JPEG so EXIF stripping is automatic), and stores
// the result in `uploaded_files` (BYTEA-backed; survives Render's ephemeral
// disk). Returns the stored filename — write that into `users.photo_filename`.
//
// Mirrors set_user_photo (app.py:644-654): persists the new file, then
// deletes the previous one if the caller passes its filename.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB raw upload cap
const ACCEPTED_KINDS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

export interface SavePhotoOpts {
  /** Multipart File from a server action. */
  file: File;
  /** Optional uploader id for the audit column on uploaded_files. */
  uploadedByLmsUserId?: number | null;
  /** Existing photo filename to delete if the upload succeeds. */
  previousFilename?: string | null;
}

export async function saveUserPhoto(opts: SavePhotoOpts): Promise<string> {
  if (opts.file.size === 0) {
    throw new PhotoUploadError("No file selected.");
  }
  if (opts.file.size > MAX_BYTES) {
    const mb = Math.round(opts.file.size / (1024 * 1024));
    throw new PhotoUploadError(`File too large (${mb} MB). Max 8 MB.`);
  }
  if (!ACCEPTED_KINDS.has(opts.file.type)) {
    throw new PhotoUploadError("Use a JPEG, PNG, WebP, or GIF image.");
  }

  const raw = Buffer.from(await opts.file.arrayBuffer());

  let processed: Buffer;
  try {
    processed = await sharp(raw)
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PhotoUploadError("Couldn't process that image.");
  }

  const stored = `photo_${crypto.randomBytes(8).toString("hex")}.jpg`;
  await db.transaction(async (tx) => {
    await tx.insert(lmsUploadedFiles).values({
      filename: stored,
      mimeType: "image/jpeg",
      data: processed,
      size: processed.byteLength,
      uploadedById: opts.uploadedByLmsUserId ?? null,
    });
    if (opts.previousFilename && opts.previousFilename !== stored) {
      await tx
        .delete(lmsUploadedFiles)
        .where(eq(lmsUploadedFiles.filename, opts.previousFilename));
    }
  });

  return stored;
}

/** Mirror clear_user_photo (app.py:657). Deletes the BYTEA row; caller is
 *  responsible for nulling `users.photo_filename`. */
export async function deleteStoredPhoto(filename: string): Promise<void> {
  if (!filename) return;
  await db.delete(lmsUploadedFiles).where(eq(lmsUploadedFiles.filename, filename));
}
