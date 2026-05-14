import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/current";
import { storage } from "@/lib/storage";
import { isStorageBucket } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const bucket = form.get("bucket");
  const path = form.get("path");
  const upsert = form.get("upsert");
  const contentType = form.get("contentType");
  const file = form.get("file");

  if (typeof bucket !== "string" || !isStorageBucket(bucket)) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }
  if (typeof path !== "string" || !path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    await storage().upload(bucket, path, buf, {
      contentType: typeof contentType === "string" && contentType
        ? contentType
        : (file.type || undefined),
      upsert: upsert === "1" || upsert === "true",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path });
}
