"use client";

import { useSyncContext } from "@/lib/offline/sync-context";

export default function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, lastSyncResult, manualSync } = useSyncContext();

  // Online + nothing queued — render nothing
  if (isOnline && pendingCount === 0 && !lastSyncResult) return null;

  // Just finished syncing — show success briefly
  if (isOnline && pendingCount === 0 && lastSyncResult) {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: "#166534", color: "white",
        padding: "0.5rem 1rem",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
        fontSize: "0.875rem", fontWeight: "500",
      }}>
        ✅ Back online — {lastSyncResult.succeeded} change{lastSyncResult.succeeded !== 1 ? "s" : ""} synced successfully.
      </div>
    );
  }

  // Syncing in progress
  if (isOnline && isSyncing) {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: "#1d4ed8", color: "white",
        padding: "0.5rem 1rem",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
        fontSize: "0.875rem", fontWeight: "500",
      }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
        Syncing {pendingCount} queued change{pendingCount !== 1 ? "s" : ""}…
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Online but still has pending (sync failed)
  if (isOnline && pendingCount > 0) {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: "#d97706", color: "white",
        padding: "0.5rem 1rem",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
        fontSize: "0.875rem", fontWeight: "500",
      }}>
        ⚠ {pendingCount} change{pendingCount !== 1 ? "s" : ""} waiting to sync
        <button
          onClick={manualSync}
          style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)", color: "white", borderRadius: "0.25rem", padding: "0.1875rem 0.625rem", cursor: "pointer", fontSize: "0.8125rem" }}
        >
          Retry sync
        </button>
      </div>
    );
  }

  // Offline
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#1c1917", color: "white",
      padding: "0.5rem 1rem",
      fontSize: "0.875rem",
    }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1rem" }}>📵</span>
          <span><strong>You&apos;re offline.</strong> Changes are being saved locally and will sync when you&apos;re back online.</span>
        </div>
        {pendingCount > 0 && (
          <div style={{ background: "#dc2626", borderRadius: "1rem", padding: "0.125rem 0.625rem", fontSize: "0.75rem", fontWeight: "700" }}>
            {pendingCount} queued
          </div>
        )}
      </div>
    </div>
  );
}
