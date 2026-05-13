"use client";

/**
 * Item Master header button + picker modal for cloning an existing item.
 *
 * Flow:
 *   1. Operator clicks "📋 Duplicate Item" in the page header.
 *   2. A small modal opens with a search box. Typing filters items by
 *      code or name. Operator picks ONE row.
 *   3. Click "Duplicate selected item" → server action runs.
 *   4. On success, redirect to /items/<new>/edit with a banner so the
 *      operator can fill in the new code and tweak details.
 *
 * Items are loaded once when the modal opens, capped at TENANT_FULL_FETCH
 * (5,000) which covers any tenant we'd realistically see.
 */

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { duplicateItem } from "../actions";
import { TENANT_FULL_FETCH } from "@/lib/limits";

type Row = { id: string; code: string; name: string; item_type: string; is_active: boolean };

export default function DuplicateItemButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Lazy-load the item list when the modal first opens.
  useEffect(() => {
    if (!open || items.length > 0) return;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("items")
      .select("id, code, name, item_type, is_active")
      .order("code")
      .limit(TENANT_FULL_FETCH)
      .then(({ data, error }) => {
        if (!error && data) setItems(data as Row[]);
        setLoading(false);
      });
  }, [open, items.length]);

  // Search filter — case-insensitive across code + name.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 200);
    return items
      .filter(it => it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q))
      .slice(0, 200);
  }, [items, search]);

  function close() {
    setOpen(false);
    setSelectedId(null);
    setSearch("");
    setMsg(null);
  }

  function doDuplicate() {
    if (!selectedId) return;
    startTransition(async () => {
      const r = await duplicateItem(selectedId);
      if (r.error) {
        setMsg(`Couldn't duplicate: ${r.error}`);
        return;
      }
      // Land on the edit page so the operator can fix the code + adjust
      // the rest. router.refresh first so the listing reloads on
      // back-navigation later.
      router.refresh();
      router.push(`/items/${r.id}/edit?from_duplicate=1`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary"
        title="Clone an existing item — code and stock blanked, everything else copied"
      >
        📋 Duplicate Item
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "1.5rem 1rem", overflow: "auto",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card"
            style={{ width: "min(620px, 100%)", padding: 0, background: "#fff", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 3rem)" }}
          >
            <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", background: "#1c1917", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>📋 Duplicate item</h2>
                <div style={{ fontSize: "0.75rem", color: "#d6d3d1", marginTop: "0.15rem" }}>
                  Pick one item to clone. The copy starts as a draft (inactive) — open it to set a new code and activate.
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                style={{ background: "rgba(255,255,255,0.1)", border: "1px solid #57534e", color: "#fff", borderRadius: "0.375rem", padding: "0.25rem 0.625rem", cursor: "pointer", fontSize: "0.875rem" }}
              >×</button>
            </div>
            <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #f5f5f4" }}>
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setSelectedId(null); }}
                placeholder="Search by code or name…"
                className="form-input"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1, minHeight: "200px" }}>
              {loading ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "#a8a29e", fontSize: "0.8125rem" }}>Loading items…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "#a8a29e", fontSize: "0.8125rem" }}>No items match.</div>
              ) : (
                filtered.map(it => {
                  const sel = it.id === selectedId;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setSelectedId(it.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.625rem",
                        padding: "0.5rem 1.25rem", width: "100%", textAlign: "left",
                        background: sel ? "#fef3c7" : "transparent",
                        border: "none", borderBottom: "1px solid #f5f5f4",
                        cursor: "pointer", fontSize: "0.8125rem",
                      }}
                    >
                      <span style={{ width: "1rem", textAlign: "center", color: sel ? "#854d0e" : "#d6d3d1" }}>
                        {sel ? "●" : "○"}
                      </span>
                      <span style={{ fontFamily: "monospace", color: "#78716c", minWidth: "5.5rem" }}>{it.code}</span>
                      <span style={{ flex: 1, color: "#1c1917", fontWeight: 500 }}>{it.name}</span>
                      <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#a8a29e" }}>
                        {it.item_type.replace("_", " ")}
                      </span>
                      {!it.is_active && <span style={{ fontSize: "0.6rem", color: "#b91c1c", fontWeight: 700, padding: "0.05rem 0.35rem", background: "#fef2f2", borderRadius: "9999px" }}>INACTIVE</span>}
                    </button>
                  );
                })
              )}
            </div>
            {msg && (
              <div style={{ padding: "0.5rem 1.25rem", background: "#fef2f2", color: "#991b1b", fontSize: "0.8125rem", borderTop: "1px solid #fca5a5" }}>{msg}</div>
            )}
            <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", justifyContent: "flex-end", background: "#fafaf9", flexShrink: 0 }}>
              <button type="button" onClick={close} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button
                type="button"
                onClick={doDuplicate}
                disabled={!selectedId || isPending}
                className="btn-primary"
                style={{ fontSize: "0.8125rem", opacity: !selectedId || isPending ? 0.5 : 1 }}
              >
                {isPending ? "Duplicating…" : "📋 Duplicate selected item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
