"use client";

/**
 * Purchasing dashboard — multi-view hub.
 *
 *   1. Need now              — what to order, grouped by supplier (default tab)
 *   2. Order by item         — one row per item, total qty, click to split across suppliers
 *   3. Stock vs min / max    — safety-stock view
 *   4. Open POs              — links to existing /purchase-orders list
 *   5. Forecast (12 weeks)   — placeholder, needs usage-history view
 *   6. Supplier scorecard    — placeholder, needs delivery-date data
 *
 * Filters cascade across all 5 tabs (CascadingFilters component) — the chips
 * on each filter dimension reflect the rows that survived the OTHER filters.
 *
 * Click any row in any tab → QuickFix modal (stock / min / max / cost /
 * default supplier). Save closes modal, restores scroll Y.
 *
 * "Order by item" → click row → SplitOrderModal — accept primary supplier,
 * split across multiple, or +Add new supplier inline. Saves to po_drafts
 * via server actions for persistence.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import { DataTable, type ColumnDef } from "@/components/data-table";
import QuickFixModal from "./quick-fix-modal";
import SplitOrderModal from "./split-order-modal";
import { removeDraftLine, clearDraft, submitDraft } from "../actions";

// ─── Shared types (also exported for page.tsx) ───────────────
export type SupplierLink = {
  supplier_link_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_item_code: string | null;
  supplier_item_name: string | null;
  unit_price: number;
  currency: string;
  lead_time_days: number | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  min_order_qty: number | null;
  is_preferred: boolean;
  notes: string | null;
};

export type SupplierOption = {
  id: string; name: string; code: string | null;
};

export type DraftLine = {
  id: string;
  item_id: string;
  supplier_id: string;
  qty: number;
  unit: string;
  unit_price: number | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  notes: string | null;
};

export type NeedNowRow = {
  id: string; code: string; name: string; item_type: string; unit: string;
  current_stock: number; min_stock: number; max_stock: number;
  department: string | null;
  effective_cost: number;
  standard_cost: number | null;
  needed_orders: number;
  needed_plan: number;
  open_order_count: number;
  gap: number;
  recommended_qty: number;
  supplier_id: string | null;
  supplier_name: string | null;
  lead_time_days: number | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  unit_price: number | null;
  is_preferred: boolean;
  // Derived for convenience inside DataTable cells
  cost_per_consume: number;
  line_cost: number;
  // ALL supplier_items linked to this item (for the split modal)
  supplier_links: SupplierLink[];
};

type Tab = "need-now" | "by-item" | "stock" | "open-pos" | "forecast" | "scorecard";
type StockState = "all" | "low" | "ok" | "empty" | "over";
type LeadBucket = "all" | "fast" | "med" | "slow" | "unknown";

const TABS: { id: Tab; label: string }[] = [
  { id: "need-now",  label: "Need now" },
  { id: "by-item",   label: "Order by item" },
  { id: "stock",     label: "Stock vs min/max" },
  { id: "open-pos",  label: "Open POs" },
  { id: "forecast",  label: "Forecast" },
  { id: "scorecard", label: "Supplier scorecard" },
];

function fmt(n: number, dec = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtMoney(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Top-level wrapper ───────────────────────────────────────
export default function PurchasingHub({
  activeTab, rows, latestPlan, departments, suppliers, draftLines,
}: {
  activeTab: Tab;
  rows: NeedNowRow[];
  latestPlan: { id: string; week_start: string; status: string } | null;
  departments: string[];
  suppliers: SupplierOption[];
  draftLines: DraftLine[];
}) {
  // QuickFix modal state shared across tabs
  const [quickFixRow, setQuickFixRow] = useState<NeedNowRow | null>(null);
  const scrollYRef = useRef<number>(0);

  function openQuickFix(r: NeedNowRow) {
    scrollYRef.current = window.scrollY;
    setQuickFixRow(r);
  }
  function closeQuickFix() {
    setQuickFixRow(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollYRef.current));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchasing</h1>
          <p className="page-subtitle">
            What to buy, when, from whom — driven from production orders + demand plan.
          </p>
        </div>
        <Link href="/purchase-orders/new" className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New PO
        </Link>
      </div>

      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.25rem", borderBottom: "1px solid #e7e5e4" }}>
        {TABS.map(t => {
          const active = t.id === activeTab;
          return (
            <Link
              key={t.id}
              href={`/purchasing?tab=${t.id}`}
              style={{
                padding: "0.625rem 0.875rem",
                background: active ? "white" : "transparent",
                color: active ? "#1c1917" : "#78716c",
                border: "1px solid",
                borderColor: active ? "#e7e5e4" : "transparent",
                borderBottomColor: active ? "white" : "transparent",
                marginBottom: "-1px",
                borderRadius: "0.375rem 0.375rem 0 0",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: active ? 600 : 500,
              }}
            >{t.label}</Link>
          );
        })}
      </div>

      {activeTab === "need-now"  && <NeedNowTab rows={rows} latestPlan={latestPlan} departments={departments} suppliers={suppliers} draftLines={draftLines} onRowClick={openQuickFix} />}
      {activeTab === "by-item"   && <OrderByItemTab rows={rows} departments={departments} suppliers={suppliers} draftLines={draftLines} onRowClick={openQuickFix} />}
      {activeTab === "stock"     && <StockTab rows={rows} departments={departments} suppliers={suppliers} onRowClick={openQuickFix} />}
      {activeTab === "open-pos"  && <OpenPOsTab />}
      {activeTab === "forecast"  && <PlaceholderTab title="Forecast (12 weeks)" body="Coming next: weekly stock projection per item — today's stock, minus average usage, plus expected PO arrivals. Shows when each item runs out and how many weeks of cover you have." />}
      {activeTab === "scorecard" && <PlaceholderTab title="Supplier scorecard" body="Coming later: per supplier — lead-time accuracy, price-change history, on-time delivery %, fill rate. Needs delivery-date data on goods-in receipts which we'll capture once scanning is wired." />}

      {quickFixRow && <QuickFixModal row={quickFixRow} suppliers={suppliers} onClose={closeQuickFix} />}

      {/* Draft cart bar — sticky at bottom whenever there are lines */}
      {draftLines.length > 0 && <DraftCartBar lines={draftLines} rows={rows} suppliers={suppliers} />}
    </div>
  );
}

// ─── Cascading-filters hook ──────────────────────────────────
function useCascadingFilters(rows: NeedNowRow[], opts: { allowEmptyOnGap?: boolean; defaultGapOnly?: boolean } = {}) {
  const [search, setSearch]                   = useState("");
  const [showOnlyGap, setShowOnlyGap]         = useState(opts.defaultGapOnly ?? true);
  const [typeFilter, setTypeFilter]           = useState<Set<string>>(new Set());
  const [deptFilter, setDeptFilter]           = useState<Set<string>>(new Set());
  const [supFilter,  setSupFilter]            = useState<Set<string>>(new Set());
  const [stockState, setStockState]           = useState<StockState>("all");
  const [leadBucket, setLeadBucket]           = useState<LeadBucket>("all");
  const [noSupplierOnly, setNoSupplierOnly]   = useState(false);

  function predicate(r: NeedNowRow, except: "type"|"dept"|"sup"|"stock"|"lead"|"none"): boolean {
    const q = search.trim().toLowerCase();
    if (q && !r.code.toLowerCase().includes(q)
         && !r.name.toLowerCase().includes(q)
         && !(r.supplier_name ?? "").toLowerCase().includes(q)
         && !r.supplier_links.some(s => (s.supplier_item_code ?? "").toLowerCase().includes(q) || (s.supplier_item_name ?? "").toLowerCase().includes(q))) return false;

    if (showOnlyGap && r.gap <= 0 && !opts.allowEmptyOnGap) return false;
    if (noSupplierOnly && r.supplier_id) return false;

    if (except !== "type" && typeFilter.size > 0 && !typeFilter.has(r.item_type)) return false;
    if (except !== "dept" && deptFilter.size > 0 && !deptFilter.has(r.department ?? "")) return false;
    if (except !== "sup"  && supFilter.size > 0  && !(r.supplier_id && supFilter.has(r.supplier_id))) return false;

    if (except !== "stock") {
      if (stockState === "low"   && !(r.min_stock > 0 && r.current_stock <= r.min_stock && r.current_stock > 0)) return false;
      if (stockState === "ok"    && !(r.current_stock > r.min_stock && r.current_stock <= (r.max_stock || Infinity))) return false;
      if (stockState === "empty" && !(r.current_stock <= 0)) return false;
      if (stockState === "over"  && !(r.max_stock > 0 && r.current_stock > r.max_stock)) return false;
    }
    if (except !== "lead") {
      const lt = r.lead_time_days;
      if (leadBucket === "fast" && !(lt != null && lt <= 2)) return false;
      if (leadBucket === "med"  && !(lt != null && lt > 2 && lt <= 7)) return false;
      if (leadBucket === "slow" && !(lt != null && lt > 7)) return false;
      if (leadBucket === "unknown" && lt != null) return false;
    }
    return true;
  }

  const filtered = useMemo(() => rows.filter(r => predicate(r, "none")), [rows, search, showOnlyGap, typeFilter, deptFilter, supFilter, stockState, leadBucket, noSupplierOnly, opts.allowEmptyOnGap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cascading counts — count for each chip ignoring its OWN dimension
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (predicate(r, "type")) m.set(r.item_type, (m.get(r.item_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, search, showOnlyGap, deptFilter, supFilter, stockState, leadBucket, noSupplierOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const deptCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (predicate(r, "dept") && r.department) m.set(r.department, (m.get(r.department) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, search, showOnlyGap, typeFilter, supFilter, stockState, leadBucket, noSupplierOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const supCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (predicate(r, "sup") && r.supplier_id) m.set(r.supplier_id, (m.get(r.supplier_id) ?? 0) + 1);
    return m;
  }, [rows, search, showOnlyGap, typeFilter, deptFilter, stockState, leadBucket, noSupplierOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const stateCounts = useMemo(() => {
    let all = 0, low = 0, ok = 0, empty = 0, over = 0;
    for (const r of rows) {
      if (!predicate(r, "stock")) continue;
      all++;
      if (r.current_stock <= 0) empty++;
      else if (r.min_stock > 0 && r.current_stock <= r.min_stock) low++;
      else if (r.max_stock > 0 && r.current_stock > r.max_stock) over++;
      else ok++;
    }
    return { all, low, ok, empty, over };
  }, [rows, search, showOnlyGap, typeFilter, deptFilter, supFilter, leadBucket, noSupplierOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const leadCounts = useMemo(() => {
    let fast = 0, med = 0, slow = 0, unknown = 0;
    for (const r of rows) {
      if (!predicate(r, "lead")) continue;
      const lt = r.lead_time_days;
      if (lt == null) unknown++;
      else if (lt <= 2) fast++;
      else if (lt <= 7) med++;
      else slow++;
    }
    return { fast, med, slow, unknown };
  }, [rows, search, showOnlyGap, typeFilter, deptFilter, supFilter, stockState, noSupplierOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearAll() {
    setSearch(""); setTypeFilter(new Set()); setDeptFilter(new Set()); setSupFilter(new Set());
    setStockState("all"); setLeadBucket("all"); setNoSupplierOnly(false);
  }
  const isFiltered = !!(search.trim() || typeFilter.size || deptFilter.size || supFilter.size || stockState !== "all" || leadBucket !== "all" || noSupplierOnly);

  return {
    filtered,
    state: { search, showOnlyGap, typeFilter, deptFilter, supFilter, stockState, leadBucket, noSupplierOnly, isFiltered },
    setters: { setSearch, setShowOnlyGap, setTypeFilter, setDeptFilter, setSupFilter, setStockState, setLeadBucket, setNoSupplierOnly },
    counts: { type: typeCounts, dept: deptCounts, sup: supCounts, state: stateCounts, lead: leadCounts },
    clearAll,
  };
}

// ─── Reusable filter strip UI ────────────────────────────────
function CascadingFilters({
  state, setters, counts, clearAll, suppliers, showGapToggle = true,
}: {
  state: ReturnType<typeof useCascadingFilters>["state"];
  setters: ReturnType<typeof useCascadingFilters>["setters"];
  counts: ReturnType<typeof useCascadingFilters>["counts"];
  clearAll: () => void;
  suppliers: SupplierOption[];
  showGapToggle?: boolean;
}) {
  const stockOpts: { val: StockState; label: string; count: number }[] = [
    { val: "all",   label: "All",   count: counts.state.all },
    { val: "low",   label: "Low",   count: counts.state.low },
    { val: "ok",    label: "OK",    count: counts.state.ok },
    { val: "empty", label: "Empty", count: counts.state.empty },
    { val: "over",  label: "Over",  count: counts.state.over },
  ];
  const leadOpts: { val: LeadBucket; label: string; count: number }[] = [
    { val: "all",     label: "Any lead",  count: 0 },
    { val: "fast",    label: "≤2d",       count: counts.lead.fast },
    { val: "med",     label: "3-7d",      count: counts.lead.med },
    { val: "slow",    label: ">7d",       count: counts.lead.slow },
    { val: "unknown", label: "Unknown",   count: counts.lead.unknown },
  ];

  function toggleSetMember<T>(setter: (s: Set<T>) => void, current: Set<T>, value: T) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  }

  return (
    <div style={{ background: "white", border: "1px solid #e7e5e4", borderRadius: "0.625rem", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", gap: "0.625rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text" placeholder="Search code, item name, supplier name, supplier SKU…"
          value={state.search}
          onChange={e => setters.setSearch(e.target.value)}
          style={{ minWidth: "260px", flex: "0 1 360px", padding: "0.4rem 0.625rem", border: "1px solid #cfc9bf", borderRadius: "0.375rem", fontSize: "0.8125rem", fontFamily: "inherit" }}
        />
        {showGapToggle && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8125rem", color: "#57534e", cursor: "pointer" }}>
            <input type="checkbox" checked={state.showOnlyGap} onChange={e => setters.setShowOnlyGap(e.target.checked)} />
            Only show items with a gap
          </label>
        )}
        <PillGroup
          label=""
          options={stockOpts}
          value={state.stockState}
          onChange={(v) => setters.setStockState(v)}
        />
        {state.isFiltered && (
          <button
            type="button" onClick={clearAll}
            style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "0.375rem", padding: "0.3rem 0.625rem", fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit" }}
          >Clear filters</button>
        )}
      </div>

      {counts.type.length > 0 && (
        <div style={{ marginTop: "0.625rem", display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={lblTiny}>Type</span>
          {counts.type.map(([type, count]) => (
            <Chip key={type} label={ITEM_TYPE_LABELS[type as ItemType] ?? type} count={count}
              active={state.typeFilter.has(type)}
              onClick={() => toggleSetMember(setters.setTypeFilter, state.typeFilter, type)} />
          ))}
        </div>
      )}

      {counts.dept.length > 0 && (
        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={lblTiny}>Department</span>
          {counts.dept.map(([dept, count]) => (
            <Chip key={dept} label={dept} count={count}
              active={state.deptFilter.has(dept)}
              onClick={() => toggleSetMember(setters.setDeptFilter, state.deptFilter, dept)} />
          ))}
        </div>
      )}

      {/* Supplier multi-select dropdown (collapsed) */}
      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={lblTiny}>Suppliers</span>
        <SupplierFilterDropdown
          suppliers={suppliers}
          counts={counts.sup}
          selected={state.supFilter}
          onChange={(s) => setters.setSupFilter(s)}
        />
        <span style={lblTiny}>Lead time</span>
        {leadOpts.map(o => (
          <Chip key={o.val} label={o.label} count={o.val === "all" ? undefined : o.count}
            active={state.leadBucket === o.val}
            onClick={() => setters.setLeadBucket(o.val)} />
        ))}
      </div>
    </div>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        padding: "0.25rem 0.5rem",
        border: `1px solid ${active ? "#b91c1c" : "#e7e5e4"}`,
        background: active ? "#fef2f2" : "white",
        borderRadius: "999px", cursor: "pointer", fontFamily: "inherit",
        fontSize: "0.6875rem", fontWeight: 500,
        color: active ? "#b91c1c" : "#57534e",
      }}
    >
      {active && "✓ "}{label}
      {count != null && <span style={{ opacity: 0.6, marginLeft: "0.25rem" }}>{count}</span>}
    </button>
  );
}

function PillGroup<T extends string>({ options, value, onChange }: { label: string; options: { val: T; label: string; count: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: "2px", padding: "2px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem" }}>
      {options.map(o => (
        <button
          key={o.val}
          type="button"
          onClick={() => onChange(o.val)}
          style={{
            padding: "0.3rem 0.625rem", border: 0, cursor: "pointer", fontFamily: "inherit",
            fontSize: "0.7rem", fontWeight: 500,
            background: value === o.val ? "#1c1917" : "transparent",
            color: value === o.val ? "white" : "#57534e",
            borderRadius: "0.375rem",
          }}
        >{o.label} <span style={{ opacity: 0.6, marginLeft: "0.2rem" }}>{o.count}</span></button>
      ))}
    </div>
  );
}

function SupplierFilterDropdown({ suppliers, counts, selected, onChange }: {
  suppliers: SupplierOption[]; counts: Map<string, number>; selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState<"count" | "az">("count");
  const [search, setSearch] = useState("");

  const ordered = useMemo(() => {
    const list = [...suppliers];
    if (sortBy === "count") {
      list.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return list.filter(s => s.name.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [suppliers, counts, sortBy, search]);

  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ ...btnSelect, background: selected.size > 0 ? "#fef2f2" : "white", borderColor: selected.size > 0 ? "#b91c1c" : "#cfc9bf", color: selected.size > 0 ? "#b91c1c" : "#57534e" }}>
        {selected.size > 0 ? `${selected.size} supplier${selected.size === 1 ? "" : "s"} selected` : "All suppliers"} ▾
      </button>
      {open && (
        <div onMouseLeave={() => setOpen(false)} style={{ position: "absolute", zIndex: 5, top: "calc(100% + 0.25rem)", left: 0, background: "white", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "0.4rem", minWidth: "320px", maxHeight: "360px", overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.08)" }}>
          <input
            type="text" placeholder="Filter suppliers…" value={search}
            onChange={e => setSearch(e.target.value)} autoFocus
            style={{ width: "100%", padding: "0.3rem 0.5rem", border: "1px solid #cfc9bf", borderRadius: "0.375rem", fontSize: "0.75rem", marginBottom: "0.4rem", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <div style={{ display: "inline-flex", gap: "2px", padding: "2px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem" }}>
              <button type="button" onClick={() => setSortBy("count")}
                style={{ padding: "0.2rem 0.45rem", border: 0, cursor: "pointer", fontSize: "0.65rem", fontFamily: "inherit", background: sortBy === "count" ? "#1c1917" : "transparent", color: sortBy === "count" ? "white" : "#57534e", borderRadius: "0.25rem" }}>By items</button>
              <button type="button" onClick={() => setSortBy("az")}
                style={{ padding: "0.2rem 0.45rem", border: 0, cursor: "pointer", fontSize: "0.65rem", fontFamily: "inherit", background: sortBy === "az" ? "#1c1917" : "transparent", color: sortBy === "az" ? "white" : "#57534e", borderRadius: "0.25rem" }}>A-Z</button>
            </div>
            {selected.size > 0 && (
              <button type="button" onClick={() => onChange(new Set())} style={{ background: "transparent", border: 0, color: "#dc2626", cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}>Clear</button>
            )}
          </div>
          {ordered.map(s => {
            const c = counts.get(s.id) ?? 0;
            const checked = selected.has(s.id);
            return (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.4rem", fontSize: "0.8125rem", cursor: c > 0 ? "pointer" : "not-allowed", opacity: c > 0 ? 1 : 0.4, borderRadius: "0.25rem" }}>
                <input type="checkbox" checked={checked} disabled={c === 0}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                    onChange(next);
                  }} />
                <span style={{ flex: 1 }}>{s.name}</span>
                <span style={{ color: "#a8a29e", fontSize: "0.7rem" }}>{c}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Need-now columns ────────────────────────────────────────
function buildNeedNowColumns(): ColumnDef<NeedNowRow>[] {
  return [
    {
      key: "code", label: "Code", width: 110, sortable: true,
      render: v => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{String(v)}</span>,
    },
    {
      key: "name", label: "Item", width: 280, sortable: true,
      render: (v, row) => (
        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ color: "#1c1917", fontWeight: 500 }}>{String(v)}</span>
          <span className={`badge ${ITEM_TYPE_COLORS[row.item_type as ItemType] ?? "badge-gray"}`} style={{ fontSize: "0.6rem" }}>
            {ITEM_TYPE_LABELS[row.item_type as ItemType] ?? row.item_type}
          </span>
        </span>
      ),
    },
    {
      key: "current_stock", label: "Stock", width: 110, sortable: true,
      render: (v, row) => (
        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: row.current_stock <= 0 ? "#dc2626" : "#1c1917" }}>
          {fmt(Number(v ?? 0), 2)} {row.unit}
        </span>
      ),
    },
    {
      key: "min_stock", label: "Min/Max", width: 110, sortable: true,
      render: (_v, row) => (
        row.min_stock > 0 || row.max_stock > 0
          ? <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{fmt(row.min_stock, 0)} / {fmt(row.max_stock, 0)}</span>
          : <span style={{ color: "#a8a29e" }}>—</span>
      ),
    },
    {
      key: "needed_orders", label: "Need (orders)", width: 130, sortable: true,
      render: (v, row) => {
        const val = Number(v ?? 0);
        return val > 0
          ? <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
              {fmt(val, 2)}
              {row.open_order_count > 0 && <span style={{ color: "#78716c", fontSize: "0.65rem", marginLeft: "0.25rem" }}>· {row.open_order_count} PO{row.open_order_count === 1 ? "" : "s"}</span>}
            </span>
          : <span style={{ color: "#a8a29e" }}>—</span>;
      },
    },
    {
      key: "needed_plan", label: "Need (plan)", width: 110, sortable: true,
      render: (v) => Number(v ?? 0) > 0
        ? <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{fmt(Number(v), 2)}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
    },
    {
      key: "gap", label: "Gap", width: 100, sortable: true,
      render: (v) => Number(v ?? 0) > 0
        ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: 700, color: "#dc2626" }}>{fmt(Number(v), 2)}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
    },
    {
      key: "recommended_qty", label: "Order qty", width: 140, sortable: true,
      render: (v, row) => {
        const val = Number(v ?? 0);
        if (val <= 0) return <span style={{ color: "#a8a29e" }}>—</span>;
        return (
          <span>
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: 600 }}>
              {fmt(val, 2)} {row.unit}
            </span>
            {row.purchase_uom && row.purchase_uom_qty && row.purchase_uom !== row.unit && (
              <span style={{ display: "block", color: "#78716c", fontSize: "0.65rem" }}>
                = {fmt(val / row.purchase_uom_qty, 2)} {row.purchase_uom}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "lead_time_days", label: "Lead", width: 70, sortable: true,
      render: v => v != null ? <span style={{ fontSize: "0.75rem", color: "#78716c" }}>{Number(v)}d</span> : <span style={{ color: "#a8a29e" }}>—</span>,
    },
    {
      key: "line_cost", label: "Line $", width: 110, sortable: true,
      render: (v) => Number(v ?? 0) > 0
        ? <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 500 }}>{fmtMoney(Number(v))}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
    },
  ];
}

// ─── Tab 1: Need now ─────────────────────────────────────────
function NeedNowTab({ rows, latestPlan, departments, suppliers, draftLines, onRowClick }: {
  rows: NeedNowRow[];
  latestPlan: { id: string; week_start: string; status: string } | null;
  departments: string[];
  suppliers: SupplierOption[];
  draftLines: DraftLine[];
  onRowClick: (r: NeedNowRow) => void;
}) {
  const f = useCascadingFilters(rows, { defaultGapOnly: true });

  const draftByItem = useMemo(() => {
    const m = new Map<string, DraftLine[]>();
    for (const l of draftLines) {
      const list = m.get(l.item_id) ?? [];
      list.push(l);
      m.set(l.item_id, list);
    }
    return m;
  }, [draftLines]);

  // Build display rows: when an item has draft lines, expand it into one row
  // per cart supplier (with the cart qty + cart cost), so each supplier card
  // reflects what the operator has actually planned. Items without cart lines
  // keep their primary-supplier row as before.
  const displayRows = useMemo(() => {
    const out: NeedNowRow[] = [];
    for (const r of f.filtered) {
      const cart = draftByItem.get(r.id) ?? [];
      if (cart.length === 0) { out.push(r); continue; }
      for (const l of cart) {
        const link = r.supplier_links.find(s => s.supplier_id === l.supplier_id);
        const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
        const perBase = (l.unit_price ?? link?.unit_price ?? 0) / pack;
        out.push({
          ...r,
          supplier_id:        l.supplier_id,
          supplier_name:      link?.supplier_name ?? "—",
          lead_time_days:     link?.lead_time_days ?? null,
          purchase_uom:       l.purchase_uom ?? link?.purchase_uom ?? null,
          purchase_uom_qty:   l.purchase_uom_qty ?? link?.purchase_uom_qty ?? null,
          unit_price:         l.unit_price ?? link?.unit_price ?? null,
          is_preferred:       link?.is_preferred ?? false,
          recommended_qty:    l.qty,
          cost_per_consume:   perBase,
          line_cost:          l.qty * perBase,
        });
      }
    }
    return out;
  }, [f.filtered, draftByItem]);

  // Group by supplier
  const grouped = useMemo(() => {
    const m = new Map<string, { supplier_id: string | null; supplier_name: string; rows: NeedNowRow[]; total_cost: number; from_cart: boolean }>();
    for (const r of displayRows) {
      const key = r.supplier_id ?? "_no_supplier";
      const fromCart = (draftByItem.get(r.id)?.length ?? 0) > 0;
      const cur = m.get(key) ?? {
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name ?? "(no supplier linked)",
        rows: [], total_cost: 0,
        from_cart: false,
      };
      cur.rows.push(r);
      cur.total_cost += r.line_cost;
      cur.from_cart = cur.from_cart || fromCart;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => {
      if (!a.supplier_id && b.supplier_id) return -1;
      if (a.supplier_id && !b.supplier_id) return 1;
      return b.total_cost - a.total_cost;
    });
  }, [displayRows, draftByItem]);

  const kpis = useMemo(() => {
    // displayRows already reflects cart splits; sum line_cost there for the
    // headline spend so it matches what's grouped in the supplier cards.
    const totalGap = displayRows.reduce((s, r) => s + r.line_cost, 0);
    const itemsWithGap = f.filtered.filter(r => r.gap > 0).length;
    const noSupplier = f.filtered.filter(r => !r.supplier_id && r.gap > 0).length;
    return { totalGap, itemsWithGap, noSupplier };
  }, [f.filtered, displayRows]);

  const columns = useMemo(() => buildNeedNowColumns(), []);
  void departments;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.625rem", marginBottom: "1rem" }}>
        <Kpi label="Items needing order" value={kpis.itemsWithGap.toString()} sub={`of ${rows.length} tracked`} />
        <Kpi label="Estimated $ to spend" value={fmtMoney(kpis.totalGap)} sub="at recommended order qtys" />
        <Kpi
          label="No supplier yet"
          value={kpis.noSupplier.toString()}
          sub="cannot generate PO"
          warning={kpis.noSupplier > 0}
          onClick={() => f.setters.setNoSupplierOnly(!f.state.noSupplierOnly)}
          active={f.state.noSupplierOnly}
        />
        <Kpi label="Source plan" value={latestPlan ? `Week of ${new Date(latestPlan.week_start).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : "(no plan)"} sub={latestPlan?.status ?? "—"} />
      </div>

      <CascadingFilters state={f.state} setters={f.setters} counts={f.counts} clearAll={f.clearAll} suppliers={suppliers} />

      {grouped.length === 0 ? (
        <div className="card" style={{ padding: "2.5rem", textAlign: "center", color: "#78716c" }}>
          {f.state.showOnlyGap
            ? "Nothing to order right now — all tracked items have enough stock for current production orders, the demand plan, and min/max levels."
            : "No items match the current filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {grouped.map(g => (
            <SupplierCard
              key={g.supplier_id ?? "_no_sup"}
              supplier_id={g.supplier_id}
              supplier_name={g.supplier_name}
              total_cost={g.total_cost}
              rows={g.rows}
              columns={columns}
              onRowClick={onRowClick}
              fromCart={g.from_cart}
            />
          ))}
        </div>
      )}
    </>
  );
}

// Stacked sticky: supplier-name bar AND column headers stick together.
function SupplierCard({ supplier_id, supplier_name, total_cost, rows, columns, onRowClick, fromCart = false }: {
  supplier_id: string | null;
  supplier_name: string;
  total_cost: number;
  rows: NeedNowRow[];
  columns: ColumnDef<NeedNowRow>[];
  onRowClick: (r: NeedNowRow) => void;
  fromCart?: boolean;
}) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerH, setHeaderH] = useState(48);
  useEffect(() => {
    if (!headerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setHeaderH(Math.ceil(e.contentRect.height));
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div
        ref={headerRef}
        style={{
          padding: "0.75rem 1rem",
          background: supplier_id ? "#fafaf9" : "#fef2f2",
          borderBottom: "1px solid #e7e5e4",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
          position: "sticky", top: 0, zIndex: 6,
        }}
      >
        <div>
          <strong style={{ fontSize: "0.9375rem", color: supplier_id ? "#1c1917" : "#991b1b" }}>{supplier_name}</strong>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#78716c" }}>
            · {rows.length} item{rows.length === 1 ? "" : "s"}
          </span>
          {fromCart && (
            <span title="Includes lines from your draft cart" style={{ marginLeft: "0.5rem", fontSize: "0.65rem", padding: "0.1rem 0.4rem", background: "#fef9c3", border: "1px solid #fde68a", color: "#854d0e", borderRadius: "999px", fontWeight: 600 }}>
              ✎ from cart
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
          <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>
            Estimated&nbsp;<strong style={{ fontFamily: "monospace" }}>{fmtMoney(total_cost)}</strong>
          </span>
          {supplier_id && (
            <Link href={`/purchase-orders/new?supplier_id=${supplier_id}`} className="btn-primary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.625rem" }}>Create PO →</Link>
          )}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={onRowClick}
        emptyMessage="No items"
        stickyHeader
        stickyHeaderOffset={headerH}
      />
    </div>
  );
}

// ─── Tab 2: Order by item ────────────────────────────────────
function OrderByItemTab({ rows, suppliers, draftLines, onRowClick }: {
  rows: NeedNowRow[];
  departments: string[];
  suppliers: SupplierOption[];
  draftLines: DraftLine[];
  onRowClick: (r: NeedNowRow) => void;
}) {
  const f = useCascadingFilters(rows, { defaultGapOnly: true });
  const [splitForRow, setSplitForRow] = useState<NeedNowRow | null>(null);

  const draftByItem = useMemo(() => {
    const m = new Map<string, DraftLine[]>();
    for (const l of draftLines) {
      const list = m.get(l.item_id) ?? [];
      list.push(l);
      m.set(l.item_id, list);
    }
    return m;
  }, [draftLines]);

  const columns: ColumnDef<NeedNowRow>[] = useMemo(() => [
    { key: "code", label: "Code", width: 100, sortable: true,
      render: v => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{String(v)}</span> },
    { key: "name", label: "Item", width: 320, sortable: true,
      render: (v, row) => (
        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span style={{ color: "#1c1917", fontWeight: 500 }}>{String(v)}</span>
          <span className={`badge ${ITEM_TYPE_COLORS[row.item_type as ItemType] ?? "badge-gray"}`} style={{ fontSize: "0.6rem" }}>
            {ITEM_TYPE_LABELS[row.item_type as ItemType] ?? row.item_type}
          </span>
          {(draftByItem.get(row.id)?.length ?? 0) > 0 && (
            <span title="In draft cart" style={{ background: "#fef9c3", border: "1px solid #fde68a", color: "#854d0e", padding: "0 0.4rem", borderRadius: "999px", fontSize: "0.6rem", fontWeight: 600 }}>✎ in cart</span>
          )}
        </span>
      ) },
    { key: "current_stock", label: "Stock", width: 110, sortable: true,
      render: (v, row) => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: row.current_stock <= 0 ? "#dc2626" : "#1c1917" }}>{fmt(Number(v ?? 0), 2)} {row.unit}</span> },
    { key: "gap", label: "Gap", width: 100, sortable: true,
      render: v => Number(v ?? 0) > 0 ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: 700, color: "#dc2626" }}>{fmt(Number(v), 2)}</span> : <span style={{ color: "#a8a29e" }}>—</span> },
    { key: "recommended_qty", label: "Suggested order", width: 150, sortable: true,
      render: (v, row) => {
        const val = Number(v ?? 0);
        if (val <= 0) return <span style={{ color: "#a8a29e" }}>—</span>;
        return <span style={{ fontFamily: "monospace", fontSize: "0.875rem", fontWeight: 600 }}>{fmt(val, 2)} {row.unit}</span>;
      } },
    { key: "supplier_links", label: "Suppliers", width: 280, sortable: false,
      render: (_v, row) => <SupplierBreakdown row={row} draftLines={draftByItem.get(row.id) ?? []} /> },
    { key: "line_cost", label: "Est. $", width: 110, sortable: true,
      render: (_v, row) => {
        // When the item has cart lines, show their total; otherwise primary cost.
        const cart = draftByItem.get(row.id) ?? [];
        if (cart.length > 0) {
          const total = cart.reduce((s, l) => {
            const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
            return s + l.qty * ((l.unit_price ?? 0) / pack);
          }, 0);
          return <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 600, color: "#854d0e" }} title="From draft cart">{fmtMoney(total)}</span>;
        }
        return Number(row.line_cost) > 0
          ? <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 500 }}>{fmtMoney(Number(row.line_cost))}</span>
          : <span style={{ color: "#a8a29e" }}>—</span>;
      } },
    { key: "id", label: "", width: 110, sortable: false,
      render: (_v, row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSplitForRow(row); }}
          className="btn-primary"
          style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
        >Order…</button>
      ) },
  ], [draftByItem]);

  const totalGap = f.filtered.reduce((s, r) => s + r.line_cost, 0);
  const noSupplier = f.filtered.filter(r => !r.supplier_id && r.gap > 0).length;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.625rem", marginBottom: "1rem" }}>
        <Kpi label="Items needing order" value={f.filtered.filter(r => r.gap > 0).length.toString()} sub={`of ${rows.length} tracked`} />
        <Kpi label="Estimated $ to spend" value={fmtMoney(totalGap)} sub="at recommended order qtys" />
        <Kpi
          label="No supplier yet"
          value={noSupplier.toString()}
          sub="needs supplier link first"
          warning={noSupplier > 0}
          onClick={() => f.setters.setNoSupplierOnly(!f.state.noSupplierOnly)}
          active={f.state.noSupplierOnly}
        />
        <Kpi label="In draft cart" value={draftLines.length.toString()} sub="lines pending review" />
      </div>

      <CascadingFilters state={f.state} setters={f.setters} counts={f.counts} clearAll={f.clearAll} suppliers={suppliers} />

      <div className="card" style={{ padding: 0, marginBottom: draftLines.length > 0 ? "5.5rem" : 0 }}>
        <DataTable
          columns={columns}
          data={f.filtered}
          onRowClick={onRowClick}
          emptyMessage="No items match these filters."
          stickyHeader
        />
      </div>

      {splitForRow && (
        <SplitOrderModal
          row={splitForRow}
          suppliers={suppliers}
          existingDraftLines={draftByItem.get(splitForRow.id) ?? []}
          onClose={() => setSplitForRow(null)}
        />
      )}
    </>
  );
}

function SupplierBreakdown({ row, draftLines }: { row: NeedNowRow; draftLines: DraftLine[] }) {
  if (draftLines.length > 0) {
    const total = draftLines.reduce((s, l) => {
      const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
      const perBase = (l.unit_price ?? 0) / pack;
      return s + l.qty * perBase;
    }, 0);
    return (
      <div style={{ fontSize: "0.7rem", color: "#57534e" }}>
        {draftLines.map(l => {
          const sup = row.supplier_links.find(s => s.supplier_id === l.supplier_id);
          return (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span>{sup?.supplier_name ?? "—"}</span>
              <span style={{ fontFamily: "monospace" }}>{fmt(l.qty, 2)} {row.unit}</span>
            </div>
          );
        })}
        <div style={{ borderTop: "1px solid #e7e5e4", marginTop: "0.2rem", paddingTop: "0.2rem", display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
          <span>Total</span><span style={{ fontFamily: "monospace" }}>${total.toFixed(2)}</span>
        </div>
      </div>
    );
  }
  if (!row.supplier_id) {
    return <span style={{ fontSize: "0.7rem", color: "#dc2626" }}>No supplier — link one first</span>;
  }
  return (
    <div style={{ fontSize: "0.7rem", color: "#57534e" }} title={`${row.supplier_links.length} supplier${row.supplier_links.length === 1 ? "" : "s"} linked. Click row to order.`}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 500 }}>{row.is_preferred ? "✓ " : ""}{row.supplier_name}</span>
        <span style={{ fontFamily: "monospace" }}>${row.cost_per_consume.toFixed(2)}/{row.unit}</span>
      </div>
      {row.supplier_links.length > 1 && (
        <div style={{ color: "#a8a29e", fontSize: "0.65rem" }}>+ {row.supplier_links.length - 1} other{row.supplier_links.length - 1 === 1 ? "" : "s"} available</div>
      )}
    </div>
  );
}

// ─── Tab 3: Stock vs min/max ─────────────────────────────────
function StockTab({ rows, suppliers, onRowClick }: {
  rows: NeedNowRow[];
  departments: string[];
  suppliers: SupplierOption[];
  onRowClick: (r: NeedNowRow) => void;
}) {
  const f = useCascadingFilters(rows.filter(r => r.min_stock > 0 || r.max_stock > 0), { defaultGapOnly: false, allowEmptyOnGap: true });

  const columns: ColumnDef<NeedNowRow>[] = useMemo(() => [
    { key: "code", label: "Code", width: 110, sortable: true,
      render: v => <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{String(v)}</span> },
    { key: "name", label: "Item", width: 320, sortable: true,
      render: v => <span style={{ color: "#1c1917", fontWeight: 500 }}>{String(v)}</span> },
    { key: "current_stock", label: "Current", width: 130, sortable: true,
      render: (v, row) => {
        const val = Number(v ?? 0);
        const isLow = row.min_stock > 0 && val <= row.min_stock;
        const isEmpty = val <= 0;
        const isOver = row.max_stock > 0 && val > row.max_stock;
        const color = isEmpty || isLow ? "#dc2626" : isOver ? "#9a3412" : "#166534";
        return <span style={{ fontFamily: "monospace", fontWeight: 700, color }}>{fmt(val, 2)} {row.unit}</span>;
      } },
    { key: "min_stock", label: "Min", width: 100, sortable: true,
      render: v => Number(v) > 0 ? <span style={{ fontFamily: "monospace", color: "#78716c" }}>{fmt(Number(v), 0)}</span> : <span style={{ color: "#cfc9bf" }}>—</span> },
    { key: "max_stock", label: "Max", width: 100, sortable: true,
      render: v => Number(v) > 0 ? <span style={{ fontFamily: "monospace", color: "#78716c" }}>{fmt(Number(v), 0)}</span> : <span style={{ color: "#cfc9bf" }}>—</span> },
    { key: "supplier_name", label: "Default supplier", width: 220, sortable: true,
      render: v => v ? <span>{String(v)}</span> : <span style={{ color: "#a8a29e" }}>—</span> },
    { key: "lead_time_days", label: "Lead", width: 70, sortable: true,
      render: v => v != null ? <span style={{ fontSize: "0.75rem", color: "#78716c" }}>{Number(v)}d</span> : <span style={{ color: "#a8a29e" }}>—</span> },
  ], []);

  return (
    <>
      <CascadingFilters state={f.state} setters={f.setters} counts={f.counts} clearAll={f.clearAll} suppliers={suppliers} showGapToggle={false} />
      <div className="card" style={{ padding: 0 }}>
        <DataTable columns={columns} data={f.filtered} onRowClick={onRowClick} emptyMessage="No items with min/max set." stickyHeader />
      </div>
    </>
  );
}

// ─── Open POs ────────────────────────────────────────────────
function OpenPOsTab() {
  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem", fontWeight: 600 }}>Open POs</h2>
      <p style={{ color: "#57534e", fontSize: "0.875rem", margin: "0 0 0.875rem" }}>The existing Purchase Orders list shows everything on order.</p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Link href="/purchase-orders" className="btn-primary">Open Purchase Orders →</Link>
        <Link href="/purchase-orders/suggestions" className="btn-secondary">PO Suggestions (advanced view)</Link>
      </div>
    </div>
  );
}

function PlaceholderTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
      <div style={{ fontSize: "2rem", marginBottom: "0.625rem", opacity: 0.5 }}>📊</div>
      <h2 style={{ fontSize: "1.125rem", margin: "0 0 0.5rem", fontWeight: 600 }}>{title}</h2>
      <p style={{ color: "#57534e", fontSize: "0.875rem", maxWidth: "560px", margin: "0 auto 1rem" }}>{body}</p>
      <p style={{ fontSize: "0.75rem", color: "#a8a29e" }}>Tracked in tracey-master-plan.md · queued for an upcoming push.</p>
    </div>
  );
}

function Kpi({ label, value, sub, warning = false, onClick, active = false }: { label: string; value: string; sub: string; warning?: boolean; onClick?: () => void; active?: boolean }) {
  const clickable = !!onClick;
  // Real <button> for reliable click handling; reset native button styles.
  const Tag = (clickable ? "button" : "div") as "button" | "div";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      onClick={(e) => { if (clickable) { e.preventDefault(); onClick?.(); } }}
      style={{
        background: active ? "#fee2e2" : warning ? "#fef2f2" : "#fafaf9",
        border: `${active ? "2px" : "1px"} solid ${active ? "#dc2626" : warning ? "#fca5a5" : "#e7e5e4"}`,
        borderRadius: "0.5rem", padding: "0.75rem 0.875rem",
        cursor: clickable ? "pointer" : "default",
        textAlign: "left", font: "inherit", color: "inherit",
        width: "100%", display: "block",
      }}
    >
      <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.04em", color: warning ? "#991b1b" : "#78716c", fontWeight: 600 }}>
        {label}
        {clickable && <span style={{ marginLeft: "0.4rem", color: active ? "#dc2626" : "#a8a29e", fontSize: "0.65rem", fontWeight: 700 }}>{active ? "✓ filtering — click to clear" : "click to filter"}</span>}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "0.2rem", color: warning ? "#991b1b" : "#1c1917" }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: warning ? "#dc2626" : "#a8a29e", marginTop: "0.125rem" }}>{sub}</div>
    </Tag>
  );
}

// ─── Draft cart bar ──────────────────────────────────────────
function DraftCartBar({ lines, rows, suppliers }: { lines: DraftLine[]; rows: NeedNowRow[]; suppliers: SupplierOption[] }) {
  const itemById = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows]);
  const supById  = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);

  const totals = useMemo(() => {
    const bySupplier = new Map<string, { name: string; qty: number; cost: number; lines: number }>();
    let grand = 0;
    for (const l of lines) {
      const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
      const perBase = (l.unit_price ?? 0) / pack;
      const lineCost = l.qty * perBase;
      grand += lineCost;
      const cur = bySupplier.get(l.supplier_id) ?? { name: supById.get(l.supplier_id)?.name ?? "—", qty: 0, cost: 0, lines: 0 };
      cur.qty += l.qty; cur.cost += lineCost; cur.lines += 1;
      bySupplier.set(l.supplier_id, cur);
    }
    return { bySupplier: [...bySupplier.values()].sort((a, b) => b.cost - a.cost), grand };
  }, [lines, supById]);

  const [open, setOpen] = useState(false);

  async function handleRemove(id: string) { await removeDraftLine(id); }
  async function handleClear() { if (confirm("Clear the entire draft cart?")) await clearDraft(); }
  async function handleSubmit() {
    if (!confirm("Submit this draft? POs will be created per supplier.")) return;
    const r = await submitDraft();
    if ("error" in r) alert(r.error);
  }

  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: "white", borderTop: "1px solid #e7e5e4", boxShadow: "0 -4px 14px rgba(0,0,0,0.06)", padding: "0.625rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", maxWidth: "1600px", margin: "0 auto", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", flex: 1 }}>
          <strong style={{ fontSize: "0.875rem" }}>📋 Draft cart · {lines.length} line{lines.length === 1 ? "" : "s"}</strong>
          {totals.bySupplier.slice(0, 4).map(s => (
            <span key={s.name} style={{ fontSize: "0.75rem", color: "#57534e", padding: "0.2rem 0.5rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "999px" }}>
              {s.name}: <strong style={{ fontFamily: "monospace" }}>{fmtMoney(s.cost)}</strong>
            </span>
          ))}
          {totals.bySupplier.length > 4 && <span style={{ fontSize: "0.75rem", color: "#78716c" }}>+ {totals.bySupplier.length - 4} more</span>}
          <span style={{ fontSize: "0.875rem", marginLeft: "auto", marginRight: "0.5rem" }}>Total <strong style={{ fontFamily: "monospace" }}>{fmtMoney(totals.grand)}</strong></span>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button onClick={() => setOpen(v => !v)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem" }}>{open ? "Hide details" : "Review lines"}</button>
          <button onClick={handleClear} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.75rem", color: "#dc2626", borderColor: "#fca5a5" }}>Clear</button>
          <button onClick={handleSubmit} className="btn-primary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.875rem" }}>Submit → POs</button>
        </div>
      </div>
      {open && (
        <div style={{ maxWidth: "1600px", margin: "0.5rem auto 0", maxHeight: "240px", overflowY: "auto", border: "1px solid #e7e5e4", borderRadius: "0.5rem" }}>
          <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
            <thead style={{ background: "#fafaf9" }}>
              <tr>
                <th style={th}>Item</th><th style={th}>Supplier</th>
                <th style={{ ...th, textAlign: "right" }}>Qty</th>
                <th style={{ ...th, textAlign: "right" }}>Unit $</th>
                <th style={{ ...th, textAlign: "right" }}>Line $</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const it = itemById.get(l.item_id);
                const sup = supById.get(l.supplier_id);
                const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
                const perBase = (l.unit_price ?? 0) / pack;
                const cost = l.qty * perBase;
                return (
                  <tr key={l.id} style={{ borderTop: "1px solid #f5f5f4" }}>
                    <td style={td}>{it ? `${it.code} · ${it.name}` : l.item_id.slice(0, 8)}</td>
                    <td style={td}>{sup?.name ?? "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{fmt(l.qty, 2)} {l.unit}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{l.unit_price != null ? fmtMoney(l.unit_price) : "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(cost)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <button onClick={() => handleRemove(l.id)} style={{ border: 0, background: "transparent", color: "#dc2626", cursor: "pointer", fontSize: "1rem" }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "0.4rem 0.625rem", textAlign: "left", fontSize: "0.65rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 };
const td: React.CSSProperties = { padding: "0.4rem 0.625rem" };

const lblTiny: React.CSSProperties = {
  fontSize: "0.6875rem", color: "#78716c",
  textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.25rem", fontWeight: 600,
};
const btnSelect: React.CSSProperties = {
  padding: "0.3rem 0.5rem", border: "1px solid #cfc9bf", borderRadius: "0.375rem",
  fontSize: "0.7rem", fontFamily: "inherit", cursor: "pointer",
};
