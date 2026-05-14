import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  type DownloadResult,
  type StorageAdapter,
  type StorageBucket,
  type UploadOpts,
  assertSafePath,
} from "./types";

function rootDir(): string {
  return resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".tracey-storage");
}

function bucketDir(bucket: StorageBucket): string {
  return join(rootDir(), bucket);
}

function safeJoin(bucket: StorageBucket, path: string): string {
  assertSafePath(path);
  const full = resolve(bucketDir(bucket), path);
  const base = bucketDir(bucket) + sep;
  if (full !== bucketDir(bucket) && !full.startsWith(base)) {
    throw new Error("Resolved storage path escapes bucket root");
  }
  return full;
}

function hmacSecret(): string {
  const s = process.env.STORAGE_SIGNING_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Local-FS storage needs STORAGE_SIGNING_SECRET or NEXTAUTH_SECRET to sign URLs");
  return s;
}

export function signLocalToken(bucket: StorageBucket, path: string, expiresAtMs: number): string {
  const payload = `${bucket}|${path}|${expiresAtMs}`;
  return createHmac("sha256", hmacSecret()).update(payload).digest("base64url");
}

export function verifyLocalToken(
  bucket: string,
  path: string,
  expiresAtMs: number,
  token: string,
): boolean {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return false;
  const expected = createHmac("sha256", hmacSecret())
    .update(`${bucket}|${path}|${expiresAtMs}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(token, "base64url");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

function publicBaseUrl(): string {
  const explicit = process.env.STORAGE_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return "";
}

function guessContentType(path: string): string | undefined {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "gif": return "image/gif";
    case "pdf": return "application/pdf";
    case "json": return "application/json";
    case "txt": return "text/plain";
    case "csv": return "text/csv";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls": return "application/vnd.ms-excel";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "doc": return "application/msword";
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    default: return undefined;
  }
}

export class LocalFsAdapter implements StorageAdapter {
  readonly kind = "local-fs" as const;

  async upload(bucket: StorageBucket, path: string, body: Uint8Array, opts?: UploadOpts): Promise<void> {
    const full = safeJoin(bucket, path);
    if (!opts?.upsert) {
      try {
        await stat(full);
        throw new Error(`File already exists at ${bucket}/${path}`);
      } catch (err: unknown) {
        if (!isEnoent(err)) throw err;
      }
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async download(bucket: StorageBucket, path: string): Promise<DownloadResult> {
    const full = safeJoin(bucket, path);
    const body = await readFile(full);
    return {
      body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      contentType: guessContentType(path),
      size: body.byteLength,
    };
  }

  async remove(bucket: StorageBucket, paths: string[]): Promise<void> {
    await Promise.all(
      paths.map(async (p) => {
        const full = safeJoin(bucket, p);
        try {
          await rm(full, { force: true });
        } catch (err) {
          if (!isEnoent(err)) throw err;
        }
      }),
    );
  }

  async signedUrl(bucket: StorageBucket, path: string, expiresInSeconds: number): Promise<string> {
    assertSafePath(path);
    const expiresAt = Date.now() + Math.max(1, expiresInSeconds) * 1000;
    const token = signLocalToken(bucket, path, expiresAt);
    const params = new URLSearchParams({
      bucket,
      path,
      exp: String(expiresAt),
      sig: token,
    });
    return `${publicBaseUrl()}/api/storage/serve?${params.toString()}`;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
