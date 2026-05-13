"use client";

// ─── Tracey Offline — Sync Context ───────────────────────────────────────────
// Provides:
//   - isOnline: boolean
//   - pendingCount: number (items waiting in the queue)
//   - isSyncing: boolean
//   - lastSyncResult: DrainResult | null
//   - manualSync(): trigger a drain immediately
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext, useContext, useEffect, useState, useCallback, useRef,
} from "react";
import { drainQueue, requestBackgroundSync } from "./queue";
import { pendingCount as dbPendingCount, pruneOld } from "./db";
import type { DrainResult } from "./queue";

interface SyncContextValue {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncResult: DrainResult | null;
  manualSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  isOnline: true,
  pendingCount: 0,
  isSyncing: false,
  lastSyncResult: null,
  manualSync: async () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]     = useState(true);
  const [pending, setPending]       = useState(0);
  const [isSyncing, setIsSyncing]   = useState(false);
  const [lastResult, setLastResult] = useState<DrainResult | null>(null);
  const draining = useRef(false);

  const refreshCount = useCallback(async () => {
    try { setPending(await dbPendingCount()); } catch { /* IDB not available */ }
  }, []);

  const sync = useCallback(async () => {
    if (draining.current || !navigator.onLine) return;
    draining.current = true;
    setIsSyncing(true);
    try {
      const result = await drainQueue();
      setLastResult(result);
      await refreshCount();
      if (result.succeeded > 0) {
        // Trigger a page refresh so server-rendered data is up to date
        window.dispatchEvent(new CustomEvent("tracey:synced", { detail: result }));
      }
    } finally {
      draining.current = false;
      setIsSyncing(false);
    }
  }, [refreshCount]);

  // Register SW + listen for SW messages
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(reg => {
        console.log("[Tracey] SW registered:", reg.scope);
        // If a new SW is waiting, activate it
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      })
      .catch(e => console.warn("[Tracey] SW registration failed:", e));

    // Listen for sync messages from the SW background sync event
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "SYNC_QUEUE") sync();
    });
  }, [sync]);

  // Online / offline listeners
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      await refreshCount();
      await sync();
      await requestBackgroundSync();
    };
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sync, refreshCount]);

  // Poll pending count every 30s (catches items added in other tabs)
  useEffect(() => {
    refreshCount();
    pruneOld().catch(() => {});
    const id = setInterval(refreshCount, 30_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  return (
    <SyncContext.Provider value={{
      isOnline,
      pendingCount: pending,
      isSyncing,
      lastSyncResult: lastResult,
      manualSync: sync,
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncContext() {
  return useContext(SyncContext);
}
