"use client";

import { useState, useTransition, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Item, PlanStatus, WeightMode } from "@/lib/types";
import { saveDemandLines, runMrp, generateProductionOrders, reopenPlan, deleteDraftPlan, lockAndPublishPlan } from "../../actions";
import { openItemInPopup as sharedOpenItemInPopup } from "@/lib/popup";
import { formatKg, formatQty, parseDecimal } from "@/lib/format";
import DeptScheduler, { type SchedulerOrder } from "./dept-scheduler";
import OverrideModal, { type OverrideTarget } from "./override-modal";

// ─── Types ───────────────────────────────────────────────────────────────────

type FgItem = Pick<Item, "id" | "code" | "name" | "item_type" | "unit" | "target_weight_g" | "current_stock" | "units_per_inner" | "units_per_outer"> & {
  weight_mode: WeightMode;
  /** Auto-derived from units_per_outer × outers_per_pallet by a DB trigger
   *  (migration 060). Optional — items without a pallet config keep it null. */
  units_per_pallet: number | null;
};

interface DemandLine {
  _key: number;
  id?: string;
  item_id: string;
  item?: FgItem;
  demand_type: string;
  planned_qty_kg: string;
  planned_units: string;
  customer_ref: string;
  customer_name: string;
  day_of_week: string;
  priority: string;
  notes: string;
}

interface MrpResult {
  id: string;
  item_id: string;
  department: string;
  /** BOM that was used to explode this row. Null for leaf items (raw_material /
   *  packaging / consumable) and any item that doesn't have an active BOM. */
  bom_id: string | null;
  required_qty: number;
  on_hand_qty: number | null;
  net_required_qty: number | null;
  unit: string;
  standard_batch_size: number | null;
  suggested_batches: number | null;
  rounded_batches: number | null;
  planned_qty: number;
  surplus_qty: number;
  item: { id: string; code: string; name: string; item_type: string } | null;
}

/** Pre-computed per-dept material row from the get_plan_dept_materials RPC.
 *  One row per (consumingDept, component) tuple. Math comes from the RPC and
 *  matches explode_mrp exactly, so per-dept totals reconcile with the global
 *  Raw Materials view. */
interface DeptMaterialRow {
  consumingDept: string;
  componentId: string;
  code: string;
  name: string;
  type: string;
  unit: string;
  requiredQty: number;
  onHand: number;
  net: number;
  parentCount: number;
  parentCodes: string[];
}

interface DepartmentOption {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
}

interface ItemLookup {
  id: string;
  code: string;
  name: string;
  parent_item_id: string | null;
}

interface PickableItemType {
  /** DB code, e.g. "wipf". Matches items.item_type. */
  code: string;
  /** Operator-visible name, e.g. "WIP Filled". Used for filter chip + badge. */
  name: string;
  /** Hex colour from item_types.color. Drives chip + badge tint. May be null. */
  color: string | null;
}

interface Props {
  planId: string;
  weekStart: string;
  status: PlanStatus;
  notes: string | null;
  initialLines: DemandLine[];
  mrpResults: MrpResult[];
  fgItems: FgItem[];
  /** Live tenant item-type catalogue, filtered to is_sellable OR is_producible.
   *  Drives the modal's filter chips + the colour/label of the type badge in
   *  the dropdown — replaces every hard-coded type list in this component. */
  pickableItemTypes: PickableItemType[];
  /** Active departments — drives the dashboard cards. Source of truth: /settings/departments. */
  departments: DepartmentOption[];
  /** Flat list of every item with its parent_item_id, used to walk parent chains
   *  for the demand-modal "totals by shared parent" roll-up. */
  itemsLookup: ItemLookup[];
  /** Pre-computed per-dept material consumption from the get_plan_dept_materials
   *  RPC (migration 071). Used by the per-dept "🧂 Materials" modal. */
  deptMaterialsRows: DeptMaterialRow[];
  /** All non-cancelled production orders for this plan. Feeds the per-dept
   *  drag-drop scheduler in each department modal. Includes published_at so
   *  the scheduler can render scheduled-vs-published states correctly. */
  productionOrders: SchedulerOrder[];
  /** Whether the current user has admin rights — gates destructive controls
   *  (currently: Delete Plan). RLS on demand_plans is the real guard. */
  isAdmin: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEMAND_TYPES = [
  { value: "replenishment", label: "Replenishment" },
  { value: "customer_order", label: "Customer Order" },
  { value: "buffer_stock", label: "Buffer Stock" },
  { value: "transfer", label: "Transfer" },
  { value: "export", label: "Export" },
];

const DEPT_ORDER = ["production", "filling", "cooking", "packing", "dispatch", "raw_material", "packaging"];
const DEPT_LABELS: Record<string, string> = {
  production: "🥩 Production (WIP/Mix)",
  filling: "🌭 Filling",
  cooking: "🔥 Cooking",
  packing: "📦 Packing",
  dispatch: "🚚 Dispatch",
  raw_material: "🧂 Raw Materials",
  packaging: "🎁 Packaging",
};

function weekLabel(dateStr: string) {
  const d = new Date(dateStr);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Default emojis for common department names — anything else gets a generic 🏭.
// Operators can rename departments freely; if they invent "Smokehouse" we still
// render a card, just with the fallback emoji.
const DEPT_EMOJI: Record<string, string> = {
  production: "🥩", filling: "🌭", cooking: "🔥", packing: "📦",
  dispatch: "🚚", smokehouse: "💨", admin: "📋", management: "📋",
  butchery: "🔪", curing: "🧂", marination: "🧴", slicing: "🔪",
};
function emojiFor(name: string) {
  return DEPT_EMOJI[name.toLowerCase()] ?? "🏭";
}

// Item-type fallback: most items don't have items.department set, so MRP
// stores the item_type as the "department" label (e.g. "wip", "fill"). The
// dashboard cards need to catch those too. This map says: a dept named X also
// owns items whose item_type is in this list. Add aliases here as your tenant
// invents new types — or set items.department explicitly per item to override.
const DEPT_ITEM_TYPE_ALIASES: Record<string, string[]> = {
  production: ["wip"],
  filling:    ["fill", "wipf"],
  cooking:    [],
  packing:    ["finished_good"],
  dispatch:   [],
};

export default function PlanEditor({ planId, weekStart, status, notes, initialLines, mrpResults, fgItems, pickableItemTypes, departments, itemsLookup, deptMaterialsRows, productionOrders, isAdmin }: Props) {
  // Look-ups derived once from the live item-type catalogue. `nameByCode` is
  // for the chip / badge label; `tintByCode` is the hex from item_types.color
  // converted to a soft pastel + a darker text colour. We compute it lazily
  // because the operator may add a new item type with any hex value.
  function tintForType(code: string): { bg: string; fg: string; label: string } {
    const t = pickableItemTypes.find(x => x.code === code);
    const label = t?.name ?? code.toUpperCase();
    const hex = t?.color ?? null;
    // Defensive parse — fall back to neutral grey when the colour is missing
    // or malformed. We pastelize by alpha-blending with white at ~85%, and
    // pick a dark-ish foreground from the same hue at ~60% lightness.
    if (hex && /^#?[0-9a-f]{6}$/i.test(hex)) {
      const h = hex.startsWith("#") ? hex : `#${hex}`;
      const r = parseInt(h.slice(1, 3), 16);
      const g = parseInt(h.slice(3, 5), 16);
      const b = parseInt(h.slice(5, 7), 16);
      // Pastel bg = blend with white at 85%
      const pr = Math.round(r * 0.20 + 255 * 0.80);
      const pg = Math.round(g * 0.20 + 255 * 0.80);
      const pb = Math.round(b * 0.20 + 255 * 0.80);
      // Dark fg = blend with black at 30%
      const fr = Math.round(r * 0.55);
      const fg = Math.round(g * 0.55);
      const fb = Math.round(b * 0.55);
      return {
        bg: `rgb(${pr},${pg},${pb})`,
        fg: `rgb(${fr},${fg},${fb})`,
        label,
      };
    }
    return { bg: "#f5f5f4", fg: "#57534e", label };
  }
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [lines, setLines] = useState<DemandLine[]>(initialLines);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [lineKey, setLineKey] = useState(initialLines.length + 100);

  // ── Demand grid: column-header sort ────────────────────────────────────
  // Visual-only sort. We compute a permutation of indices into `lines` and
  // iterate the permutation when rendering — that way the existing edit
  // handlers (which use lineIdx into lines[]) keep working unchanged, and
  // saving still operates on the un-permuted state.
  // Click cycle on header: null → asc → desc → null (default order = entry).
  type GridSortCol =
    | "item" | "type" | "units" | "qty" | "net"
    | "day"  | "customer" | "cust_ref" | "pri" | "notes";
  const [gridSort, setGridSort] = useState<{ col: GridSortCol; dir: "asc" | "desc" } | null>(null);
  // Phase 2G v2 (Tino May 8 2026): after Save & Build the server returns the
  // codes of items that have no active BOM or whose parent is missing. We
  // capture those codes here so the demand-line grid can paint affected rows
  // with a red background, giving the planner an at-a-glance view of which
  // lines need a recipe before the next build.
  const [missingBomCodes, setMissingBomCodes] = useState<Set<string>>(new Set());
  const [orphanParentCodes, setOrphanParentCodes] = useState<Set<string>>(new Set());
  function cycleGridSort(col: GridSortCol) {
    setGridSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc")        return { col, dir: "desc" };
      return null;
    });
  }
  const sortedIndices = useMemo(() => {
    const indices = lines.map((_, i) => i);
    if (!gridSort) return indices;
    const { col, dir } = gridSort;
    const keyOf = (line: DemandLine): string | number => {
      const item = line.item ?? fgItems.find(i => i.id === line.item_id);
      switch (col) {
        case "item":     return (item?.code ?? "zzz").toLowerCase();
        case "type":     return (line.demand_type ?? "").toLowerCase();
        case "units":    return parseDecimal(line.planned_units)  ?? -Infinity;
        case "qty":      return parseDecimal(line.planned_qty_kg) ?? -Infinity;
        case "net": {
          const planKg  = parseDecimal(line.planned_qty_kg) ?? 0;
          const stockKg = item?.current_stock ?? 0;
          return line.planned_qty_kg ? Math.max(0, planKg - stockKg) : -Infinity;
        }
        case "day":      return parseInt(line.day_of_week)  || 99; // empty/Any sorts last
        case "customer": return (line.customer_name ?? "").toLowerCase();
        case "cust_ref": return (line.customer_ref  ?? "").toLowerCase();
        case "pri":      return parseInt(line.priority) || 99;
        case "notes":    return (line.notes ?? "").toLowerCase();
      }
    };
    indices.sort((a, b) => {
      const av = keyOf(lines[a]);
      const bv = keyOf(lines[b]);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return indices;
  }, [lines, gridSort, fgItems]);

  // Demand-grid filter — narrows the rendered rows to just those whose item
  // code or name matches a free-text search. Doesn't touch the underlying
  // data; hidden rows stay in `lines` and still save / count toward totals
  // when the operator hits Run MRP. Empty string = no filter (default).
  const [demandFilter, setDemandFilter] = useState<string>("");
  const displayedIndices = useMemo(() => {
    const q = demandFilter.trim().toLowerCase();
    if (!q) return sortedIndices;
    return sortedIndices.filter(i => {
      const line = lines[i];
      const item = line.item ?? fgItems.find(it => it.id === line.item_id);
      const code = (item?.code ?? "").toLowerCase();
      const name = (item?.name ?? "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [sortedIndices, demandFilter, lines, fgItems]);

  const [itemSearch, setItemSearch] = useState<Record<number, string>>({});
  // Per-line highlighted dropdown index for keyboard navigation in the item picker.
  const [searchHighlight, setSearchHighlight] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Dashboard modal: which DEPT card is "opened" (drilling into MRP results).
  // null = no modal open. "rm" = raw materials & packaging. Otherwise a
  // department id (key from deptCards). Demand entry is INLINE on the page
  // (the scrollable grid table below the sticky cards), so "demand" is no
  // longer a modal value.
  //
  // Special prefix "materials_<deptId>" opens the per-department Materials
  // modal — same data shape as the global Raw Materials view but filtered to
  // just what THIS dept directly consumes (one BOM level deep).
  type OpenModal = null | "rm" | string;
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  // Materials modal (Raw Materials & Packaging + per-dept Materials)
  // sort + filter state. Shared between the two modals because they're
  // mutually exclusive — only one is ever open at a time. Reset whenever
  // the open modal changes so a sort applied in the RM view doesn't leak
  // into the per-dept view next time.
  // (Declared AFTER openModal so the useEffect below references a hoisted
  // const — TDZ would throw "cannot access before initialization" otherwise.)
  type MatSort = { col: string; dir: "asc" | "desc" } | null;
  const [matFilter, setMatFilter] = useState<string>("");
  const [matSort, setMatSort] = useState<MatSort>(null);
  // Override modal — opens from any materials row "✎ Override" button.
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setMatFilter(""); setMatSort(null); }, [openModal]);
  // Cycle a sort: first click → asc, second → desc, third → off.
  function cycleMatSort(col: string) {
    setMatSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  }
  // Tiny HTML-escape helper for the print template — guards against item
  // names with stray < or & breaking the rendered document.
  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
  }
  // Print a captured HTML table in a popup window with a clean stylesheet.
  // Avoids screwing with the main page's print styles, and the operator
  // ends up with a window dedicated to the report (saves a PDF nicely).
  function printMaterialsTable(title: string, html: string) {
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${title}</title>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 1.5rem; color: #1c1917; }
        h1 { font-size: 1.125rem; margin: 0 0 0.5rem; }
        .meta { color: #78716c; font-size: 0.8125rem; margin-bottom: 1rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
        th { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 2px solid #1c1917; background: #fafaf9; }
        th.r { text-align: right; }
        td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #f5f5f4; vertical-align: top; }
        td.r { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; }
        td.code { font-family: ui-monospace, SFMono-Regular, monospace; color: #78716c; font-size: 0.7rem; }
        .red { color: #b91c1c; font-weight: 700; }
        .green { color: #166534; font-weight: 700; }
        @media print { body { padding: 0; } }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 100);
  }

  // ─── Add-item modal state ─────────────────────────────────────────────
  // Multi-row entry: the modal carries an array of draft lines (independent
  // from `lines[]` so Cancel discards them cleanly). Tab on the Notes field
  // of the LAST row appends a new empty draft row — same flow as the inline
  // grid's Tab-from-Notes shortcut. On Add & Close, every draft with an
  // item + non-zero qty is pushed onto lines[] in one shot.
  const [addModalOpen, setAddModalOpen] = useState(false);
  type AddDraftLine = {
    _key: number;
    selectedItem: FgItem | null;
    search: string;
    highlightIdx: number;
    demand_type: string;
    /** Pieces / individual units (e.g. one sausage). Saved to demand_lines. */
    planned_units: string;
    /** Kg — saved to demand_lines. For fixed-weight items we can derive this
     *  from units × target_weight_g; for random-weight it's the canonical input. */
    planned_qty_kg: string;
    /** Display-only — recomputed from units when item has units_per_inner. */
    planned_inners: string;
    /** Display-only — recomputed from units when item has units_per_outer. */
    planned_outers: string;
    /** Display-only — recomputed from units when item has units_per_pallet. */
    planned_pallets: string;
    customer_name: string;
    customer_ref: string;
    day_of_week: string;
    priority: string;
    notes: string;
  };
  const [addDraftKey, setAddDraftKey] = useState(1);
  const emptyDraftLine = (key: number): AddDraftLine => ({
    _key: key,
    selectedItem: null, search: "", highlightIdx: 0,
    demand_type: "replenishment",
    planned_units: "", planned_qty_kg: "",
    planned_inners: "", planned_outers: "", planned_pallets: "",
    customer_name: "", customer_ref: "",
    day_of_week: "", priority: "5", notes: "",
  });
  const [addDrafts, setAddDrafts] = useState<AddDraftLine[]>([]);
  // After the user picks an item from the search dropdown, we want focus to
  // jump straight to the qty input on that row. Setting pendingFocusKey to the
  // row's _key triggers the qty <input>'s ref-callback to focus + select on
  // mount, then clears the key so it only fires once.
  const [pendingFocusKey, setPendingFocusKey] = useState<number | null>(null);
  // Item-type filter for the Add-Item modal's search dropdown. Defaults to
  // "all" (FG + Fill + WIP). Switching to "wip" supports the top-down
  // planning use-case — start at production WIP, then add the FGs underneath
  // separately. "finished_good" or "fill" let users narrow when there are
  // many items with overlapping codes.
  const [addModalTypeFilter, setAddModalTypeFilter] = useState<string>("all");
  // Ref to the inline demand grid wrapper — used to scroll to it when the
  // operator clicks "Open / edit demand" on the sticky summary card.
  const demandGridRef = useRef<HTMLDivElement | null>(null);
  const scrollToDemand = useCallback(() => {
    demandGridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  // Auto-focus the search input on a freshly added empty row.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  useEffect(() => {
    if (focusKey == null) return;
    const el = document.querySelector<HTMLInputElement>(`[data-line-search="${focusKey}"]`);
    el?.focus();
    setFocusKey(null);
  }, [focusKey]);

  // Restore scroll + focus to the row the operator was on before clicking a
  // link to the Item Master detail page. The link handler stashes the line's
  // _key in sessionStorage; on remount here, we look it up, scroll the row
  // into view, focus its first editable cell (the qty kg input is the most
  // useful default), and clear the stash so navigating elsewhere later
  // doesn't fire the same restore again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let storedKey: string | null = null;
    try { storedKey = sessionStorage.getItem(`plans.${planId}.focusLineKey`); } catch { /* ignore */ }
    if (!storedKey) return;
    const numKey = Number(storedKey);
    if (!Number.isFinite(numKey)) return;
    // Defer one tick so the table has actually rendered the rows
    const timer = setTimeout(() => {
      // Find any cell within the target row — qty input is most useful.
      const row = document.querySelector<HTMLTableRowElement>(`tr[data-line-key="${numKey}"]`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        // Brief highlight so the eye can find it
        row.style.transition = "background 0.6s";
        const prevBg = row.style.background;
        row.style.background = "#fef9c3";
        setTimeout(() => { row.style.background = prevBg; }, 1200);
        // Focus the kg-qty input (most common cursor target)
        const input = row.querySelector<HTMLInputElement>('input[type="number"]');
        input?.focus();
      }
      try { sessionStorage.removeItem(`plans.${planId}.focusLineKey`); } catch { /* ignore */ }
    }, 100);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  // Notification banner timing (Tino, May 2026): 4s was too short — operators
  // were missing important context like "34 items had no scheduled date".
  // Bumped to 12s for success, kept errors STICKY until manually dismissed
  // so they can never be lost in a glance-away. The banner already has an
  // ✕ button so anyone who's read it can clear it immediately.
  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    if (type === "success") {
      setTimeout(() => setMessage(null), 12000);
    }
    // error: no auto-dismiss — operator clicks ✕ when ready
  };

  // ── Line management ──

  const addLine = () => {
    // Derive next key from CURRENT lines (functional state update) to avoid
    // a race condition where rapid addLine calls (e.g. Tab + click Add) all
    // read the same stale `lineKey` and assign the same _key to multiple
    // rows — which corrupted state because every per-line handler
    // (setLineItem, updateLine, removeLine) matches by _key.
    setLines(prev => {
      const maxKey = prev.reduce((m, l) => Math.max(m, l._key), lineKey);
      const key = maxKey + 1;
      // Keep lineKey roughly in sync for any code still reading it.
      setLineKey(key);
      return [...prev, {
        _key: key,
        item_id: "", demand_type: "replenishment",
        planned_qty_kg: "", planned_units: "",
        customer_ref: "", customer_name: "",
        day_of_week: "", priority: "5", notes: "",
      }];
    });
  };

  /** Open the add-item modal seeded with a single empty row. Used by the
   *  "+ Add Item" / "+ Add First Item" buttons on the demand grid header. */
  const openAddItemModal = () => {
    const k = addDraftKey;
    setAddDraftKey(k + 1);
    setAddDrafts([emptyDraftLine(k)]);
    setAddModalOpen(true);
  };

  /** Append a new empty draft row to the modal. Returns the new row's key
   *  so the caller can focus its item-search input on next render. */
  const addDraftRow = () => {
    const k = addDraftKey;
    setAddDraftKey(k + 1);
    setAddDrafts(prev => [...prev, emptyDraftLine(k)]);
    return k;
  };

  /** Remove a draft row from the modal by key. If it was the last row,
   *  seed a fresh empty row so the modal isn't blank (otherwise the user
   *  would have to close + reopen to recover). */
  const removeDraftRow = (key: number) => {
    setAddDrafts(prev => {
      const next = prev.filter(d => d._key !== key);
      if (next.length === 0) {
        const k = addDraftKey;
        setAddDraftKey(k + 1);
        return [emptyDraftLine(k)];
      }
      return next;
    });
  };

  /** Patch a single field on a draft row by key. */
  const updateDraft = (key: number, patch: Partial<AddDraftLine>) => {
    setAddDrafts(prev => prev.map(d => d._key === key ? { ...d, ...patch } : d));
  };

  /** Format a derived qty for display: integers exact, decimals to 2 places,
   *  empty when input is empty/zero. */
  const fmtDerived = (n: number) => {
    if (!isFinite(n) || n === 0) return "";
    if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
    return n.toFixed(2);
  };

  /** items.target_weight_g semantic (post-migration 076): per PIECE directly.
   *  e.g. a 56 g frankfurter → target_weight_g = 56, regardless of how many
   *  go in an inner pack. Per-inner weight = target × units_per_inner. */
  const piecesWeightG = (item: FgItem | null): number => {
    return Number(item?.target_weight_g ?? 0);
  };

  /** Given an item and a "canonical" pieces value, derive every linked
   *  qty (pieces, kg, inners, outers, pallets). Fields without a defined
   *  conversion (e.g. units_per_pallet=null) come back as "". */
  const recomputeFromPieces = (item: FgItem | null, pieces: number) => {
    const pieceG  = piecesWeightG(item);
    const upi     = item?.units_per_inner  ?? 0;
    const upo     = item?.units_per_outer  ?? 0;
    const upp     = item?.units_per_pallet ?? 0;
    return {
      planned_units:   pieces > 0 ? String(Math.round(pieces)) : "",
      planned_qty_kg:  pieceG > 0 && pieces > 0 ? ((pieces * pieceG) / 1000).toFixed(2) : "",
      planned_inners:  upi > 0 ? fmtDerived(pieces / upi) : "",
      planned_outers:  upo > 0 ? fmtDerived(pieces / upo) : "",
      planned_pallets: upp > 0 ? fmtDerived(pieces / upp) : "",
    };
  };

  /** Update a draft row's quantities. The caller specifies which field was
   *  edited and the new value; we convert that to a canonical "pieces"
   *  number and re-derive every linked field from there. For random-weight
   *  items (no target_weight_g) only kg is meaningful — the others stay blank. */
  const setDraftQty = (
    key: number,
    field: "units" | "kg" | "inners" | "outers" | "pallets",
    value: string,
  ) => {
    setAddDrafts(prev => prev.map(d => {
      if (d._key !== key) return d;
      const item = d.selectedItem;
      const v = Number(value) || 0;

      // Random-weight: only kg is canonical. Don't try to derive pieces.
      if (item && item.weight_mode === "random") {
        return field === "kg"
          ? { ...d, planned_qty_kg: value, planned_units: "", planned_inners: "", planned_outers: "", planned_pallets: "" }
          : d;  // ignore other fields for random-weight
      }

      // Fixed-weight (or item not yet picked): convert any input to pieces.
      // piece_weight_g = target_weight_g / units_per_inner (target is per inner).
      const pieceG  = piecesWeightG(item);
      const upi     = item?.units_per_inner  ?? 0;
      const upo     = item?.units_per_outer  ?? 0;
      const upp     = item?.units_per_pallet ?? 0;
      let pieces = 0;
      if (field === "units")        pieces = v;
      else if (field === "kg"      && pieceG > 0) pieces = v * 1000 / pieceG;
      else if (field === "inners"  && upi > 0)    pieces = v * upi;
      else if (field === "outers"  && upo > 0)    pieces = v * upo;
      else if (field === "pallets" && upp > 0)    pieces = v * upp;
      else {
        // No conversion available — just stash the raw value on the matching
        // field and leave others as-is (so user can still type into kg even
        // if pack hierarchy isn't configured).
        const map: Record<typeof field, keyof AddDraftLine> = {
          units: "planned_units", kg: "planned_qty_kg",
          inners: "planned_inners", outers: "planned_outers", pallets: "planned_pallets",
        };
        return { ...d, [map[field]]: value };
      }

      // Empty input → blank everything out so user can clear cleanly.
      if (value === "" || pieces === 0) {
        return { ...d, planned_units: "", planned_qty_kg: "", planned_inners: "", planned_outers: "", planned_pallets: "" };
      }

      // Re-derive every field from pieces, BUT preserve the user's exact
      // typed value on the field they just edited (so 2.5 doesn't snap to "2"
      // because rounding pieces and re-deriving back drops the decimal).
      const derived = recomputeFromPieces(item, pieces);
      const fieldKey: Record<typeof field, keyof AddDraftLine> = {
        units: "planned_units", kg: "planned_qty_kg",
        inners: "planned_inners", outers: "planned_outers", pallets: "planned_pallets",
      };
      return { ...d, ...derived, [fieldKey[field]]: value };
    }));
  };

  /** Submit every valid draft (item + non-zero qty) as a demand line AND
   *  persist immediately to the DB. Without the auto-save, the lines would
   *  disappear from the operator's view on the next page refresh — they'd
   *  be in local state only, never synced to demand_lines. Returns the
   *  count submitted (0 if there's nothing valid to add). */
  const submitAddDrafts = () => {
    const valid = addDrafts.filter(d =>
      d.selectedItem && (Number(d.planned_units) > 0 || Number(d.planned_qty_kg) > 0)
    );
    if (valid.length === 0) return 0;

    // Build new lines client-side. Keys are assigned monotonically off the
    // current max so we don't collide with any inline-added trailing rows.
    const baseKey = Math.max(lineKey, lines.reduce((m, l) => Math.max(m, l._key), 0));
    let nextKey = baseKey;
    const newLines: DemandLine[] = valid.map(d => {
      nextKey += 1;
      const item = d.selectedItem!;
      return {
        _key: nextKey,
        item_id: item.id,
        item,
        demand_type: d.demand_type || "replenishment",
        planned_qty_kg: d.planned_qty_kg,
        planned_units: d.planned_units,
        customer_ref: d.customer_ref,
        customer_name: d.customer_name,
        day_of_week: d.day_of_week,
        priority: d.priority || "5",
        notes: d.notes,
      };
    });

    // Optimistically push the new lines into state so the grid shows them
    // immediately (the save below will then fill in DB-assigned IDs).
    setLines(prev => [...prev, ...newLines]);
    setLineKey(nextKey);

    // Persist immediately. Build the toSave payload from the new lines only;
    // existing lines aren't re-saved here (handleSave handles those when the
    // operator hits Save Lines / Save & Run MRP). saveDemandLines's INSERT
    // branch handles new rows correctly.
    startTransition(async () => {
      const toSave = newLines.map(l => ({
        item_id: l.item_id,
        demand_type: l.demand_type,
        planned_qty_kg: l.planned_qty_kg ? Number(l.planned_qty_kg) : null,
        planned_units: l.planned_units ? Number(l.planned_units) : null,
        customer_ref: l.customer_ref || null,
        customer_name: l.customer_name || null,
        day_of_week: l.day_of_week ? Number(l.day_of_week) : null,
        priority: Number(l.priority) || 5,
        notes: l.notes || null,
      }));
      const result = await saveDemandLines(planId, toSave, []);
      if (result.error) {
        showMsg("error", `Items added locally but DB save failed: ${result.error}`);
        return;
      }
      // Merge the freshly-assigned IDs back onto the optimistic lines so a
      // later Save Lines doesn't re-INSERT them.
      const insertedIds = result.insertedIds ?? [];
      setLines(prev => {
        const newKeys = new Set(newLines.map(l => l._key));
        let nextIdx = 0;
        return prev.map(l => {
          if (!newKeys.has(l._key) || l.id) return l;
          const id = insertedIds[nextIdx++];
          return id ? { ...l, id } : l;
        });
      });
      showMsg("success", `Added ${newLines.length} demand line${newLines.length !== 1 ? "s" : ""}.`);
      router.refresh();
    });

    return valid.length;
  };

  const removeLine = (key: number) => {
    const line = lines.find(l => l._key === key);
    if (line?.id) setDeletedIds(prev => [...prev, line.id!]);
    setLines(prev => prev.filter(l => l._key !== key));
  };

  const updateLine = useCallback((key: number, field: keyof Omit<DemandLine, "_key">, value: string) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, [field]: value } : l));
  }, []);

  const setLineItem = (key: number, item: FgItem) => {
    setLines(prev => prev.map(l => l._key === key ? {
      ...l,
      item_id: item.id,
      item,
      // Reset both qty fields when switching item — operator re-enters in
      // the natural unit for the new item's weight mode.
      planned_units: "",
      planned_qty_kg: "",
    } : l));
    setItemSearch(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  // ── Smart qty linking ─────────────────────────────────────────────
  // Fixed weight: units is primary, kg auto-calcs. Editing either updates the
  // other so the line stays internally consistent.
  // Random weight: kg is primary; units is informational only (per-pack weight
  // varies — needs an avg-weight model, future).
  const updatePlannedUnits = useCallback((key: number, value: string) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const item = l.item;
      let kg = l.planned_qty_kg;
      if (item?.weight_mode === "fixed" && item.target_weight_g) {
        kg = value === "" ? "" : ((Number(value) * item.target_weight_g) / 1000).toFixed(2);
      }
      return { ...l, planned_units: value, planned_qty_kg: kg };
    }));
  }, []);

  const updatePlannedQtyKg = useCallback((key: number, value: string) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const item = l.item;
      let units = l.planned_units;
      if (item?.weight_mode === "fixed" && item.target_weight_g) {
        units = value === "" ? "" : Math.round((Number(value) * 1000) / item.target_weight_g).toString();
      }
      return { ...l, planned_qty_kg: value, planned_units: units };
    }));
  }, []);

  // ── Helpers ──

  /** Open an item-detail page in a sized popup window so the operator
   *  understands a new context has opened (vs the familiar same-tab back
   *  flow). Implementation lives in @/lib/popup so the Item Master grid
   *  uses the same helper. */
  const openItemInPopup = useCallback((itemId: string) => sharedOpenItemInPopup(itemId), []);

  // ── Actions ──

  const handleSave = () => {
    startTransition(async () => {
      const toSave = lines
        .filter(l => l.item_id)
        .map(l => ({
          id: l.id,
          item_id: l.item_id,
          demand_type: l.demand_type,
          planned_qty_kg: l.planned_qty_kg ? Number(l.planned_qty_kg) : null,
          planned_units: l.planned_units ? Number(l.planned_units) : null,
          customer_ref: l.customer_ref || null,
          customer_name: l.customer_name || null,
          day_of_week: l.day_of_week ? Number(l.day_of_week) : null,
          priority: Number(l.priority) || 5,
          notes: l.notes || null,
        }));

      const result = await saveDemandLines(planId, toSave, deletedIds);
      if (result.error) {
        showMsg("error", result.error);
      } else {
        setDeletedIds([]);
        // Merge the freshly-assigned IDs onto the local "new" lines (those
        // without an id). Without this, saving twice would re-INSERT the
        // same rows because the client never learned their DB IDs and would
        // still treat them as new. Order is preserved between toSave (new
        // first by filter order) and result.insertedIds. We MUST do this
        // BEFORE the filter so a line with item_id="" doesn't get dropped
        // before getting its id back.
        const insertedIds = result.insertedIds ?? [];
        let nextNewIdx = 0;
        setLines(prev => prev
          .map(l => {
            if (!l.item_id) return l;       // unfilled — keep as-is for filter below
            if (l.id) return l;             // already had a DB id — UPDATE path
            // This was a new line that just got INSERTed — assign its id.
            const id = insertedIds[nextNewIdx++];
            return id ? { ...l, id } : l;
          })
          // Drop any unfilled (no item picked) lines from local state so a
          // Tab-added trailing empty line doesn't linger after save.
          .filter(l => l.item_id)
        );
        showMsg("success", "Demand lines saved.");
        router.refresh();
      }
    });
  };

  const handleRunMrp = () => {
    startTransition(async () => {
      // Save first, then explode
      const toSave = lines
        .filter(l => l.item_id)
        .map(l => ({
          id: l.id,
          item_id: l.item_id,
          demand_type: l.demand_type,
          planned_qty_kg: l.planned_qty_kg ? Number(l.planned_qty_kg) : null,
          planned_units: l.planned_units ? Number(l.planned_units) : null,
          customer_ref: l.customer_ref || null,
          customer_name: l.customer_name || null,
          day_of_week: l.day_of_week ? Number(l.day_of_week) : null,
          priority: Number(l.priority) || 5,
          notes: l.notes || null,
        }));

      const saveResult = await saveDemandLines(planId, toSave, deletedIds);
      if (saveResult.error) { showMsg("error", saveResult.error); return; }

      // Merge the freshly-assigned IDs onto the local state so re-running MRP
      // doesn't re-INSERT the same lines (same fix as handleSave).
      const insertedIds = saveResult.insertedIds ?? [];
      let nextNewIdx = 0;
      setLines(prev => prev.map(l => {
        if (!l.item_id || l.id) return l;
        const id = insertedIds[nextNewIdx++];
        return id ? { ...l, id } : l;
      }));

      const mrpResult = await runMrp(planId);
      if (mrpResult.error) {
        showMsg("error", `MRP failed: ${mrpResult.error}`);
        return;
      }

      // Chain into generateProductionOrders so the operator gets work-order
      // cards in one click (Tino May 2026 — no separate "Generate Orders"
      // button anymore). The action cascades demand_line.day_of_week down
      // the BOM tree so every linked stage lands on the same day as the FG
      // when a day was specified on the demand line.
      const genResult = await generateProductionOrders(planId, { deptFilter: null, deptCodes: [] });
      setDeletedIds([]);
      setOpenModal(null);

      if (genResult.error) {
        showMsg("error", `Work orders failed: ${genResult.error}`);
        router.refresh();
        return;
      }
      const parts: string[] = [];
      if (genResult.created)   parts.push(`${genResult.created} created`);
      if (genResult.updated)   parts.push(`${genResult.updated} updated`);
      if (genResult.cancelled) parts.push(`${genResult.cancelled} cancelled (no longer needed)`);
      const summary = parts.length ? parts.join(" · ") : "No changes — work orders already in sync";
      const note = genResult.unscheduled
        ? ` · ${genResult.unscheduled} item(s) had no day set — drag them onto a day in the dept cards below.`
        : ` · Drag cards onto days in the dept boards below.`;

      // Phase 2G: surface BOM / parent-chain audit warnings the planner
      // needs to fix BEFORE publishing. We still show the success toast for
      // the build itself but flip to "warn" colour and append the offending
      // items so they can fix recipes before sending to the floor.
      const missingBom = genResult.missingBomItems ?? [];
      const orphans   = genResult.orphanParentItems ?? [];
      // Stash the codes so the grid can paint affected rows red until the
      // next build. Empty sets when both lists are empty (clears stale paint).
      setMissingBomCodes(new Set(missingBom.map(x => x.code)));
      setOrphanParentCodes(new Set(orphans.map(x => x.code)));
      if (missingBom.length === 0 && orphans.length === 0) {
        showMsg("success", `Work orders ready: ${summary}${note}`);
      } else {
        const warnParts: string[] = [];
        if (missingBom.length > 0) {
          const sample = missingBom.slice(0, 5).map(x => x.code).join(", ");
          const more = missingBom.length > 5 ? ` + ${missingBom.length - 5} more` : "";
          warnParts.push(`⚠ ${missingBom.length} item(s) have no active BOM (${sample}${more}) — components won't explode for these. Activate a BOM in Item Master then re-build.`);
        }
        if (orphans.length > 0) {
          const sample = orphans.slice(0, 5).map(x => x.code).join(", ");
          const more = orphans.length > 5 ? ` + ${orphans.length - 5} more` : "";
          warnParts.push(`⚠ ${orphans.length} item(s) point at a deleted/inactive parent (${sample}${more}) — family-batch traceability will skip them.`);
        }
        showMsg("error", `Work orders built but with issues: ${summary}${note}\n${warnParts.join("\n")}`);
      }
      router.refresh();
    });
  };

  /**
   * Generate production_orders for the whole plan, or just one department.
   * Pass a dept code (lowercase) for per-dept generation; null/undefined for everything.
   * Per-dept generates DON'T lock the plan — only the full one does.
   */
  const handleGenerateOrders = (deptFilter?: string | null, deptCodes?: string[]) => {
    startTransition(async () => {
      const result = await generateProductionOrders(planId, {
        deptFilter: deptFilter ?? null,
        deptCodes: deptCodes ?? [],
      });
      if (result.error) {
        showMsg("error", result.error);
      } else {
        const parts: string[] = [];
        if (result.created)   parts.push(`${result.created} created`);
        if (result.updated)   parts.push(`${result.updated} updated`);
        if (result.cancelled) parts.push(`${result.cancelled} cancelled (no longer needed)`);
        const summary = parts.length ? parts.join(" · ") : "No changes — everything already in sync";
        const note = result.unscheduled
          ? ` · ⚠ ${result.unscheduled} item(s) had no scheduled date — defaulted to plan Monday. Drag-drop in dept modals to schedule, then click Lock & Publish.`
          : " · Plan stays in draft. Schedule dates per dept, then click Lock & Publish.";
        showMsg("success", `${summary}${note}`);
        router.refresh();
      }
    });
  };

  /** Reopen a locked plan so demand can be edited again. */
  const handleReopenPlan = () => {
    if (!confirm("Re-open this plan? You'll be able to edit demand and re-run MRP. Existing production orders won't be touched until you re-run Generate Orders, which reconciles them automatically.")) return;
    startTransition(async () => {
      const result = await reopenPlan(planId);
      if (result.error) showMsg("error", result.error);
      else { showMsg("success", "Plan re-opened. Edit demand, re-run MRP, then Generate Orders to reconcile."); router.refresh(); }
    });
  };

  /** Lock & Publish the plan — flips status to 'locked' so the floor screens
   *  see the schedule. Production orders must already exist (Generate Orders
   *  must have been clicked at least once). Confirms first because publish
   *  is the moment the floor sees the orders. */
  const handleLockAndPublish = () => {
    if (!confirm("Lock & Publish this plan to the floor? Departments will see the orders and can start working. You can Reopen the plan later to re-edit, but already-started orders won't be modified.")) return;
    startTransition(async () => {
      const result = await lockAndPublishPlan(planId);
      if (result.error) showMsg("error", result.error);
      else {
        showMsg("success", `Plan locked & published. ${result.orderCount} production order${result.orderCount !== 1 ? "s" : ""} now visible on the floor.`);
        router.refresh();
      }
    });
  };

  /** Delete a draft plan entirely — only available while status='draft'.
   *  Cascades to demand_lines and mrp_results via FK ON DELETE CASCADE. */
  const handleDeletePlan = () => {
    const lineCount = lines.length;
    const lineWord = lineCount === 1 ? "line" : "lines";
    const msg = lineCount > 0
      ? `Delete this draft plan and all ${lineCount} demand ${lineWord}? This can't be undone.`
      : "Delete this draft plan? This can't be undone.";
    if (!confirm(msg)) return;
    startTransition(async () => {
      const result = await deleteDraftPlan(planId);
      if (result.error) {
        showMsg("error", result.error);
      } else {
        // Navigate back to the plans list since this plan is gone.
        router.push("/plans");
        router.refresh();
      }
    });
  };

  const getItemOptions = (search: string, typeFilter?: string) => {
    // typeFilter narrows the candidate set to a specific item_type (e.g.
    // "wip" for top-down planners) — used by the Add-Item modal's filter
    // chips. Inline grid callers don't pass it and get the full FG/Fill/WIP
    // pool as before.
    const pool = typeFilter && typeFilter !== "all"
      ? fgItems.filter(i => i.item_type === typeFilter)
      : fgItems;
    if (!search) return pool.slice(0, 20);
    const lq = search.toLowerCase();
    return pool.filter(i =>
      i.name.toLowerCase().includes(lq) || i.code.toLowerCase().includes(lq)
    ).slice(0, 20);
  };

  // ── MRP grouped by department ──

  const mrpByDept = mrpResults.reduce((acc, r) => {
    const dept = r.department ?? "other";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(r);
    return acc;
  }, {} as Record<string, MrpResult[]>);

  const sortedDepts = DEPT_ORDER.filter(d => mrpByDept[d]);
  const otherDepts = Object.keys(mrpByDept).filter(d => !DEPT_ORDER.includes(d));

  const totalDemandLines = lines.filter(l => l.item_id).length;
  const isLocked = status === "locked" || status === "completed" || status === "archived";

  // (Parent roll-up banner — "Totals by Shared Parent" — was removed at
  //  Tracey's request: with the dept summary cards above the demand grid
  //  there's enough at-a-glance context already, and the rough indicator
  //  felt redundant. The walk lived here previously; itemsLookup is still
  //  used elsewhere so we leave the prop intact.)

  return (
    <div>
      {/* Plan header bar */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>Production Week</div>
            <div style={{ fontSize: "1.25rem", fontWeight: "700", color: "#1c1917" }}>{weekLabel(weekStart)}</div>
            {notes && <div style={{ marginTop: "0.375rem", fontSize: "0.875rem", color: "#78716c" }}>{notes}</div>}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
            {/* Status badge — always visible */}
            <span
              style={{
                fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: "9999px",
                textTransform: "uppercase", letterSpacing: "0.05em",
                background: status === "draft" ? "#fef3c7" : status === "locked" ? "#dbeafe" : "#f5f5f4",
                color:      status === "draft" ? "#92400e" : status === "locked" ? "#1e3a8a" : "#57534e",
                border:     status === "draft" ? "1px solid #fcd34d" : status === "locked" ? "1px solid #93c5fd" : "1px solid #e7e5e4",
              }}
              title={status === "locked" ? "Plan is locked. Reopen to edit demand or re-generate orders." : ""}
            >
              {status}
            </span>

            {!isLocked && (
              <>
                <button onClick={handleSave} disabled={isPending} className="btn-secondary">
                  {isPending ? "…" : "💾 Save Lines"}
                </button>
                {/* Save & Build Work Orders (Tino May 2026) replaces the
                    previous three-step Save Lines / Run MRP / Generate Orders
                    chain. Single button does all three in sequence: persists
                    demand lines, runs MRP, generates production_orders,
                    cascading any specified Day from the demand line down to
                    every consuming stage. After this, dept cards are pre-
                    populated with work orders ready to drag onto days. */}
                <button
                  onClick={handleRunMrp}
                  disabled={isPending || totalDemandLines === 0}
                  className="btn-primary"
                  style={{ background: "#166534", color: "white", border: "none" }}
                  title="Save the demand lines, explode BOMs, and build the work orders for every department. Cards then appear on the dept boards ready to drag onto days."
                >
                  {isPending ? "Building…" : "🔨 Save & Build Work Orders"}
                </button>
                {/* Lock & Publish — only available once orders exist.
                    Flips plan to 'locked' status; floor screens see the
                    schedule. Reopen Plan to edit again. */}
                {mrpResults.length > 0 && (
                  <button
                    onClick={handleLockAndPublish}
                    disabled={isPending}
                    className="btn-primary"
                    style={{ background: "#1e3a8a", color: "white", border: "none" }}
                    title="Lock the plan and publish orders to the floor. Production / Filling / Packing / Labelling can start working from the orders. You can Reopen Plan later to re-edit."
                  >
                    {isPending ? "…" : "🔒 Lock & Publish"}
                  </button>
                )}
              </>
            )}

            {isLocked && (
              <button
                onClick={handleReopenPlan}
                disabled={isPending}
                className="btn-secondary"
                title="Re-open the plan so you can edit demand and re-generate orders"
              >
                {isPending ? "…" : "🔓 Reopen Plan"}
              </button>
            )}

            {/* Delete is admin-only AND only while the plan is still a draft.
                Once Generate Orders & Lock has run, the plan flips to 'locked'
                and this button hides — at that point production orders exist
                and a Reopen-then-Delete dance is intentionally not supported.
                The RLS policy demand_plans_delete is the real security guard. */}
            {status === "draft" && isAdmin && (
              <button
                onClick={handleDeletePlan}
                disabled={isPending}
                className="btn-secondary"
                style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fca5a5" }}
                title="Delete this draft plan. Admin-only. Only possible while the plan is still a draft."
              >
                {isPending ? "…" : "🗑 Delete Plan"}
              </button>
            )}
          </div>
        </div>

        {message && (
          <div style={{
            marginTop: "0.875rem",
            padding: "0.625rem 0.875rem",
            background: message.type === "success" ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${message.type === "success" ? "#86efac" : "#fca5a5"}`,
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: message.type === "success" ? "#166534" : "#991b1b",
            display: "flex", alignItems: "flex-start", gap: "0.625rem",
          }}>
            <span style={{ flex: 1 }}>{message.text}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1, opacity: 0.7 }}
              title="Dismiss"
            >×</button>
          </div>
        )}
      </div>

      {/* ─── STICKY summary cards: Demand · per-Department · Raw Materials ───
          These stick to the top of the viewport so the operator always sees
          the up-to-date totals while scrolling through the demand grid below. */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "linear-gradient(180deg, #fafaf9 0%, #fafaf9 85%, rgba(250,250,249,0) 100%)",
        paddingTop: "0.5rem",
        paddingBottom: "1rem",
        marginLeft: "-1rem",
        marginRight: "-1rem",
        paddingLeft: "1rem",
        paddingRight: "1rem",
      }}>
      {(() => {
        // Compute per-card stats from current state.
        const demandKgTotal = lines.reduce((s, l) => s + (Number(l.planned_qty_kg) || 0), 0);
        // Department cards are now driven by the live departments table.
        // Anything in mrp_results whose `department` matches a department's
        // NAME (case-insensitive) shows under that card. Anything in the RM
        // bucket types goes to the RM card instead.
        const RM_DEPTS = ["raw_material", "packaging", "consumable"];

        function deptStats(deptCodes: string[], deptName?: string) {
          // Match case-insensitively because items.department historically
          // stored the human name ("Production") while older code expected
          // a lowercase code. Both work now.
          const lc = deptCodes.map(c => c.toLowerCase());
          // PLUS: items without an explicit items.department fall through to
          // their item_type (e.g. "wip"). Pull those into the right card via
          // DEPT_ITEM_TYPE_ALIASES so most items show up without manual
          // department assignment.
          const aliasTypes = deptName ? (DEPT_ITEM_TYPE_ALIASES[deptName.toLowerCase()] ?? []) : [];
          const items = mrpResults.filter(r => {
            const rDept = (r.department ?? "").toLowerCase();
            if (lc.includes(rDept)) return true;          // direct dept name/code match
            if (aliasTypes.includes(rDept)) return true;  // dept fell back to item_type label
            return false;
          });
          const totalNet = items.reduce((s, r) => s + (r.net_required_qty ?? Math.max(0, r.required_qty - (r.on_hand_qty ?? 0))), 0);
          const totalPlanned = items.reduce((s, r) => s + (r.planned_qty ?? 0), 0);
          const totalBatches = items.reduce((s, r) => s + (r.rounded_batches ?? 0), 0);
          const fullyCovered = items.length > 0 && items.every(r => (r.net_required_qty ?? 0) <= 0.001);
          return { items, count: items.length, totalNet, totalPlanned, totalBatches, fullyCovered };
        }

        // ─── Per-dept materials (precomputed by RPC) ──────────────────────
        // The get_plan_dept_materials RPC (migration 071) already aggregated
        // material consumption per (consuming_dept, component) tuple using the
        // same math as explode_mrp. Here we just look up rows whose
        // consumingDept matches the dept's labels/codes/aliases (same matching
        // rules as deptStats above so cards and Materials button stay in sync).
        function deptMaterialsFor(deptCodes: string[], deptName?: string) {
          const aliasTypes = deptName ? (DEPT_ITEM_TYPE_ALIASES[deptName.toLowerCase()] ?? []) : [];
          const lc = [...deptCodes, ...aliasTypes].map(c => c.toLowerCase());
          return deptMaterialsRows
            .filter(r => lc.includes(r.consumingDept.toLowerCase()))
            .sort((a, b) => b.requiredQty - a.requiredQty);
        }

        // One card per active department. Cards are:
        //   1. Filtered to only those with items in the plan (no empty cards)
        //   2. Sorted left→right in production-flow order: the OLDEST link in
        //      the parent/child chain (Production → makes WIP) goes first,
        //      then Filling (WIPF), Cooking, Packing, Dispatch. Anything else
        //      (Admin, Management, smokehouse, etc.) trails after — sorted by
        //      the user's sort_order from /settings/departments.
        //      RM/Packaging is rendered AFTER this list as the last card.
        const WORKFLOW_ORDER = ["production", "filling", "cooking", "packing", "dispatch"];
        const workflowRank = (name: string) => {
          const idx = WORKFLOW_ORDER.indexOf(name.toLowerCase());
          return idx === -1 ? 999 : idx; // unknown depts sink to the end
        };

        const allDeptCards: { key: string; label: string; emoji: string; codes: string[] }[] =
          departments.map(d => ({
            key: d.id,
            label: d.name,
            emoji: emojiFor(d.name),
            codes: [d.name, d.code, d.name.toLowerCase()].filter((x): x is string => !!x),
          }));

        // Drop empty cards, then sort by workflow rank (then by user sort_order
        // for non-workflow depts). Strict ascending so Production sits leftmost.
        const deptCards = allDeptCards
          .filter(d => deptStats(d.codes, d.label).count > 0)
          .sort((a, b) => {
            const r = workflowRank(a.label) - workflowRank(b.label);
            if (r !== 0) return r;
            // Both unknown — preserve original sort_order from departments[]
            return allDeptCards.indexOf(a) - allDeptCards.indexOf(b);
          });

        const cardStyle: React.CSSProperties = {
          padding: "0.875rem 1rem",
          background: "#fff",
          border: "1px solid #e7e5e4",
          borderRadius: "0.625rem",
          display: "flex", flexDirection: "column", gap: "0.5rem",
          minHeight: "120px",
        };
        const openButtonStyle: React.CSSProperties = {
          fontSize: "0.75rem", fontWeight: 600,
          padding: "0.3rem 0.65rem", borderRadius: "0.375rem",
          border: "1px solid #1c1917", background: "#1c1917", color: "#fff",
          cursor: "pointer",
        };
        // Secondary button — "🧂 Materials" — sits next to the primary Open
        // button on each dept card and opens the per-dept materials modal.
        // Borrowed visual style from the global Raw Materials card so users
        // recognise the relationship between the two views.
        const materialsButtonStyle: React.CSSProperties = {
          fontSize: "0.75rem", fontWeight: 600,
          padding: "0.3rem 0.65rem", borderRadius: "0.375rem",
          border: "1px solid #fcd34d", background: "#fffaf0", color: "#854d0e",
          cursor: "pointer",
        };
        const cardButtonRowStyle: React.CSSProperties = {
          marginTop: "auto",
          display: "flex", gap: "0.375rem", flexWrap: "wrap",
        };
        const cardLabelStyle: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em" };
        const cardTitleStyle: React.CSSProperties = { fontSize: "1rem", fontWeight: 700, color: "#1c1917", margin: 0 };
        const cardStatStyle: React.CSSProperties = { fontSize: "0.8125rem", color: "#57534e" };

        return (
          <>
            {/* Demand summary now lives in the inline grid header below — keeps
                the sticky section focused on per-dept totals only. */}

            {/* Department + RM cards grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.875rem", marginBottom: "1.5rem" }}>
              {deptCards.map(d => {
                const s = deptStats(d.codes, d.label);
                // Empty cards are filtered upstream — but keep this guard so a
                // future change there doesn't render a broken card.
                if (s.count === 0) return null;
                // Pre-compute material count for this dept so we can hide the
                // Materials button when the dept's items have no BOM lines yet.
                const materialsCount = deptMaterialsFor(d.codes, d.label).length;
                return (
                  <div key={d.key} style={cardStyle}>
                    <div style={cardLabelStyle}>{d.emoji} {d.label}</div>
                    <h3 style={cardTitleStyle}>
                      {s.count} item{s.count !== 1 ? "s" : ""}
                    </h3>
                    <div style={cardStatStyle}>
                      Net <strong style={{ color: "#b91c1c" }}>{formatKg(s.totalNet)} kg</strong>
                      {" · "}plan <strong style={{ color: "#166534" }}>{formatKg(s.totalPlanned)} kg</strong>
                      {s.totalBatches > 0 && <> · {s.totalBatches} batch{s.totalBatches !== 1 ? "es" : ""}</>}
                      {s.fullyCovered && <> · ✓ stock covers</>}
                    </div>
                    <div style={cardButtonRowStyle}>
                      <button
                        onClick={() => setOpenModal(d.key)}
                        style={openButtonStyle}
                      >
                        Open {d.label}
                      </button>
                      {materialsCount > 0 && (
                        <button
                          onClick={() => setOpenModal(`materials_${d.key}`)}
                          style={materialsButtonStyle}
                          title={`Show raw materials & packaging consumed by ${d.label} (one BOM level deep)`}
                        >
                          🧂 Materials
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* RAW MATERIALS card — pinned to the right end of the row.
                  Hidden if there's nothing to procure (consistent with dept cards). */}
              {(() => {
                const s = deptStats(RM_DEPTS);
                if (s.count === 0) return null;
                return (
                  <div style={{ ...cardStyle, background: "#fffaf0", border: "1px solid #fcd34d" }}>
                    <div style={cardLabelStyle}>🧂 Raw Materials &amp; Packaging</div>
                    <h3 style={cardTitleStyle}>
                      {s.count} item{s.count !== 1 ? "s" : ""}
                    </h3>
                    <div style={cardStatStyle}>
                      Net <strong style={{ color: "#b91c1c" }}>{formatKg(s.totalNet)} kg</strong> to procure
                      {s.fullyCovered && <> · ✓ stock covers</>}
                    </div>
                    <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "auto" }}>
                      <button
                        onClick={() => setOpenModal("rm")}
                        style={openButtonStyle}
                      >
                        Open Raw Materials
                      </button>
                      <a
                        href={`/plans/${planId}/rm-schedule`}
                        style={{
                          fontSize: "0.75rem", fontWeight: 600,
                          padding: "0.3rem 0.65rem", borderRadius: "0.375rem",
                          border: "1px solid #fcd34d", background: "#fff", color: "#854d0e",
                          textDecoration: "none",
                          display: "inline-flex", alignItems: "center", gap: "0.25rem",
                        }}
                        title="Per-department × per-day raw material schedule with totals"
                      >
                        📅 Schedule
                      </a>
                    </div>
                  </div>
                );
              })()}
            </div>

            {mrpResults.length === 0 && totalDemandLines > 0 && (
              <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.875rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "0.5rem", color: "#92400e", fontSize: "0.8125rem" }}>
                Demand entered but MRP hasn&apos;t run yet — click <strong>⚡ Run MRP</strong> in the header to explode BOMs and populate department cards.
              </div>
            )}
            {mrpResults.length === 0 && totalDemandLines === 0 && (
              <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.875rem", background: "#fff", border: "1px dashed #d6d3d1", borderRadius: "0.5rem", color: "#78716c", fontSize: "0.8125rem", textAlign: "center" }}>
                Add finished goods in the grid below to get started.
              </div>
            )}
          </>
        );
      })()}
      </div>{/* /sticky cards wrapper */}

      {/* ─── INLINE DEMAND GRID — scrollable detail area ───
          Header now carries the Demand summary (count + total kg) that used
          to live in a separate sticky card above. Saves vertical real estate. */}
      {(() => {
        const demandKgTotal = lines.reduce((s, l) => s + (parseDecimal(l.planned_qty_kg) ?? 0), 0);
        return (
      <div ref={demandGridRef} className="card" style={{ padding: 0, marginBottom: "2rem" }}>
        <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", background: "#fafaf9" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.875rem", flexWrap: "wrap", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em" }}>📋 Demand · Finished Goods</span>
            </div>
            {totalDemandLines > 0 ? (
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1c1917" }}>
                {totalDemandLines} item{totalDemandLines !== 1 ? "s" : ""}
                <span style={{ color: "#a8a29e", fontWeight: 400, margin: "0 0.4rem" }}>·</span>
                <span style={{ fontFamily: "monospace" }}>{formatKg(demandKgTotal)} kg total</span>
              </span>
            ) : (
              <span style={{ fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}>No demand entered yet</span>
            )}
            <span style={{ fontSize: "0.75rem", color: "#a8a29e" }}>
              Each row = one demand line · Tab through to fly · MRP will explode the BOMs
            </span>
          </div>
          {/* Filter input — narrows the rendered demand rows by code or name.
              Doesn't touch the data; hidden rows still save and still feed
              MRP. Useful when iterating on a 50-line plan and wanting to
              focus on, say, all Chorizo lines. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "nowrap" }}>
            <input
              type="text"
              value={demandFilter}
              onChange={e => setDemandFilter(e.target.value)}
              placeholder="🔎 Filter by code or name…"
              className="form-input"
              style={{ fontSize: "0.8125rem", padding: "0.3rem 0.55rem", width: "14rem" }}
            />
            {demandFilter && (
              <>
                <span style={{ fontSize: "0.7rem", color: "#78716c", whiteSpace: "nowrap" }}>
                  {displayedIndices.length} of {sortedIndices.length}
                </span>
                <button
                  type="button"
                  onClick={() => setDemandFilter("")}
                  style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
                  title="Clear filter"
                >✕</button>
              </>
            )}
            {!isLocked && (
              <button
                onClick={openAddItemModal}
                className="btn-secondary"
                style={{ fontSize: "0.8125rem", whiteSpace: "nowrap" }}
                title="Open the add-item modal — searchable picker + qty/customer/day in one place"
              >
                + Add Item
              </button>
            )}
          </div>
        </div>

        {/* Heads-up: clicking item codes/names opens a sized popup window
            with the Item Master detail. Edits over there don't auto-sync
            back here — the operator needs to refresh the plan tab. */}
        <div style={{
          padding: "0.5rem 1rem",
          background: "#eff6ff",
          borderTop: "1px solid #dbeafe",
          borderBottom: "1px solid #dbeafe",
          fontSize: "0.75rem",
          color: "#1e3a8a",
          display: "flex", alignItems: "center", gap: "0.5rem",
        }}>
          <span aria-hidden style={{ fontSize: "1rem" }}>↗</span>
          <span>
            Click an item&apos;s code or name to open it in a new window. After saving changes there, refresh this tab with <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #93c5fd", borderRadius: "0.25rem", background: "#fff", fontFamily: "monospace", fontSize: "0.7rem" }}>Ctrl + F5</kbd> (or <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #93c5fd", borderRadius: "0.25rem", background: "#fff", fontFamily: "monospace", fontSize: "0.7rem" }}>Ctrl + Shift + R</kbd>) to pull the updated values.
          </span>
        </div>

        {/* Grid table */}
        {lines.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>📋</div>
            <p style={{ margin: 0 }}>No demand lines yet.</p>
            {!isLocked && (
              <button
                onClick={openAddItemModal}
                className="btn-primary"
                style={{ marginTop: "0.75rem" }}
              >+ Add First Item</button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: "0.8125rem", width: "100%", margin: 0 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 5, background: "#f5f5f4" }}>
              <tr>
                <th style={{ minWidth: "260px" }}><GridSortHeader col="item"     label="Item"     sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "120px" }}><GridSortHeader col="type"        label="Type"     sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "110px", textAlign: "right" }}><GridSortHeader col="units"    label="Units"    sort={gridSort} onClick={cycleGridSort} align="right" /></th>
                <th style={{ width: "120px", textAlign: "right" }}><GridSortHeader col="qty"      label="Qty (kg)" sort={gridSort} onClick={cycleGridSort} align="right" /></th>
                <th style={{ width: "130px", textAlign: "right" }} title="Net = qty − on-hand stock"><GridSortHeader col="net" label="Net Need" sort={gridSort} onClick={cycleGridSort} align="right" /></th>
                <th style={{ width: "80px" }}><GridSortHeader col="day"          label="Day"      sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "150px" }}><GridSortHeader col="customer"    label="Customer" sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "110px" }}><GridSortHeader col="cust_ref"    label="Cust Ref" sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "70px", textAlign: "center" }}><GridSortHeader col="pri" label="Pri" sort={gridSort} onClick={cycleGridSort} align="center" /></th>
                <th><GridSortHeader col="notes" label="Notes" sort={gridSort} onClick={cycleGridSort} /></th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {displayedIndices.map((lineIdx) => {
                const line = lines[lineIdx];
                const item = line.item ?? fgItems.find(i => i.id === line.item_id);
                const isFixed = item?.weight_mode === "fixed";
                const targetG = item?.target_weight_g ?? null;
                const stockKg = item?.current_stock ?? 0;
                const planKg = parseDecimal(line.planned_qty_kg) ?? 0;
                const netNeedKg = item && line.planned_qty_kg ? Math.max(0, planKg - stockKg) : null;
                const search = itemSearch[line._key];
                // Tab-to-add fires on the visually-last row, not the original-last
                // row in `lines` — otherwise an active column sort would put the
                // Tab trigger on whichever row happens to live at lines[length-1].
                const isLastRow = lineIdx === sortedIndices[sortedIndices.length - 1];
                // Phase 2G v2 — paint the row red if the last Save & Build
                // flagged this item's code as missing a BOM, or amber if the
                // parent chain is broken. The hint sits visually next to the
                // toast so the planner can act without scrolling away.
                const itemCode = item?.code ?? "";
                const isMissingBom = missingBomCodes.has(itemCode);
                const isOrphan = orphanParentCodes.has(itemCode);
                const rowBg = isMissingBom ? "#fef2f2" : isOrphan ? "#fefce8" : undefined;
                const rowBorderLeft = isMissingBom ? "3px solid #b91c1c" : isOrphan ? "3px solid #ca8a04" : undefined;
                return (
                  <tr
                    key={line._key}
                    data-line-key={line._key}
                    title={isMissingBom
                      ? "No active BOM — components won't explode for this item. Activate a BOM in Item Master then re-build."
                      : isOrphan
                      ? "Parent item is inactive or missing — family-batch traceability will skip this item."
                      : undefined}
                    style={{ verticalAlign: "middle", background: rowBg, boxShadow: rowBorderLeft ? `inset ${rowBorderLeft}` : undefined }}
                  >
                    {/* ── Item picker / display ── */}
                    <td style={{ position: "relative" }}>
                      {isLocked ? (
                        <div>
                          <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{item?.code}</div>
                          <div style={{ fontWeight: 500 }}>{item?.name ?? "—"}</div>
                        </div>
                      ) : !item ? (
                        <>
                          <input
                            data-line-search={line._key}
                            className="form-input"
                            placeholder="🔎 Search FG by code or name…"
                            value={search ?? ""}
                            onChange={e => {
                              setItemSearch(prev => ({ ...prev, [line._key]: e.target.value }));
                              setSearchHighlight(prev => ({ ...prev, [line._key]: 0 }));
                              if (!e.target.value) updateLine(line._key, "item_id", "");
                            }}
                            onKeyDown={e => {
                              const opts = getItemOptions(search ?? "");
                              const idx = searchHighlight[line._key] ?? 0;
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setSearchHighlight(prev => ({ ...prev, [line._key]: Math.min(idx + 1, Math.max(0, opts.length - 1)) }));
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setSearchHighlight(prev => ({ ...prev, [line._key]: Math.max(idx - 1, 0) }));
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                const pick = opts[idx] ?? opts[0];
                                if (pick) setLineItem(line._key, pick);
                              } else if (e.key === "Escape") {
                                setItemSearch(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                              }
                            }}
                            style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem", width: "100%" }}
                          />
                          {search !== undefined && search !== "" && (
                            <div style={{
                              position: "absolute", zIndex: 50, left: "0.5rem", right: "0.5rem", top: "calc(100% - 4px)",
                              border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: "white",
                              maxHeight: "260px", overflowY: "auto",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                            }}>
                              {getItemOptions(search).length === 0 ? (
                                <div style={{ padding: "0.5rem 0.75rem", color: "#78716c", fontSize: "0.8125rem" }}>No matches for &quot;{search}&quot;</div>
                              ) : getItemOptions(search).map((i, idx) => {
                                const isHighlighted = (searchHighlight[line._key] ?? 0) === idx;
                                return (
                                <button
                                  key={i.id}
                                  type="button"
                                  onMouseDown={e => { e.preventDefault(); setLineItem(line._key, i); }}
                                  onMouseEnter={() => setSearchHighlight(prev => ({ ...prev, [line._key]: idx }))}
                                  style={{
                                    display: "flex", alignItems: "center", gap: "0.5rem",
                                    width: "100%", textAlign: "left",
                                    padding: "0.4rem 0.65rem", border: "none",
                                    background: isHighlighted ? "#fef2f2" : "none",
                                    color: isHighlighted ? "#b91c1c" : "#1c1917",
                                    cursor: "pointer", fontSize: "0.8125rem",
                                    borderBottom: "1px solid #f5f5f4",
                                  }}
                                >
                                  <span style={{ fontFamily: "monospace", color: "#78716c", fontSize: "0.7rem", minWidth: "5rem" }}>{i.code}</span>
                                  <span style={{ flex: 1, fontWeight: 500 }}>{i.name}</span>
                                  <span style={{
                                    fontSize: "0.6rem", padding: "0.1rem 0.35rem", borderRadius: "9999px",
                                    background: i.weight_mode === "fixed" ? "#dbeafe" : "#fef3c7",
                                    color: i.weight_mode === "fixed" ? "#1e3a8a" : "#92400e",
                                    fontWeight: 700, textTransform: "uppercase",
                                  }}>{i.weight_mode}</span>
                                </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        <div>
                          <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            {/* Click-through to Item Master detail. Opens in a
                                sized popup window (~75% × 85% of the screen)
                                so the operator clearly sees a new context.
                                After editing the item there, they refresh the
                                plan tab (Ctrl+F5) to pull the updated values. */}
                            <button
                              type="button"
                              onClick={() => openItemInPopup(item.id)}
                              style={{ background: "none", border: "none", padding: 0, color: "#78716c", textDecoration: "underline", fontWeight: 600, fontFamily: "inherit", fontSize: "inherit", cursor: "pointer" }}
                              title="Open Item Master detail in a new window (resizable popup)"
                            >
                              {item.code}
                            </button>
                            <span style={{
                              fontSize: "0.55rem", padding: "0.05rem 0.3rem", borderRadius: "9999px",
                              background: isFixed ? "#dbeafe" : "#fef3c7",
                              color: isFixed ? "#1e3a8a" : "#92400e",
                              fontWeight: 700, textTransform: "uppercase",
                            }}>{item.weight_mode}</span>
                            {isFixed && targetG && <span style={{ color: "#a8a29e" }}>· {targetG}g/u</span>}
                          </div>
                          <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <button
                              type="button"
                              onClick={() => openItemInPopup(item.id)}
                              style={{ flex: 1, background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "none", textAlign: "left", fontFamily: "inherit", fontSize: "inherit", fontWeight: 500, cursor: "pointer" }}
                              title="Open Item Master detail in a new window (resizable popup)"
                            >
                              {item.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateLine(line._key, "item_id", "");
                                setLines(prev => prev.map(l => l._key === line._key ? { ...l, item: undefined, planned_units: "", planned_qty_kg: "" } : l));
                                setItemSearch(prev => ({ ...prev, [line._key]: "" }));
                              }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#78716c", fontSize: "0.65rem", textDecoration: "underline" }}
                              title="Pick a different item"
                            >
                              change
                            </button>
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.1rem" }}>
                            stock <strong style={{ color: stockKg > 0 ? "#166534" : "#a8a29e" }}>{formatQty(stockKg, item.unit)} {item.unit}</strong>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* ── Type ── */}
                    <td>
                      <select
                        className="form-select"
                        value={line.demand_type}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "demand_type", e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%" }}
                      >
                        {DEMAND_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>

                    {/* ── Units ── */}
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={isLocked || !item || !isFixed}
                        value={line.planned_units}
                        onChange={e => updatePlannedUnits(line._key, e.target.value)}
                        placeholder={isFixed ? "0" : "—"}
                        className="form-input"
                        title={!isFixed ? "Random-weight items: enter kg directly" : "Auto-calculates kg"}
                        style={{ width: "100%", textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem", padding: "0.3rem 0.4rem", fontWeight: 600 }}
                      />
                    </td>

                    {/* ── Qty kg ── */}
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        disabled={isLocked || !item}
                        value={line.planned_qty_kg}
                        onChange={e => updatePlannedQtyKg(line._key, e.target.value)}
                        placeholder="0.000"
                        className="form-input"
                        style={{
                          width: "100%", textAlign: "right", fontFamily: "monospace",
                          fontSize: "0.8125rem", padding: "0.3rem 0.4rem", fontWeight: 600,
                          background: isFixed && line.planned_units ? "#fafaf9" : "#fff",
                        }}
                      />
                    </td>

                    {/* ── Net need ── */}
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {netNeedKg == null ? (
                        <span style={{ color: "#a8a29e" }}>—</span>
                      ) : netNeedKg <= 0.001 ? (
                        <span style={{ color: "#166534", fontWeight: 600 }}>✓ covered</span>
                      ) : (
                        <span style={{ color: "#b91c1c", fontWeight: 700 }}>{formatKg(netNeedKg)} kg</span>
                      )}
                    </td>

                    {/* ── Day ── */}
                    <td>
                      <select
                        className="form-select"
                        value={line.day_of_week}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "day_of_week", e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%" }}
                      >
                        <option value="">Any</option>
                        {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </td>

                    {/* ── Customer ── */}
                    <td>
                      <input
                        className="form-input"
                        placeholder="optional"
                        value={line.customer_name}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "customer_name", e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%" }}
                      />
                    </td>

                    {/* ── Cust ref ── */}
                    <td>
                      <input
                        className="form-input"
                        placeholder="PO/ref"
                        value={line.customer_ref}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "customer_ref", e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%", fontFamily: "monospace" }}
                      />
                    </td>

                    {/* ── Priority ── */}
                    <td>
                      <input
                        className="form-input"
                        type="number"
                        min="1"
                        max="10"
                        value={line.priority}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "priority", e.target.value)}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%", textAlign: "center" }}
                      />
                    </td>

                    {/* ── Notes (Tab on last row adds new line) ── */}
                    <td>
                      <input
                        className="form-input"
                        placeholder="optional…"
                        value={line.notes}
                        disabled={isLocked || !item}
                        onChange={e => updateLine(line._key, "notes", e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Tab" && !e.shiftKey && !isLocked) {
                            if (isLastRow && line.item_id) {
                              e.preventDefault();
                              addLine();
                              setTimeout(() => {
                                setLines(curr => {
                                  const last = curr[curr.length - 1];
                                  if (last) setFocusKey(last._key);
                                  return curr;
                                });
                              }, 0);
                            }
                          }
                        }}
                        style={{ fontSize: "0.75rem", padding: "0.3rem 0.4rem", width: "100%" }}
                      />
                    </td>

                    {/* ── Remove ── */}
                    <td style={{ textAlign: "center" }}>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => removeLine(line._key)}
                          title="Remove this line"
                          style={{
                            background: "none", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                            color: "#dc2626", cursor: "pointer", padding: "0.15rem 0.4rem",
                            fontSize: "0.875rem", lineHeight: 1,
                          }}
                        >×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {/* Totals row sums ONLY the rows actually visible in the grid.
                  When a filter is active (e.g. "2015") the operator expects
                  to see the total of just the chorizo lines, not the whole
                  plan. Hidden rows still feed MRP and Save Lines — totals
                  are a view-layer thing. */}
              <tr style={{ background: "#fafaf9", fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: "right" }}>
                  {demandFilter ? `Filtered totals (${displayedIndices.length} of ${sortedIndices.length}) →` : "Totals →"}
                </td>
                <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                  {formatKg(displayedIndices.reduce((s, i) => s + (parseDecimal(lines[i].planned_qty_kg) ?? 0), 0))} kg
                </td>
                <td style={{ textAlign: "right", fontFamily: "monospace", color: "#b91c1c" }}>
                  {formatKg(displayedIndices.reduce((s, i) => {
                    const l = lines[i];
                    const it = l.item ?? fgItems.find(it2 => it2.id === l.item_id);
                    const stock = it?.current_stock ?? 0;
                    const plan = parseDecimal(l.planned_qty_kg) ?? 0;
                    return s + Math.max(0, plan - stock);
                  }, 0))} kg
                </td>
                <td colSpan={6}></td>
              </tr>
            </tfoot>
          </table>
          </div>
        )}

        {!isLocked && lines.length > 0 && (
          <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #f5f5f4", display: "flex", gap: "0.75rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.7rem", color: "#78716c" }}>
              💡 Tab on the last <strong>Notes</strong> field to add another row
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={handleSave} disabled={isPending} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
                {isPending ? "Saving…" : "💾 Save Lines"}
              </button>
              <button
                onClick={handleRunMrp}
                disabled={isPending || totalDemandLines === 0}
                className="btn-primary"
                style={{ fontSize: "0.8125rem", background: "#166534", color: "white", border: "none" }}
                title="Save lines, explode BOMs, and build the work orders. Cards land on the dept boards ready to drag onto days."
              >
                {isPending ? "Building…" : "🔨 Save & Build Work Orders"}
              </button>
            </div>
          </div>
        )}
      </div>
        );
      })()}

      {/* ── PER-DEPT MATERIALS modal (one BOM level deep) ─────────────────
          Triggered by openModal === "materials_<deptId>". Shows the raw
          materials / packaging / consumables that this dept's items DIRECTLY
          consume. Data comes pre-computed from the get_plan_dept_materials
          RPC (migration 071) — same math as explode_mrp so totals reconcile
          with the global Raw Materials view. */}
      {openModal && openModal.startsWith("materials_") && (() => {
        const deptId = openModal.slice("materials_".length);
        const dept = departments.find(d => d.id === deptId);
        if (!dept) return null;
        const aliasTypes = DEPT_ITEM_TYPE_ALIASES[dept.name.toLowerCase()] ?? [];
        const deptCodes = [dept.name, dept.code, dept.name.toLowerCase(), ...aliasTypes].filter((x): x is string => !!x);
        const lc = deptCodes.map(c => c.toLowerCase());
        // Base list — every component this dept directly consumes.
        const baseMaterials = deptMaterialsRows
          .filter(r => lc.includes(r.consumingDept.toLowerCase()))
          .map(r => ({ ...r, fullyCovered: r.net <= 0.001 }));

        // Apply operator filter (code or name, case-insensitive).
        const fq = matFilter.trim().toLowerCase();
        const filteredMaterials = fq
          ? baseMaterials.filter(m => m.code.toLowerCase().includes(fq) || m.name.toLowerCase().includes(fq))
          : baseMaterials;

        // Apply sort if active; otherwise default to gross qty desc (the
        // existing default — keeps the noisiest items at the top).
        const materials = (() => {
          const arr = [...filteredMaterials];
          if (!matSort) {
            arr.sort((a, b) => b.requiredQty - a.requiredQty);
            return arr;
          }
          const { col, dir } = matSort;
          const sign = dir === "asc" ? 1 : -1;
          arr.sort((a, b) => {
            type M = typeof baseMaterials[number];
            const v = (m: M): string | number => {
              switch (col) {
                case "component": return m.name.toLowerCase();
                case "type": return m.type;
                case "gross": return m.requiredQty;
                case "onhand": return m.onHand;
                case "net": return m.net;
                case "consumedby": return m.parentCount;
                default: return 0;
              }
            };
            const av = v(a), bv = v(b);
            if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
            return sign * String(av).localeCompare(String(bv));
          });
          return arr;
        })();
        const totalNet = materials.reduce((s, m) => s + m.net, 0);
        const totalGross = materials.reduce((s, m) => s + m.requiredQty, 0);
        const typeLabel = (t: string) => t === "raw_material" ? "Raw" : t === "packaging" ? "Packaging" : "Consumable";

        // Render a sort indicator on a header.
        const sortArrow = (col: string) => matSort?.col === col
          ? (matSort.dir === "asc" ? " ▲" : " ▼")
          : " ⇅";

        // Build a printable HTML snapshot of the visible (filtered + sorted) rows.
        function doPrint() {
          const rows = materials.map(m => {
            const consumedBy = m.parentCount === 1
              ? m.parentCodes[0]
              : `${m.parentCount} parents (${m.parentCodes.join(", ")})`;
            return `<tr>
              <td><strong>${escapeHtml(m.name)}</strong><div class="code">${escapeHtml(m.code)}</div></td>
              <td>${typeLabel(m.type)}</td>
              <td class="r">${formatQty(m.requiredQty, m.unit)} ${m.unit}</td>
              <td class="r">${m.onHand > 0 ? `${formatQty(m.onHand, m.unit)} ${m.unit}` : "—"}</td>
              <td class="r ${m.fullyCovered ? "green" : "red"}">${m.fullyCovered ? "✓ covered" : `${formatQty(m.net, m.unit)} ${m.unit}`}</td>
              <td>${escapeHtml(consumedBy)}</td>
            </tr>`;
          }).join("");
          const html = `
            <h1>🧂 ${escapeHtml(dept!.name)} — Materials</h1>
            <div class="meta">
              ${materials.length} component${materials.length !== 1 ? "s" : ""} ·
              gross ${formatKg(totalGross)} · net ${formatKg(totalNet)}
              ${fq ? ` · filter "${escapeHtml(matFilter)}"` : ""}
              · printed ${new Date().toLocaleString("en-AU")}
            </div>
            <table>
              <thead><tr>
                <th>Component</th><th>Type</th>
                <th class="r">Gross</th><th class="r">On hand</th>
                <th class="r">Net for this dept</th><th>Consumed by</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>`;
          printMaterialsTable(`${dept!.name} — Materials`, html);
        }
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "1.5rem 1rem", overflow: "auto" }}>
            <div className="card" style={{ width: "min(1100px, 100%)", padding: 0, background: "#fff", maxHeight: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", background: "#854d0e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>
                    🧂 {dept.name} — Materials
                  </h2>
                  <div style={{ fontSize: "0.8125rem", color: "#fde68a", marginTop: "0.15rem" }}>
                    {materials.length} component{materials.length !== 1 ? "s" : ""} · gross {formatKg(totalGross)} · net {formatKg(totalNet)}
                    {" · "}<span style={{ opacity: 0.85 }}>direct consumption only (1 BOM level)</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={doPrint}
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid #fde68a", color: "#fff", borderRadius: "0.375rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem" }}
                    title="Open the visible (filtered + sorted) rows in a print-friendly window"
                  >🖨 Print</button>
                  <button onClick={() => setOpenModal(null)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid #a8a29e", color: "#fff", borderRadius: "0.375rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem" }}>Close</button>
                </div>
              </div>
              {/* Filter row — narrows the rendered + printed rows. */}
              <div style={{ padding: "0.5rem 1.25rem", borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", background: "#fafaf9" }}>
                <input
                  type="text"
                  value={matFilter}
                  onChange={e => setMatFilter(e.target.value)}
                  placeholder="🔎 Filter by component code or name…"
                  className="form-input"
                  style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem", flex: 1, maxWidth: "26rem" }}
                />
                {matFilter && (
                  <>
                    <span style={{ fontSize: "0.7rem", color: "#78716c" }}>{materials.length} of {baseMaterials.length}</span>
                    <button type="button" onClick={() => setMatFilter("")} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}>✕</button>
                  </>
                )}
                {matSort && (
                  <span style={{ fontSize: "0.7rem", color: "#854d0e", padding: "0.1rem 0.5rem", background: "#fef3c7", borderRadius: "9999px", fontWeight: 600 }}>
                    Sort: {matSort.col} {matSort.dir === "asc" ? "▲" : "▼"}
                    <button type="button" onClick={() => setMatSort(null)} style={{ background: "none", border: "none", color: "#854d0e", cursor: "pointer", marginLeft: "0.3rem", fontSize: "0.7rem" }}>✕</button>
                  </span>
                )}
              </div>
              <div style={{ overflowY: "auto", flex: 1, padding: "1rem 1.25rem" }}>
                {materials.length === 0 ? (
                  <p style={{ color: "#78716c", fontSize: "0.875rem", margin: 0 }}>
                    No raw materials, packaging or consumables found in the BOMs of {dept.name}&apos;s items for this plan.
                  </p>
                ) : (
                  <table className="data-table" style={{ fontSize: "0.8125rem" }}>
                    <thead>
                      <tr>
                        <th onClick={() => cycleMatSort("component")} style={{ cursor: "pointer", userSelect: "none" }}>Component{sortArrow("component")}</th>
                        <th onClick={() => cycleMatSort("type")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>Type{sortArrow("type")}</th>
                        <th onClick={() => cycleMatSort("gross")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Total demand from this dept's BOMs (no SOH)">Gross{sortArrow("gross")}</th>
                        <th onClick={() => cycleMatSort("onhand")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Current stock at item level (shared across all depts that consume it)">On hand{sortArrow("onhand")}</th>
                        <th onClick={() => cycleMatSort("net")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Net = max(0, gross − on hand)">Net for this dept{sortArrow("net")}</th>
                        <th onClick={() => cycleMatSort("consumedby")} style={{ cursor: "pointer", userSelect: "none" }}>Consumed by{sortArrow("consumedby")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map(m => (
                        <tr key={m.componentId} style={{ opacity: m.fullyCovered ? 0.55 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 500 }}>
                              <button
                                type="button"
                                onClick={() => openItemInPopup(m.componentId)}
                                style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", color: "inherit", fontFamily: "inherit", fontSize: "inherit", textAlign: "left", cursor: "pointer" }}
                                title="Open in resizable popup window"
                              >{m.name}</button>
                            </div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{m.code}</div>
                          </td>
                          <td>
                            <span style={{
                              fontSize: "0.7rem", fontWeight: 600,
                              padding: "0.1rem 0.4rem", borderRadius: "9999px",
                              background: m.type === "raw_material" ? "#fef3c7" : m.type === "packaging" ? "#dbeafe" : "#f5f5f4",
                              color: m.type === "raw_material" ? "#92400e" : m.type === "packaging" ? "#1e3a8a" : "#57534e",
                            }}>{typeLabel(m.type)}</span>
                          </td>
                          <td style={{ textAlign: "right", color: "#78716c" }}>{formatQty(m.requiredQty, m.unit)} {m.unit}</td>
                          <td style={{ textAlign: "right", color: m.onHand > 0 ? "#166534" : "#a8a29e", fontWeight: m.onHand > 0 ? 600 : 400 }}>
                            {m.onHand > 0 ? `${formatQty(m.onHand, m.unit)} ${m.unit}` : "—"}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: m.fullyCovered ? "#166534" : "#b91c1c" }}>
                            {m.fullyCovered ? "✓ covered" : `${formatQty(m.net, m.unit)} ${m.unit}`}
                          </td>
                          <td style={{ fontSize: "0.75rem", color: "#57534e" }}>
                            {m.parentCount === 1 ? (
                              <span title={m.parentCodes.join(", ")}>{m.parentCodes[0]}</span>
                            ) : (
                              <span title={m.parentCodes.join(", ")}>{m.parentCount} parents</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              onClick={() => setOverrideTarget({
                                plan_id: planId,
                                item_id: m.componentId,
                                item_code: m.code,
                                item_name: m.name,
                                department: m.type,
                                current_qty: m.requiredQty,
                                unit: m.unit,
                              })}
                              style={{ background: "none", border: "1px dashed #cfc9bf", padding: "0.15rem 0.4rem", fontSize: "0.65rem", color: "#854d0e", cursor: "pointer", borderRadius: "0.25rem", marginRight: "0.3rem", fontFamily: "inherit" }}
                              title="Manually override the qty for this item — emergency release valve"
                            >✎ Override</button>
                            <button
                              type="button"
                              onClick={() => openItemInPopup(m.componentId)}
                              style={{ background: "none", border: "none", padding: 0, fontSize: "0.75rem", color: "#78716c", cursor: "pointer" }}
                              title="Open in resizable popup window"
                            >↗</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ marginTop: "0.875rem", padding: "0.625rem 0.875rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "0.375rem", fontSize: "0.75rem", color: "#854d0e" }}>
                  <strong>Note.</strong> This view shows materials directly consumed by {dept.name}&apos;s items (one BOM level deep). For the full recursive explosion across every department, open the global <strong>🧂 Raw Materials &amp; Packaging</strong> card. On-hand stock is shared across all departments — net here doesn&apos;t account for what other depts also pull from the same SOH.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── DEPARTMENT modal (production / filling / cooking / packing / dispatch / rm) ── */}
      {openModal && !openModal.startsWith("materials_") && (() => {
        const RM_DEPTS = ["raw_material", "packaging", "consumable"];
        const isRm = openModal === "rm";
        // openModal for a dept is the department's id (key from deptCards).
        const dept = isRm ? null : departments.find(d => d.id === openModal);
        // Include item_type aliases (wip, fill, wipf, finished_good) in
        // deptCodes so the per-dept Generate Orders button covers them too.
        const aliasTypes = dept ? (DEPT_ITEM_TYPE_ALIASES[dept.name.toLowerCase()] ?? []) : [];
        const deptCodes = isRm
          ? RM_DEPTS
          : dept
            ? [dept.name, dept.code, dept.name.toLowerCase(), ...aliasTypes].filter((x): x is string => !!x)
            : [openModal];
        const lcCodes = deptCodes.map(c => c.toLowerCase());
        const baseDeptItems = mrpResults.filter(r => {
          const rDept = (r.department ?? "").toLowerCase();
          return lcCodes.includes(rDept);
        });
        // Apply filter (RM modal especially benefits from this — 60+ rows).
        const fq2 = matFilter.trim().toLowerCase();
        const filteredDeptItems = fq2
          ? baseDeptItems.filter(r => {
              const c = (r.item?.code ?? "").toLowerCase();
              const n = (r.item?.name ?? "").toLowerCase();
              return c.includes(fq2) || n.includes(fq2);
            })
          : baseDeptItems;
        // Apply sort (default = required_qty desc, matches existing behaviour).
        const deptItems = (() => {
          const arr = [...filteredDeptItems];
          if (!matSort) {
            arr.sort((a, b) => b.required_qty - a.required_qty);
            return arr;
          }
          const sign = matSort.dir === "asc" ? 1 : -1;
          arr.sort((a, b) => {
            type R = typeof baseDeptItems[number];
            const v = (r: R): string | number => {
              switch (matSort!.col) {
                case "item": return (r.item?.code ?? "").toLowerCase();
                case "gross": return r.required_qty;
                case "onhand": return r.on_hand_qty ?? 0;
                case "net": return r.net_required_qty ?? Math.max(0, r.required_qty - (r.on_hand_qty ?? 0));
                case "batch": return r.standard_batch_size ?? 0;
                case "batches": return r.rounded_batches ?? 0;
                case "planned": return r.planned_qty ?? 0;
                case "surplus": return r.surplus_qty ?? 0;
                default: return 0;
              }
            };
            const av = v(a), bv = v(b);
            if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
            return sign * String(av).localeCompare(String(bv));
          });
          return arr;
        })();
        const deptLabel = isRm
          ? "🧂 Raw Materials & Packaging"
          : dept ? `${emojiFor(dept.name)} ${dept.name}` : openModal;
        const totalNet = deptItems.reduce((s, r) => s + (r.net_required_qty ?? Math.max(0, r.required_qty - (r.on_hand_qty ?? 0))), 0);
        const totalPlanned = deptItems.reduce((s, r) => s + (r.planned_qty ?? 0), 0);
        const sortArrow2 = (col: string) => matSort?.col === col
          ? (matSort.dir === "asc" ? " ▲" : " ▼")
          : " ⇅";
        // Print snapshot — same flow as the per-dept Materials modal.
        function doPrintDept() {
          const rows = deptItems.map(r => {
            const onHand = r.on_hand_qty ?? 0;
            const net = r.net_required_qty ?? Math.max(0, r.required_qty - onHand);
            const fullyCovered = net <= 0.001;
            return `<tr>
              <td><strong>${escapeHtml(r.item?.name ?? "—")}</strong><div class="code">${escapeHtml(r.item?.code ?? "")}</div></td>
              <td class="r">${formatQty(r.required_qty, r.unit)} ${r.unit}</td>
              <td class="r">${onHand > 0 ? `${formatQty(onHand, r.unit)} ${r.unit}` : "—"}</td>
              <td class="r ${fullyCovered ? "green" : "red"}">${fullyCovered ? "✓ covered" : `${formatQty(net, r.unit)} ${r.unit}`}</td>
              <td class="r">${r.standard_batch_size ? `${formatQty(r.standard_batch_size, r.unit)} ${r.unit}` : "—"}</td>
              <td class="r">${r.rounded_batches ?? "—"}</td>
              <td class="r">${(r.planned_qty ?? 0) > 0 ? `${formatQty(r.planned_qty, r.unit)} ${r.unit}` : "—"}</td>
              <td class="r">${(r.surplus_qty ?? 0) > 0.01 ? `+${formatQty(r.surplus_qty ?? 0, r.unit)} ${r.unit}` : "—"}</td>
            </tr>`;
          }).join("");
          const html = `
            <h1>${escapeHtml(deptLabel)}</h1>
            <div class="meta">
              ${deptItems.length} item${deptItems.length !== 1 ? "s" : ""} · net ${formatKg(totalNet)} kg · plan ${formatKg(totalPlanned)} kg
              ${fq2 ? ` · filter "${escapeHtml(matFilter)}"` : ""}
              · printed ${new Date().toLocaleString("en-AU")}
            </div>
            <table>
              <thead><tr>
                <th>Item</th><th class="r">Gross</th><th class="r">On hand</th><th class="r">Net</th>
                <th class="r">Batch Size</th><th class="r">Batches</th><th class="r">Planned</th><th class="r">Surplus</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>`;
          printMaterialsTable(deptLabel, html);
        }
        // Wider modal when the scheduler is showing — the 7-column calendar
        // needs the room. RM/dispatch (no scheduler) keeps the original width.
        const showScheduler = !isRm && !!dept && deptItems.length > 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: showScheduler ? "stretch" : "flex-start", justifyContent: "center", padding: showScheduler ? "0.75rem" : "1.5rem 1rem", overflow: "auto" }}>
            <div className="card" style={{
              width: showScheduler ? "min(1700px, 100%)" : "min(1100px, 100%)",
              height: showScheduler ? "calc(100vh - 1.5rem)" : "auto",
              padding: 0, background: "#fff",
              maxHeight: showScheduler ? "calc(100vh - 1.5rem)" : "calc(100vh - 3rem)",
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
              <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", background: "#1c1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>{deptLabel}</h2>
                  <div style={{ fontSize: "0.8125rem", color: "#d6d3d1", marginTop: "0.15rem" }}>
                    {deptItems.length} item{deptItems.length !== 1 ? "s" : ""} · net {formatKg(totalNet)} kg · plan {formatKg(totalPlanned)} kg
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {/* Print is most useful for the Raw Materials view (the
                      operator sticks the printout next to the goods-in
                      bench), but it also works for individual dept views. */}
                  {!showScheduler && (
                    <button
                      type="button"
                      onClick={doPrintDept}
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid #d6d3d1", color: "#fff", borderRadius: "0.375rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem" }}
                      title="Open the visible (filtered + sorted) rows in a print-friendly window"
                    >🖨 Print</button>
                  )}
                  {!isLocked && !isRm && dept && (
                    <button
                      onClick={() => handleGenerateOrders(dept.name, deptCodes)}
                      disabled={isPending}
                      className="btn-primary"
                      style={{ fontSize: "0.8125rem" }}
                      title={`Build production orders for ${dept.name} from the plan rows above. Won't lock the plan; safe to re-run.`}
                    >
                      {/* Action-first wording: tells the planner what's about
                          to happen ("we're moving to the next stage") instead
                          of restating the entity. Was 'Generate {dept} Orders'. */}
                      {isPending ? "…" : `Continue scheduling →`}
                    </button>
                  )}
                  {/* Schedule Machines — opens the kanban board for this dept
                      in a new tab. The planner flow:
                        Day-grid (this modal) → Machine kanban (next page) → Finalise.
                      Was '⚙ Run Order' — Tino May 2026 wanted plain-English
                      verbs that say what the next step is. */}
                  {!isRm && dept && productionOrders.length > 0 && (
                    <a
                      href={`/dept/${dept.name.toLowerCase()}/run-order?week=${weekStart}`}
                      target="_blank"
                      rel="noopener"
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid #d6d3d1", color: "#fff", borderRadius: "0.375rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                      title={`Assign machines and set run order for ${dept.name} orders this week — finalise to floor from there.`}
                    >
                      Schedule machines →
                    </a>
                  )}
                  <button onClick={() => setOpenModal(null)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid #57534e", color: "#fff", borderRadius: "0.375rem", padding: "0.3rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem" }}>Close</button>
                </div>
              </div>
              {/* Filter row — only shown for the table view (RM, dispatch, or
                  any dept whose scheduler is hidden). The drag-drop scheduler
                  has its own filter built in. */}
              {!showScheduler && (
                <div style={{ padding: "0.5rem 1.25rem", borderBottom: "1px solid #f5f5f4", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", background: "#fafaf9" }}>
                  <input
                    type="text"
                    value={matFilter}
                    onChange={e => setMatFilter(e.target.value)}
                    placeholder="🔎 Filter by item code or name…"
                    className="form-input"
                    style={{ fontSize: "0.8125rem", padding: "0.25rem 0.5rem", flex: 1, maxWidth: "26rem" }}
                  />
                  {matFilter && (
                    <>
                      <span style={{ fontSize: "0.7rem", color: "#78716c" }}>{deptItems.length} of {baseDeptItems.length}</span>
                      <button type="button" onClick={() => setMatFilter("")} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}>✕</button>
                    </>
                  )}
                  {matSort && (
                    <span style={{ fontSize: "0.7rem", color: "#854d0e", padding: "0.1rem 0.5rem", background: "#fef3c7", borderRadius: "9999px", fontWeight: 600 }}>
                      Sort: {matSort.col} {matSort.dir === "asc" ? "▲" : "▼"}
                      <button type="button" onClick={() => setMatSort(null)} style={{ background: "none", border: "none", color: "#854d0e", cursor: "pointer", marginLeft: "0.3rem", fontSize: "0.7rem" }}>✕</button>
                    </span>
                  )}
                </div>
              )}
              <div style={{ overflowY: "auto", flex: 1, padding: "1rem 1.25rem" }}>
                {/* ── Drag-drop scheduler (PRIMARY view for production depts) ─
                    For RM/Packaging the scheduler is hidden and the MRP table
                    is the only view (no scheduling needed for raw mats).
                    For production depts the scheduler completely replaces the
                    MRP table — work orders are the planner's unit of work, not
                    the raw MRP rows. */}
                {showScheduler && dept ? (
                  <DeptScheduler
                    planId={planId}
                    weekStart={weekStart}
                    deptKey={dept.name.toLowerCase()}
                    deptLabel={dept.name}
                    orders={productionOrders}
                    isLocked={isLocked}
                  />
                ) : deptItems.length === 0 ? (
                  <p style={{ color: "#78716c", fontSize: "0.875rem", margin: 0 }}>No items in this department for this plan.</p>
                ) : (
                  <table className="data-table" style={{ fontSize: "0.8125rem" }}>
                    <thead>
                      <tr>
                        <th onClick={() => cycleMatSort("item")} style={{ cursor: "pointer", userSelect: "none" }}>Item{sortArrow2("item")}</th>
                        <th onClick={() => cycleMatSort("gross")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Total demand from BOM explosion (no SOH applied)">Gross{sortArrow2("gross")}</th>
                        <th onClick={() => cycleMatSort("onhand")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Current stock at time of MRP run">On hand{sortArrow2("onhand")}</th>
                        <th onClick={() => cycleMatSort("net")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} title="Net = max(0, gross − on hand)">Net{sortArrow2("net")}</th>
                        <th onClick={() => cycleMatSort("batch")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }}>Batch Size{sortArrow2("batch")}</th>
                        <th onClick={() => cycleMatSort("batches")} style={{ cursor: "pointer", userSelect: "none", textAlign: "center" }}>Batches{sortArrow2("batches")}</th>
                        <th onClick={() => cycleMatSort("planned")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }}>Planned Qty{sortArrow2("planned")}</th>
                        <th onClick={() => cycleMatSort("surplus")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }}>Surplus{sortArrow2("surplus")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {deptItems.map(r => {
                        const isSurplus = (r.surplus_qty ?? 0) > 0.01;
                        const item = r.item;
                        const onHand = r.on_hand_qty ?? 0;
                        const net = r.net_required_qty ?? Math.max(0, r.required_qty - onHand);
                        const fullyCovered = net <= 0.001;
                        return (
                          <tr key={r.id} style={{ opacity: fullyCovered ? 0.55 : 1 }}>
                            <td>
                              <div style={{ fontWeight: 500 }}>
                                {item ? (
                                  <button
                                    type="button"
                                    onClick={() => openItemInPopup(item.id)}
                                    style={{ background: "none", border: "none", padding: 0, textDecoration: "underline", color: "inherit", fontFamily: "inherit", fontSize: "inherit", textAlign: "left", cursor: "pointer" }}
                                    title="Open in resizable popup window"
                                  >{item.name}</button>
                                ) : "—"}
                              </div>
                              <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{item?.code}</div>
                            </td>
                            <td style={{ textAlign: "right", color: "#78716c" }}>{formatQty(r.required_qty, r.unit)} {r.unit}</td>
                            <td style={{ textAlign: "right", color: onHand > 0 ? "#166534" : "#a8a29e", fontWeight: onHand > 0 ? 600 : 400 }}>
                              {onHand > 0 ? `${formatQty(onHand, r.unit)} ${r.unit}` : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 700, color: fullyCovered ? "#166534" : "#b91c1c" }}>
                              {fullyCovered ? "✓ covered" : `${formatQty(net, r.unit)} ${r.unit}`}
                            </td>
                            <td style={{ textAlign: "right", color: "#78716c" }}>{r.standard_batch_size ? `${formatQty(r.standard_batch_size, r.unit)} ${r.unit}` : "—"}</td>
                            <td style={{ textAlign: "center" }}>
                              {r.rounded_batches != null && r.rounded_batches > 0 ? (
                                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "2rem", height: "2rem", borderRadius: "50%", background: "#fef3c7", color: "#92400e", fontWeight: 700, fontSize: "0.875rem" }}>
                                  {r.rounded_batches}
                                </span>
                              ) : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: "#166534" }}>{r.planned_qty > 0 ? `${formatQty(r.planned_qty, r.unit)} ${r.unit}` : "—"}</td>
                            <td style={{ textAlign: "right", color: isSurplus ? "#d97706" : "#a8a29e" }}>{isSurplus ? `+${formatQty(r.surplus_qty ?? 0, r.unit)} ${r.unit}` : "—"}</td>
                            <td>{item && (
                              <button
                                type="button"
                                onClick={() => openItemInPopup(item.id)}
                                style={{ background: "none", border: "none", padding: 0, fontSize: "0.75rem", color: "#78716c", cursor: "pointer" }}
                                title="Open in resizable popup window"
                              >↗</button>
                            )}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── ADD-ITEM MODAL (multi-row) ──────────────────────────────────
          Each draft row mirrors a demand line. Tab on the Notes field of
          the LAST row appends a new draft + autofocuses its item search.
          X removes a row. Cancel discards everything. Add & Close pushes
          every valid row (item + non-zero qty) onto the demand grid.
          The OUTER overlay scrolls (not the inner body) so the item-picker
          dropdowns are not clipped — they overflow the modal naturally. */}
      {addModalOpen && (() => {
        const close = () => { setAddModalOpen(false); setAddDrafts([]); };
        const validCount = addDrafts.filter(d =>
          d.selectedItem && (Number(d.planned_units) > 0 || Number(d.planned_qty_kg) > 0)
        ).length;
        const submit = () => {
          if (validCount === 0) return;
          submitAddDrafts();
          close();
        };
        return (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 70, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "1.5rem 1rem", overflow: "auto" }}
            onClick={close}
          >
            <div
              className="card"
              style={{ width: "min(1180px, 100%)", padding: 0, background: "#fff", display: "flex", flexDirection: "column", overflow: "visible" }}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
            >
              {/* Header */}
              <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", background: "#1c1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>📋 Add Demand Items</h2>
                  <div style={{ fontSize: "0.75rem", color: "#d6d3d1", marginTop: "0.15rem" }}>
                    {addDrafts.length} row{addDrafts.length !== 1 ? "s" : ""} · {validCount} ready to add · Tab from Notes on the last row to add another
                  </div>
                </div>
                <button onClick={close} style={{ background: "none", border: "none", color: "#fff", fontSize: "1.5rem", cursor: "pointer", lineHeight: 1, padding: 0 }} title="Cancel (Esc)">×</button>
              </div>

              {/* Body — no inner scroll; outer overlay scrolls when content tall */}
              <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                {/* Item-type filter chips. Default is "All" (FG + Fill + WIP).
                    Pick "WIP" for top-down production planning, or narrow to
                    "Finished good" / "Fill" when codes overlap across types. */}
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", paddingBottom: "0.25rem", borderBottom: "1px dashed #f5f5f4" }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.25rem" }}>Show</span>
                  {[
                    // "All" is always first; the rest come from the tenant's
                    // item_types catalogue (filtered server-side to anything
                    // is_sellable OR is_producible). Adding a new pickable
                    // type via /settings/item-types makes a chip appear here
                    // automatically with no code change.
                    {
                      v: "all",
                      label: "All",
                      hint: pickableItemTypes.length > 0
                        ? pickableItemTypes.map(t => t.name).join(" + ")
                        : "All pickable item types",
                    },
                    ...pickableItemTypes.map(t => ({
                      v: t.code,
                      label: t.name,
                      hint: `Filter to ${t.name} only`,
                    })),
                  ].map(c => {
                    const active = addModalTypeFilter === c.v;
                    return (
                      <button
                        key={c.v}
                        type="button"
                        onClick={() => setAddModalTypeFilter(c.v)}
                        title={c.hint}
                        style={{
                          fontSize: "0.7rem", fontWeight: 600,
                          padding: "0.2rem 0.55rem", borderRadius: "9999px",
                          border: active ? "1px solid #1c1917" : "1px solid #e7e5e4",
                          background: active ? "#1c1917" : "#fff",
                          color: active ? "#fff" : "#57534e",
                          cursor: "pointer",
                        }}
                      >{c.label}</button>
                    );
                  })}
                  {addModalTypeFilter === "wip" && (
                    <span style={{ fontSize: "0.7rem", color: "#854d0e", marginLeft: "0.25rem", fontStyle: "italic" }}>
                      Tip: pick a WIP to plan production first. MRP will explode its recipe; FGs aren&apos;t implied — add them separately if you need to.
                    </span>
                  )}
                </div>

                {addDrafts.map((d, rowIdx) => {
                  const isLast = rowIdx === addDrafts.length - 1;
                  const opts = d.selectedItem ? [] : getItemOptions(d.search, addModalTypeFilter);
                  const item = d.selectedItem;
                  const isFixed = item?.weight_mode === "fixed";
                  const isRandom = item?.weight_mode === "random";
                  const targetG = item?.target_weight_g ?? null;
                  const stockKg = item?.current_stock ?? 0;
                  const planKg = Number(d.planned_qty_kg) || 0;
                  const netNeedKg = item && d.planned_qty_kg ? Math.max(0, planKg - stockKg) : null;
                  // Pack-hierarchy fields drive which qty inputs are shown.
                  // Random-weight items only show kg (the others aren't meaningful).
                  // Fixed-weight items show pieces always, plus inner/outer/pallet
                  // when those conversion factors are configured.
                  const upi = item?.units_per_inner  ?? 0;
                  const upo = item?.units_per_outer  ?? 0;
                  const upp = item?.units_per_pallet ?? 0;
                  const showInners  = isFixed && upi > 0;
                  const showOuters  = isFixed && upo > 0;
                  const showPallets = isFixed && upp > 0;
                  return (
                    <div key={d._key} style={{
                      border: "1px solid #e7e5e4",
                      borderRadius: "0.625rem",
                      background: "#fff",
                      overflow: "visible",
                    }}>
                      {/* Row header: Item picker + delete */}
                      <div style={{ padding: "0.625rem 0.75rem", borderBottom: item ? "1px solid #f5f5f4" : "none", display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                          {item ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "0.7rem", color: "#a8a29e", fontWeight: 600 }}>#{rowIdx + 1}</span>
                              <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontWeight: 600 }}>{item.code}</span>
                              <span style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{item.name}</span>
                              {(() => {
                                // Item-type chip — colour + label sourced live
                                // from the tenant's item_types catalogue via
                                // tintForType (defined above).
                                const tint = tintForType(item.item_type);
                                return (
                                  <span style={{
                                    fontSize: "0.625rem", padding: "0.1rem 0.4rem", borderRadius: "9999px",
                                    background: tint.bg, color: tint.fg,
                                    fontWeight: 700, textTransform: "uppercase",
                                  }}>{tint.label}</span>
                                );
                              })()}
                              {/* Tiny weight_mode hint — kept because it tells the operator
                                  whether Pieces input will show (fixed) or kg-only (random). */}
                              <span style={{
                                fontSize: "0.55rem", padding: "0.05rem 0.35rem", borderRadius: "9999px",
                                background: "#f5f5f4", color: "#57534e",
                                fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                              }} title={`${item.weight_mode} weight`}>{item.weight_mode === "fixed" ? "fixed wt" : "random wt"}</span>
                              <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
                                · stock <strong style={{ color: "#166534" }}>{formatQty(stockKg, item.unit)} {item.unit}</strong>
                                {netNeedKg !== null && d.planned_qty_kg && (
                                  netNeedKg > 0
                                    ? <> · net <strong style={{ color: "#b91c1c" }}>{formatQty(netNeedKg, item.unit)} {item.unit}</strong></>
                                    : <> · <strong style={{ color: "#166534" }}>✓ covered</strong></>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateDraft(d._key, { selectedItem: null, search: "", highlightIdx: 0, planned_units: "", planned_qty_kg: "" })}
                                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#78716c", fontSize: "0.7rem", textDecoration: "underline" }}
                              >change</button>
                            </div>
                          ) : (
                            <>
                              <input
                                autoFocus={isLast}
                                className="form-input"
                                placeholder={`🔎 Row ${rowIdx + 1} — search finished good by code or name…`}
                                value={d.search}
                                onChange={e => updateDraft(d._key, { search: e.target.value, highlightIdx: 0 })}
                                onKeyDown={e => {
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    updateDraft(d._key, { highlightIdx: Math.min(d.highlightIdx + 1, Math.max(0, opts.length - 1)) });
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    updateDraft(d._key, { highlightIdx: Math.max(d.highlightIdx - 1, 0) });
                                  } else if (e.key === "Enter") {
                                    e.preventDefault();
                                    const pick = opts[d.highlightIdx] ?? opts[0];
                                    if (pick) {
                                      updateDraft(d._key, { selectedItem: pick, search: "", highlightIdx: 0 });
                                      setPendingFocusKey(d._key);
                                    }
                                  }
                                }}
                                style={{ fontSize: "0.875rem", padding: "0.4rem 0.6rem" }}
                              />
                              {d.search && (
                                <div style={{
                                  position: "absolute", zIndex: 80, left: 0, right: 0, top: "calc(100% + 4px)",
                                  border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: "white",
                                  maxHeight: "260px", overflowY: "auto",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                                }}>
                                  {opts.length === 0 ? (
                                    <div style={{ padding: "0.625rem 0.875rem", color: "#78716c", fontSize: "0.8125rem" }}>No matches for &quot;{d.search}&quot;</div>
                                  ) : opts.map((i, idx) => {
                                    const isHighlighted = d.highlightIdx === idx;
                                    return (
                                      <button
                                        key={i.id}
                                        type="button"
                                        onMouseDown={e => { e.preventDefault(); updateDraft(d._key, { selectedItem: i, search: "", highlightIdx: 0 }); setPendingFocusKey(d._key); }}
                                        onMouseEnter={() => updateDraft(d._key, { highlightIdx: idx })}
                                        style={{
                                          display: "flex", alignItems: "center", gap: "0.5rem",
                                          width: "100%", textAlign: "left",
                                          padding: "0.4rem 0.7rem", border: "none",
                                          background: isHighlighted ? "#fef2f2" : "none",
                                          color: isHighlighted ? "#b91c1c" : "#1c1917",
                                          cursor: "pointer", fontSize: "0.8125rem",
                                          borderBottom: "1px solid #f5f5f4",
                                        }}
                                      >
                                        <span style={{ fontFamily: "monospace", color: "#78716c", fontSize: "0.7rem", minWidth: "5rem" }}>{i.code}</span>
                                        <span style={{ flex: 1, fontWeight: 500 }}>{i.name}</span>
                                        {(() => {
                                          // Type chip lets the operator tell apart codes
                                          // that share a base (e.g. 1010 WIP vs 1010.6300
                                          // WIPF). Colour + label come from the live
                                          // item_types catalogue via tintForType.
                                          const tint = tintForType(i.item_type);
                                          return (
                                            <span style={{
                                              fontSize: "0.6rem", padding: "0.05rem 0.4rem", borderRadius: "9999px",
                                              background: tint.bg, color: tint.fg,
                                              fontWeight: 700, textTransform: "uppercase",
                                            }}>{tint.label}</span>
                                          );
                                        })()}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDraftRow(d._key)}
                          title="Remove this row"
                          style={{
                            background: "none", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                            color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem",
                            fontSize: "0.875rem", lineHeight: 1, flexShrink: 0,
                          }}
                        >×</button>
                      </div>

                      {/* Fields — only when item selected */}
                      {item && (
                        <div style={{ padding: "0.625rem 0.75rem", display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                          {/* Multi-unit qty entry — edit any field, the rest auto-derive
                              from the item's pack hierarchy (target_weight_g + units_per_inner/outer/pallet).
                              For random-weight items only Kg is editable; the conversions don't apply. */}
                          {isFixed && (() => {
                            // Per-piece weight = target_weight_g / units_per_inner.
                            // For 1 piece per inner (or no pack hierarchy) it equals
                            // target_weight_g; for multi-piece packs it's target_weight_g/upi.
                            // target_weight_g IS the per-piece weight (post-migration 076).
                            // No division needed — show it as-is.
                            const pieceG = targetG ?? 0;
                            return (<>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                              <span
                                style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}
                                title={targetG ? `Per-piece target weight: ${targetG}g${upi && upi > 1 ? ` · per-inner = ${(targetG * upi).toFixed(2)}g (${upi} pcs)` : ""}` : undefined}
                              >Pieces{pieceG ? ` · ${pieceG}g ea` : ""}</span>
                              <input
                                ref={el => { if (el && d._key === pendingFocusKey) { el.focus(); el.select?.(); setPendingFocusKey(null); } }}
                                type="number" min="0" step="1"
                                value={d.planned_units}
                                onChange={e => setDraftQty(d._key, "units", e.target.value)}
                                placeholder="0"
                                className="form-input"
                                style={{ width: "85px", textAlign: "right", fontFamily: "monospace", fontSize: "0.875rem", padding: "0.3rem 0.5rem", fontWeight: 600 }}
                              />
                            </label>
                            </>);
                          })()}
                          {showInners && (
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }} title={`${upi} pieces / inner`}>Inners · {upi}</span>
                              <input
                                type="number" min="0" step="1"
                                value={d.planned_inners}
                                onChange={e => setDraftQty(d._key, "inners", e.target.value)}
                                placeholder="0"
                                className="form-input"
                                style={{ width: "75px", textAlign: "right", fontFamily: "monospace", fontSize: "0.875rem", padding: "0.3rem 0.5rem", background: "#fafaf9" }}
                              />
                            </label>
                          )}
                          {showOuters && (
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }} title={`${upo} pieces / outer`}>Outers · {upo}</span>
                              <input
                                type="number" min="0" step="1"
                                value={d.planned_outers}
                                onChange={e => setDraftQty(d._key, "outers", e.target.value)}
                                placeholder="0"
                                className="form-input"
                                style={{ width: "75px", textAlign: "right", fontFamily: "monospace", fontSize: "0.875rem", padding: "0.3rem 0.5rem", background: "#fafaf9" }}
                              />
                            </label>
                          )}
                          {showPallets && (
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }} title={`${upp} pieces / pallet`}>Pallets · {upp}</span>
                              <input
                                type="number" min="0" step="0.1"
                                value={d.planned_pallets}
                                onChange={e => setDraftQty(d._key, "pallets", e.target.value)}
                                placeholder="0"
                                className="form-input"
                                style={{ width: "75px", textAlign: "right", fontFamily: "monospace", fontSize: "0.875rem", padding: "0.3rem 0.5rem", background: "#fafaf9" }}
                              />
                            </label>
                          )}
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Kg</span>
                            <input
                              ref={el => { if (el && isRandom && d._key === pendingFocusKey) { el.focus(); el.select?.(); setPendingFocusKey(null); } }}
                              type="number" min="0" step="0.1"
                              value={d.planned_qty_kg}
                              onChange={e => setDraftQty(d._key, "kg", e.target.value)}
                              placeholder="0.0"
                              className="form-input"
                              style={{
                                width: "100px", textAlign: "right", fontFamily: "monospace",
                                fontSize: "0.875rem", padding: "0.3rem 0.5rem", fontWeight: 600,
                                background: isFixed && d.planned_units ? "#fafaf9" : "#fff",
                              }}
                            />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Type</span>
                            <select className="form-select" value={d.demand_type} onChange={e => updateDraft(d._key, { demand_type: e.target.value })} style={{ fontSize: "0.8125rem", padding: "0.3rem 0.4rem" }}>
                              {DEMAND_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Day</span>
                            <select className="form-select" value={d.day_of_week} onChange={e => updateDraft(d._key, { day_of_week: e.target.value })} style={{ fontSize: "0.8125rem", padding: "0.3rem 0.4rem" }}>
                              <option value="">Any</option>
                              {DAYS.map((day, i) => <option key={i} value={i}>{day}</option>)}
                            </select>
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: "1 1 130px" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Customer</span>
                            <input className="form-input" placeholder="optional" value={d.customer_name} onChange={e => updateDraft(d._key, { customer_name: e.target.value })} style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Cust ref</span>
                            <input className="form-input" placeholder="PO/ref" value={d.customer_ref} onChange={e => updateDraft(d._key, { customer_ref: e.target.value })} style={{ width: "110px", fontSize: "0.8125rem", padding: "0.3rem 0.5rem", fontFamily: "monospace" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pri</span>
                            <input className="form-input" type="number" min="1" max="10" value={d.priority} onChange={e => updateDraft(d._key, { priority: e.target.value })} style={{ width: "55px", textAlign: "center", fontSize: "0.8125rem", padding: "0.3rem 0.4rem" }} />
                          </label>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: "1 1 200px" }}>
                            <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              Notes{isLast && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#a8a29e", marginLeft: "0.4rem" }}>· Tab to add new row</span>}
                            </span>
                            <input
                              className="form-input"
                              placeholder="Optional…"
                              value={d.notes}
                              onChange={e => updateDraft(d._key, { notes: e.target.value })}
                              onKeyDown={e => {
                                // Tab on the LAST row's Notes field → append a fresh draft
                                // and let autoFocus on the new row's search input handle focus.
                                if (e.key === "Tab" && !e.shiftKey && isLast) {
                                  e.preventDefault();
                                  addDraftRow();
                                }
                              }}
                              style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem" }}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Manual "+ Add row" button as an alternative to Tab-from-Notes */}
                <button
                  type="button"
                  onClick={() => addDraftRow()}
                  className="btn-secondary"
                  style={{ alignSelf: "flex-start", fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                  title="Add another empty row"
                >+ Add another row</button>
              </div>

              {/* Footer */}
              <div style={{
                padding: "0.75rem 1.25rem",
                borderTop: "1px solid #f5f5f4",
                display: "flex", gap: "0.625rem",
                justifyContent: "flex-end", alignItems: "center",
                background: "#fafaf9",
                position: "sticky", bottom: 0, zIndex: 5,
              }}>
                <span style={{ fontSize: "0.75rem", color: "#78716c", marginRight: "auto" }}>
                  {validCount > 0
                    ? <>Will add <strong style={{ color: "#1c1917" }}>{validCount}</strong> demand line{validCount !== 1 ? "s" : ""}</>
                    : <>Pick an item and enter a qty to enable Add</>}
                </span>
                <button onClick={close} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
                <button
                  onClick={submit}
                  disabled={validCount === 0}
                  className="btn-primary"
                  style={{ fontSize: "0.8125rem", opacity: validCount === 0 ? 0.5 : 1, cursor: validCount === 0 ? "not-allowed" : "pointer" }}
                >Add &amp; Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Manual MRP override modal — see migration 117 + override-modal.tsx */}
      {overrideTarget && (
        <OverrideModal
          target={overrideTarget}
          onClose={() => { setOverrideTarget(null); router.refresh(); }}
        />
      )}

    </div>
  );
}


// --- Demand-grid sortable column header ---
// Click cycles: not-sorted -> asc -> desc -> not-sorted.
// Inactive: faint icon so users can see the column is sortable.
// Active: dark red arrow to show the current direction.
function GridSortHeader<T extends string>({
  col, label, sort, onClick, align = "left",
}: {
  col: T;
  label: string;
  sort: { col: T; dir: "asc" | "desc" } | null;
  onClick: (col: T) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sort?.col === col;
  const arrow = active ? (sort!.dir === "asc" ? "^" : "v") : "=";
  return (
    <button
      type="button"
      onClick={() => onClick(col)}
      style={{
        background: "none", border: "none", padding: 0, margin: 0,
        color: active ? "#1c1917" : "#57534e",
        fontWeight: active ? 800 : 700,
        fontSize: "inherit",
        textTransform: "inherit",
        letterSpacing: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        width: "100%",
        textAlign: align,
        display: "block",
      }}
      title={active ? "Click to cycle sort" : `Sort by ${label}`}
    >
      {label}
      <span style={{
        color: active ? "#b91c1c" : "#a8a29e",
        marginLeft: "0.25rem",
        fontSize: active ? "0.75em" : "0.85em",
        fontWeight: active ? 700 : 400,
        display: "inline-block",
        minWidth: "0.85em",
      }}>{arrow}</span>
    </button>
  );
}
