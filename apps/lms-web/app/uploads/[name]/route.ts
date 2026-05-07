import { NextResponse } from "next/server";
import { getUploadForLearner, requireLearner } from "~/lib/lms/learner";

// Tenant-scoped port of Flask's /uploads/<name> (app.py:3886). Streams the
// BYTEA stored in `uploaded_files`. Disk-fallback is intentionally dropped:
// Render's free-tier ephemeral disk wipes anything not in the DB.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return new NextResponse("Not Found", { status: 404 });

  const { lmsUser } = await requireLearner();
  const file = await getUploadForLearner(name, lmsUser.id);
  if (!file) return new NextResponse("Not Found", { status: 404 });

  // Copy into a fresh ArrayBuffer so TS's BlobPart type (which forbids
  // SharedArrayBuffer-backed views) accepts it. Negligible cost vs the
  // disk/network it just came from.
  const ab = new ArrayBuffer(file.data.byteLength);
  new Uint8Array(ab).set(file.data);
  const blob = new Blob([ab], { type: file.mimeType });
  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(blob.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
