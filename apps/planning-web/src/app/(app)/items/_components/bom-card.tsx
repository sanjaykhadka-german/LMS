"use client";

/**
 * BOM card on the Item Master detail page.
 *
 * Was previously a static <table> rendered server-side. Tino wanted:
 *   • Click-to-sort column headers (Component, Code, Qty, %, Mince, Notes).
 *   • Drag-to-resize column widths, persisted to localStorage so the
 *     operator's layout sticks across visits.
 *
 * Sort: click a header to set asc, click again for desc, click again to clear.
 * Resize: drag the right edge of any header. Width snapshots to localStorage
 *         under "bom_card_widths_v1" — shared across all BOM versions on the
 *         page so changing one resizes them all.
 */

import { useState, useRef, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatQty, formatPercent } from "@/lib/format";

type BomLine = {
  id: string;
  qty_per_batch: number;
  unit: string;
  percentage: number | null;
  grind_size: string | null;
  comment: string | null;
  component_item: {
    id: string;
    code: string;
    name: string;
    unit: string;
    /** TRUE = weight ingredient (counts toward recipe total kg); FALSE = packaging /
     *  casings / labels / consumables (scaled by basis, not by share-of-recipe). */
    consumed_in_weight: boolean | null;
  } | null;
};

type Bom = {
  id: string;
  version: number;
  reference_batch_size: number;
  reference_batch_unit: string;
  yield_factor: number;
  is_active: boolean;
  approved_at: string | null;
  lines: BomLine[];
};

type SortKey = "component" | "code" | "qty" | "pct" | "grind" | "notes";
type SortDir = "asc" | "desc";

const COLS: { key: SortKey; label: string; align?: "left" | "right"; default: number }[] = [
  { key: "component", label: "Component", default: 280 },
  { key: "code",      label: "Code",      default: 120 },
  { key: "qty",       label: "Qty / Batch", align: "right", default: 130 },
  { key: "pct",       label: "%",         align: "right", default: 80 },
  { key: "grind",     label: "Mince size", default: 110 },
  { key: "notes",     label: "Notes",     default: 240 },
];

const STORAGE_KEY = "bom_card_widths_v1";

function defaultWidths(): Record<SortKey, number> {
  return COLS.reduce((acc, c) => ({ ...acc, [c.key]: c.default }), {} as Record<SortKey, number>);
}
function loadWidths(): Record<SortKey, number> {
  if (typeof window === "undefined") return defaultWidths();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultWidths();
    const parsed = JSON.parse(raw) as Partial<Record<SortKey, number>>;
    const out = defaultWidths();
    for (const c of COLS) if (parsed[c.key] && parsed[c.key]! > 60) out[c.key] = parsed[c.key]!;
    return out;
  } catch {
    return defaultWidths();
  }
}

export default function BomCard({
  itemId,
  boms,
  newVersionTrigger,
}: {
  itemId: string;
  boms: Bom[];
  /** Render-prop for the "+ New Version" button so the page can keep
   *  its server-rendered modal trigger without us pulling the whole
   *  BomFormModal into a client tree. */
  newVersionTrigger: React.ReactNode;
}) {
  void itemId; // kept on the interface for future drilldown use
  // Sort + widths are shared across every BOM version rendered on this page.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [widths, setWidths] = useState<Record<SortKey, number>>(defaultWidths);

  // Hydrate widths from localStorage on mount (no SSR/CSR mismatch this way).
  useEffect(() => { setWidths(loadWidths()); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch { /* ignore */ }
  }, [widths]);

  function toggleSort(k: SortKey) {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); return; }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    setSortKey(null);
  }

  // Drag-to-resize: window-level listeners so the drag continues even when
  // the cursor leaves the header cell.
  const dragRef = useRef<{ key: SortKey; startX: number; startW: number } | null>(null);
  function startResize(e: React.MouseEvent, key: SortKey, th: HTMLTableCellElement | null) {
    e.preventDefault();
    e.stopPropagation();
    const startW = th ? th.getBoundingClientRect().width : widths[key];
    dragRef.current = { key, startX: e.clientX, startW };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(60, d.startW + (e.clientX - d.startX));
      setWidths(w => ({ ...w, [d.key]: next }));
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Bill of Materials (Recipes)</h2>
        {newVersionTrigger}
      </div>

      {boms.map(bom => (
        <BomVersion
          key={bom.id}
          bom={bom}
          sortKey={sortKey}
          sortDir={sortDir}
          widths={widths}
          onToggleSort={toggleSort}
          onStartResize={startResize}
        />
      ))}
    </div>
  );
}

// ─── One BOM version ─────────────────────────────────────────────────────────
//
// Pulled into its own component so the useMemo for sorted lines is a
// per-BOM hook call (React's rules-of-hooks requires hooks at the top
// level, never in a .map() callback inside a parent).

function BomVersion({
  bom, sortKey, sortDir, widths, onToggleSort, onStartResize,
}: {
  bom: Bom;
  sortKey: SortKey | null;
  sortDir: SortDir;
  widths: Record<SortKey, number>;
  onToggleSort: (k: SortKey) => void;
  onStartResize: (e: React.MouseEvent, k: SortKey, th: HTMLTableCellElement | null) => void;
}) {
  const sortedLines = useMemo(() => {
    if (!sortKey) return bom.lines;
    const arr = [...bom.lines];
    const valueOf = (l: BomLine): string | number => {
      switch (sortKey) {
        case "component": return l.component_item?.name ?? "";
        case "code":      return l.component_item?.code ?? "";
        case "qty":       return Number(l.qty_per_batch) || 0;
        case "pct":       return l.percentage != null ? Number(l.percentage) : 0;
        case "grind":     return l.grind_size ?? "";
        case "notes":     return l.comment ?? "";
      }
    };
    arr.sort((a, b) => {
      const av = valueOf(a), bv = valueOf(b);
      const aEmpty = av === "" || av == null;
      const bEmpty = bv === "" || bv == null;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [bom.lines, sortKey, sortDir]);

  // Recipe-only sum (weight ingredients) — same divisor used by the BOM detail
  // page (/bom/[id]) and by MRP. Packaging / casings / labels / consumables
  // don't share a kg unit so summing them as kg would be nonsense.
  // consumed_in_weight === false means "not a weight ingredient"; null and
  // true both count, mirroring the bom/[id]/page.tsx convention.
  const recipeLines = useMemo(
    () => bom.lines.filter((l) => l.component_item?.consumed_in_weight !== false),
    [bom.lines],
  );
  const recipeQty = useMemo(
    () => recipeLines.reduce((s, l) => s + Number(l.qty_per_batch ?? 0), 0),
    [recipeLines],
  );

  return (
    <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #f5f5f4" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>v{bom.version}</span>
          <span style={{ color: "#78716c", fontSize: "0.875rem" }}>
            {formatQty(bom.reference_batch_size, bom.reference_batch_unit)} {bom.reference_batch_unit} batch · Yield: {formatPercent(bom.yield_factor)}
          </span>
          {/* Active / Inactive toggle (Tino May 2026). Click to flip — when
              activating, any other active version for the same item gets
              switched off automatically. Approved badge hidden — only the
              active flag matters per Tino's UX. */}
          <ActiveToggle bom={bom} />
        </div>
        <Link href={`/bom/${bom.id}`} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Edit BOM</Link>
      </div>

      {sortedLines.length === 0 ? (
        <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>No ingredients in this version yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: "0.8125rem", tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
            <colgroup>
              {COLS.map(c => <col key={c.key} style={{ width: `${widths[c.key]}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                {COLS.map(c => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      style={{
                        textAlign: c.align ?? "left",
                        cursor: "pointer",
                        userSelect: "none",
                        position: "relative",
                        whiteSpace: "nowrap",
                      }}
                      onClick={() => onToggleSort(c.key)}
                      title="Click to sort · drag right edge to resize"
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                        {c.label}
                        {active
                          ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
                          : <span style={{ color: "#d6d3d1", fontWeight: 400 }}>⇅</span>}
                      </span>
                      {/* Resize handle: 6px strip pinned to the right edge.
                          stopPropagation on click so we don't accidentally
                          trigger the sort toggle when the operator's just
                          dragging the column wider. */}
                      <span
                        onMouseDown={e => onStartResize(e, c.key, e.currentTarget.parentElement as HTMLTableCellElement)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: 0, right: 0, bottom: 0,
                          width: "6px",
                          cursor: "col-resize",
                          userSelect: "none",
                        }}
                        aria-hidden
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedLines.map(line => {
                // % of batch is meaningful ONLY for recipe (weight) lines —
                // packaging / casings / labels / consumables show "—" since
                // they're scaled by basis (per_piece/inner/outer/pallet/kg),
                // not by share-of-recipe-weight. Same convention as the BOM
                // detail page at /bom/[id], so totals reconcile across views.
                const isRecipe = line.component_item?.consumed_in_weight !== false;
                const pctRatio = !isRecipe
                  ? null
                  : line.percentage != null
                    ? Number(line.percentage) / 100
                    : recipeQty > 0
                      ? Number(line.qty_per_batch) / recipeQty
                      : null;
                return (
                  <tr key={line.id}>
                    <td style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={line.component_item?.name ?? ""}>
                      {line.component_item?.name ?? "-"}
                    </td>
                    <td style={{ fontFamily: "monospace", color: "#78716c", whiteSpace: "nowrap" }}>{line.component_item?.code}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{formatQty(line.qty_per_batch, line.unit)} {line.unit}</td>
                    <td style={{ textAlign: "right", color: "#78716c", whiteSpace: "nowrap" }}>
                      {pctRatio == null ? "-" : formatPercent(pctRatio)}
                    </td>
                    <td style={{ color: "#57534e", whiteSpace: "nowrap" }}>{line.grind_size ?? "-"}</td>
                    <td style={{ color: "#78716c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={line.comment ?? ""}>
                      {line.comment ?? "-"}
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background: "#fafaf9", fontWeight: 600 }}>
                <td colSpan={2} style={{ fontSize: "0.75rem", color: "#78716c", textAlign: "right", padding: "0.5rem 0.75rem" }}>
                  Recipe Total <span style={{ fontWeight: 400, fontStyle: "italic" }}>(weight ingredients)</span>
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                  {recipeLines.length === 0
                    ? "-"
                    : `${formatQty(recipeQty, bom.reference_batch_unit)} ${bom.reference_batch_unit ?? ""}`}
                </td>
                <td style={{ textAlign: "right", padding: "0.5rem 0.75rem", color: "#78716c" }}>
                  {recipeLines.length === 0 ? "-" : "100%"}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
       
// ----------------------------------------------------------------------
// ActiveToggle — clickable Active/Inactive badge for a BOM version.
// Tino May 2026: lets the operator flip versions from the Item Master BOM
// card without entering the BOM editor. When activating, deactivates any
// other version of the same item first so we never end up with two active.
// ----------------------------------------------------------------------
function ActiveToggle({ bom }: { bom: { id: string; version: number; is_active: boolean } & { item_id?: string } }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticActive, setOptimisticActive] = useState(bom.is_active);
  const supabase = createClient();

  async function flip() {
    const next = !optimisticActive;
    setOptimisticActive(next);
    startTransition(async () => {
      // Look up item_id off the BOM header (we may not have it on props)
      const { data: header } = await supabase
        .from("bom_headers")
        .select("item_id")
        .eq("id", bom.id)
        .single();
      const itemId = header?.item_id ?? null;

      if (next && itemId) {
        const ok = confirm(
          `Make v${bom.version} the active BOM for this item? Any other active version will be switched off.`
        );
        if (!ok) {
          setOptimisticActive(false);
          return;
        }
        await supabase
          .from("bom_headers")
          .update({ is_active: false })
          .eq("item_id", itemId)
          .eq("is_active", true)
          .neq("id", bom.id);
      }

      const { error } = await supabase
        .from("bom_headers")
        .update({ is_active: next })
        .eq("id", bom.id);
      if (error) {
        setOptimisticActive(!next);
        alert(`Could not toggle: ${error.message}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={isPending}
      className={optimisticActive ? "badge badge-green" : "badge badge-gray"}
      style={{
        marginLeft: "0.25rem",
        fontSize: "0.6875rem",
        cursor: "pointer",
        border: "none",
        opacity: isPending ? 0.6 : 1,
        padding: "0.15rem 0.55rem",
      }}
      title={optimisticActive
        ? "Active version. Click to deactivate."
        : "Inactive (draft). Click to make this the active version."}
    >
      {isPending ? "..." : optimisticActive ? "Active" : "Inactive"}
    </button>
  );
}
