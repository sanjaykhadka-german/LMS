import "server-only";

export type StorageBucket =
  | "item-images"
  | "item-specs"
  | "tenant-branding"
  | "spec-images"
  | "machine-docs"
  | "supplier-certs";

export const STORAGE_BUCKETS: readonly StorageBucket[] = [
  "item-images",
  "item-specs",
  "tenant-branding",
  "spec-images",
  "machine-docs",
  "supplier-certs",
] as const;

export function isStorageBucket(b: string): b is StorageBucket {
  return (STORAGE_BUCKETS as readonly string[]).includes(b);
}

export interface UploadOpts {
  contentType?: string;
  upsert?: boolean;
}

export interface DownloadResult {
  body: Uint8Array;
  contentType?: string;
  size?: number;
}

export interface StorageAdapter {
  readonly kind: "local-fs" | "r2";
  upload(bucket: StorageBucket, path: string, body: Uint8Array, opts?: UploadOpts): Promise<void>;
  download(bucket: StorageBucket, path: string): Promise<DownloadResult>;
  remove(bucket: StorageBucket, paths: string[]): Promise<void>;
  signedUrl(bucket: StorageBucket, path: string, expiresInSeconds: number): Promise<string>;
}

export function assertSafePath(path: string): void {
  if (!path) throw new Error("Storage path is empty");
  if (path.startsWith("/") || path.startsWith("\\")) throw new Error("Storage path must be relative");
  if (path.includes("..")) throw new Error("Storage path must not contain `..`");
  if (path.includes("\0")) throw new Error("Storage path must not contain null bytes");
}
