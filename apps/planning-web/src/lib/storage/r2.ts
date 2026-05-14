import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type DownloadResult,
  type StorageAdapter,
  type StorageBucket,
  type UploadOpts,
  assertSafePath,
} from "./types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`R2 storage adapter requires ${name}`);
  return v;
}

// One bucket per Tracey "logical bucket" mirrors the Supabase model.
// In practice an operator can map all of them onto a single R2 bucket by
// setting R2_BUCKET_PREFIX (the prefix is treated as a key-prefix path).
function r2BucketName(bucket: StorageBucket): string {
  const explicit = process.env[`R2_BUCKET_${bucket.toUpperCase().replace(/-/g, "_")}`];
  if (explicit) return explicit;
  return requireEnv("R2_BUCKET");
}

function r2Key(bucket: StorageBucket, path: string): string {
  const prefix = process.env.R2_BUCKET_PREFIX;
  const ns = prefix ? `${prefix.replace(/\/$/, "")}/${bucket}` : bucket;
  return `${ns}/${path}`;
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = requireEnv("R2_ACCOUNT_ID");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body && typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export class R2Adapter implements StorageAdapter {
  readonly kind = "r2" as const;

  async upload(bucket: StorageBucket, path: string, body: Uint8Array, opts?: UploadOpts): Promise<void> {
    assertSafePath(path);
    await client().send(new PutObjectCommand({
      Bucket: r2BucketName(bucket),
      Key: r2Key(bucket, path),
      Body: body,
      ContentType: opts?.contentType,
    }));
  }

  async download(bucket: StorageBucket, path: string): Promise<DownloadResult> {
    assertSafePath(path);
    const res = await client().send(new GetObjectCommand({
      Bucket: r2BucketName(bucket),
      Key: r2Key(bucket, path),
    }));
    const bytes = await bodyToBytes(res.Body);
    return {
      body: bytes,
      contentType: res.ContentType,
      size: res.ContentLength ?? bytes.byteLength,
    };
  }

  async remove(bucket: StorageBucket, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    paths.forEach(assertSafePath);
    await client().send(new DeleteObjectsCommand({
      Bucket: r2BucketName(bucket),
      Delete: {
        Objects: paths.map((p) => ({ Key: r2Key(bucket, p) })),
        Quiet: true,
      },
    }));
  }

  async signedUrl(bucket: StorageBucket, path: string, expiresInSeconds: number): Promise<string> {
    assertSafePath(path);
    return getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: r2BucketName(bucket),
        Key: r2Key(bucket, path),
      }),
      { expiresIn: Math.max(1, expiresInSeconds) },
    );
  }
}
