"use client";

/**
 * "Build Family Tree" — multi-select picker that re-parents selected items
 * onto the currently-viewed item.
 *
 * UX:
 *   - Search box (case-insensitive on code OR name)
 *   - Live results list with checkbox per row
 *   - Picked items show as removable chips above the search
 *   - "Add N children" button → bulk UPDATE items.parent_item_id = currentId
 *
 * Safety:
 *   - excludes the current item itself
 *   - excludes the entire descendant subtree of the current item (so adding a
 *     descendant as a "new child" wouldn't create a cycle — for that case the
 *     drag-and-drop is the right tool)
 *   - excludes items already direct children of the current item
 *   - shows a small ⚠ on items that ALREADY have a different parent: confirming
 *     will move them off their current parent. The modal lists those parents
 *     in a confirmation step before saving.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";

type SearchRow = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  parent_item_id: string | null;
  is_active: boolean;
};

export function AddChildrenModal({
  open,
  onClose,
  currentId,
  excludeIds,                 // current item + all descendants + existing direct children
  existingParentNames = {},   // optional id → "code — name" map for the warning step
}: {
  open: boolean;
  onClose: () => void;
  currentId: string;
  excludeIds: Set<string>;
  existingParentNames?: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Map<string, SearchRow>>(new Map());
  const [includeInactive, setIncludeInactive] = useState(false);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Reset on open / close ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setPicked(new Map());
    setStep("pick");
    setError(null);
    // Focus the search box on open
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // ── Live search (debounced) ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        let q = supabase
          .from("items")
          .select("id, code, name, item_type, parent_item_id, is_active")
          .order("code")
          .limit(50);
        if (!includeInactive) q = q.eq("is_active", true);
        if (term) {
          // Postgres ilike on either column. PostgREST wants `or=(...)` syntax.
          q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
        }
        const { data, error: e } = await q;
        if (cancelled) return;
        if (e) { setError(e.message); setResults([]); return; }
        // Drop excluded ids (current item, descendants, existing children)
        const filtered = (data ?? []).filter(r => !excludeIds.has(r.id));
        setResults(filtered as SearchRow[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, includeInactive, open, excludeIds, supabase]);

  // Items with an existing parent that ISN'T the current item — these will be
  // re-parented (moved). Worth surfacing before commit.
  const movers = useMemo(() => {
    return [...picked.values()].filter(r => r.parent_item_id && r.parent_item_id !== currentId);
  }, [picked, currentId]);

  function togglePick(row: SearchRow) {
    setPicked(prev => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }

  async function confirm() {
    if (picked.size === 0) return;
    setSaving(true); setError(null);
    const ids = [...picked.keys()];
    const { error: e } = await supabase
      .from("items")
      .update({ parent_item_id: currentId })
      .in("id", ids);
    setSaving(false);
    if (e) { setError(e.message); return; }
    onClose();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{
          width: "min(640px, 100%)", maxHeight: "85vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          padding: 0,
        }}
      >
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>
            {step === "pick" ? "Add children to this item" : "Confirm — re-parent these items?"}
          </h3>
          <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            {step === "pick"
              ? "Search and tick the items that should sit underneath this one. You can re-order later by dragging."
              : "Some items already have a parent. Confirming will MOVE them into this item's family."}
          </p>
        </div>

        {/* ───────── Pick step ───────── */}
        {step === "pick" && (
          <>
            {/* Picked chips */}
            {picked.size > 0 && (
              <div style={{
                padding: "0.625rem 0.875rem",
                borderBottom: "1px solid #f5f5f4",
                background: "#fafaf9",
                display: "flex", flexWrap: "wrap", gap: "0.375rem",
              }}>
                {[...picked.values()].map(r => (
                  <span
                    key={r.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.375rem",
                      padding: "0.25rem 0.5rem 0.25rem 0.625rem",
                      background: "#fff", border: "1px solid #d6d3d1", borderRadius: "9999px",
                      fontSize: "0.75rem",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", color: "#78716c" }}>{r.code}</span>
                    <strong style={{ color: "#1c1917" }}>{r.name}</strong>
                    <button
                      type="button"
                      onClick={() => togglePick(r)}
                      style={{
                        marginLeft: "0.125rem", border: "none", background: "transparent",
                        cursor: "pointer", color: "#78716c", fontSize: "0.95rem", lineHeight: 1,
                        padding: "0 0.125rem",
                      }}
                      aria-label={`Remove ${r.code}`}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Search */}
            <div style={{ padding: "0.75rem 1rem 0.5rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by code or name…"
                style={{
                  flex: 1, padding: "0.5rem 0.625rem",
                  border: "1px solid #d6d3d1", borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                }}
              />
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#78716c", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={e => setIncludeInactive(e.target.checked)}
                />
                Include inactive
              </label>
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0.25rem 0.5rem 0.75rem" }}>
              {loading && (
                <div style={{ padding: "0.75rem 1rem", fontSize: "0.8125rem", color: "#78716c" }}>Searching…</div>
              )}
              {!loading && results.length === 0 && (
                <div style={{ padding: "0.75rem 1rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
                  {query ? "No matches." : "Start typing to find items."}
                </div>
              )}
              {!loading && results.map(r => {
                const isPicked = picked.has(r.id);
                const hasOtherParent = r.parent_item_id && r.parent_item_id !== currentId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => togglePick(r)}
                    style={{
                      width: "100%", textAlign: "left",
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.45rem 0.625rem",
                      background: isPicked ? "#dcfce7" : "transparent",
                      border: isPicked ? "1px solid #86efac" : "1px solid transparent",
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                      marginBottom: "0.125rem",
                    }}
                    onMouseEnter={e => { if (!isPicked) (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f4"; }}
                    onMouseLeave={e => { if (!isPicked) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <input
                      type="checkbox"
                      checked={isPicked}
                      readOnly
                      style={{ flexShrink: 0 }}
                    />
                    <span className={`badge ${ITEM_TYPE_COLORS[r.item_type as ItemType]}`} style={{ fontSize: "0.625rem" }}>
                      {ITEM_TYPE_LABELS[r.item_type as ItemType] ?? r.item_type}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c", minWidth: "5rem" }}>
                      {r.code}
                    </span>
                    <span style={{ fontSize: "0.875rem", color: "#1c1917", flex: 1 }}>{r.name}</span>
                    {!r.is_active && (
                      <span style={{ fontSize: "0.65rem", padding: "0.1rem 0.4rem", background: "#f5f5f4", color: "#78716c", borderRadius: "9999px", border: "1px solid #e7e5e4" }}>inactive</span>
                    )}
                    {hasOtherParent && (
                      <span title="Already has a parent — will be moved" style={{ fontSize: "0.7rem", color: "#92400e" }}>⚠ has parent</span>
                    )}
                  </button>
                );
              })}
            </div>

            {error && (
              <div style={{ margin: "0 1rem 0.5rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                {picked.size === 0 ? "Pick one or more items" : `${picked.size} selected`}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
                <button
                  className="btn-primary"
                  disabled={picked.size === 0 || saving}
                  onClick={() => {
                    if (movers.length > 0) setStep("confirm");
                    else confirm();
                  }}
                >
                  {movers.length > 0 ? `Review & add (${picked.size})` : `Add ${picked.size} child${picked.size === 1 ? "" : "ren"}`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ───────── Confirm step (only when re-parenting) ───────── */}
        {step === "confirm" && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1rem" }}>
              <div style={{ fontSize: "0.8125rem", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", padding: "0.625rem 0.75rem", borderRadius: "0.375rem", marginBottom: "0.75rem" }}>
                ⚠ {movers.length} of the {picked.size} item{picked.size === 1 ? "" : "s"} you picked already sit{movers.length === 1 ? "s" : ""} under another parent. Confirming will move {movers.length === 1 ? "it" : "them"} here.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {movers.map(r => (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.5rem 0.625rem",
                    background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                    fontSize: "0.8125rem",
                  }}>
                    <span style={{ fontFamily: "monospace", color: "#78716c" }}>{r.code}</span>
                    <strong style={{ color: "#1c1917" }}>{r.name}</strong>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: "#78716c", fontSize: "0.75rem" }}>
                      from {existingParentNames[r.parent_item_id!] ?? "another parent"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ margin: "0 1rem 0.5rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}

            <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e7e5e4", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button onClick={() => setStep("pick")} className="btn-secondary" disabled={saving}>Back</button>
              <button onClick={confirm} className="btn-primary" disabled={saving}>
                {saving ? "Adding…" : `Add ${picked.size} & re-parent`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
