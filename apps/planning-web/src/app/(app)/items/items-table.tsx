"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { useItemsQuery, useItemTypeCounts, invalidateItemsCache } from "@/lib/hooks/use-items-query";
import {
  useDepartments,
  useItemCategories,
  useItemSubcategories,
  useItemTypes,
  useSuppliers,
} from "@/lib/hooks/use-reference-data";
import {
  ITEM_TYPE_LABELS,
  ITEM_TYPE_COLORS,
  PRODUCTION_METHOD_LABELS,
  type ItemTypeRow,
  type ProductionMethod,
} from "@/lib/types";
import { formatQty, formatUnits, formatGrams } from "@/lib/format";
import { openItemInPopup } from "@/lib/popup";
import ItemsExportButton, { type ExportColumnSpec } from "./_components/items-export-button";

// Local money helper — 2dp + thousand separators in en-AU.
function fmtMoney(v: unknown): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Render a gram value showing own value when set, otherwise the inherited
// value (from a parent in the family tree) in muted-grey italics with a "↑"
// prefix so the operator can tell at a glance which is which. Renders "—"
// when neither is available.
function formatInheritedGrams(own: number | null, inherited: number | null): React.ReactNode {
  if (own != null) {
    return <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{formatGrams(own)}</span>;
  }
  if (inherited != null) {
    return (
      <span
        style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
        title="Inherited from parent — not set on this item"
      >↑ {formatGrams(inherited)}</span>
    );
  }
  return <span style={{ color: "#a8a29e" }}>—</span>;
}

// Same idea for unit/integer values (pieces / inners / outers per ...).
function formatInheritedUnits(own: number | null, inherited: number | null): React.ReactNode {
  if (own != null) {
    return <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{formatUnits(Number(own))}</span>;
  }
  if (inherited != null) {
    return (
      <span
        style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
        title="Inherited from parent — not set on this item"
      >↑ {formatUnits(Number(inherited))}</span>
    );
  }
  return <span style={{ color: "#a8a29e" }}>—</span>;
}

interface ItemRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  item_type: string;
  item_category_id: string | null;
  item_subcategory_id: string | null;
  department: string | null;
  unit: string;
  weight_mode: string | null;
  production_method: string | null;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  is_active: boolean;
  is_make_to_order: boolean;
  consumed_in_weight: boolean;
  allergens: string[] | null;
  default_batch_size: number | null;
  batch_unit: string | null;
  priority: number | null;
  item_category?: { id: string; name: string; color: string } | null;
  // Extended fields — opt-in via the column toggle. All optional so existing
  // code paths keep type-checking. Backed by the items.* select.
  procurement_type?: string | null;
  parent_item_id?: string | null;
  machine?: string | null;
  room?: string | null;
  item_number_upload?: string | null;
  // Pack configuration (the cluster Tino wants to bulk-edit fast)
  target_weight_g?: number | null;
  fill_weight_g?: number | null;
  process_loss_pct?: number | null;
  tare_weight_g?: number | null;
  tolerance_over_g?: number | null;
  tolerance_under_g?: number | null;
  units_per_inner?: number | null;
  inner_per_outer?: number | null;
  units_per_outer?: number | null;          // DERIVED — DB trigger fills this
  outers_per_pallet?: number | null;
  units_per_pallet?: number | null;         // DERIVED — DB trigger fills this
  // Inherited values (populated by useItemsQuery joining v_items_inherited_attrs).
  // Each is the closest non-null ancestor value when the item itself doesn't
  // have one set. Lets a leaf FG show the fill/target it inherits from a WIPF.
  inherited_fill_weight_g?: number | null;
  inherited_target_weight_g?: number | null;
  inherited_process_loss_pct?: number | null;
  inherited_units_per_inner?: number | null;
  inherited_units_per_outer?: number | null;
  inherited_units_per_pallet?: number | null;
  inherited_inner_per_outer?: number | null;
  inherited_outers_per_pallet?: number | null;
  inherited_tare_weight_g?: number | null;
  inherited_tolerance_over_g?: number | null;
  inherited_tolerance_under_g?: number | null;
  // From item_pallet_config (joined in useItemsQuery). Per-item pallet config
  // table has at most one row per item — these are read-only in the grid;
  // the operator edits them via the item detail / pallet config screen.
  carton_gross_weight_kg?: number | null;
  carton_net_weight_kg?: number | null;
  total_pallet_weight_kg?: number | null;
  // ── Cost health — joined from v_item_cost_health (migration 086). Drives
  // the standard cost / cheapest / highest columns and the below-cheapest
  // red-line row tint. supplier_count = 0 means no supplier_items rows yet.
  standard_cost?: number | null;
  standard_cost_override_at?: string | null;
  supplier_count?: number;
  supplier_min_price?: number | null;
  supplier_max_price?: number | null;
  cheapest_supplier_id?: string | null;
  highest_supplier_id?: string | null;
  is_below_cheapest?: boolean;
  giveaway_pct?: number | null;
  packaging_materials?: string[] | null;
  // Stock / shelf life
  min_shelf_life_days?: number | null;
  // Pricing
  sell_price_per_inner?: number | null;
  sell_price_per_kg?: number | null;
  purchase_unit_price?: number | null;
  purchase_currency?: string | null;
  purchase_uom?: string | null;
  purchase_uom_qty?: number | null;
  purchase_uom_type?: string | null;
  purchase_account_code?: string | null;
  sales_account_code?: string | null;
  supplier?: string | null;
  supplier_code?: string | null;
  // Spec
  spec_storage_temp?: string | null;
  spec_shelf_life?: string | null;
  spec_notes?: string | null;
  spec_origin?: string | null;
  spec_fat_content?: string | null;
  spec_protein?: string | null;
  spec_moisture?: string | null;
  spec_ph?: string | null;
  spec_water_activity?: string | null;
  spec_micro?: string | null;
  spec_packaging?: string | null;
  spec_labelling?: string | null;
  spec_weight_per_unit?: string | null;
  // Other
  is_rte?: boolean | null;
  ingredients_statement?: string | null;
  // Microbiological limits
  micro_tpc?: string | null;
  micro_ecoli?: string | null;
  micro_coliforms?: string | null;
  micro_salmonella?: string | null;
  micro_listeria?: string | null;
  micro_s_aureus?: string | null;
  micro_yeast_mould?: string | null;
  micro_sulphite_clostridia?: string | null;
  micro_reference?: string | null;
  // Nutrition (per 100g)
  nut_energy_kj?: number | null;
  nut_energy_kcal?: number | null;
  nut_protein_g?: number | null;
  nut_fat_total_g?: number | null;
  nut_fat_saturated_g?: number | null;
  nut_fat_trans_g?: number | null;
  nut_carbs_total_g?: number | null;
  nut_carbs_sugars_g?: number | null;
  nut_fibre_g?: number | null;
  nut_sodium_mg?: number | null;
  nut_per_serving_g?: number | null;
  nut_notes?: string | null;
}

interface AllergenDef  { code: string; name: string; regulatory_standard: string }
interface Dept         { id: string; name: string; code: string }
interface Category     { id: string; name: string; color: string }
interface Subcategory  { id: string; category_id: string; name: string }
interface SupplierOption { id: string; name: string; code: string | null }

interface ItemsTableProps {
  isAdmin?: boolean;
}

const PAGE_SIZE = 200;

// ── Column factories for the long tail of optional columns ──────────────────
// Each returns a single-element array so it can be spread into the columns
// list with `...specCol(...)`. All produce defaultHidden columns — the
// operator opts in via the column toggle to focus the grid on whatever
// cluster they're bulk-editing right now (pack, pricing, micro, NIP, etc.).
//
// `specCol` — short text fields with a generic placeholder.
// `numCol`  — numeric fields rendered in monospace.
function specCol(key: string, label: string): ColumnDef<ItemRow>[] {
  return [{
    key: key as keyof ItemRow,
    label,
    width: 130,
    defaultHidden: true,
    render: (v) => v
      ? <span style={{ fontSize: "0.75rem", color: "#57534e" }}>{String(v)}</span>
      : <span style={{ color: "#a8a29e" }}>—</span>,
    editable: { type: "text", placeholder: label },
  }];
}
function numCol(key: string, label: string): ColumnDef<ItemRow>[] {
  return [{
    key: key as keyof ItemRow,
    label,
    width: 110,
    defaultHidden: true,
    render: (v) => v != null
      ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{formatQty(Number(v))}</span>
      : <span style={{ color: "#a8a29e" }}>—</span>,
    editable: { type: "number", placeholder: "0" },
  }];
}

// ─── MultiSelectFilter ──────────────────────────────────────────────────────
// Compact dropdown that lets the operator tick multiple values for a single
// filter (Type / Category / Subcategory / Department / etc.). Mirrors the
// supplier multi-select pattern that already lives inline below. Click-outside
// closes the dropdown; checkboxes don't auto-close so multiple values can be
// ticked in one open. "Clear" wipes selection. The button label compacts to
// the count when more than one value is selected ("3 categories" instead of
// listing every name).
function MultiSelectFilter({
  label,
  noun,
  options,
  selectedValues,
  onChange,
}: {
  label: string;
  noun: string;
  options: { value: string; label: string; sublabel?: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);
  const active = selectedValues.length > 0;
  const buttonText = !active
    ? label
    : selectedValues.length === 1
      ? options.find(o => o.value === selectedValues[0])?.label ?? label
      : `${selectedValues.length} ${noun}${selectedValues.length === 1 ? "" : "s"}`;
  return (
    <div ref={ref} style={{ position: "relative", flex: "1 1 130px", minWidth: "130px" }}>
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{
          width: "100%", textAlign: "left",
          fontSize: "0.8125rem",
          padding: "0.4375rem 0.75rem",
          border: `1px solid ${active ? "#b91c1c" : "#d6d3d1"}`,
          borderRadius: "0.375rem",
          background: active ? "#fef2f2" : "#fff",
          color: active ? "#b91c1c" : "#57534e",
          cursor: "pointer",
          whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: "0.375rem",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{buttonText}</span>
        <span style={{ fontSize: "0.55rem", opacity: 0.5 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
          background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: "240px",
          maxHeight: "300px", overflowY: "auto",
        }}>
          {selectedValues.length > 0 && (
            <div style={{ padding: "0.375rem 0.75rem", borderBottom: "1px solid #f5f5f4", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.7rem", color: "#78716c" }}>{selectedValues.length} selected</span>
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                style={{ fontSize: "0.75rem", color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >Clear</button>
            </div>
          )}
          {options.length === 0 ? (
            <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#a8a29e", textAlign: "center" }}>No options</div>
          ) : options.map(opt => (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #fafaf9" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(opt.value)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...selectedValues, opt.value]
                    : selectedValues.filter(v => v !== opt.value);
                  onChange(next);
                }}
                style={{ cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ fontSize: "0.8125rem", color: "#292524" }}>{opt.label}</span>
              {opt.sublabel && (
                <span style={{ fontSize: "0.75rem", color: "#a8a29e", fontFamily: "monospace", marginLeft: "auto" }}>{opt.sublabel}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ItemsTable({ isAdmin = false }: ItemsTableProps) {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // ── Derive current page and filters from the URL ─────────────────────────
  const currentPage = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  const pageSize    = PAGE_SIZE;
  const activeTypeRaw = searchParams.get("type") ?? "all";

  // Active-status filter — three states:
  //   "active"   (default) → only is_active = true
  //   "inactive"           → only is_active = false
  //   "both"               → no filter, show all
  // URL param `status`; defaults to "active" when missing so the grid never
  // shows inactive items unless the operator explicitly asks for them.
  const activeStatusFilter = (searchParams.get("status") ?? "active") as "active" | "inactive" | "both";

  const queryFilters = {
    code:      searchParams.get("code")      ?? "",
    name:      searchParams.get("name")      ?? "",
    desc:      searchParams.get("desc")      ?? "",
    type:      activeTypeRaw !== "all" ? activeTypeRaw : "",
    category:  searchParams.get("category")  ?? "",
    subcat:    searchParams.get("subcat")    ?? "",
    dept:      searchParams.get("dept")      ?? "",
    suppliers: searchParams.get("suppliers") ?? "",
    status:    activeStatusFilter,
    page:      currentPage,
  };

  // ── TanStack Query — all data fetched and cached client-side ─────────────
  const { data: queryData, isFetching: itemsFetching, refetch: refetchItems } = useItemsQuery(queryFilters);
  const items      = queryData?.items      ?? [];
  const totalCount = queryData?.totalCount ?? 0;

  const { data: typeCounts    = {} } = useItemTypeCounts();
  const { data: departments   = [] } = useDepartments();
  const { data: categories    = [] } = useItemCategories();
  const { data: subcategories = [] } = useItemSubcategories();
  const { data: itemTypes     = [] } = useItemTypes();
  const { data: suppliers     = [] } = useSuppliers();
  const allergenDefs: AllergenDef[] = [];

  // Local state for text inputs — debounced URL sync
  const [localCode, setLocalCode] = useState(searchParams.get("code") ?? "");
  const [localName, setLocalName] = useState(searchParams.get("name") ?? "");
  const [localDesc, setLocalDesc] = useState(searchParams.get("desc") ?? "");

  // Supplier dropdown
  const [showSupplierDd, setShowSupplierDd] = useState(false);
  // Phase 9.3 v3 (Tino May 8 2026): typeahead box at the top of the
  // supplier dropdown so the operator can quickly find a supplier in a
  // long list (German Butchery has ~80+ suppliers).
  const [supplierSearch, setSupplierSearch] = useState("");
  const supplierDdRef = useRef<HTMLDivElement>(null);

  // Close supplier dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (supplierDdRef.current && !supplierDdRef.current.contains(e.target as Node)) {
        setShowSupplierDd(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter values derived from queryFilters (already read from URL above).
  // All four "category-like" filters (type / category / subcategory / dept)
  // accept a comma-separated list now; the URL param stays the same key but
  // multiple values join with commas.
  const activeType        = activeTypeRaw;
  const filterTypeIds     = useMemo(
    () => (searchParams.get("type") ?? "").split(",").map(s => s.trim()).filter(s => s && s !== "all"),
    [searchParams]
  );
  const filterCategoryIds = useMemo(
    () => (searchParams.get("category") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    [searchParams]
  );
  const filterSubcatIds   = useMemo(
    () => (searchParams.get("subcat") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    [searchParams]
  );
  const filterDeptNames   = useMemo(
    () => (searchParams.get("dept") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    [searchParams]
  );
  // Legacy single-value aliases — kept so existing render code that reads
  // these doesn't have to change yet. They evaluate to the FIRST selected
  // value (if any), which is fine for "is anything selected?" boolean
  // checks. Multi-select dropdowns use the *Ids/*Names variants above.
  const filterCategory    = filterCategoryIds[0] ?? "";
  const filterSubcat      = filterSubcatIds[0]   ?? "";
  const filterDept        = filterDeptNames[0]   ?? "";
  const filterSupplierIds = useMemo(
    () => (searchParams.get("suppliers") ?? "").split(",").filter(Boolean),
    [searchParams]
  );

  // Helper: merge updated params and navigate (resets to page 1)
  const pushFilters = useCallback(
    (updates: Record<string, string>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) p.set(key, value);
        else p.delete(key);
      }
      p.delete("page");
      router.push(`/items?${p.toString()}`);
    },
    [router, searchParams]
  );

  // Debounce Item Number filter (code)
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.get("code") ?? "";
      if (localCode !== current) pushFilters({ code: localCode });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localCode]);

  // Debounce Name filter
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.get("name") ?? "";
      if (localName !== current) pushFilters({ name: localName });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localName]);

  // Debounce Description filter
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = searchParams.get("desc") ?? "";
      if (localDesc !== current) pushFilters({ desc: localDesc });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDesc]);

  // Build type tab list — driven entirely by the Type register
  // (`/settings/item-types`). Add a type there and a tab appears here
  // automatically; rename → tab label updates; deactivate → tab disappears.
  // While item_types is still loading we show only "All" so the tab strip
  // doesn't flicker with stale labels.
  const TYPE_TABS: { value: string; label: string }[] = [
    { value: "all", label: "All" },
    ...itemTypes
      .filter(t => t.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(t => ({ value: t.code, label: t.name })),
  ];

  const typeLabel = (code: string) =>
    itemTypes.find(t => t.code === code)?.name ?? ITEM_TYPE_LABELS[code] ?? code;
  const typeColor = (code: string) =>
    itemTypes.find(t => t.code === code)?.color ?? null;

  // Sub-categories filtered by the currently-selected category
  const filteredSubcats = useMemo(
    // Subcategory cascade — when one or more categories are selected, show
    // only subcategories whose parent is in the selected set. With nothing
    // selected, all subcategories are available.
    () => filterCategoryIds.length > 0
      ? subcategories.filter(s => filterCategoryIds.includes(s.category_id))
      : subcategories,
    [subcategories, filterCategoryIds]
  );

  // Selection state
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const allPageSelected = items.length > 0 && items.every(r => selected.has(r.id));
  const someSelected    = selected.size > 0;

  // Is any filter active? Status only counts when it's NOT the 'active'
  // default — so a fresh page (status implied 'active') doesn't show
  // the Clear-filters button, but flipping to Inactive / Both does.
  const hasFilters =
    !!localCode || !!localName ||
    activeType !== "all" || !!filterCategory || !!filterSubcat ||
    !!filterDept || filterSupplierIds.length > 0 ||
    activeStatusFilter !== "active";

  function clearAllFilters() {
    setLocalCode("");
    setLocalName("");
    router.push("/items");
  }

  // Pagination helpers
  const totalPages  = Math.ceil(totalCount / pageSize);
  const displayFrom = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const displayTo   = Math.min(currentPage * pageSize, totalCount);

  // ── Hidden-cols snapshot for the smart export ────────────────────────────
  // DataTable persists hidden columns at "{storageKey}.hiddenCols" in
  // localStorage. We mirror that here so the export button knows which
  // columns to include WITHOUT round-tripping through DataTable props.
  // Storage events fire across tabs but NOT for same-tab writes, so we
  // re-read on the column-toggle click via a bumped tick + on focus.
  const HIDDEN_LS_KEY = "items.v1.hiddenCols";
  const [hiddenColsTick, setHiddenColsTick] = useState(0);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === HIDDEN_LS_KEY) setHiddenColsTick(t => t + 1);
    }
    function onFocus() { setHiddenColsTick(t => t + 1); }
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  const hiddenColsSet = useMemo(() => {
    void hiddenColsTick; // re-read on tick
    if (typeof window === "undefined") return new Set<string>();
    try {
      const raw = window.localStorage.getItem(HIDDEN_LS_KEY);
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    } catch { return new Set<string>(); }
  }, [hiddenColsTick]);

  // exportColumnSpecs is built AFTER `columns` is defined further down —
  // see the matching block right under the columns useMemo. Putting it
  // here would dereference `columns` before initialization (TDZ).

  function goToPage(p: number) {
    const ps = new URLSearchParams(searchParams.toString());
    if (p === 1) ps.delete("page");
    else ps.set("page", String(p));
    router.push(`/items?${ps.toString()}`);
  }

  // ── Column definitions ───────────────────────────────────────────────────
  const columns: ColumnDef<ItemRow>[] = useMemo(
    () => [
      ...(isAdmin
        ? [{
            key: "_select" as keyof ItemRow,
            label: "",
            width: 40,
            hideable: false,
            render: (_v: unknown, row: ItemRow) => (
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={e => { e.stopPropagation(); toggleRow(row.id); }}
                onClick={e => e.stopPropagation()}
                style={{ cursor: "pointer", width: "1rem", height: "1rem" }}
              />
            ),
          }]
        : []),
      {
        key: "code",
        label: "Code",
        width: 110, minWidth: 80, hideable: false,
        render: (v) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
            {String(v ?? "—")}
          </span>
        ),
      },
      {
        key: "name",
        label: "Name",
        width: 240,
        render: (v, row) => (
          <span style={{ fontWeight: 500 }}>
            {String(v ?? "—")}
            {row.item_type === "finished_good" && row.weight_mode === "random" && (
              <span className="badge badge-yellow" style={{ marginLeft: "0.5rem", fontSize: "0.6rem", verticalAlign: "middle" }}>⚖ Random wt</span>
            )}
            {row.item_type === "finished_good" && row.weight_mode === "fixed" && (
              <span className="badge badge-blue" style={{ marginLeft: "0.5rem", fontSize: "0.6rem", verticalAlign: "middle" }}>Fixed wt</span>
            )}
            {!row.is_active && (
              <span className="badge badge-gray" style={{ marginLeft: "0.375rem", fontSize: "0.6875rem" }}>Inactive</span>
            )}
          </span>
        ),
        editable: { type: "text", placeholder: "Item name" },
      },
      {
        key: "description",
        label: "Description",
        width: 260,
        render: (v) =>
          v ? <span style={{ color: "#57534e", fontSize: "0.8125rem" }}>{String(v)}</span>
            : <span style={{ color: "#d4d0cc" }}>—</span>,
        editable: { type: "text", placeholder: "Item description" },
      },
      {
        key: "item_type",
        label: "Type",
        width: 130,
        render: (v) => {
          const code  = String(v ?? "");
          const hex   = typeColor(code);
          const label = typeLabel(code);
          if (hex) {
            return (
              <span style={{
                display: "inline-block",
                fontSize: "0.6875rem", fontWeight: 500,
                padding: "0.125rem 0.5rem", borderRadius: "9999px",
                background: hex + "22", color: hex, border: `1px solid ${hex}44`,
              }}>
                {label}
              </span>
            );
          }
          return (
            <span className={`badge ${ITEM_TYPE_COLORS[code] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
              {label}
            </span>
          );
        },
        editable: {
          type: "select",
          options: itemTypes.length > 0
            ? itemTypes.filter(t => t.is_active).sort((a, b) => a.sort_order - b.sort_order).map(t => ({ value: t.code, label: t.name }))
            : Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        },
      },
      {
        key: "item_category",
        label: "Category",
        width: 130,
        render: (_v, row) => {
          const cat = row.item_category;
          if (!cat) return <span style={{ color: "#a8a29e" }}>—</span>;
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3125rem" }}>
              <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: cat.color, flexShrink: 0, display: "inline-block" }} />
              <span style={{ fontSize: "0.8125rem" }}>{cat.name}</span>
            </span>
          );
        },
        editable: categories.length > 0
          ? { type: "select", editKey: "item_category_id", options: categories.map(c => ({ value: c.id, label: c.name })) }
          : undefined,
      },
      {
        key: "item_subcategory_id",
        label: "Subcategory",
        width: 130,
        render: (_v, row) => {
          const sub = subcategories.find(s => s.id === row.item_subcategory_id);
          return sub
            ? <span style={{ fontSize: "0.8125rem" }}>{sub.name}</span>
            : <span style={{ color: "#a8a29e" }}>—</span>;
        },
        editable: subcategories.length > 0
          ? { type: "select", editKey: "item_subcategory_id", options: subcategories.map(s => ({ value: s.id, label: s.name })) }
          : undefined,
      },
      {
        key: "department",
        label: "Department",
        width: 130,
        render: (v) =>
          v ? <span style={{ textTransform: "capitalize" }}>{String(v)}</span>
            : <span style={{ color: "#a8a29e" }}>—</span>,
        editable: departments.length > 0
          ? { type: "select", options: departments.map(d => ({ value: d.name, label: d.name })) }
          : { type: "text", placeholder: "Department" },
      },
      {
        key: "production_method",
        label: "Prod. Method",
        width: 140, defaultHidden: true,
        render: (v) =>
          v ? <span style={{ fontSize: "0.8125rem" }}>{PRODUCTION_METHOD_LABELS[v as ProductionMethod] ?? String(v)}</span>
            : <span style={{ color: "#a8a29e" }}>—</span>,
        editable: {
          type: "select",
          options: Object.entries(PRODUCTION_METHOD_LABELS).map(([value, label]) => ({ value, label })),
        },
      },
      {
        key: "unit",
        label: "Unit",
        width: 80,
        render: (v) => <span style={{ color: "#78716c" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "kg" },
      },
      {
        key: "default_batch_size",
        label: "Batch Size",
        width: 110,
        render: (v, row) =>
          v != null ? <span style={{ color: "#78716c" }}>{formatQty(Number(v), row.batch_unit)} {row.batch_unit}</span>
                    : <span style={{ color: "#a8a29e" }}>—</span>,
        editable: { type: "number", placeholder: "e.g. 750" },
      },
      {
        key: "batch_unit",
        label: "Batch Unit",
        width: 100, defaultHidden: true,
        render: (v) => <span style={{ color: "#78716c" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "kg" },
      },
      {
        key: "min_stock",
        label: "Min Stock",
        width: 100,
        render: (v, row) => <span style={{ color: "#78716c" }}>{formatQty(Number(v ?? 0), row.unit)} {row.unit}</span>,
        editable: { type: "number", placeholder: "0" },
      },
      {
        key: "max_stock",
        label: "Max Stock",
        width: 100,
        render: (v, row) => <span style={{ color: "#78716c" }}>{formatQty(Number(v ?? 0), row.unit)} {row.unit}</span>,
        editable: { type: "number", placeholder: "0" },
      },
      {
        key: "current_stock",
        label: "Stock",
        width: 120,
        render: (v, row) => {
          const isLow = row.current_stock <= row.min_stock && row.min_stock > 0;
          return (
            <span style={{ whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 600, color: isLow ? "#dc2626" : "#292524" }}>
                {formatQty(row.current_stock, row.unit)} {row.unit}
              </span>
              {isLow && (
                <span className="badge badge-red" style={{ marginLeft: "0.375rem", fontSize: "0.6875rem" }}>Low</span>
              )}
            </span>
          );
        },
      },
      {
        key: "allergens",
        label: "Allergens",
        width: 200,
        render: (v) => {
          const allergens = v as string[] | null;
          if (!allergens?.length) return <span style={{ color: "#a8a29e" }}>—</span>;
          const display = [...new Set(allergens.map(a => a.replace(/^[A-Z]+_/, "")))];
          return (
            <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>
              {display.join(", ")}
            </span>
          );
        },
        editable: allergenDefs.length > 0
          ? {
              type: "multiselect",
              options: allergenDefs.map(a => ({
                value: a.code,
                label: `${a.name}${allergenDefs.some(x => x.name === a.name && x.regulatory_standard !== a.regulatory_standard) ? ` (${a.regulatory_standard})` : ""}`,
              })),
            }
          : undefined,
      },
      {
        key: "priority",
        label: "Priority",
        width: 90, defaultHidden: true,
        render: (v) => <span style={{ color: "#78716c" }}>{String(v ?? 5)}</span>,
        editable: { type: "number", placeholder: "5" },
      },
      {
        key: "is_make_to_order",
        label: "Make to Order",
        width: 120, defaultHidden: true,
        render: (v) => (
          <span className={`badge ${v ? "badge-blue" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
            {v ? "Yes" : "No"}
          </span>
        ),
        editable: {
          type: "select",
          options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }],
        },
      },
      {
        key: "is_active",
        label: "Status",
        width: 90, defaultHidden: true,
        render: (v) => (
          <span className={`badge ${v ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
            {v ? "Active" : "Inactive"}
          </span>
        ),
        editable: {
          type: "select",
          options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }],
        },
      },
      // ── How is this item consumed? ──
      // TRUE  = consumed as WEIGHT (kg) — recipe ingredient, % math
      // FALSE = consumed as UNIT (each/m/roll/bag/etc.) — packaging/casing/consumable
      {
        key: "consumed_in_weight",
        label: "Consume As",
        width: 120, defaultHidden: true,
        render: (v) => (
          <span className={`badge ${v ? "badge-blue" : "badge-yellow"}`} style={{ fontSize: "0.6875rem" }}
            title={v ? "Consumed as weight — counts toward product weight (recipe ingredient)" : "Consumed as unit (each / m / roll / bag / etc.) — packaging, casing, consumable"}>
            {v ? "Weight" : "Unit"}
          </span>
        ),
        editable: {
          type: "select",
          options: [
            { value: "true",  label: "Weight (kg)"        },
            { value: "false", label: "Unit (each / etc.)" },
          ],
        },
      },

      // ── Extended fields (all defaultHidden — show via column toggle) ──
      // Tino's main use case: show the cluster you're bulk-editing (e.g. all
      // pack-config columns), edit inline across many rows, save.

      // ── Identity / classification extras ──
      {
        key: "procurement_type", label: "Procurement", width: 110, defaultHidden: true,
        render: (v) => v ? <span style={{ textTransform: "capitalize", fontSize: "0.8125rem" }}>{String(v)}</span> : <span style={{ color: "#a8a29e" }}>—</span>,
        editable: { type: "select", options: [{ value: "purchase", label: "Purchase" }, { value: "produce", label: "Produce" }] },
      },
      {
        key: "item_number_upload", label: "Item # (upload)", width: 130, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "Vendor item #" },
      },
      {
        key: "machine", label: "Machine", width: 110, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.8125rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "Machine" },
      },
      {
        key: "room", label: "Room", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.8125rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "Room" },
      },

      // ── Pack configuration cluster (the one Tino called out) ──
      {
        key: "weight_mode", label: "Weight Mode", width: 110, defaultHidden: true,
        render: (v) => v ? <span style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#57534e" }}>{String(v)}</span> : <span style={{ color: "#a8a29e" }}>—</span>,
        editable: { type: "select", options: [{ value: "fixed", label: "Fixed" }, { value: "random", label: "Random" }] },
      },
      // ── PACK / FILL HIERARCHY (re-ordered to follow the natural flow) ──
      // Order: Actual fill (per piece) → Target fill (per piece) → Pieces/Inner
      //   → Target Inner Wt → Inners/Outer → Pieces/Outer (auto) → Outers/Pallet
      //   → Pieces/Pallet (auto) → Tare → Tolerance ± → Process Loss
      //
      // Inheritance: when a value isn't set on the item itself, the columns
      // below fall back to its closest ancestor's value (via the
      // v_items_inherited_attrs view, merged in by useItemsQuery). The cell
      // renders the inherited value in muted-grey with a "↑" prefix so the
      // operator can tell at a glance whether they're seeing the item's own
      // value or one inherited from a parent.

      // Reusable renderer for "own value or inherited" gram fields.
      // (Defined once below — see formatInheritedGrams / formatInheritedUnits.)

      // 1. Actual Fill Weight (g/piece) — what's put in per piece, before process.
      {
        key: "fill_weight_g", label: "Actual Fill Wt (g/pc)", width: 130, defaultHidden: true,
        render: (v, row) => formatInheritedGrams(v as number | null, row.inherited_fill_weight_g ?? null),
        editable: { type: "number", placeholder: "g" },
      },
      // 2. Target Piece Weight (g) — target_weight_g IS now the per-piece
      //    value directly. With inheritance from the parent chain.
      {
        key: "target_weight_g_per_piece", label: "Target Piece Wt (g)", width: 130, defaultHidden: true, sortable: false,
        render: (_v, row) => {
          const ownTarget = row.target_weight_g ?? null;
          const inhTarget = row.inherited_target_weight_g ?? null;
          const target = ownTarget ?? inhTarget;
          if (target == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const isInherited = ownTarget == null;
          return (
            <span style={{
              fontFamily: "monospace", fontSize: "0.8125rem",
              color: isInherited ? "#78716c" : "#57534e",
              fontStyle: isInherited ? "italic" : undefined,
            }} title={isInherited ? "Inherited from parent" : "Per-piece target weight"}>
              {isInherited ? "↑ " : ""}{Number(target).toFixed(2)} g
            </span>
          );
        },
      },
      // 3. Pieces / Inner — moved up from below.
      {
        key: "units_per_inner", label: "Pieces / Inner", width: 110, defaultHidden: true,
        render: (v, row) => formatInheritedUnits(v as number | null, row.inherited_units_per_inner ?? null),
        editable: { type: "number", placeholder: "pcs" },
      },
      // 4. Target Inner Weight (g) — DERIVED: target_weight_g × units_per_inner.
      //    target_weight_g is now per-piece (migration 076), so the per-inner
      //    value is computed at render time from own or inherited operands.
      {
        key: "target_inner_wt_g", label: "Target Inner Wt (g)", width: 140, defaultHidden: true, sortable: false,
        render: (_v, row) => {
          const ownTarget = row.target_weight_g ?? null;
          const inhTarget = row.inherited_target_weight_g ?? null;
          const target = ownTarget ?? inhTarget;
          const upi    = row.units_per_inner ?? row.inherited_units_per_inner ?? null;
          if (target == null || upi == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const perInner = Number(target) * Number(upi);
          const isInherited = ownTarget == null || row.units_per_inner == null;
          return (
            <span style={{
              fontFamily: "monospace", fontSize: "0.8125rem",
              color: isInherited ? "#78716c" : "#78716c",
              fontStyle: "italic",
            }} title={`Auto: ${target} g/piece × ${upi} pcs/inner`}>
              {perInner.toFixed(2)} g
            </span>
          );
        },
      },
      // The raw stored target_weight_g column (per-piece). Editable, hidden
      // by default since the renamed "Target Piece Wt (g)" above shows the
      // same field with inheritance fallback.
      {
        key: "target_weight_g", label: "Target Wt (g/pc · raw)", width: 150, defaultHidden: true,
        render: (v, row) => formatInheritedGrams(v as number | null, row.inherited_target_weight_g ?? null),
        editable: { type: "number", placeholder: "g" },
      },
      // 5. Inners / Outer.
      {
        key: "inner_per_outer", label: "Inners / Outer", width: 110, defaultHidden: true,
        render: (v, row) => formatInheritedUnits(v as number | null, row.inherited_inner_per_outer ?? null),
        editable: { type: "number", placeholder: "inners" },
      },
      // 6. Pieces / Outer (auto) — DB trigger fills this.
      {
        key: "units_per_outer", label: "Pieces / Outer (auto)", width: 130, defaultHidden: true, sortable: true,
        render: (_v, row) => {
          const upi = row.units_per_inner ?? row.inherited_units_per_inner ?? null;
          const ipo = row.inner_per_outer ?? row.inherited_inner_per_outer ?? null;
          if (upi == null || ipo == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          return (
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
              title={`Auto: ${upi} pcs/inner × ${ipo} inners/outer`}>
              {formatUnits(upi * ipo)}
            </span>
          );
        },
      },
      // 7. Outers / Pallet.
      {
        key: "outers_per_pallet", label: "Outers / Pallet", width: 120, defaultHidden: true,
        render: (v, row) => formatInheritedUnits(v as number | null, row.inherited_outers_per_pallet ?? null),
        editable: { type: "number", placeholder: "outers" },
      },
      // 8. Pieces / Pallet (auto) — DB trigger fills this.
      {
        key: "units_per_pallet", label: "Pieces / Pallet (auto)", width: 130, defaultHidden: true, sortable: true,
        render: (_v, row) => {
          const upi = row.units_per_inner ?? row.inherited_units_per_inner ?? null;
          const ipo = row.inner_per_outer ?? row.inherited_inner_per_outer ?? null;
          const opp = row.outers_per_pallet ?? row.inherited_outers_per_pallet ?? null;
          if (upi == null || ipo == null || opp == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          return (
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
              title={`Auto: ${upi} × ${ipo} × ${opp}`}>
              {formatUnits(upi * ipo * opp)}
            </span>
          );
        },
      },
      // 8b. Carton (Box) Gross Weight.
      //     Two sources, in priority order:
      //       1. item_pallet_config.carton_gross_weight_kg — operator-set, takes
      //          precedence so manual measurements override the calc.
      //       2. AUTO: units_per_outer × per-piece target weight (with inherited
      //          fallback for both factors) ÷ 1000 → kg. Same convention as the
      //          other "(auto)" columns: muted italic + tooltip explaining the
      //          formula. Operators wanted these to fill in automatically rather
      //          than waiting for a manual carton_gross_weight_kg entry.
      {
        key: "carton_gross_weight_kg", label: "Carton (kg)", width: 110, defaultHidden: true,
        render: (v, row) => {
          if (v != null) {
            return <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{Number(v).toFixed(2)}</span>;
          }
          const upo = row.units_per_outer ?? row.inherited_units_per_outer ?? null;
          const tw  = row.target_weight_g ?? row.inherited_target_weight_g ?? null;
          if (upo == null || tw == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const kg = (Number(upo) * Number(tw)) / 1000;
          return (
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
              title={`Auto: ${upo} pcs/outer × ${tw} g target ÷ 1000`}>
              {kg.toFixed(2)}
            </span>
          );
        },
      },
      // 8c. Pallet Total Weight.
      //     Same two-source logic as carton above. Auto = units_per_pallet ×
      //     per-piece target weight ÷ 1000. Stored value (full loaded pallet
      //     incl. carton + pallet tare) wins when present.
      {
        key: "total_pallet_weight_kg", label: "Pallet (kg)", width: 110, defaultHidden: true,
        render: (v, row) => {
          if (v != null) {
            return <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{Number(v).toFixed(2)}</span>;
          }
          const upp = row.units_per_pallet ?? row.inherited_units_per_pallet ?? null;
          const tw  = row.target_weight_g ?? row.inherited_target_weight_g ?? null;
          if (upp == null || tw == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const kg = (Number(upp) * Number(tw)) / 1000;
          return (
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}
              title={`Auto: ${upp} pcs/pallet × ${tw} g target ÷ 1000`}>
              {kg.toFixed(2)}
            </span>
          );
        },
      },
      // 8d-f. Cost columns — joined from v_item_cost_health (migration 086).
      //   Standard Cost: editable when admin (writes to items.standard_cost
      //     plus stamps the override profile/timestamp via handleBulkSave).
      //   Cheapest / Highest: read-only display from v_item_cost_health,
      //     normalised through purchase_uom_qty so $/ctn becomes $/kg etc.
      //   Below-cheapest red-line is applied at row level via getRowStyle
      //     in the DataTable (we surface row.is_below_cheapest below).
      {
        key: "standard_cost", label: "Std cost", width: 110, defaultHidden: true,
        render: (v, row) => {
          if (v == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const isOverride = !!row.standard_cost_override_at;
          return (
            <span
              style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: row.is_below_cheapest ? "#dc2626" : "#1c1917", fontWeight: row.is_below_cheapest ? 700 : 500 }}
              title={isOverride ? `Manually overridden ${new Date(row.standard_cost_override_at!).toLocaleString("en-AU")}` : "Auto from supplier prices"}
            >
              {row.is_below_cheapest && "⚠ "}
              ${Number(v).toFixed(2)}
              {isOverride && <span style={{ fontSize: "0.65rem", marginLeft: "0.25rem", color: "#854d0e" }}>(override)</span>}
            </span>
          );
        },
        editable: isAdmin ? { type: "number", placeholder: "$ / unit" } : undefined,
      },
      {
        key: "supplier_min_price", label: "Cheapest", width: 100, defaultHidden: true,
        render: (v, row) => {
          if (v == null) return (
            <span style={{ color: "#a8a29e", fontSize: "0.75rem", fontStyle: "italic" }} title="No supplier prices">—</span>
          );
          return (
            <span
              style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#166534" }}
              title={`Cheapest of ${row.supplier_count ?? 0} supplier${(row.supplier_count ?? 0) === 1 ? "" : "s"}`}
            >
              ${Number(v).toFixed(2)}
            </span>
          );
        },
      },
      {
        key: "supplier_max_price", label: "Highest", width: 100, defaultHidden: true,
        render: (v, row) => {
          if (v == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          return (
            <span
              style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#854d0e" }}
              title={`Highest of ${row.supplier_count ?? 0} supplier${(row.supplier_count ?? 0) === 1 ? "" : "s"} — default standard cost source`}
            >
              ${Number(v).toFixed(2)}
            </span>
          );
        },
      },
      {
        key: "supplier_count", label: "# Suppliers", width: 100, defaultHidden: true,
        render: (v) => {
          const n = Number(v ?? 0);
          if (n === 0) return <span style={{ color: "#a8a29e" }}>—</span>;
          return <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>{n}</span>;
        },
      },
      // 9. Tare (g).
      {
        key: "tare_weight_g", label: "Tare (g)", width: 90, defaultHidden: true,
        render: (v, row) => formatInheritedGrams(v as number | null, row.inherited_tare_weight_g ?? null),
        editable: { type: "number", placeholder: "g" },
      },
      // 10. Tolerance Over (g).
      {
        key: "tolerance_over_g", label: "Tol +g", width: 80, defaultHidden: true,
        render: (v, row) => formatInheritedGrams(v as number | null, row.inherited_tolerance_over_g ?? null),
        editable: { type: "number", placeholder: "g" },
      },
      // 11. Tolerance Under (g).
      {
        key: "tolerance_under_g", label: "Tol -g", width: 80, defaultHidden: true,
        render: (v, row) => formatInheritedGrams(v as number | null, row.inherited_tolerance_under_g ?? null),
        editable: { type: "number", placeholder: "g" },
      },
      // 12. Process Loss (%) — moved to the end since it's a percentage, not a weight or count.
      {
        key: "process_loss_pct", label: "Process Loss %", width: 120, defaultHidden: true,
        render: (v, row) => {
          const own = v;
          const inh = row.inherited_process_loss_pct;
          const eff = own != null ? own : inh;
          if (eff == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const isInh = own == null && inh != null;
          return (
            <span style={{
              fontFamily: "monospace", fontSize: "0.8125rem",
              color: isInh ? "#78716c" : "#a16207",
              fontStyle: isInh ? "italic" : undefined,
            }} title={isInh ? "Inherited from parent" : "Own value"}>
              {isInh ? "↑ " : ""}{Number(eff).toFixed(2)}%
            </span>
          );
        },
        editable: { type: "number", placeholder: "%" },
      },
      // ── Giveaway as % of target weight (replaces per-piece grams) ──
      {
        key: "giveaway_pct", label: "Giveaway %", width: 110, defaultHidden: true,
        render: (v, row) => {
          if (v == null) return <span style={{ color: "#a8a29e" }}>—</span>;
          const pct = Number(v);
          const target = row.target_weight_g ?? null;
          // Equivalent grams hint when target is set, so operator can sanity-check
          const grams = target ? (target * pct) / 100 : null;
          return (
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#a16207" }}>
              {pct.toFixed(2)}%
              {grams != null && <span style={{ marginLeft: "0.35rem", color: "#a8a29e", fontSize: "0.7rem" }}>(~{formatGrams(grams)}g)</span>}
            </span>
          );
        },
        editable: { type: "number", placeholder: "%" },
      },
      {
        key: "packaging_materials", label: "Packaging Mats", width: 160, defaultHidden: true,
        render: (v) => {
          const arr = v as string[] | null;
          if (!arr?.length) return <span style={{ color: "#a8a29e" }}>—</span>;
          return <span style={{ fontSize: "0.75rem", color: "#57534e" }}>{arr.join(", ")}</span>;
        },
      },
      {
        key: "min_shelf_life_days", label: "Min Shelf (d)", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{v != null ? `${v}d` : "—"}</span>,
        editable: { type: "number", placeholder: "days" },
      },

      // ── Pricing cluster ──
      {
        key: "sell_price_per_inner", label: "$/Inner", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#166534" }}>{v != null ? `$${fmtMoney(v)}` : "—"}</span>,
        editable: { type: "number", placeholder: "$" },
      },
      {
        key: "sell_price_per_kg", label: "$/kg", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#166534" }}>{v != null ? `$${fmtMoney(v)}` : "—"}</span>,
        editable: { type: "number", placeholder: "$" },
      },
      {
        key: "purchase_unit_price", label: "Purch $", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#b91c1c" }}>{v != null ? `$${fmtMoney(v)}` : "—"}</span>,
        editable: { type: "number", placeholder: "$" },
      },
      {
        key: "purchase_currency", label: "Currency", width: 90, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "AUD" },
      },
      {
        key: "purchase_uom", label: "Purch UOM", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.8125rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "kg/ctn" },
      },
      {
        key: "purchase_uom_qty", label: "Purch UOM Qty", width: 110, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{v != null ? String(v) : "—"}</span>,
        editable: { type: "number", placeholder: "qty" },
      },
      {
        key: "purchase_uom_type", label: "UOM Type", width: 100, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.75rem", textTransform: "capitalize" }}>{String(v ?? "—")}</span>,
        editable: { type: "select", options: [{ value: "fixed", label: "Fixed" }, { value: "average", label: "Average" }] },
      },
      {
        key: "purchase_account_code", label: "Purch Acct", width: 110, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "code" },
      },
      {
        key: "sales_account_code", label: "Sales Acct", width: 110, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "code" },
      },
      {
        key: "supplier", label: "Supplier (text)", width: 140, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "Legacy supplier" },
      },
      {
        key: "supplier_code", label: "Supp Code (text)", width: 130, defaultHidden: true,
        render: (v) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "code" },
      },

      // ── Other / regulatory ──
      {
        key: "is_rte", label: "RTE", width: 80, defaultHidden: true,
        render: (v) => <span className={`badge ${v ? "badge-blue" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>{v ? "Yes" : "No"}</span>,
        editable: { type: "select", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      },
      {
        key: "ingredients_statement", label: "Ingredients", width: 240, defaultHidden: true,
        render: (v) => <span style={{ fontSize: "0.75rem", color: "#57534e" }}>{String(v ?? "—")}</span>,
        editable: { type: "text", placeholder: "Ingredients statement" },
      },

      // ── Spec cluster ──
      ...specCol("spec_storage_temp",   "Storage Temp"),
      ...specCol("spec_shelf_life",     "Shelf Life (text)"),
      ...specCol("spec_notes",          "Spec Notes"),
      ...specCol("spec_origin",         "Origin"),
      ...specCol("spec_fat_content",    "Fat Content"),
      ...specCol("spec_protein",        "Protein"),
      ...specCol("spec_moisture",       "Moisture"),
      ...specCol("spec_ph",             "pH"),
      ...specCol("spec_water_activity", "Water Activity"),
      ...specCol("spec_micro",          "Spec Micro"),
      ...specCol("spec_packaging",      "Spec Packaging"),
      ...specCol("spec_labelling",      "Spec Labelling"),
      ...specCol("spec_weight_per_unit","Spec Wt/Unit"),

      // ── Microbiological limits cluster ──
      ...specCol("micro_tpc",                 "Micro: TPC"),
      ...specCol("micro_ecoli",               "Micro: E.coli"),
      ...specCol("micro_coliforms",           "Micro: Coliforms"),
      ...specCol("micro_salmonella",          "Micro: Salmonella"),
      ...specCol("micro_listeria",            "Micro: Listeria"),
      ...specCol("micro_s_aureus",            "Micro: S.aureus"),
      ...specCol("micro_yeast_mould",         "Micro: Yeast/Mould"),
      ...specCol("micro_sulphite_clostridia", "Micro: Sulphite Clos."),
      ...specCol("micro_reference",           "Micro: Reference"),

      // ── Nutrition (per 100g) cluster ──
      ...numCol("nut_energy_kj",        "Energy (kJ)"),
      ...numCol("nut_energy_kcal",      "Energy (kcal)"),
      ...numCol("nut_protein_g",        "Protein (g)"),
      ...numCol("nut_fat_total_g",      "Fat Total (g)"),
      ...numCol("nut_fat_saturated_g",  "Fat Sat (g)"),
      ...numCol("nut_fat_trans_g",      "Fat Trans (g)"),
      ...numCol("nut_carbs_total_g",    "Carbs (g)"),
      ...numCol("nut_carbs_sugars_g",   "Sugars (g)"),
      ...numCol("nut_fibre_g",          "Fibre (g)"),
      ...numCol("nut_sodium_mg",        "Sodium (mg)"),
      ...numCol("nut_per_serving_g",    "Serving (g)"),
      ...specCol("nut_notes",           "Nut Notes"),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [departments, categories, allergenDefs, isAdmin, selected]
  );

  // ── Smart-export column spec ────────────────────────────────────────────
  // Built from `columns` + the hidden-cols snapshot we mirror in
  // `hiddenColsSet`. Lives HERE (after `columns`) rather than next to
  // hiddenColsSet because the deps array reads `columns` and reading a
  // `const` before its declaration line is a TDZ error in production
  // (manifests as the minified "Cannot access 'ek' before initialization"
  // crash). Same render order = same behaviour, just placed correctly.
  const exportColumnSpecs: ExportColumnSpec[] = useMemo(() => {
    return columns
      .filter(c => c.key !== "_select" && !hiddenColsSet.has(c.key))
      .map(c => ({
        key: c.key,
        label: typeof c.label === "string" ? c.label : c.key,
        asYesNo:    c.editable?.type === "select" && c.editable.options?.some(o => o.value === "true" || o.value === "false"),
        asCommaJoin: c.editable?.type === "multiselect",
      }));
  }, [columns, hiddenColsSet]);

  // ── Selection helpers ────────────────────────────────────────────────────
  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allPageSelected) {
      setSelected(prev => { const n = new Set(prev); items.forEach(r => n.delete(r.id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); items.forEach(r => n.add(r.id)); return n; });
    }
  }

  async function bulkSetActive(isActive: boolean) {
    if (!confirm(`${isActive ? "Activate" : "Deactivate"} ${selected.size} item(s)?`)) return;
    setBulkWorking(true);
    const supabase = createClient();
    const { error } = await supabase.from("items").update({ is_active: isActive }).in("id", Array.from(selected));
    if (error) { alert(error.message); setBulkWorking(false); return; }
    invalidateItemsCache();
    setSelected(new Set());
    setBulkWorking(false);
    window.location.reload();
  }

  // ── Bulk save ────────────────────────────────────────────────────────────
  async function handleBulkSave(changes: { id: string; fields: Record<string, unknown> }[]): Promise<string | null> {
    const supabase = createClient();
    const errors: string[] = [];

    // Field-type registry — drives coercion. Anything not listed falls
    // through to text (the default in the loop). Add new fields here when
    // you add a numeric / integer / boolean column to the grid.
    const NUMERIC_FIELDS = new Set([
      "min_stock", "max_stock", "current_stock", "default_batch_size",
      "target_weight_g", "fill_weight_g", "process_loss_pct",
      "tare_weight_g", "tolerance_over_g", "tolerance_under_g",
      "giveaway_pct",
      "purchase_unit_price", "purchase_uom_qty", "sell_price_per_inner", "sell_price_per_kg",
      // Standard cost (admin-only edit). Setting it stamps the override
      // metadata via post-process below.
      "standard_cost",
      "nut_energy_kj", "nut_energy_kcal", "nut_protein_g", "nut_fat_total_g",
      "nut_fat_saturated_g", "nut_fat_trans_g", "nut_carbs_total_g", "nut_carbs_sugars_g",
      "nut_fibre_g", "nut_sodium_mg", "nut_per_serving_g",
    ]);
    // units_per_outer + units_per_pallet REMOVED — they're derived by DB trigger
    // from units_per_inner × inner_per_outer × outers_per_pallet (migration 060).
    const INTEGER_FIELDS = new Set([
      "units_per_inner", "inner_per_outer",
      "outers_per_pallet",
      "min_shelf_life_days",
    ]);
    const BOOLEAN_FIELDS = new Set([
      "is_active", "is_make_to_order", "is_rte", "consumed_in_weight",
    ]);
    const NULLABLE_TEXT_FIELDS = new Set([
      "item_category_id", "item_subcategory_id", "department", "production_method",
      "weight_mode", "procurement_type", "purchase_uom_type",
    ]);

    // Resolve current user once for the standard_cost override stamp.
    const { data: { user } } = await supabase.auth.getUser();

    await Promise.all(
      changes.map(async ({ id, fields }) => {
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (k === "allergens") {
            payload.allergens = Array.isArray(v) ? v : [];
          } else if (k === "priority") {
            payload[k] = v !== "" && v != null ? parseInt(String(v)) : 5;
          } else if (NUMERIC_FIELDS.has(k)) {
            payload[k] = v !== "" && v != null ? parseFloat(String(v)) : null;
          } else if (INTEGER_FIELDS.has(k)) {
            payload[k] = v !== "" && v != null ? parseInt(String(v), 10) : null;
          } else if (BOOLEAN_FIELDS.has(k)) {
            payload[k] = String(v) === "true";
          } else if (NULLABLE_TEXT_FIELDS.has(k)) {
            payload[k] = v || null;
          } else {
            // Default: text fields. Empty string → null so the DB doesn't
            // store empty strings for nullable spec/micro/notes columns.
            payload[k] = v === "" ? null : v;
          }
        }
        // Standard cost edit → stamp the override fields so v_item_cost_health
        // and audit can tell auto from manual. Clearing the value (null) also
        // clears the override stamp — caller is reverting to "auto".
        if ("standard_cost" in fields) {
          if (payload.standard_cost == null) {
            payload.standard_cost_override_by = null;
            payload.standard_cost_override_at = null;
          } else {
            payload.standard_cost_override_by = user?.id ?? null;
            payload.standard_cost_override_at = new Date().toISOString();
          }
        }
        const { error } = await supabase.from("items").update(payload).eq("id", id);
        if (error) errors.push(error.message);
      })
    );
    // Bust the client-side items cache so future renders fetch fresh, AND
    // force the currently-mounted query hook to re-fetch from the DB right
    // now. Without this, the local React state in useItemsQuery still holds
    // the pre-save snapshot until the user navigates or filters change —
    // which is what made saved values appear to "lag behind".
    invalidateItemsCache();
    refetchItems();
    return errors.length > 0 ? errors[0] : null;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 13rem)", minHeight: "400px" }}>

      {/* Heads-up banner — clicking a row opens the item detail in a sized
          popup. After saving changes there, the operator must refresh this
          list to see the updated values (popup writes don't auto-sync back). */}
      <div style={{
        padding: "0.5rem 1rem",
        background: "#eff6ff",
        borderBottom: "1px solid #dbeafe",
        fontSize: "0.75rem",
        color: "#1e3a8a",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span aria-hidden style={{ fontSize: "1rem" }}>↗</span>
        <span>
          Click any row to open the item in a new window. After saving changes there, refresh this tab with <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #93c5fd", borderRadius: "0.25rem", background: "#fff", fontFamily: "monospace", fontSize: "0.7rem" }}>Ctrl + F5</kbd> (or <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #93c5fd", borderRadius: "0.25rem", background: "#fff", fontFamily: "monospace", fontSize: "0.7rem" }}>Ctrl + Shift + R</kbd>) to pull the updated values.
        </span>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div style={{
        padding: "0.75rem 1rem",
        borderBottom: "1px solid #e7e5e4",
        display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap",
      }}>
        {/* 1. Item Number */}
        <input
          type="text"
          className="form-input"
          placeholder="Item number…"
          value={localCode}
          onChange={e => setLocalCode(e.target.value)}
          style={{ fontSize: "0.8125rem", minWidth: "130px", flex: "1 1 130px", maxWidth: "190px" }}
        />

        {/* 2. Name */}
        <input
          type="text"
          className="form-input"
          placeholder="Name…"
          value={localName}
          onChange={e => setLocalName(e.target.value)}
          style={{ fontSize: "0.8125rem", minWidth: "150px", flex: "2 1 150px", maxWidth: "260px" }}
        />

        {/* 3. Description */}
        <input
          type="text"
          className="form-input"
          placeholder="Description…"
          value={localDesc}
          onChange={e => setLocalDesc(e.target.value)}
          style={{ fontSize: "0.8125rem", minWidth: "150px", flex: "2 1 150px", maxWidth: "260px" }}
        />

        {/* 3. Type — multi-select. Tick multiple types to combine (e.g. WIP +
            Fill). Empty selection = "all types". The TYPE_TABS strip above
            still single-clicks to one type. */}
        <MultiSelectFilter
          label="All types"
          noun="type"
          options={TYPE_TABS.slice(1).map(t => ({ value: t.value, label: t.label }))}
          selectedValues={filterTypeIds}
          onChange={vals => pushFilters({ type: vals.join(",") })}
        />

        {/* 4. Category — multi-select. Selecting multiple categories also
            widens the subcategory dropdown to all subcategories under any of
            them. Clearing the category filter clears the subcategory filter
            too (otherwise we'd leave orphan subcategory IDs hanging in the URL). */}
        <MultiSelectFilter
          label="All categories"
          noun="category"
          options={categories.map(c => ({ value: c.id, label: c.name }))}
          selectedValues={filterCategoryIds}
          onChange={vals => {
            const ps = new URLSearchParams(searchParams.toString());
            if (vals.length > 0) ps.set("category", vals.join(","));
            else ps.delete("category");
            // When removing a category, drop subcategories that are no longer
            // valid under the remaining selected categories.
            if (vals.length === 0) {
              ps.delete("subcat");
            } else {
              const validSubcatIds = new Set(
                subcategories.filter(s => vals.includes(s.category_id)).map(s => s.id)
              );
              const keptSubcats = filterSubcatIds.filter(id => validSubcatIds.has(id));
              if (keptSubcats.length > 0) ps.set("subcat", keptSubcats.join(","));
              else ps.delete("subcat");
            }
            ps.delete("page");
            router.push(`/items?${ps.toString()}`);
          }}
        />

        {/* 5. Sub Category — multi-select, filtered to selected categories. */}
        {filteredSubcats.length > 0 && (
          <MultiSelectFilter
            label="All subcategories"
            noun="subcategory"
            options={filteredSubcats.map(s => ({ value: s.id, label: s.name }))}
            selectedValues={filterSubcatIds}
            onChange={vals => pushFilters({ subcat: vals.join(",") })}
          />
        )}

        {/* 6. Department — multi-select. Department is keyed by name (legacy)
            so we use the name as the value. */}
        <MultiSelectFilter
          label="All departments"
          noun="department"
          options={departments.map(d => ({ value: d.name, label: d.name }))}
          selectedValues={filterDeptNames}
          onChange={vals => pushFilters({ dept: vals.join(",") })}
        />

        {/* 7. Supplier multi-select */}
        {suppliers.length > 0 && (
          <div ref={supplierDdRef} style={{ position: "relative" }}>
            <button
              onClick={() => setShowSupplierDd(prev => !prev)}
              style={{
                fontSize: "0.8125rem",
                padding: "0.4375rem 0.75rem",
                border: `1px solid ${filterSupplierIds.length > 0 ? "#b91c1c" : "#d6d3d1"}`,
                borderRadius: "0.375rem",
                background: filterSupplierIds.length > 0 ? "#fef2f2" : "#fff",
                color: filterSupplierIds.length > 0 ? "#b91c1c" : "#57534e",
                cursor: "pointer",
                whiteSpace: "nowrap" as const,
                display: "flex", alignItems: "center", gap: "0.375rem",
              }}
            >
              {filterSupplierIds.length > 0
                ? `${filterSupplierIds.length} supplier${filterSupplierIds.length > 1 ? "s" : ""}`
                : "Supplier"}
              <span style={{ fontSize: "0.55rem", opacity: 0.5 }}>▼</span>
            </button>
            {showSupplierDd && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
                background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: "280px",
                display: "flex", flexDirection: "column", maxHeight: "360px",
              }}>
                {/* Search box — sticky at top so the operator can keep typing
                    while the list scrolls underneath. */}
                <div style={{ padding: "0.5rem", borderBottom: "1px solid #f5f5f4", background: "#fafaf9" }}>
                  <input
                    type="text"
                    autoFocus
                    value={supplierSearch}
                    onChange={e => setSupplierSearch(e.target.value)}
                    placeholder="Type to filter suppliers…"
                    style={{
                      width: "100%", padding: "0.4rem 0.6rem",
                      border: "1px solid #d6d3d1", borderRadius: "0.25rem",
                      fontSize: "0.8125rem", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
                {filterSupplierIds.length > 0 && (
                  <div style={{ padding: "0.375rem 0.75rem", borderBottom: "1px solid #f5f5f4" }}>
                    <button
                      onClick={() => { pushFilters({ suppliers: "" }); setShowSupplierDd(false); setSupplierSearch(""); }}
                      style={{ fontSize: "0.75rem", color: "#b91c1c", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {(() => {
                    const q = supplierSearch.trim().toLowerCase();
                    const filtered = q
                      ? suppliers.filter(s =>
                          s.name.toLowerCase().includes(q)
                          || (s.code ?? "").toLowerCase().includes(q)
                        )
                      : suppliers;
                    if (filtered.length === 0) {
                      return (
                        <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic", textAlign: "center" }}>
                          No matches
                        </div>
                      );
                    }
                    return filtered.map(s => (
                      <label
                        key={s.id}
                        style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.75rem", cursor: "pointer", borderBottom: "1px solid #fafaf9" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <input
                          type="checkbox"
                          checked={filterSupplierIds.includes(s.id)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...filterSupplierIds, s.id]
                              : filterSupplierIds.filter(sid => sid !== s.id);
                            pushFilters({ suppliers: next.join(",") });
                          }}
                          style={{ cursor: "pointer", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: "0.8125rem", color: "#292524" }}>{s.name}</span>
                        {s.code && (
                          <span style={{ fontSize: "0.75rem", color: "#a8a29e", fontFamily: "monospace", marginLeft: "auto" }}>{s.code}</span>
                        )}
                      </label>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active / Inactive / Both — three-state toggle.
            Default 'active' so inactive items never sneak into the default
            view; operator clicks to cycle. Stored in URL (?status=) so the
            choice survives page reloads + can be linked to. */}
        {(() => {
          const next: Record<typeof activeStatusFilter, typeof activeStatusFilter> = {
            active:   "inactive",
            inactive: "both",
            both:     "active",
          };
          const labelMap: Record<typeof activeStatusFilter, { text: string; bg: string; color: string; border: string }> = {
            active:   { text: "Active only",   bg: "#f0fdf4", color: "#166534", border: "#86efac" },
            inactive: { text: "Inactive only", bg: "#f5f5f4", color: "#57534e", border: "#d6d3d1" },
            both:     { text: "Active + Inactive", bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
          };
          const cur = labelMap[activeStatusFilter];
          return (
            <button
              type="button"
              onClick={() => pushFilters({ status: next[activeStatusFilter] })}
              title="Click to cycle: Active only → Inactive only → Both"
              style={{
                fontSize: "0.8125rem", padding: "0.4rem 0.75rem",
                background: cur.bg, color: cur.color, border: `1px solid ${cur.border}`,
                borderRadius: "0.375rem", cursor: "pointer", whiteSpace: "nowrap" as const,
                fontWeight: 600,
              }}
            >
              {cur.text}
            </button>
          );
        })()}

        {/* Clear all filters */}
        {hasFilters && (
          <button
            onClick={clearAllFilters}
            className="btn-secondary"
            style={{ fontSize: "0.8125rem", color: "#b91c1c", borderColor: "#fca5a5", whiteSpace: "nowrap" as const }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Type tabs (3.) ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 0, overflowX: "auto",
        borderBottom: "1px solid #e7e5e4", padding: "0 0.5rem",
      }}>
        {TYPE_TABS.map(tab => {
          // Counts are tenant-wide totals (NOT filtered) so the user always sees
          // how many items exist of each type, regardless of search/filter state.
          const allCount = Object.values(typeCounts).reduce((a, b) => a + b, 0);
          const count = tab.value === "all" ? allCount : (typeCounts[tab.value] ?? 0);
          const isActive = activeType === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => pushFilters({ type: tab.value === "all" ? "" : tab.value })}
              style={{
                padding: "0.625rem 0.875rem",
                border: "none", background: "none", cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#b91c1c" : "#78716c",
                borderBottom: isActive ? "2px solid #b91c1c" : "2px solid transparent",
                whiteSpace: "nowrap" as const,
                flexShrink: 0,
              }}
            >
              {tab.label}
              {count > 0 && (
                <span style={{
                  marginLeft: "0.375rem", fontSize: "0.75rem",
                  color: isActive ? "#b91c1c" : "#a8a29e",
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Count + bulk actions row ────────────────────────────────────── */}
      <div style={{
        padding: "0.5rem 1rem",
        borderBottom: someSelected ? "1px solid #e7e5e4" : "none",
        display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
        minHeight: "2.25rem",
      }}>
        {/* "Select page" — moved to the LEFT (was on the right via
            marginLeft:auto). Sits at the top-left so it visually aligns
            with the row-checkbox column underneath. Operators kept asking
            "where do I select all?" because they were hunting on the
            right side. */}
        {isAdmin && items.length > 0 && (
          <label style={{
            display: "flex", alignItems: "center", gap: "0.375rem",
            fontSize: "0.8125rem", color: "#78716c", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={toggleAll}
              style={{ cursor: "pointer" }}
            />
            Select page
          </label>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#78716c", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          {totalCount === 0
            ? "No items match your filters"
            : `${displayFrom}–${displayTo} of ${totalCount} item${totalCount !== 1 ? "s" : ""}`}
          {itemsFetching && (
            <span style={{ fontSize: "0.6875rem", color: "#a8a29e", fontStyle: "italic" }}>refreshing…</span>
          )}
        </span>
        {isAdmin && someSelected && (
          <>
            <span style={{ fontSize: "0.8125rem", color: "#57534e", fontWeight: 500 }}>
              {selected.size} selected
            </span>
            <button onClick={() => bulkSetActive(true)} disabled={bulkWorking} className="btn-secondary" style={{ fontSize: "0.75rem" }}>
              Activate
            </button>
            <button onClick={() => bulkSetActive(false)} disabled={bulkWorking} className="btn-secondary" style={{ fontSize: "0.75rem" }}>
              Deactivate
            </button>
            <button onClick={() => setSelected(new Set())} className="btn-secondary" style={{ fontSize: "0.75rem" }}>
              Clear selection
            </button>
          </>
        )}
        {/* Smart export — right-aligned via marginLeft:auto. Filter-aware,
            selection-aware, uses the items grid's currently visible columns.
            Replaces the standalone Export button that used to live in the
            page header (page.tsx ItemExportImport now hides its export
            button when this one is in scope). */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <ItemsExportButton
            visibleColumns={exportColumnSpecs}
            selectedIds={selected}
            selectedCount={selected.size}
            totalFiltered={totalCount}
            hasActiveFilters={
              !!searchParams.get("code") || !!searchParams.get("name") || !!searchParams.get("desc")
              || !!searchParams.get("type") || !!searchParams.get("category") || !!searchParams.get("subcat")
              || !!searchParams.get("dept") || !!searchParams.get("suppliers")
              || (searchParams.get("status") ?? "active") !== "active"
            }
          />
        </div>
        {/* hidden — kept for backward compat (placeholder) */}
        {false && (
          <label style={{
            display: "flex", alignItems: "center", gap: "0.375rem",
            fontSize: "0.8125rem", color: "#78716c", cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={toggleAll}
              style={{ cursor: "pointer" }}
            />
            Select page
          </label>
        )}
      </div>

      {/* ── Data table ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <DataTable
          columns={columns}
          data={items}
          onRowClick={row => {
            // Stash the current list URL so the item-detail page's BackButton
            // (rememberKey="items.lastListUrl") returns to the same filtered
            // view if the popup is closed via in-page navigation.
            try {
              const qs = searchParams.toString();
              sessionStorage.setItem("items.lastListUrl", qs ? `/items?${qs}` : "/items");
            } catch { /* ignore */ }
            // Open in a sized popup window (75% × 85% of screen) so the list
            // stays put. Operator edits the item there, closes the window,
            // then refreshes the list (Ctrl+F5) to see the new values. The
            // banner above the filter row reminds them to do this.
            openItemInPopup(row.id);
          }}
          onBulkSave={isAdmin ? handleBulkSave : undefined}
          emptyMessage="No items match your filters."
          stickyHeader
          // Persist the user's column layout (visibility + widths) so the
          // grid keeps showing whatever cluster they're working on between
          // sessions. Reset link in the column popover wipes it.
          storageKey="items.v1"
          // Below-cheapest red-line: when an admin override has pushed the
          // standard cost below the cheapest supplier price, the row is
          // tinted faded-red so the operator can spot + fix it. The flag
          // comes from v_item_cost_health joined in useItemsQuery.
          rowStyle={(row) => row.is_below_cheapest
            ? { background: "rgba(254, 226, 226, 0.65)" }
            : undefined}
        />
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{
          padding: "0.625rem 1rem",
          borderTop: "1px solid #e7e5e4",
          display: "flex", alignItems: "center", gap: "0.25rem",
          flexWrap: "wrap", justifyContent: "center",
        }}>
          <button
            onClick={() => goToPage(1)}
            disabled={currentPage === 1}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >«</button>
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >‹</button>

          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let page: number;
            if (totalPages <= 7) {
              page = i + 1;
            } else if (currentPage <= 4) {
              page = i + 1;
            } else if (currentPage >= totalPages - 3) {
              page = totalPages - 6 + i;
            } else {
              page = currentPage - 3 
            }
            return (
              <button
                key={page}
                onClick={() => goToPage(page)}
                className={currentPage === page ? "btn-primary" : "btn-secondary"}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", minWidth: "2rem" }}
              >
                {page}
              </button>
            );
          })}

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >›</button>
          <button
            onClick={() => goToPage(totalPages)}
            disabled={currentPage === totalPages}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >»</button>
          <span style={{ fontSize: "0.75rem", color: "#a8a29e", marginLeft: "0.5rem" }}>
            Page {currentPage} of {totalPages}
          </span>
        </div>
      )}
    </div>
  );
}
