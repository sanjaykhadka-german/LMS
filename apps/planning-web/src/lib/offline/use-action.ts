"use client";

// ─── useOfflineAction ─────────────────────────────────────────────────────────
// Drop-in replacement for calling a server action directly.
// When offline: queues the call to IndexedDB and returns { queued: true }.
// When online: calls the action normally.
//
// Usage:
//   const run = useOfflineAction("updateProductionOrder", updateProductionOrder);
//   const result = await run(orderId, fields);
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { withOfflineQueue } from "./queue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<{ error?: string }>;

export function useOfflineAction<T extends AnyAction>(
  actionKey: string,
  action: T
): (...args: Parameters<T>) => Promise<ReturnType<T> & { queued?: boolean }> {
  return useCallback(
    (...args: Parameters<T>) =>
      withOfflineQueue(
        actionKey,
        () => action(...args),
        args
      ) as Promise<ReturnType<T> & { queued?: boolean }>,
    [actionKey, action]
  );
}
