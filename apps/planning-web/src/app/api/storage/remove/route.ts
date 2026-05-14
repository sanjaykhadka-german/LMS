import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/current";
import { isStorageBucket, storage } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { bucket?: string; paths?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { bucket, paths } = body;
  if (typeof bucket !== "string" || !isStorageBucket(bucket)) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string" || !p)) {
    return NextResponse.json({ error: "Invalid paths" }, { status: 400 });
  }

  try {
    await storage().remove(bucket, paths);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Remove failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
