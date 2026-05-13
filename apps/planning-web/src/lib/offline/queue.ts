// ─── Tracey Offline — Write Queue ────────────────────────────────────────────
// Client-side: wraps server actions so they queue to IndexedDB when offline
// and replay automatically when the connection is restored.
// ─────────────────────────────────────────────────────────────────────────────

import { enqueue, getPending, updateEntry, remove } from "./db";
import type { QueueEntry } from "./db";

// ── Action registry ───────────────────────────────────────────────────────────
// Maps action name keys → dynamic imports of the actual server actions.
// Only imported when needed (drain), keeping the client bundle lean.

type ActionFn = (...args: unknown[]) => Promise<{ error?: string }>;

async function resolveAction(actionKey: string): Promise<ActionFn | null> {
  try {
    switch (actionKey) {
      case "updateProductionOrder": {
        const m = await import("@/app/(app)/dept/actions");
        return m.updateProductionOrder as unknown as ActionFn;
      }
      case "updateFillingOrder": {
        const m = await import("@/app/(app)/dept/actions");
        return m.updateFillingOrder as unknown as ActionFn;
      }
      case "updateCookingOrder": {
        const m = await import("@/app/(app)/dept/actions");
        return m.updateCookingOrder as unknown as ActionFn;
      }
      case "updatePackingOrder": {
        const m = await import("@/app/(app)/dept/actions");
        return m.updatePackingOrder as unknown as ActionFn;
      }
      case "saveDemandLines": {
        const m = await import("@/app/(app)/plans/actions");
        return m.saveDemandLines as unknown as ActionFn;
      }
      default:
        console.warn("[Tracey offline] Unknown action key:", actionKey);
        return null;
    }
  } catch (e) {
    console.error("[Tracey offline] Failed to import action:", actionKey, e);
    return null;
  }
}

// ── Enqueue wrapper ───────────────────────────────────────────────────────────

/**
 * Call a server action, queuing it to IndexedDB if offline.
 *
 * Usage:
 *   const result = await withOfflineQueue(
 *     "updateProductionOrder",
 *     () => updateProductionOrder(id, fields),
 *     [id, fields]
 *   );
 */
export async function withOfflineQueue<T extends { error?: string }>(
  actionKey: string,
  onlineFn: () => Promise<T>,
  offlineArgs: unknown[]
): Promise<T & { queued?: boolean }> {
  if (navigator.onLine) {
    return onlineFn();
  }

  // Offline: store in IndexedDB
  try {
    await enqueue(actionKey, offlineArgs);
    console.log(`[Tracey offline] Queued "${actionKey}" for later sync`);
    return { queued: true } as T & { queued?: boolean };
  } catch (e) {
    return { error: "Failed to queue offline: " + String(e) } as T & { queued?: boolean };
  }
}

// ── Drain queue ───────────────────────────────────────────────────────────────

export type DrainResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
};

/**
 * Replay all pending queue entries against their server actions.
 * Call this when the app comes back online.
 */
export async function drainQueue(): Promise<DrainResult> {
  const pending = await getPending();
  const result: DrainResult = { attempted: pending.length, succeeded: 0, failed: 0, errors: [] };

  if (pending.length === 0) return result;

  console.log(`[Tracey offline] Draining ${pending.length} queued mutation(s)…`);

  for (const entry of pending) {
    await updateEntry(entry.id, { status: "syncing", attempts: entry.attempts + 1 });

    const action = await resolveAction(entry.action);
    if (!action) {
      await updateEntry(entry.id, { status: "failed", error: "Unknown action" });
      result.failed++;
      result.errors.push(`${entry.action}: unknown action`);
      continue;
    }

    try {
      const res = await action(...entry.args);
      if (res?.error) {
        await updateEntry(entry.id, { status: "failed", error: res.error });
        result.failed++;
        result.errors.push(`${entry.action}: ${res.error}`);
      } else {
        await remove(entry.id);
        result.succeeded++;
        console.log(`[Tracey offline] Replayed: ${entry.action}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await updateEntry(entry.id, { status: "failed", error: msg });
      result.failed++;
      result.errors.push(`${entry.action}: ${msg}`);
    }
  }

  return result;
}

// ── Background Sync registration ─────────────────────────────────────────────

/**
 * Register a Background Sync tag so the SW can trigger a drain
 * even if the user has closed the tab.
 */
export async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("SyncManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // @ts-expect-error — SyncManager not in all TypeScript lib definitions
    await reg.sync.register("tracey-queue-drain");
  } catch {
    // Silently fail — foreground drain handles this
  }
}

export type { QueueEntry };
