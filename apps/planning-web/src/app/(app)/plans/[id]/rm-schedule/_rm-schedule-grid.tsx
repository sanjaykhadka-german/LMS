"use client";

/**
 * RM Schedule Grid (Phase 9.4 v4 — Tino May 2026)
 *
 * Column order per Tino's testing of v3:
 *   Code | Item | $/unit | Mon..Sun | (Unsched) | Total Required
 *        | SOH | Min | Max | Variance | Req $ Value | To-Order $
 *
 * Two money columns at the end:
 *   - Req $ Value      = total_required × standard_cost
 *                        (cost to produce all the demand for this item)
 *   - To-Order $       = max(0, required − SOH) × standard_cost
 *                        (cost of just the shortage — what the buyer
 *                         needs to actually procure)
 *
 * The $/unit cell now also shows the unit (e.g. "$5.20 /kg") so the
 * planner sees in one glance whether the cost is by weight or piece.
 */

import { useMemo, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export type Row = {
  consuming_dept: string;
  production_date: string | null;
  component_id: string;
  component_code: string;
  component_name: string;
  component_type: string;
  component_unit: string | null;
  required_qty: number;
  on_hand_qty: number;
  min_stock: number;
  max_stock: number;
  standard_cost: number;
  parent_codes: string[];
};

const DEPT_LABELS: Record<string, string> = {
  production:    "🥩 Production",
  filling:       "🌭 Filling",
  cooking:       "🔥 Cooking",
  packing:       "📦 Packing",
  labelling:     "🏷️ Labelling",
  dispatch:      "🚚 Dispatch",
  raw_material:  "🧂 Raw Materials",
  packaging:     "📐 Packaging",
  consumable:    "🧴 Consumables",
};
function deptLabel(d: string) { return DEPT_LABELS[d.toLowerCase()] ?? d; }

function fmtQty(v: number) {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}
function fmtMoney(v: number) {
  return v.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}
function fmtUnitCost(cost: number, unit: string | null) {
  if (cost <= 0) return "—";
  const u = (unit ?? "").trim();
  return u ? `${fmtMoney(cost)} /${u}` : fmtMoney(cost);
}
function formatDayHeader(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  const wd = d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
  const dd = d.toLocaleDateString("en-AU", { day: "numeric", timeZone: "UTC" });
  const mm = d.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });
  return { wd, ddmm: `${dd} ${mm}` };
}

type Item = {
  component_id: string;
  component_code: string;
  component_name: string;
  component_unit: string | null;
  on_hand_qty: number;
  min_stock: number;
  max_stock: number;
  standard_cost: number;
  parent_codes: string[];
  perDay: Record<string, number>;
  unscheduled: number;
  total: number;
};

type SortKey = "code" | "name" | "cost" | "required" | "soh" | "min" | "max" | "variance" | "value" | "toOrder";
type SortDir = "asc" | "desc";

export function RmScheduleGrid({
  weekStart,
  planId,
  rows,
}: {
  weekStart: string;
  planId: string;
  rows: Row[];
}) {
  const [modalItemId, setModalItemId] = useState<string | null>(null);
  const [modalParents, setModalParents] = useState<{ parent_item_id: string; parent_code: string; parent_name: string; parent_dept: string; required_qty: number }[] | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [sortBySection, setSortBySection] = useState<Record<string, { key: SortKey; dir: SortDir }>>({});
  // Filters — three independent inputs (Tino's request 2026-05-10):
  //   • Departments (multi-select chips) — the consuming dept of each row
  //   • Item number (free text) — matches component_code
  //   • Product name (free text) — matches the parent product the material
  //     is consumed by (parent_codes from the RPC)
  const [deptFilter,    setDeptFilter]    = useState<Set<string>>(new Set());
  const [itemNumberQ,   setItemNumberQ]   = useState("");
  const [productNameQ,  setProductNameQ]  = useState("");

  function toggleDept(d: string) {
    setDeptFilter(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }

  // Distinct depts present in the data (drives the chip row).
  const allDepts = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.consuming_dept);
    return [...s].sort();
  }, [rows]);

  // When the modal opens, fetch the per-parent usage breakdown via the
  // get_rm_parent_breakdown RPC (migration 105). Cleared when the modal
  // closes so re-opening another row triggers a fresh load.
  useEffect(() => {
    if (!modalItemId) { setModalParents(null); return; }
    let cancelled = false;
    setModalLoading(true);
    setModalParents(null);
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_rm_parent_breakdown", {
        p_demand_plan_id: planId,
        p_component_id: modalItemId,
      });
      if (!cancelled) {
        if (!error && data) setModalParents(data as typeof modalParents extends infer T ? T : never);
        setModalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modalItemId, planId]);

  const days = useMemo(() => {
    const out: string[] = [];
    const start = new Date(weekStart + "T00:00:00Z");
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [weekStart]);
  const hasUnscheduled = rows.some(r => !r.production_date);

  // Apply filters before building dept groups so totals reflect visible rows.
  const filteredRows = useMemo(() => {
    const itemQ    = itemNumberQ.trim().toLowerCase();
    const productQ = productNameQ.trim().toLowerCase();
    return rows.filter(r => {
      if (deptFilter.size > 0 && !deptFilter.has(r.consuming_dept)) return false;
      if (itemQ && !r.component_code.toLowerCase().includes(itemQ)
                && !r.component_name.toLowerCase().includes(itemQ)) return false;
      if (productQ && !(r.parent_codes ?? []).some(p => p.toLowerCase().includes(productQ))) return false;
      return true;
    });
  }, [rows, deptFilter, itemNumberQ, productNameQ]);

  const deptGroups = useMemo(() => {
    const deptMap = new Map<string, Map<string, Item>>();
    for (const r of filteredRows) {
      const dItems = deptMap.get(r.consuming_dept) ?? new Map<string, Item>();
      deptMap.set(r.consuming_dept, dItems);
      const existing = dItems.get(r.component_id) ?? {
        component_id: r.component_id,
        component_code: r.component_code,
        component_name: r.component_name,
        component_unit: r.component_unit,
        on_hand_qty: r.on_hand_qty,
        min_stock: r.min_stock,
        max_stock: r.max_stock,
        standard_cost: r.standard_cost,
        parent_codes: r.parent_codes,
        perDay: {},
        unscheduled: 0,
        total: 0,
      };
      if (r.production_date) {
        existing.perDay[r.production_date] = (existing.perDay[r.production_date] ?? 0) + Number(r.required_qty);
      } else {
        existing.unscheduled += Number(r.required_qty);
      }
      existing.total += Number(r.required_qty);
      dItems.set(r.component_id, existing);
    }
    return [...deptMap.entries()]
      .map(([dept, dItems]) => {
        const items = [...dItems.values()];
        const deptTotalsPerDay: Record<string, number> = {};
        let deptUnscheduled = 0, deptGrandTotal = 0, deptGrandValue = 0, deptToOrderValue = 0, deptSoh = 0;
        for (const it of items) {
          for (const [day, qty] of Object.entries(it.perDay)) {
            deptTotalsPerDay[day] = (deptTotalsPerDay[day] ?? 0) + qty;
          }
          deptUnscheduled += it.unscheduled;
          deptGrandTotal += it.total;
          deptGrandValue += it.total * (it.standard_cost ?? 0);
          const shortage = Math.max(0, it.total - it.on_hand_qty);
          deptToOrderValue += shortage * (it.standard_cost ?? 0);
          deptSoh += it.on_hand_qty;
        }
        return { dept, items, deptTotalsPerDay, deptUnscheduled, deptGrandTotal, deptGrandValue, deptToOrderValue, deptSoh };
      })
      .sort((a, b) => a.dept.localeCompare(b.dept));
  }, [filteredRows]);

  const grand = useMemo(() => {
    const map = new Map<string, Item>();
    for (const r of filteredRows) {
      const existing = map.get(r.component_id) ?? {
        component_id: r.component_id,
        component_code: r.component_code,
        component_name: r.component_name,
        component_unit: r.component_unit,
        on_hand_qty: r.on_hand_qty,
        min_stock: r.min_stock,
        max_stock: r.max_stock,
        standard_cost: r.standard_cost,
        parent_codes: [],
        perDay: {},
        unscheduled: 0,
        total: 0,
      };
      const merged = new Set([...existing.parent_codes, ...(r.parent_codes ?? [])]);
      existing.parent_codes = [...merged].sort();
      if (r.production_date) {
        existing.perDay[r.production_date] = (existing.perDay[r.production_date] ?? 0) + Number(r.required_qty);
      } else {
        existing.unscheduled += Number(r.required_qty);
      }
      existing.total += Number(r.required_qty);
      map.set(r.component_id, existing);
    }
    const items = [...map.values()];
    const totalsPerDay: Record<string, number> = {};
    let unscheduled = 0, total = 0, value = 0, toOrderValue = 0, soh = 0;
    for (const it of items) {
      for (const [d, q] of Object.entries(it.perDay)) {
        totalsPerDay[d] = (totalsPerDay[d] ?? 0) + q;
      }
      unscheduled += it.unscheduled;
      total += it.total;
      value += it.total * (it.standard_cost ?? 0);
      const shortage = Math.max(0, it.total - it.on_hand_qty);
      toOrderValue += shortage * (it.standard_cost ?? 0);
      soh += it.on_hand_qty;
    }
    return { items, totalsPerDay, unscheduled, total, value, toOrderValue, soh };
  }, [filteredRows]);

  function sortItems(items: Item[], sectionKey: string): Item[] {
    const sortState = sortBySection[sectionKey] ?? { key: "code", dir: "asc" };
    const dir = sortState.dir === "asc" ? 1 : -1;
    const arr = [...items];
    arr.sort((a, b) => {
      const cmp = (() => {
        switch (sortState.key) {
          case "code":     return a.component_code.localeCompare(b.component_code);
          case "name":     return a.component_name.localeCompare(b.component_name);
          case "cost":     return (a.standard_cost - b.standard_cost);
          case "required": return (a.total - b.total);
          case "soh":      return (a.on_hand_qty - b.on_hand_qty);
          case "min":      return (a.min_stock - b.min_stock);
          case "max":      return (a.max_stock - b.max_stock);
          case "variance": return (a.on_hand_qty - a.total) - (b.on_hand_qty - b.total);
          case "value":    return (a.total * a.standard_cost) - (b.total * b.standard_cost);
          case "toOrder": {
            const sa = Math.max(0, a.total - a.on_hand_qty) * a.standard_cost;
            const sb = Math.max(0, b.total - b.on_hand_qty) * b.standard_cost;
            return sa - sb;
          }
        }
      })();
      return cmp * dir;
    });
    return arr;
  }

  function toggleSort(sectionKey: string, key: SortKey) {
    setSortBySection(prev => {
      const cur = prev[sectionKey] ?? { key: "code", dir: "asc" };
      if (cur.key === key) {
        return { ...prev, [sectionKey]: { key, dir: cur.dir === "asc" ? "desc" : "asc" } };
      }
      return { ...prev, [sectionKey]: { key, dir: "asc" } };
    });
  }

  const modalItem = modalItemId ? grand.items.find(i => i.component_id === modalItemId) ?? null : null;

  // Resizable column widths (Tino May 2026 v5). Stored as numbers (px) so
  // we can drag-resize. Item gets a sensible default width; flex layout
  // is gone in favour of pure pixel widths so the colgroup is reliable.
  // Values persist to localStorage keyed by plan-week so the planner's
  // tweaks stick across reloads.
  const STORAGE_KEY = `rm-schedule.colwidths.${weekStart}`;
  const DEFAULT_WIDTHS: Record<string, number> = {
    code: 78, item: 240, unitCost: 100, day: 60, unsched: 70,
    required: 90, soh: 70, min: 60, max: 60, variance: 90,
    value: 100, toOrder: 110,
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...DEFAULT_WIDTHS, ...JSON.parse(raw) };
      } catch {}
    }
    return DEFAULT_WIDTHS;
  });
  // Persist whenever widths change.
  useMemo(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(colWidths)); } catch {}
  }, [colWidths, STORAGE_KEY]);

  function startResize(col: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col] ?? DEFAULT_WIDTHS[col] ?? 80;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(40, startW + (ev.clientX - startX));
      setColWidths(prev => ({ ...prev, [col]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function w(k: string) { return `${colWidths[k] ?? DEFAULT_WIDTHS[k] ?? 80}px`; }
  function renderColgroup() {
    return (
      <colgroup>
        <col style={{ width: w("code") }} />
        <col style={{ width: w("item") }} />
        <col style={{ width: w("unitCost") }} />
        {days.map(d => <col key={d} style={{ width: w("day") }} />)}
        {hasUnscheduled && <col style={{ width: w("unsched") }} />}
        <col style={{ width: w("required") }} />
        <col style={{ width: w("soh") }} />
        <col style={{ width: w("min") }} />
        <col style={{ width: w("max") }} />
        <col style={{ width: w("variance") }} />
        <col style={{ width: w("value") }} />
        <col style={{ width: w("toOrder") }} />
      </colgroup>
    );
  }

  // Tiny drag handle at the right edge of each <th>. The handle is
  // 4px wide, transparent until hover (faint amber bar). Mouse-down
  // captures startX + startW; mousemove updates the column's width.
  function ResizeHandle({ col }: { col: string }) {
    return (
      <div
        onMouseDown={e => startResize(col, e)}
        onClick={e => e.stopPropagation()}
        title="Drag to resize column"
        className="no-print"
        style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: "5px",
          cursor: "col-resize", background: "transparent",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#fcd34d")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      />
    );
  }

  function SortHeader({ sectionKey, field, label, align }: { sectionKey: string; field: SortKey; label: React.ReactNode; align?: "left" | "right" }) {
    const cur = sortBySection[sectionKey] ?? { key: "code", dir: "asc" };
    const active = cur.key === field;
    // Show a faint ↕ on inactive sortable headers so the planner knows
    // every column is clickable (Tino May 2026 feedback after v4).
    const arrow = active ? (cur.dir === "asc" ? "▲" : "▼") : "↕";
    return (
      <button
        type="button"
        onClick={() => toggleSort(sectionKey, field)}
        style={{
          background: "none", border: "none", padding: 0, margin: 0,
          font: "inherit", color: "inherit", cursor: "pointer",
          width: "100%", textAlign: align ?? "left",
          display: "inline-flex", alignItems: "center",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          gap: "0.25rem",
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: "0.65em", color: active ? "#b91c1c" : "#d6d3d1", minWidth: "0.7em" }}>{arrow}</span>
      </button>
    );
  }

  function HeaderRow({ sectionKey }: { sectionKey: string }) {
    return (
      <tr style={{ background: "#fafaf9" }}>
        <th style={th}><SortHeader sectionKey={sectionKey} field="code" label="Code" /><ResizeHandle col="code" /></th>
        <th style={th}><SortHeader sectionKey={sectionKey} field="name" label="Item" /><ResizeHandle col="item" /></th>
        <th style={{ ...th, textAlign: "right" }}><SortHeader sectionKey={sectionKey} field="cost" label="$ / unit" align="right" /><ResizeHandle col="unitCost" /></th>
        {days.map(d => {
          const { wd, ddmm } = formatDayHeader(d);
          return (
            <th key={d} style={{ ...th, textAlign: "right" }}>
              <div style={{ fontSize: "0.6875rem", color: "#78716c", fontWeight: 600 }}>{wd}</div>
              <div>{ddmm}</div>
              <ResizeHandle col="day" />
            </th>
          );
        })}
        {hasUnscheduled && (
          <th style={{ ...th, textAlign: "right", color: "#92400e" }}>Unsched.<ResizeHandle col="unsched" /></th>
        )}
        <th style={{ ...th, textAlign: "right", background: "#fef2f2", color: "#991b1b" }}>
          <SortHeader sectionKey={sectionKey} field="required" label="Total Req." align="right" />
          <ResizeHandle col="required" />
        </th>
        <th style={{ ...th, textAlign: "right" }}><SortHeader sectionKey={sectionKey} field="soh" label="SOH" align="right" /><ResizeHandle col="soh" /></th>
        <th style={{ ...th, textAlign: "right" }}><SortHeader sectionKey={sectionKey} field="min" label="Min" align="right" /><ResizeHandle col="min" /></th>
        <th style={{ ...th, textAlign: "right" }}><SortHeader sectionKey={sectionKey} field="max" label="Max" align="right" /><ResizeHandle col="max" /></th>
        <th style={{ ...th, textAlign: "right" }}>
          <SortHeader sectionKey={sectionKey} field="variance" label={<>Variance<div style={{ fontSize: "0.6rem", fontWeight: 400, color: "#78716c" }}>SOH − req</div></>} align="right" />
          <ResizeHandle col="variance" />
        </th>
        <th style={{ ...th, textAlign: "right" }}>
          <SortHeader sectionKey={sectionKey} field="value" label={<>Req $<div style={{ fontSize: "0.6rem", fontWeight: 400, color: "#78716c" }}>req × cost</div></>} align="right" />
          <ResizeHandle col="value" />
        </th>
        <th style={{ ...th, textAlign: "right" }}>
          <SortHeader sectionKey={sectionKey} field="toOrder" label={<>To-Order $<div style={{ fontSize: "0.6rem", fontWeight: 400, color: "#78716c" }}>shortage × cost</div></>} align="right" />
          <ResizeHandle col="toOrder" />
        </th>
      </tr>
    );
  }

  function ItemRow({ it }: { it: Item }) {
    const variance = it.on_hand_qty - it.total;
    const reqValue = it.total * (it.standard_cost ?? 0);
    const shortage = Math.max(0, -variance);
    const toOrderValue = shortage * (it.standard_cost ?? 0);
    const belowMin = it.min_stock > 0 && it.on_hand_qty < it.min_stock;
    return (
      <tr
        onClick={() => setModalItemId(it.component_id)}
        style={{ borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}
        onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
        onMouseLeave={e => (e.currentTarget.style.background = "")}
        title={`Used in ${it.parent_codes.length} item${it.parent_codes.length === 1 ? "" : "s"} — click for details`}
      >
        <td style={{ ...td, fontFamily: "monospace", fontSize: "0.7rem", color: "#57534e" }} title={it.component_code}>{it.component_code}</td>
        <td style={tdWrap} title={it.component_name}>{it.component_name}</td>
        <td style={{ ...td, textAlign: "right", color: it.standard_cost > 0 ? "#1c1917" : "#a8a29e", fontVariantNumeric: "tabular-nums" }}>
          {fmtUnitCost(it.standard_cost, it.component_unit)}
        </td>
        {days.map(d => (
          <td key={d} style={{ ...td, textAlign: "right", color: it.perDay[d] ? "#1c1917" : "#d6d3d1", fontVariantNumeric: "tabular-nums" }}>
            {it.perDay[d] ? fmtQty(it.perDay[d]) : "·"}
          </td>
        ))}
        {hasUnscheduled && (
          <td style={{ ...td, textAlign: "right", color: it.unscheduled ? "#92400e" : "#d6d3d1", fontWeight: it.unscheduled ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>
            {it.unscheduled ? fmtQty(it.unscheduled) : "·"}
          </td>
        )}
        <td style={{ ...td, textAlign: "right", background: "#fef2f2", color: "#991b1b", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {fmtQty(it.total)}
        </td>
        <td style={{ ...td, textAlign: "right", color: belowMin ? "#dc2626" : "#1c1917", fontWeight: belowMin ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
          {fmtQty(it.on_hand_qty)}
        </td>
        <td style={{ ...td, textAlign: "right", color: belowMin ? "#dc2626" : "#57534e", fontVariantNumeric: "tabular-nums" }}>
          {it.min_stock > 0 ? fmtQty(it.min_stock) : "—"}
        </td>
        <td style={{ ...td, textAlign: "right", color: "#57534e", fontVariantNumeric: "tabular-nums" }}>
          {it.max_stock > 0 ? fmtQty(it.max_stock) : "—"}
        </td>
        <td
          style={{
            ...td,
            textAlign: "right",
            background: variance < 0 ? "#fef2f2" : "#f0fdf4",
            color: variance < 0 ? "#dc2626" : "#15803d",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {variance >= 0 ? "+" : ""}{fmtQty(variance)}
        </td>
        <td style={{ ...td, textAlign: "right", color: reqValue > 0 ? "#1c1917" : "#a8a29e", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {reqValue > 0 ? fmtMoney(reqValue) : "—"}
        </td>
        <td style={{ ...td, textAlign: "right", background: toOrderValue > 0 ? "#fef2f2" : "transparent", color: toOrderValue > 0 ? "#991b1b" : "#a8a29e", fontWeight: toOrderValue > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
          {toOrderValue > 0 ? fmtMoney(toOrderValue) : "—"}
        </td>
      </tr>
    );
  }

  function FooterRow({
    label, totalsPerDay, unscheduled, total, value, toOrderValue, soh,
  }: {
    label: string;
    totalsPerDay: Record<string, number>;
    unscheduled: number;
    total: number;
    value: number;
    toOrderValue: number;
    soh: number;
  }) {
    const variance = soh - total;
    return (
      <tr style={{ background: "#fafaf9", fontWeight: 700, borderTop: "2px solid #d6d3d1" }}>
        <td style={{ ...td, fontStyle: "italic" }} colSpan={3}>{label}</td>
        {days.map(d => (
          <td key={d} style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {totalsPerDay[d] ? fmtQty(totalsPerDay[d]) : "·"}
          </td>
        ))}
        {hasUnscheduled && (
          <td style={{ ...td, textAlign: "right", color: "#92400e", fontVariantNumeric: "tabular-nums" }}>
            {unscheduled ? fmtQty(unscheduled) : "·"}
          </td>
        )}
        <td style={{ ...td, textAlign: "right", background: "#fee2e2", color: "#991b1b", fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}>
          {fmtQty(total)}
        </td>
        <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtQty(soh)}</td>
        <td style={td}></td>
        <td style={td}></td>
        <td style={{ ...td, textAlign: "right", background: variance < 0 ? "#fee2e2" : "#dcfce7", color: variance < 0 ? "#991b1b" : "#166534", fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}>
          {variance >= 0 ? "+" : ""}{fmtQty(variance)}
        </td>
        <td style={{ ...td, textAlign: "right", color: "#1c1917", fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}>
          {value > 0 ? fmtMoney(value) : "—"}
        </td>
        <td style={{ ...td, textAlign: "right", background: toOrderValue > 0 ? "#fee2e2" : "transparent", color: toOrderValue > 0 ? "#991b1b" : "#a8a29e", fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}>
          {toOrderValue > 0 ? fmtMoney(toOrderValue) : "—"}
        </td>
      </tr>
    );
  }

  return (
    <>
      {/* Three-filter toolbar (dept chips + item number + product name) */}
      <div className="no-print" style={{ marginBottom: "0.625rem", padding: "0.625rem 0.75rem", background: "white", border: "1px solid #e7e5e4", borderRadius: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <label style={{ display: "block" }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>Item number / name</div>
            <input
              type="text"
              placeholder="🔎 Component code or name…"
              value={itemNumberQ}
              onChange={e => setItemNumberQ(e.target.value)}
              style={{ width: "100%", padding: "0.4rem 0.625rem", border: "1px solid #cfc9bf", borderRadius: "0.375rem", fontSize: "0.8125rem", fontFamily: "inherit" }}
            />
          </label>
          <label style={{ display: "block" }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>Product (parent that consumes it)</div>
            <input
              type="text"
              placeholder="🔎 Parent product code…"
              value={productNameQ}
              onChange={e => setProductNameQ(e.target.value)}
              style={{ width: "100%", padding: "0.4rem 0.625rem", border: "1px solid #cfc9bf", borderRadius: "0.375rem", fontSize: "0.8125rem", fontFamily: "inherit" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.25rem" }}>Departments</span>
          {allDepts.map(d => {
            const active = deptFilter.has(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDept(d)}
                style={{
                  padding: "0.25rem 0.5rem",
                  border: `1px solid ${active ? "#b91c1c" : "#e7e5e4"}`,
                  background: active ? "#fef2f2" : "white",
                  borderRadius: "999px", cursor: "pointer", fontFamily: "inherit",
                  fontSize: "0.7rem", fontWeight: 500,
                  color: active ? "#b91c1c" : "#57534e",
                }}
              >{active ? "✓ " : ""}{deptLabel(d)}</button>
            );
          })}
          {(deptFilter.size > 0 || itemNumberQ.trim() || productNameQ.trim()) && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#78716c", marginLeft: "auto" }}>
                {filteredRows.length} of {rows.length} rows
              </span>
              <button
                type="button"
                onClick={() => { setDeptFilter(new Set()); setItemNumberQ(""); setProductNameQ(""); }}
                style={{ background: "transparent", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "0.375rem", padding: "0.25rem 0.625rem", fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit" }}
              >Clear filters</button>
            </>
          )}
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginBottom: "0.625rem" }}>
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-secondary"
          style={{ fontSize: "0.8125rem" }}
        >
          🖨 Print
        </button>
      </div>

      {deptGroups.map(group => {
        const sectionKey = `dept_${group.dept}`;
        const items = sortItems(group.items, sectionKey);
        return (
          <div key={group.dept} className="card print-page-break" style={{ padding: "1rem", marginBottom: "1rem", breakInside: "avoid" }}>
            <h2 style={{ margin: "0 0 0.625rem", fontSize: "0.9375rem", fontWeight: 700, color: "#1c1917" }}>
              {deptLabel(group.dept)}
              <span style={{ marginLeft: "0.625rem", fontSize: "0.75rem", color: "#78716c", fontWeight: 400 }}>
                {group.items.length} item{group.items.length === 1 ? "" : "s"} · req {fmtQty(group.deptGrandTotal)} · req $ {fmtMoney(group.deptGrandValue)}
                {group.deptToOrderValue > 0 && (
                  <span style={{ color: "#991b1b", fontWeight: 600 }}> · to-order {fmtMoney(group.deptToOrderValue)}</span>
                )}
              </span>
            </h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "fixed" }}>
                {renderColgroup()}
                <thead><HeaderRow sectionKey={sectionKey} /></thead>
                <tbody>
                  {items.map(it => <ItemRow key={it.component_id} it={it} />)}
                  <FooterRow
                    label={`${deptLabel(group.dept)} total`}
                    totalsPerDay={group.deptTotalsPerDay}
                    unscheduled={group.deptUnscheduled}
                    total={group.deptGrandTotal}
                    value={group.deptGrandValue}
                    toOrderValue={group.deptToOrderValue}
                    soh={group.deptSoh}
                  />
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="card" style={{ padding: "1rem", marginTop: "1.25rem", borderTop: "3px solid #b91c1c", breakInside: "avoid" }}>
        <h2 style={{ margin: "0 0 0.875rem", fontSize: "1.0625rem", fontWeight: 700, color: "#1c1917" }}>
          Grand Total — every RM, deduped across departments
          <span style={{ marginLeft: "0.625rem", fontSize: "0.8125rem", color: "#78716c", fontWeight: 400 }}>
            {grand.items.length} items · req $ {fmtMoney(grand.value)}
            {grand.toOrderValue > 0 && (
              <span style={{ color: "#991b1b", fontWeight: 600 }}> · to-order {fmtMoney(grand.toOrderValue)}</span>
            )}
          </span>
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", tableLayout: "fixed" }}>
            {renderColgroup()}
            <thead><HeaderRow sectionKey="grand" /></thead>
            <tbody>
              {sortItems(grand.items, "grand").map(it => <ItemRow key={it.component_id} it={it} />)}
              <FooterRow
                label="Grand total"
                totalsPerDay={grand.totalsPerDay}
                unscheduled={grand.unscheduled}
                total={grand.total}
                value={grand.value}
                toOrderValue={grand.toOrderValue}
                soh={grand.soh}
              />
            </tbody>
          </table>
        </div>
      </div>

      {modalItem && (
        <div
          className="no-print"
          style={{ position: "fixed", inset: 0, zIndex: 350, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setModalItemId(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.625rem", padding: "1.25rem", width: "min(560px, 92vw)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem" }}>
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1c1917" }}>Used in</h2>
              <button type="button" onClick={() => setModalItemId(null)} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#78716c", padding: "0 0.5rem" }}>×</button>
            </div>
            <div style={{ marginBottom: "0.875rem", padding: "0.625rem 0.875rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem" }}>
              <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Item</div>
              <a
                href={`/items/${modalItem.component_id}`}
                target="_blank"
                rel="noopener"
                style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#1c1917", marginTop: "0.125rem", display: "inline-block", textDecoration: "none" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#b91c1c")}
                onMouseLeave={e => (e.currentTarget.style.color = "#1c1917")}
                title="Open this raw material in a new tab"
              >
                <span style={{ fontFamily: "monospace", color: "#57534e", marginRight: "0.5rem" }}>{modalItem.component_code}</span>
                {modalItem.component_name}
                <span style={{ fontSize: "0.7rem", color: "#a8a29e", marginLeft: "0.4rem" }}>↗</span>
              </a>
              <div style={{ marginTop: "0.5rem", display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "0.5rem 1.25rem", fontSize: "0.75rem", color: "#57534e" }}>
                <div><strong>$/unit</strong>: {fmtUnitCost(modalItem.standard_cost, modalItem.component_unit)}</div>
                <div><strong>Required</strong>: {fmtQty(modalItem.total)} {modalItem.component_unit ?? ""}</div>
                <div><strong>SOH</strong>: {fmtQty(modalItem.on_hand_qty)} {modalItem.component_unit ?? ""}</div>
                <div><strong>Min</strong>: {modalItem.min_stock > 0 ? fmtQty(modalItem.min_stock) : "—"}</div>
                <div><strong>Max</strong>: {modalItem.max_stock > 0 ? fmtQty(modalItem.max_stock) : "—"}</div>
                <div style={{ color: modalItem.on_hand_qty - modalItem.total < 0 ? "#dc2626" : "#15803d", fontWeight: 700 }}>
                  <strong>Variance</strong>: {(modalItem.on_hand_qty - modalItem.total) >= 0 ? "+" : ""}{fmtQty(modalItem.on_hand_qty - modalItem.total)}
                </div>
                <div><strong>Req $</strong>: {fmtMoney(modalItem.total * (modalItem.standard_cost ?? 0))}</div>
                <div style={{ color: modalItem.on_hand_qty < modalItem.total ? "#991b1b" : "#15803d", fontWeight: 700 }}>
                  <strong>To-Order $</strong>: {fmtMoney(Math.max(0, modalItem.total - modalItem.on_hand_qty) * (modalItem.standard_cost ?? 0))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>
              Consumed in {modalParents?.length ?? modalItem.parent_codes.length} parent item{(modalParents?.length ?? modalItem.parent_codes.length) === 1 ? "" : "s"}
              {" "}<span style={{ fontWeight: 400, color: "#a8a29e", textTransform: "none", letterSpacing: 0 }}>(click a row to open it in a new tab)</span>
            </div>
            {modalLoading ? (
              <div style={{ fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic", padding: "0.5rem 0" }}>Loading per-parent breakdown…</div>
            ) : !modalParents || modalParents.length === 0 ? (
              <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>No parent items recorded.</div>
            ) : (
              <div style={{ border: "1px solid #e7e5e4", borderRadius: "0.5rem", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                  <thead style={{ background: "#fafaf9" }}>
                    <tr>
                      <th style={{ padding: "0.4rem 0.625rem", textAlign: "left",  fontSize: "0.6875rem", color: "#78716c", borderBottom: "1px solid #e7e5e4", whiteSpace: "nowrap" }}>Code</th>
                      <th style={{ padding: "0.4rem 0.625rem", textAlign: "left",  fontSize: "0.6875rem", color: "#78716c", borderBottom: "1px solid #e7e5e4" }}>Parent item</th>
                      <th style={{ padding: "0.4rem 0.625rem", textAlign: "left",  fontSize: "0.6875rem", color: "#78716c", borderBottom: "1px solid #e7e5e4", whiteSpace: "nowrap" }}>Dept</th>
                      <th style={{ padding: "0.4rem 0.625rem", textAlign: "right", fontSize: "0.6875rem", color: "#78716c", borderBottom: "1px solid #e7e5e4", whiteSpace: "nowrap" }}>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalParents.map(p => (
                      <tr
                        key={p.parent_item_id}
                        onClick={() => window.open(`/items/${p.parent_item_id}`, "_blank", "noopener")}
                        style={{ borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}
                        title={`Open ${p.parent_code} ${p.parent_name} in a new tab`}
                      >
                        <td style={{ padding: "0.4rem 0.625rem", fontFamily: "monospace", fontSize: "0.7rem", color: "#57534e" }}>{p.parent_code}</td>
                        <td style={{ padding: "0.4rem 0.625rem", color: "#1c1917" }}>{p.parent_name}</td>
                        <td style={{ padding: "0.4rem 0.625rem", color: "#78716c", fontSize: "0.7rem", textTransform: "capitalize" }}>{p.parent_dept}</td>
                        <td style={{ padding: "0.4rem 0.625rem", textAlign: "right", color: "#1c1917", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                          {fmtQty(Number(p.required_qty))} {modalItem.component_unit ?? ""}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: "#fef2f2", fontWeight: 700 }}>
                      <td style={{ padding: "0.4rem 0.625rem", fontStyle: "italic", color: "#991b1b" }} colSpan={3}>Total</td>
                      <td style={{ padding: "0.4rem 0.625rem", textAlign: "right", color: "#991b1b", fontVariantNumeric: "tabular-nums" }}>
                        {fmtQty(modalParents.reduce((s, p) => s + Number(p.required_qty), 0))} {modalItem.component_unit ?? ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const th: React.CSSProperties = { padding: "0.4rem 0.75rem 0.4rem 0.5rem",
  textAlign: "left",
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#57534e",
  borderBottom: "1px solid #d6d3d1",
  whiteSpace: "nowrap",
  background: "#fafaf9",
  position: "sticky",
  top: 0,
  zIndex: 2,
};
const td: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
// Wrap-friendly variant for the Item cell — long item names break to a
// second line instead of getting truncated. Used only on the Item cell so
// number columns keep the strict nowrap.
const tdWrap: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  verticalAlign: "middle",
  whiteSpace: "normal",
  wordBreak: "break-word",
  lineHeight: 1.3,
};
