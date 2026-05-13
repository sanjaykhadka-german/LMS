"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import { AddChildrenModal } from "./add-children-modal";

/**
 * Reusable Product Tree with real drag-and-drop re-parenting.
 *
 * IMPLEMENTATION NOTE: We DON'T use the HTML5 drag-and-drop API. It's
 * notoriously unreliable across browsers and devices (Firefox needs
 * dataTransfer, iOS doesn't fire dragstart at all, certain browser
 * extensions intercept drag events at the OS level, etc.). Instead, we
 * implement drag using raw pointer events (mouse + touch) — this works in
 * 100% of browsers + tablets with no quirks.
 *
 * Flow:
 *   - mousedown / touchstart on the ⠿ handle → start drag, show floating ghost
 *   - mousemove / touchmove on document → track cursor, identify drop-target
 *     row via document.elementFromPoint
 *   - mouseup / touchend → if hovering valid target, open confirm modal;
 *     otherwise cancel
 */

export type TreeItem = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  parent_item_id: string | null;
  /** Manual ordering within the sibling group. Defaults to 0 if not set. */
  sort_order?: number;
  item_category?: { name: string } | null;
  item_subcategory?: { name: string } | null;
};

const ROW_ATTR = "data-tree-row-id"; // applied to every row so elementFromPoint can identify drop targets
const ROOT_DROP_ATTR = "data-tree-root-zone";

// ── Column model for the tree-grid ────────────────────────────────────────
type SortCol = "code" | "name" | "item_type" | "category" | "subcategory";
type SortState = { col: SortCol; dir: "asc" | "desc" } | null; // null = manual sort_order

function valueFor(item: TreeItem, col: SortCol): string {
  switch (col) {
    case "code":        return item.code.toLowerCase();
    case "name":        return item.name.toLowerCase();
    case "item_type":   return item.item_type.toLowerCase();
    case "category":    return (item.item_category?.name ?? "").toLowerCase();
    case "subcategory": return (item.item_subcategory?.name ?? "").toLowerCase();
  }
}

function sortSiblings(siblings: TreeItem[], sort: SortState): TreeItem[] {
  const arr = siblings.slice();
  if (!sort) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
  } else {
    arr.sort((a, b) => {
      const av = valueFor(a, sort.col), bv = valueFor(b, sort.col);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }
  return arr;
}

export function ProductTreeCard({
  items, currentId, canEdit = false,
}: {
  items: TreeItem[];
  currentId: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null); // row id or "__root__" or null
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ child: TreeItem; newParent: TreeItem | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edit lock: tree is read-only by default. Toggled via the "Edit hierarchy"
  // button. Drag handles only appear when both canEdit (role) AND isEditing
  // (explicit unlock) are true.
  const [isEditing, setIsEditing] = useState(false);
  const editingActive = canEdit && isEditing;
  // "Build family tree" — opens the multi-select picker that bulk-adds
  // children to the current item.
  const [addOpen, setAddOpen] = useState(false);
  // Column header sort. null = manual sort_order order (default).
  // Click cycles: null → asc → desc → null.
  const [sort, setSort] = useState<SortState>(null);
  // Reorder/promote in-flight flag — disables the action buttons during the
  // round-trip so a frantic double-tap doesn't fire twice.
  const [reordering, setReordering] = useState(false);

  // ── Index ─────────────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const childrenByParent = useMemo(() => {
    const m = new Map<string, TreeItem[]>();
    for (const it of items) {
      const pid = it.parent_item_id ?? "__root__";
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(it);
    }
    return m;
  }, [items]);

  // ── Walk up to root for the current item ──────────────────────────────
  const rootId = useMemo(() => {
    let id = currentId;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(id)) break;
      seen.add(id);
      const node = byId.get(id);
      if (!node?.parent_item_id) break;
      id = node.parent_item_id;
    }
    return id;
  }, [currentId, byId]);

  const root = byId.get(rootId);

  // ── Cycle helper: ids of `id` plus all descendants ────────────────────
  function descendantIds(id: string): Set<string> {
    const result = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const k of childrenByParent.get(cur) ?? []) {
        if (!result.has(k.id)) {
          result.add(k.id);
          stack.push(k.id);
        }
      }
    }
    return result;
  }

  function isValidTarget(targetId: string | null, draggedId: string): boolean {
    if (targetId === null) return true; // dropping on root zone
    if (targetId === draggedId) return false;
    if (descendantIds(draggedId).has(targetId)) return false;
    return true;
  }

  // ── Pointer-driven drag (mouse + touch, no HTML5 drag API) ─────────────
  const draggingRef = useRef<string | null>(null);
  draggingRef.current = draggingId;
  // Mirror hoverTargetId in a ref so the pointerup handler reads the latest
  // value (state would be stale inside the closure).
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hoverTargetId;

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!editingActive) return;
    e.preventDefault(); // stop text selection / native drag
    e.stopPropagation();
    setDraggingId(id);
    setHoverTargetId(null);
    setError(null);
    setGhostPos({ x: e.clientX, y: e.clientY });
    // Listen to subsequent moves at the document level (so we don't lose the
    // drag if the cursor leaves the originating element).
    const onMove = (ev: PointerEvent) => {
      setGhostPos({ x: ev.clientX, y: ev.clientY });
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!el) { setHoverTargetId(null); return; }
      // Check root drop zone first
      const rootZone = el.closest(`[${ROOT_DROP_ATTR}]`);
      if (rootZone) { setHoverTargetId("__root__"); return; }
      // Otherwise, find the closest tree row
      const row = el.closest(`[${ROW_ATTR}]`) as HTMLElement | null;
      if (row) {
        const targetId = row.getAttribute(ROW_ATTR);
        if (targetId && draggingRef.current) {
          if (isValidTarget(targetId, draggingRef.current)) {
            setHoverTargetId(targetId);
            return;
          }
        }
      }
      setHoverTargetId(null);
    };
    const onUp = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      const draggedId = draggingRef.current;
      // Use the last hover target shown to the user (mirrored in hoverRef)
      // rather than re-querying elementFromPoint at release — that way slight
      // cursor jitter on release doesn't drop you onto a different row than
      // the one you saw highlighted.
      let finalTargetId: string | null | "__root__" = hoverRef.current;
      // Fallback: if no hover was active (rare), check what's under the cursor
      if (finalTargetId === null) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        if (el) {
          if (el.closest(`[${ROOT_DROP_ATTR}]`)) finalTargetId = "__root__";
          else {
            const row = el.closest(`[${ROW_ATTR}]`) as HTMLElement | null;
            if (row) finalTargetId = row.getAttribute(ROW_ATTR);
          }
        }
      }
      setGhostPos(null);
      setHoverTargetId(null);
      setDraggingId(null);
      // Open confirm modal
      if (!draggedId) return;
      const child = byId.get(draggedId);
      if (!child) return;
      if (finalTargetId === null) return; // released outside any target
      if (finalTargetId === "__root__") {
        if ((child.parent_item_id ?? null) === null) return;
        setPendingMove({ child, newParent: null });
        return;
      }
      if (!isValidTarget(finalTargetId, draggedId)) return;
      const newParent = byId.get(finalTargetId) ?? null;
      if ((child.parent_item_id ?? null) === (newParent?.id ?? null)) return; // no-op
      setPendingMove({ child, newParent });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  // Cancel drag on Esc
  useEffect(() => {
    if (!draggingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraggingId(null);
        setHoverTargetId(null);
        setGhostPos(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draggingId]);

  async function confirmMove() {
    if (!pendingMove) return;
    setSaving(true); setError(null);
    const { child, newParent } = pendingMove;
    const { error: e } = await supabase
      .from("items")
      .update({ parent_item_id: newParent?.id ?? null })
      .eq("id", child.id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setPendingMove(null);
    router.refresh();
  }

  // ── Reorder helpers ────────────────────────────────────────────────────
  // Swap this item's sort_order with its previous (or next) sibling's. Walks
  // the manual-ordered sibling list — independent of any column-sort the user
  // has applied to the visual grid (those sorts don't persist).
  async function moveSibling(node: TreeItem, dir: -1 | 1) {
    if (reordering) return;
    setError(null);
    const groupKey = node.parent_item_id ?? "__root__";
    const siblings = (childrenByParent.get(groupKey) ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
    const idx = siblings.findIndex(s => s.id === node.id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const other = siblings[swapIdx];
    const nodeOrder  = node.sort_order  ?? idx;
    const otherOrder = other.sort_order ?? swapIdx;
    setReordering(true);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("items").update({ sort_order: otherOrder }).eq("id", node.id),
      supabase.from("items").update({ sort_order: nodeOrder  }).eq("id", other.id),
    ]);
    setReordering(false);
    if (e1 || e2) { setError((e1 ?? e2)!.message); return; }
    router.refresh();
  }

  // Promote: walk the item up one level (parent_item_id becomes its current
  // grandparent's id, or null if its parent is already a root). Drops the
  // item AT THE END of its new sibling group (sort_order = max + 1) so it
  // doesn't collide with an existing entry.
  async function promote(node: TreeItem) {
    if (reordering) return;
    setError(null);
    if (!node.parent_item_id) return; // already root
    const parent = byId.get(node.parent_item_id);
    if (!parent) return;
    const newParentId = parent.parent_item_id ?? null;
    const newSiblings = childrenByParent.get(newParentId ?? "__root__") ?? [];
    const newOrder = newSiblings.length === 0
      ? 0
      : Math.max(...newSiblings.map(s => s.sort_order ?? 0)) + 1;
    setReordering(true);
    const { error: e } = await supabase
      .from("items")
      .update({ parent_item_id: newParentId, sort_order: newOrder })
      .eq("id", node.id);
    setReordering(false);
    if (e) { setError(e.message); return; }
    router.refresh();
  }

  // Click-cycle for column headers: null → asc → desc → null
  function cycleSort(col: SortCol) {
    setSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc")        return { col, dir: "desc" };
      return null;
    });
  }

  // ── Render guards ─────────────────────────────────────────────────────
  // For viewers (canEdit=false) we still hide the card when the current item
  // has no hierarchy at all — there's nothing to look at and no controls to
  // expose. For editors we ALWAYS render so the "+ Add children" button is
  // reachable, even on a brand-new orphan item.
  const currentNode = byId.get(currentId);
  const currentHasParent   = !!currentNode?.parent_item_id;
  const rootHasChildren    = root ? (childrenByParent.get(rootId) ?? []).length > 0 : false;
  const currentHasChildren = (childrenByParent.get(currentId) ?? []).length > 0;
  const hasAnyHierarchy = !!(items.length > 0 && root && (currentHasParent || rootHasChildren || currentHasChildren));
  if (!canEdit && !hasAnyHierarchy) return null;

  // Build the exclude set for the "Add children" picker:
  //   - the current item itself
  //   - every descendant of the current item (cycle protection)
  //   - items already direct children of the current item
  const excludeIds = new Set<string>([currentId]);
  for (const id of descendantIds(currentId)) excludeIds.add(id);
  for (const k of childrenByParent.get(currentId) ?? []) excludeIds.add(k.id);

  // id → "code — name" map for the re-parent confirmation step
  const existingParentNames: Record<string, string> = {};
  for (const it of items) existingParentNames[it.id] = `${it.code} — ${it.name}`;

  const draggingItem = draggingId ? byId.get(draggingId) : null;

  return (
    <div className="card" style={{ marginTop: "1.5rem", padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Product Tree</h2>
          <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            {hasAnyHierarchy ? <>Full hierarchy. The currently-viewed item is highlighted. Click any column header to sort siblings within their parent.</> : <>No family tree yet. Click <strong>+ Add children</strong> to start building one.</>}
            {editingActive && <> Drag <strong>⠿</strong> to re-parent · use <strong>↑ ↓</strong> to reorder siblings · <strong>↰</strong> to promote up a level.</>}
            {canEdit && !editingActive && hasAnyHierarchy && <> Click <strong>Edit hierarchy</strong> to enable reordering.</>}
          </p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="btn-primary"
              style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem", whiteSpace: "nowrap" }}
            >
              + Add children
            </button>
            {hasAnyHierarchy && (
              <button
                type="button"
                onClick={() => {
                  setIsEditing(v => !v);
                  // Cancel any in-flight drag when locking
                  if (isEditing) {
                    setDraggingId(null);
                    setHoverTargetId(null);
                    setGhostPos(null);
                  }
                }}
                className={editingActive ? "btn-primary" : "btn-secondary"}
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem", whiteSpace: "nowrap" }}
              >
                {editingActive ? "✓ Done editing" : "✎ Edit hierarchy"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Root drop zone — only visible while dragging in edit mode */}
      {editingActive && draggingId && (
        <div
          data-tree-root-zone="true"
          style={{
            margin: "0.5rem 0.75rem 0",
            padding: "0.5rem 0.75rem",
            border: "2px dashed " + (hoverTargetId === "__root__" ? "#15803d" : "#d4d4d4"),
            borderRadius: "0.5rem",
            background: hoverTargetId === "__root__" ? "#dcfce7" : "#fafaf9",
            textAlign: "center",
            fontSize: "0.75rem",
            color: hoverTargetId === "__root__" ? "#14532d" : "#78716c",
            fontWeight: 600,
            transition: "background 0.1s, border-color 0.1s",
          }}
        >
          ⤴ Drop here to make a root item (no parent)
        </div>
      )}

      {hasAnyHierarchy && root ? (
        <div style={{ padding: "0.5rem 0.75rem 0.75rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                {editingActive && <th style={thStyle} />}
                <SortHeader col="code"        label="Code"        sort={sort} onClick={cycleSort} />
                <SortHeader col="name"        label="Name"        sort={sort} onClick={cycleSort} />
                <SortHeader col="item_type"   label="Type"        sort={sort} onClick={cycleSort} />
                <SortHeader col="category"    label="Category"    sort={sort} onClick={cycleSort} />
                <SortHeader col="subcategory" label="Subcategory" sort={sort} onClick={cycleSort} />
                {editingActive && <th style={{ ...thStyle, textAlign: "right" }}>Order</th>}
              </tr>
            </thead>
            <tbody>
              <TreeNode
                node={root}
                childrenByParent={childrenByParent}
                currentId={currentId}
                depth={0}
                canEdit={editingActive}
                draggingId={draggingId}
                hoverTargetId={hoverTargetId}
                onPointerDown={onPointerDown}
                isValidTarget={isValidTarget}
                sort={sort}
                onMoveUp={(n) => moveSibling(n, -1)}
                onMoveDown={(n) => moveSibling(n,  1)}
                onPromote={promote}
                reordering={reordering}
                parentSiblings={[root]}
              />
            </tbody>
          </table>
        </div>
      ) : (
        // Empty-state placeholder showing just the current item, so the user
        // sees the entry point of the family tree they're about to build.
        <div style={{ padding: "1rem 1.25rem" }}>
          {currentNode ? (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              padding: "0.5rem 0.75rem",
              border: "1px dashed #d6d3d1", borderRadius: "0.5rem",
              background: "#fafaf9",
            }}>
              <span style={{ fontSize: "0.9rem" }}>👤</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>
                {currentNode.code}
              </span>
              <strong style={{ fontSize: "0.875rem", color: "#1c1917" }}>{currentNode.name}</strong>
              <span style={{ fontSize: "0.7rem", color: "#a8a29e", marginLeft: "0.25rem" }}>(this item)</span>
            </div>
          ) : null}
          <p style={{ margin: "0.625rem 0 0", fontSize: "0.75rem", color: "#a8a29e" }}>
            Pick the items that should sit underneath this one. After they&rsquo;re added you can drag them around to set the order.
          </p>
        </div>
      )}

      {error && (
        <div style={{ margin: "0.5rem 1rem 1rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}

      {/* Floating ghost: follows the cursor while dragging */}
      {draggingItem && ghostPos && (
        <div
          style={{
            position: "fixed",
            left: ghostPos.x + 12,
            top: ghostPos.y + 8,
            zIndex: 9999,
            pointerEvents: "none",
            background: "#1c1917",
            color: "#fff",
            padding: "0.4rem 0.625rem",
            borderRadius: "0.375rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            fontSize: "0.8125rem",
            fontWeight: 600,
            display: "flex", alignItems: "center", gap: "0.4rem",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontFamily: "monospace", color: "#fcd34d" }}>{draggingItem.code}</span>
          {draggingItem.name}
        </div>
      )}

      {/* Confirmation modal */}
      {pendingMove && (() => {
        const currentParent = pendingMove.child.parent_item_id
          ? byId.get(pendingMove.child.parent_item_id) ?? null
          : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div className="card" style={{ width: "min(480px, 100%)" }}>
              <h3 style={{ margin: "0 0 0.875rem", fontSize: "1.0625rem", fontWeight: 700 }}>Re-parent item?</h3>

              {/* Item being moved */}
              <div style={{ padding: "0.625rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", border: "1px solid #e7e5e4", marginBottom: "0.75rem" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>
                  Moving
                </div>
                <div style={{ fontSize: "0.875rem", color: "#1c1917" }}>
                  <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.5rem" }}>{pendingMove.child.code}</span>
                  <strong>{pendingMove.child.name}</strong>
                </div>
              </div>

              {/* From → To */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "0.625rem", alignItems: "stretch", marginBottom: "0.875rem" }}>
                <div style={{ padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>
                    Currently under
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#1c1917" }}>
                    {currentParent ? (
                      <>
                        <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.4rem" }}>{currentParent.code}</span>
                        {currentParent.name}
                      </>
                    ) : (
                      <em style={{ color: "#78716c" }}>no parent (root)</em>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#78716c", fontSize: "1.25rem" }}>→</div>
                <div style={{ padding: "0.625rem 0.75rem", background: "#dcfce7", border: "1px solid #86efac", borderRadius: "0.375rem" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#14532d", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>
                    Will move to
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "#1c1917" }}>
                    {pendingMove.newParent ? (
                      <>
                        <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.4rem" }}>{pendingMove.newParent.code}</span>
                        {pendingMove.newParent.name}
                      </>
                    ) : (
                      <em style={{ color: "#78716c" }}>no parent (root)</em>
                    )}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0 0 1rem" }}>
                This rewires the BOM hierarchy and updates immediately.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button onClick={() => setPendingMove(null)} className="btn-secondary" disabled={saving}>Cancel</button>
                <button onClick={confirmMove} className="btn-primary" disabled={saving}>
                  {saving ? "Moving…" : "Move"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* "Build family tree" multi-select picker */}
      {canEdit && (
        <AddChildrenModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          currentId={currentId}
          excludeIds={excludeIds}
          existingParentNames={existingParentNames}
        />
      )}
    </div>
  );
}

// ─── Sortable column header ───────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.625rem",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#57534e",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1.5px solid #1c1917",
  whiteSpace: "nowrap",
  background: "#fafaf9",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

function SortHeader({
  col, label, sort, onClick,
}: {
  col: SortCol;
  label: string;
  sort: SortState;
  onClick: (col: SortCol) => void;
}) {
  const active = sort?.col === col;
  const arrow = active ? (sort!.dir === "asc" ? "▲" : "▼") : "⇅";
  return (
    <th style={thStyle}>
      <button
        type="button"
        onClick={() => onClick(col)}
        style={{
          background: "none", border: "none", padding: 0, margin: 0,
          color: active ? "#1c1917" : "#57534e",
          fontWeight: active ? 800 : 700,
          fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em",
          cursor: "pointer", whiteSpace: "nowrap",
        }}
        title={active ? "Click to cycle sort" : `Sort by ${label}`}
      >
        {label}
        <span style={{
          color: active ? "#b91c1c" : "#a8a29e",
          marginLeft: "0.25rem",
          fontSize: active ? "0.75em" : "0.9em",
          fontWeight: active ? 700 : 400,
          display: "inline-block",
        }}>{arrow}</span>
      </button>
    </th>
  );
}

// ─── Tree-grid row (recursive) ────────────────────────────────────────────
// Returns a React Fragment of <tr>s — itself + all descendants — so the whole
// tree lives inside one <tbody>. Indentation lives in the Name cell. The
// sibling order is decided by the current column-sort (or sort_order when no
// column sort is active).
function TreeNode({
  node, childrenByParent, currentId, depth,
  canEdit, draggingId, hoverTargetId,
  onPointerDown, isValidTarget,
  sort, onMoveUp, onMoveDown, onPromote, reordering,
  parentSiblings,
}: {
  node: TreeItem;
  childrenByParent: Map<string, TreeItem[]>;
  currentId: string;
  depth: number;
  canEdit: boolean;
  draggingId: string | null;
  hoverTargetId: string | null;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  isValidTarget: (targetId: string | null, draggedId: string) => boolean;
  sort: SortState;
  onMoveUp: (n: TreeItem) => void;
  onMoveDown: (n: TreeItem) => void;
  onPromote: (n: TreeItem) => void;
  reordering: boolean;
  /** The manually-ordered list of this node's siblings (for ↑/↓ disable logic). */
  parentSiblings?: TreeItem[];
}) {
  const kids = sortSiblings(childrenByParent.get(node.id) ?? [], sort);
  const isCurrent = node.id === currentId;
  const isDragging = draggingId === node.id;
  const isHoverTarget = hoverTargetId === node.id;
  const isInvalid = !!draggingId && !isDragging && !isValidTarget(node.id, draggingId);

  // Manual-order sibling list (NOT subject to column sort) — for ↑/↓ disable
  // logic so first/last in the manual order can't go further up/down.
  const manualSiblings = (parentSiblings ?? [])
    .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code));
  const manualIdx = manualSiblings.findIndex(s => s.id === node.id);
  const isFirst = manualIdx === 0;
  const isLast  = manualIdx === manualSiblings.length - 1;
  const canPromote = !!node.parent_item_id; // must have a parent to promote off
  // Reorder buttons only meaningful when the user is in manual-sort mode.
  const reorderEnabled = canEdit && !sort;

  const rowBg = isHoverTarget ? "#dcfce7" : isCurrent ? "#fef2f2" : "transparent";
  const tdBase: React.CSSProperties = {
    padding: "0.45rem 0.625rem",
    background: rowBg,
    borderBottom: "1px solid #f5f5f4",
    opacity: isDragging ? 0.4 : isInvalid ? 0.55 : 1,
    verticalAlign: "middle",
  };

  return (
    <>
      <tr data-tree-row-id={node.id}>
        {canEdit && (
          <td style={{ ...tdBase, width: "1px", paddingRight: "0.25rem" }}>
            <span
              onPointerDown={(e) => onPointerDown(e, node.id)}
              title="Drag to re-parent"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "1.5rem", height: "1.5rem",
                color: "#57534e", background: "#f5f5f4",
                border: "1px solid #d6d3d1", borderRadius: "0.25rem",
                fontSize: "0.95rem", fontWeight: 700,
                cursor: isDragging ? "grabbing" : "grab",
                userSelect: "none", touchAction: "none",
              }}
            >⠿</span>
          </td>
        )}

        {/* Code */}
        <td style={{ ...tdBase, fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c", whiteSpace: "nowrap" }}>
          {node.code}
        </td>

        {/* Name (with indentation + branch indicator + link) */}
        <td style={{ ...tdBase, paddingLeft: `${0.625 + depth * 1.25}rem` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            {depth > 0 && (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: "0.75rem", height: "0.75rem",
                  flexShrink: 0,
                  borderLeft: "1.5px solid #d6d3d1",
                  borderBottom: "1.5px solid #d6d3d1",
                  borderBottomLeftRadius: "3px",
                }}
              />
            )}
            {isCurrent ? (
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#991b1b" }}>{node.name}</span>
            ) : (
              <Link
                href={`/items/${node.id}`}
                style={{ fontSize: "0.875rem", color: "#1c1917", textDecoration: "none", fontWeight: 500 }}
              >
                {node.name}
              </Link>
            )}
          </span>
        </td>

        {/* Type */}
        <td style={tdBase}>
          <span className={`badge ${ITEM_TYPE_COLORS[node.item_type as ItemType]}`} style={{ fontSize: "0.625rem" }}>
            {ITEM_TYPE_LABELS[node.item_type as ItemType] ?? node.item_type}
          </span>
        </td>

        {/* Category */}
        <td style={{ ...tdBase, color: "#57534e", fontSize: "0.75rem" }}>
          {node.item_category?.name ?? "—"}
        </td>

        {/* Subcategory */}
        <td style={{ ...tdBase, color: "#78716c", fontSize: "0.75rem" }}>
          {node.item_subcategory?.name ?? "—"}
        </td>

        {/* Order actions */}
        {canEdit && (
          <td style={{ ...tdBase, textAlign: "right", whiteSpace: "nowrap", width: "1px" }}>
            <span style={{ display: "inline-flex", gap: "0.2rem" }}>
              <ReorderBtn
                label="↑" title={reorderEnabled ? "Move up" : "Reorder is disabled while a column sort is active"}
                disabled={!reorderEnabled || isFirst || reordering}
                onClick={() => onMoveUp(node)}
              />
              <ReorderBtn
                label="↓" title={reorderEnabled ? "Move down" : "Reorder is disabled while a column sort is active"}
                disabled={!reorderEnabled || isLast || reordering}
                onClick={() => onMoveDown(node)}
              />
              <ReorderBtn
                label="↰" title={canPromote ? "Promote — move up one level" : "Already at the top level"}
                disabled={!canPromote || reordering}
                onClick={() => onPromote(node)}
              />
            </span>
          </td>
        )}
      </tr>

      {kids.map(kid => (
        <TreeNode
          key={kid.id}
          node={kid}
          childrenByParent={childrenByParent}
          currentId={currentId}
          depth={depth + 1}
          canEdit={canEdit}
          draggingId={draggingId}
          hoverTargetId={hoverTargetId}
          onPointerDown={onPointerDown}
          isValidTarget={isValidTarget}
          sort={sort}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onPromote={onPromote}
          reordering={reordering}
          parentSiblings={childrenByParent.get(node.id) ?? []}
        />
      ))}
    </>
  );
}

function ReorderBtn({
  label, title, disabled, onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "1.5rem", height: "1.5rem",
        background: disabled ? "#f5f5f4" : "#fff",
        color: disabled ? "#d6d3d1" : "#1c1917",
        border: "1px solid #d6d3d1", borderRadius: "0.25rem",
        fontSize: "0.85rem", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
