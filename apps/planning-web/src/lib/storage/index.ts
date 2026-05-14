import "server-only";
import { LocalFsAdapter } from "./local-fs";
import { R2Adapter } from "./r2";
import type { StorageAdapter } from "./types";

export type StorageBackend = "local-fs" | "r2";

function resolveBackend(): StorageBackend {
  const explicit = process.env.STORAGE_BACKEND?.toLowerCase();
  if (explicit === "r2") return "r2";
  if (explicit === "local-fs") return "local-fs";
  // Auto-detect: if any R2_* core var is set, use R2; otherwise local-fs.
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET) {
    return "r2";
  }
  return "local-fs";
}

let cached: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (cached) return cached;
  cached = resolveBackend() === "r2" ? new R2Adapter() : new LocalFsAdapter();
  return cached;
}

export function resetStorageForTests(): void {
  cached = null;
}

export type { StorageAdapter, StorageBucket, UploadOpts, DownloadResult } from "./types";
export { STORAGE_BUCKETS, isStorageBucket } from "./types";
