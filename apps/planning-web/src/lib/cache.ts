"use client";

/**
 * Tiny module-level stale-while-revalidate cache.
 * Lives for the lifetime of the browser tab — no external packages needed.
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map<string, CacheEntry<any>>();

export function getCached<T>(key: string, staleMs: number): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > staleMs) return undefined;
  return entry.data;
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now() });
}

export function invalidateCache(key: string): void {
  store.delete(key);
}

export function invalidateCachePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
