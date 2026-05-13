"use client";

/**
 * Inventory list — full current-state view of all stocked items with:
 *   - Sticky summary bar (grand total value + per-type breakdown)
 *   - Multi-select Type + Category chips
 *   - Search box (code or name)
 *   - Stock-state pill: All / Low / OK / Empty / Over-max
 *   - Sortable, resizable, hideable columns via the existing DataTable
 *   - Real-cost column (standard_cost from v_item_cost_health) + total value per row
 *   - Recent stock movements panel below (audit log of inventory_transactions)
 *
 * Standard cost reflects the highest supplier price (the conservative number
 * for any costing calc). When scanned-receipt actual cost lands later, this
 * column will switch to actual cost where a lot is traceable.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import { DataTable, type ColumnDef } from "@/components/data-table";

export type InventoryRow = {
  id: string; code: string; name: string;
  item_type: string;
  category: string | null;
  unit: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  standard_cost: number;       // = effective_cost from v_item_cost_health
  supplier_count: number;
  has_override: boolean;       // true when an admin set an explicit standard_cost
  total_value: number;
};

export type RecentMovement = {
  id: string; tx_type: string; quantity: number; unit: string;
  notes: string | null; created_at: string; reference_type: string | null;
  item: { id: string; code: string; name: string; item_type: string } | null;
};

const TX_TYPE_LABELS: Record<string, string> = {
  receipt: "Receipt", production_use: "Production Use", production_output: "Production Output",
  adjustment: "Adjustment", waste: "Waste", dispatch: "Dispatch", transfer: "Transfer",
};
const TX_TYPE_COLORS: Record<string, string> = {
  receipt: "badge-green", production_use: "badge-yellow", production_output: "badge-blue",
  adjustment: "badge-gray", waste: "badge-red", dispatch: "badge-gray", transfer: "badge-gray",
};

type StockState = "all" | "low" | "ok" | "empty" | "over";

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function InventoryView({
  rows, categories, movements,
}: {
  rows: InventoryRow[];
  categories: { id: string; name: string }[];
  movements: RecentMovement[];
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [stockState, setStockState] = useState<StockState>("all");

  // Measure the outer sticky wrapper height so the DataTable's own sticky
  // toolbar + headers sit BELOW it instead of overlapping. Re-measures on
  // window resize and on filter-chip wrapping (via ResizeObserver).
  const stickyTopRef = useRef<HTMLDivElement | null>(null);
  const [stickyTopHeight, setStickyTopHeight] = useState(0);
  useEffect(() => {
    const el = stickyTopRef.current;
    if (!el) return;
    const update = () => setStickyTopHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  // ─── Distinct types and counts in raw data ───────────────
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.item_type, (m.get(r.item_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // ─── Filter ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(r.item_type)) return false;
      if (catFilter.size > 0  && (r.category == null || !catFilter.has(r.category))) return false;
      if (stockState === "low"   && !(r.min_stock > 0 && r.current_stock <= r.min_stock)) return false;
      if (stockState === "ok"    && !(r.current_stock > r.min_stock && r.current_stock <= (r.max_stock || Infinity))) return false;
      if (stockState === "empty" && !(r.current_stock <= 0)) return false;
      if (stockState === "over"  && !(r.max_stock > 0 && r.current_stock > r.max_stock)) return false;
      return true;
    });
  }, [rows, search, typeFilter, catFilter, stockState]);

  // ─── Totals ─────────────────────────────────────────────
  const totals = useMemo(() => {
    let total = 0;
    const byType = new Map<string, { count: number; value: number }>();
    for (const r of filtered) {
      total += r.total_value;
      const cur = byType.get(r.item_type) ?? { count: 0, value: 0 };
      byType.set(r.item_type, { count: cur.count + 1, value: cur.value + r.total_value });
    }
    return { total, byType: [...byType.entries()].sort((a, b) => b[1].value - a[1].value) };
  }, [filtered]);

  // ─── Counts per stock state in current filter set ───────
  const stateCounts = useMemo(() => {
    const base = rows.filter(r => {
      const q = search.trim().toLowerCase();
      if (q && !r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      if (typeFilter.size > 0 && !typeFilter.has(r.item_type)) return false;
      if (catFilter.size > 0  && (r.category == null || !catFilter.has(r.category))) return false;
      return true;
    });
    let low = 0, ok = 0, empty = 0, over = 0;
    for (const r of base) {
      if (r.current_stock <= 0) empty++;
      else if (r.min_stock > 0 && r.current_stock <= r.min_stock) low++;
      else if (r.max_stock > 0 && r.current_stock > r.max_stock) over++;
      else ok++;
    }
    return { all: base.length, low, ok, empty, over };
  }, [rows, search, typeFilter, catFilter]);

  function toggleSetMember<T>(setter: (s: Set<T>) => void, current: Set<T>, value: T) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  }

  // ─── Columns ─────────────────────────────────────────────
  const columns: ColumnDef<InventoryRow>[] = [
    {
      key: "code", label: "Code", width: 130, sortable: true,
      render: v => <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{String(v)}</span>,
    },
    {
      key: "name", label: "Name", width: 280, sortable: true,
      render: (v, row) => <Link href={`/items/${row.id}`} style={{ textDecoration: "none", color: "#1c1917", fontWeight: 500 }}>{String(v)}</Link>,
    },
    {
      key: "item_type", label: "Type", width: 130, sortable: true,
      render: v => (
        <span className={`badge ${ITEM_TYPE_COLORS[v as ItemType] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
          {ITEM_TYPE_LABELS[v as ItemType] ?? String(v)}
        </span>
      ),
    },
    {
      key: "category", label: "Category", width: 140, sortable: true, defaultHidden: false,
      render: v => v ? <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>{String(v)}</span> : <span style={{ color: "#a8a29e" }}>—</span>,
    },
    {
      key: "current_stock", label: "Current", width: 120, sortable: true,
      render: (v, row) => {
        const isLow   = row.min_stock > 0 && row.current_stock <= row.min_stock;
        const isEmpty = row.current_stock <= 0;
        const isOver  = row.max_stock > 0 && row.current_stock > row.max_stock;
        const color = isEmpty || isLow ? "#dc2626" : isOver ? "#9a3412" : "#166534";
        return (
          <span style={{ fontFamily: "monospace", fontWeight: 700, color }}>
            {Number(v).toLocaleString()} <span style={{ color: "#a8a29e", fontSize: "0.75rem", fontWeight: 400 }}>{row.unit}</span>
          </span>
        );
      },
    },
    {
      key: "min_stock", label: "Min", width: 90, sortable: true, defaultHidden: false,
      render: (v, row) => v ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{Number(v).toLocaleString()} {row.unit}</span> : <span style={{ color: "#cfc9bf" }}>—</span>,
    },
    {
      key: "max_stock", label: "Max", width: 90, sortable: true, defaultHidden: false,
      render: (v, row) => v ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{Number(v).toLocaleString()} {row.unit}</span> : <span style={{ color: "#cfc9bf" }}>—</span>,
    },
    {
      key: "standard_cost", label: "Cost / unit", width: 130, sortable: true,
      render: (v, row) => {
        const cost = Number(v ?? 0);
        if (cost <= 0) {
          return (
            <span style={{ color: "#a8a29e", fontSize: "0.75rem" }} title={row.supplier_count === 0 ? "No supplier linked yet — add one in the Suppliers panel of the item" : "No cost data"}>
              —
            </span>
          );
        }
        return (
          <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
                title={row.has_override
                  ? `Manual override · ${row.supplier_count} supplier${row.supplier_count === 1 ? "" : "s"}`
                  : `Highest of ${row.supplier_count} supplier${row.supplier_count === 1 ? "" : "s"}`}>
            {fmtMoney(cost)}
            {row.has_override && <span style={{ color: "#b91c1c", marginLeft: "0.3rem", fontSize: "0.65rem" }}>★</span>}
          </span>
        );
      },
    },
    {
      key: "total_value", label: "Total value", width: 130, sortable: true,
      render: (v, row) => {
        const total = Number(v ?? 0);
        if (total <= 0) {
          return <span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>—</span>;
        }
        const isStale = row.standard_cost <= 0;
        return (
          <span style={{ fontFamily: "monospace", fontWeight: 600, color: isStale ? "#a8a29e" : "#1c1917" }}>
            {fmtMoney(total)}
          </span>
        );
      },
    },
  ];

  // ─── Render ──────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Current stock levels with standard-cost valuation</p>
        </div>
        <Link href="/inventory/new" className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Record Movement
        </Link>
      </div>

      {/* ─── Sticky top: totals + filters together so both stay pinned on scroll ─── */}
      <div ref={stickyTopRef} style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "#fafaf9",
        margin: "0 -28px 0.875rem", padding: "0 28px 0.625rem",
        borderBottom: "1px solid #e7e5e4",
      }}>
      <div style={{
        background: "white",
        border: "1px solid #e7e5e4", borderRadius: "0.625rem",
        padding: "0.875rem 1rem", marginBottom: "0.625rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.6875rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>
              Total inventory value{filtered.length !== rows.length && <span style={{ color: "#b91c1c", marginLeft: "0.4rem" }}>(filtered)</span>}
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              {fmtMoney(totals.total)}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.2rem" }}>
              {filtered.length.toLocaleString()} items · cost = standard cost (highest supplier)
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {totals.byType.map(([type, agg]) => (
              <div key={type} style={{
                padding: "0.4rem 0.75rem",
                background: "#fafaf9",
                borderRadius: "0.5rem",
                border: "1px solid #e7e5e4",
                fontSize: "0.75rem",
              }}>
                <span className={`badge ${ITEM_TYPE_COLORS[type as ItemType] ?? "badge-gray"}`} style={{ fontSize: "0.625rem", marginRight: "0.4rem" }}>
                  {ITEM_TYPE_LABELS[type as ItemType] ?? type}
                </span>
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(agg.value)}</span>
                <span style={{ color: "#a8a29e", marginLeft: "0.3rem", fontSize: "0.6875rem" }}>· {agg.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Filters bar (inside the sticky wrapper) ─── */}
      <div style={{
        background: "white", border: "1px solid #e7e5e4",
        borderRadius: "0.625rem", padding: "0.75rem 1rem",
      }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text" placeholder="Search code or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              minWidth: "220px", flex: "0 1 280px",
              padding: "0.4rem 0.625rem",
              border: "1px solid #cfc9bf", borderRadius: "0.375rem",
              fontSize: "0.8125rem", fontFamily: "inherit",
            }}
          />

          {/* Stock state pills */}
          <div style={{ display: "inline-flex", gap: "2px", padding: "2px",
            background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem" }}>
            {([
              { val: "all",   label: "All",   count: stateCounts.all },
              { val: "low",   label: "Low",   count: stateCounts.low },
              { val: "ok",    label: "OK",    count: stateCounts.ok },
              { val: "empty", label: "Empty", count: stateCounts.empty },
              { val: "over",  label: "Over",  count: stateCounts.over },
            ] as { val: StockState; label: string; count: number }[]).map(s => (
              <button
                key={s.val}
                type="button"
                onClick={() => setStockState(s.val)}
                style={{
                  padding: "0.3rem 0.625rem",
                  border: 0, cursor: "pointer", fontFamily: "inherit",
                  fontSize: "0.75rem", fontWeight: 500,
                  background: stockState === s.val ? "#1c1917" : "transparent",
                  color: stockState === s.val ? "white" : "#57534e",
                  borderRadius: "0.375rem",
                }}
              >{s.label} <span style={{ opacity: 0.6, marginLeft: "0.25rem" }}>{s.count}</span></button>
            ))}
          </div>

          {(typeFilter.size > 0 || catFilter.size > 0 || search.trim() || stockState !== "all") && (
            <button
              type="button"
              onClick={() => { setTypeFilter(new Set()); setCatFilter(new Set()); setSearch(""); setStockState("all"); }}
              style={{
                background: "transparent", border: "1px solid #fca5a5",
                color: "#dc2626", borderRadius: "0.375rem",
                padding: "0.3rem 0.625rem", fontSize: "0.75rem",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >Clear filters</button>
          )}
        </div>

        {/* Type chips */}
        {typeCounts.length > 0 && (
          <div style={{ marginTop: "0.625rem", display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.6875rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.4rem" }}>Type</span>
            {typeCounts.map(([type, count]) => {
              const active = typeFilter.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleSetMember(setTypeFilter, typeFilter, type)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    border: `1px solid ${active ? "#b91c1c" : "#e7e5e4"}`,
                    background: active ? "#fef2f2" : "white",
                    borderRadius: "999px", cursor: "pointer", fontFamily: "inherit",
                    fontSize: "0.6875rem", fontWeight: 500,
                    color: active ? "#b91c1c" : "#57534e",
                  }}
                >
                  {active && "✓ "}{ITEM_TYPE_LABELS[type as ItemType] ?? type} <span style={{ opacity: 0.6, marginLeft: "0.2rem" }}>{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Category chips */}
        {categories.length > 0 && (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.6875rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.4rem" }}>Category</span>
            {categories.map(c => {
              const active = catFilter.has(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleSetMember(setCatFilter, catFilter, c.name)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    border: `1px solid ${active ? "#b91c1c" : "#e7e5e4"}`,
                    background: active ? "#fef2f2" : "white",
                    borderRadius: "999px", cursor: "pointer", fontFamily: "inherit",
                    fontSize: "0.6875rem", fontWeight: 500,
                    color: active ? "#b91c1c" : "#57534e",
                  }}
                >{active && "✓ "}{c.name}</button>
              );
            })}
          </div>
        )}
      </div>
      </div>

      {/* ─── Inventory table ─── */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <DataTable
          columns={columns}
          data={filtered}
          href={(row) => `/items/${row.id}`}
          emptyMessage={
            search.trim() || typeFilter.size > 0 || catFilter.size > 0 || stockState !== "all"
              ? "No items match the current filters."
              : "No items yet — add some via Item Master."
          }
          stickyHeader
          stickyHeaderOffset={stickyTopHeight}
        />
      </div>

      {/* ─── Recent Stock Movements (audit log) ─── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Recent stock movements</h2>
          <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.2rem 0 0" }}>
            Audit log of the last 50 stock changes — receipts in, production use / output, dispatches, transfers, adjustments, waste.
            Chronological. The current-state view is the table above.
          </p>
        </div>
        {!movements.length ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
            No movements recorded yet.{" "}
            <Link href="/inventory/new" style={{ color: "#b91c1c" }}>Record your first movement →</Link>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                {["Date", "Type", "Item", "Qty", "Reference", "Notes"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "0.5rem 0.875rem", fontWeight: 600, color: "#78716c", background: "#f5f5f4", borderBottom: "1px solid #e7e5e4", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movements.map((tx, i) => (
                <tr key={tx.id} style={{ borderBottom: "1px solid #f0efee", background: i % 2 === 0 ? "white" : "#fafaf9" }}>
                  <td style={{ padding: "0.5rem 0.875rem", color: "#78716c", whiteSpace: "nowrap" }}>
                    {new Date(tx.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td style={{ padding: "0.5rem 0.875rem" }}>
                    <span className={`badge ${TX_TYPE_COLORS[tx.tx_type] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                      {TX_TYPE_LABELS[tx.tx_type] ?? tx.tx_type}
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem 0.875rem" }}>
                    {tx.item ? (
                      <Link href={`/items/${tx.item.id}`} style={{ textDecoration: "none", fontWeight: 500, color: "#1c1917" }}>
                        {tx.item.name}
                        <span style={{ fontFamily: "monospace", fontSize: "0.6875rem", color: "#78716c", marginLeft: "0.375rem" }}>{tx.item.code}</span>
                      </Link>
                    ) : <span style={{ color: "#a8a29e" }}>—</span>}
                  </td>
                  <td style={{ padding: "0.5rem 0.875rem", fontFamily: "monospace", fontWeight: 700, color: tx.quantity >= 0 ? "#166534" : "#dc2626" }}>
                    {tx.quantity >= 0 ? "+" : ""}{tx.quantity} {tx.unit}
                  </td>
                  <td style={{ padding: "0.5rem 0.875rem", color: "#78716c" }}>{tx.reference_type ?? "—"}</td>
                  <td style={{ padding: "0.5rem 0.875rem", color: "#78716c" }}>{tx.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
