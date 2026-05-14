import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/auth/current";
import { isStorageBucket, storage } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_EXPIRES = 60 * 60 * 24; // 24h

export async function POST(req: NextRequest) {
  try {
    await requireTenant();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { bucket?: string; path?: string; expiresIn?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const { bucket, path } = body;
  const expiresIn = Math.min(Math.max(1, body.expiresIn ?? 3600), MAX_EXPIRES);

  if (typeof bucket !== "string" || !isStorageBucket(bucket)) {
    return NextResponse.json({ error: "Invalid bucket" }, { status: 400 });
  }
  if (typeof path !== "string" || !path) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  try {
    const url = await storage().signedUrl(bucket, path, expiresIn);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
