import { NextRequest } from "next/server";
import { isStorageBucket, storage } from "@/lib/storage";
import { verifyLocalToken } from "@/lib/storage/local-fs";

export const runtime = "nodejs";

// This endpoint serves files for the local-fs storage backend. The signed
// URL produced by LocalFsAdapter.signedUrl() encodes a short-lived HMAC of
// (bucket, path, expiresAt) which we verify here before reading the file.
// R2 signed URLs hit Cloudflare directly and never go through this route.

export async function GET(req: NextRequest) {
  const adapter = storage();
  if (adapter.kind !== "local-fs") {
    return new Response("Not configured for local-fs serving", { status: 404 });
  }

  const u = new URL(req.url);
  const bucket = u.searchParams.get("bucket");
  const path = u.searchParams.get("path");
  const expStr = u.searchParams.get("exp");
  const sig = u.searchParams.get("sig");

  if (!bucket || !path || !expStr || !sig) {
    return new Response("Missing params", { status: 400 });
  }
  if (!isStorageBucket(bucket)) {
    return new Response("Invalid bucket", { status: 400 });
  }
  const exp = Number(expStr);
  if (!verifyLocalToken(bucket, path, exp, sig)) {
    return new Response("Invalid or expired signature", { status: 403 });
  }

  try {
    const { body, contentType, size } = await adapter.download(bucket, path);
    const headers: Record<string, string> = {
      "content-length": String(size ?? body.byteLength),
      "cache-control": "private, max-age=300",
    };
    if (contentType) headers["content-type"] = contentType;
    return new Response(Buffer.from(body), { status: 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
