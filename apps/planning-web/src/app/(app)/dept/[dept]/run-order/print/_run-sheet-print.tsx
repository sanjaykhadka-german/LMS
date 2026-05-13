"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type Order = {
  id: string;
  batch_number: string;
  planned_qty: number | null;
  unit: string | null;
  machine_id: string | null;
  run_sequence: number | null;
  batch_size: number | null;
  n_of_batches: number | null;
  target_batch_size: number | null;
  machine: string | null;
  item: { id: string; code: string; name: string; item_type: string } | null;
};

type Machine = {
  id: string; name: string; code: string | null;
  machine_type: string | null;
  capacity_value: number | null;
  capacity_unit: string | null;
};

type RecipeLine = {
  /** bom_lines.id — unique per recipe line. Used as React key because the
   *  same component can appear on multiple lines in a single BOM (e.g.
   *  FUMARO added at different stages with different grind sizes). Using
   *  component_id as key would collide and React would ghost-duplicate
   *  rows during sort re-renders. */
  bom_line_id: string;
  component_id: string;
  code: string;
  name: string;
  item_type: string;
  qty_per_batch: number;
  unit: string;
  percentage: number | null;
  grind_size: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
};

type BomRecipe = {
  bom_id: string;
  reference_batch_size: number;
  yield_factor: number;
  lines: RecipeLine[];
};

type RmRow = {
  component_id: string;
  component_code: string;
  component_name: string;
  component_type: string;
  component_unit: string;
  required_qty: number;
  on_hand_qty: number;
  parent_codes: string[];
};

type SortState = { col: string; dir: "asc" | "desc" };

export default function RunSheetPrint({
  deptLabel, deptEmoji, day, machines, orders, bomByItem, rmRows, autoPrint,
}: {
  deptLabel: string;
  deptEmoji: string;
  day: string;
  machines: Machine[];
  orders: Order[];
  bomByItem: Record<string, BomRecipe>;
  rmRows: RmRow[];
  autoPrint: boolean;
}) {
  useEffect(() => { if (autoPrint) setTimeout(() => window.print(), 250); }, [autoPrint]);

  const [dayComments, setDayComments] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // Per-table prefs (sort state + column widths) persisted to localStorage so
  // each operator's preferred layout survives reloads. Scoped by deptLabel so
  // Production / Filling / Cooking each keep their own defaults.
  const PREFS_KEY = `runsheet.prefs.${deptLabel.toLowerCase()}`;
  const [sortBy, setSortBy] = useState<Record<string, SortState>>({});
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(PREFS_KEY) : null;
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (p.sortBy && typeof p.sortBy === "object") setSortBy(p.sortBy);
        if (p.colWidths && typeof p.colWidths === "object") setColWidths(p.colWidths);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveAsDefault() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ sortBy, colWidths }));
      setToast("Saved sort + column widths as default for " + deptLabel);
    } catch {
      setToast("Could not save (storage blocked)");
    }
  }
  function clearDefaults() {
    try {
      window.localStorage.removeItem(PREFS_KEY);
      setSortBy({});
      setColWidths({});
      setToast("Reset to factory defaults");
    } catch { /* ignore */ }
  }

  // Sort cycles: untouched → asc → desc → cleared (back to default order).
  function cycleSort(tableId: string, col: string) {
    setSortBy(prev => {
      const cur = prev[tableId];
      if (!cur || cur.col !== col) return { ...prev, [tableId]: { col, dir: "asc" } };
      if (cur.dir === "asc") return { ...prev, [tableId]: { col, dir: "desc" } };
      const next = { ...prev };
      delete next[tableId];
      return next;
    });
  }

  // Stable sort: decorate-sort-undecorate using original index so ties keep
  // their original order. Empty / null values always sink to the bottom
  // regardless of sort direction so "missing data" doesn't bubble to the top
  // when descending.
  function applySort<T>(
    tableId: string,
    rows: T[],
    get: (r: T, col: string) => string | number | null | undefined,
  ): T[] {
    const cur = sortBy[tableId];
    if (!cur) return rows;
    const sign = cur.dir === "asc" ? 1 : -1;
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const av = get(a.r, cur.col);
        const bv = get(b.r, cur.col);
        const aEmpty = av == null || av === "";
        const bEmpty = bv == null || bv === "";
        if (aEmpty && bEmpty) return a.i - b.i;
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        if (typeof av === "number" && typeof bv === "number") {
          if (av === bv) return a.i - b.i;
          return sign * (av - bv);
        }
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
        return cmp === 0 ? a.i - b.i : sign * cmp;
      })
      .map(x => x.r);
  }

  function setColWidth(tableId: string, col: string, w: number) {
    setColWidths(prev => ({ ...prev, [`${tableId}.${col}`]: Math.max(40, Math.round(w)) }));
  }

  // Format helpers ──────────────────────────────────────────────────────────
  function fmt(n: number | null | undefined, dec = 2): string {
    if (n == null || isNaN(Number(n))) return "—";
    const v = Number(n);
    if (Math.abs(v - Math.round(v)) < 0.05) return Math.round(v).toLocaleString("en-AU");
    return v.toLocaleString("en-AU", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // Unit-aware quantity formatter. kg always shows 3 dp (the floor team
  // mixes by weight to gram precision); every other unit (pcs, ea, units…)
  // prints as a whole number because half-pieces don't exist.
  function fmtQty(n: number | null | undefined, unit: string | null | undefined): string {
    if (n == null || isNaN(Number(n))) return "—";
    const v = Number(n);
    const u = (unit ?? "").trim().toLowerCase();
    if (u === "kg") {
      return v.toLocaleString("en-AU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
    return Math.round(v).toLocaleString("en-AU");
  }
  const dayDate = new Date(day + "T00:00:00");
  const dayLabel = dayDate.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // Group orders by machine ────────────────────────────────────────────────
  const machineGroups = useMemo(() => {
    const byMachine = new Map<string, Order[]>();
    for (const o of orders) {
      const k = o.machine_id ?? "__unassigned";
      const arr = byMachine.get(k) ?? [];
      arr.push(o);
      byMachine.set(k, arr);
    }
    const out: Array<{ machine: Machine | null; orders: Order[] }> = [];
    for (const m of machines) {
      const list = byMachine.get(m.id);
      if (list && list.length > 0) out.push({ machine: m, orders: list });
    }
    const unassigned = byMachine.get("__unassigned") ?? [];
    if (unassigned.length > 0) out.push({ machine: null, orders: unassigned });
    return out;
  }, [orders, machines]);

  const totalKg = orders.reduce((s, o) => s + (Number(o.planned_qty) || 0), 0);

  const rmList = useMemo(() => {
    const m = new Map<string, RmRow>();
    for (const r of rmRows) {
      const e = m.get(r.component_id);
      if (!e) m.set(r.component_id, { ...r });
      else e.required_qty += r.required_qty;
    }
    return [...m.values()].sort((a, b) => b.required_qty - a.required_qty);
  }, [rmRows]);

  function lineQty(line: RecipeLine, outputQty: number, refBatch: number, yieldFactor: number): number {
    if (yieldFactor <= 0) return 0;
    if ((line.unit ?? "").toLowerCase() === "kg" && line.percentage != null && line.percentage > 0) {
      return outputQty * (line.percentage / 100) / yieldFactor;
    }
    if (refBatch <= 0) return 0;
    return (line.qty_per_batch * outputQty / refBatch) / yieldFactor;
  }

  // Default recipe sort: category asc → total qty desc.
  function sortRecipe(rows: Array<RecipeLine & { _total: number; _single: number; _idx: number }>) {
    // Default: heaviest input first. Tino May 2026 — operators want to see
    // the biggest weight contributors at the top of every recipe.
    return [...rows].sort((a, b) => {
      const t = b._total - a._total;
      if (t !== 0) return t;
      return a._idx - b._idx;
    });
  }

  type PlanRow = { o: Order; idx: number; machineName: string };
  const planRows: PlanRow[] = orders.map((o, i) => ({
    o, idx: i + 1,
    machineName: machines.find(m => m.id === o.machine_id)?.name ?? (o.machine ?? "—"),
  }));
  const sortedPlan = applySort("plan", planRows, (r, col) => {
    switch (col) {
      case "code":     return r.o.item?.code ?? "";
      case "item":     return r.o.item?.name ?? "";
      case "machine":  return r.machineName;
      case "batches":  return r.o.n_of_batches ?? 1;
      case "batchSize":return Number(r.o.batch_size) || 0;
      case "total":    return Number(r.o.planned_qty) || 0;
      case "batchNo":  return r.o.batch_number;
      default:         return r.idx;
    }
  });
  const sortedRm = applySort("rm", rmList, (r, col) => {
    switch (col) {
      case "code":     return r.component_code;
      case "name":     return r.component_name;
      case "type":     return r.component_type;
      case "required": return r.required_qty;
      case "onhand":   return r.on_hand_qty;
      default:         return null;
    }
  });

  // Helper that wraps SortableTh with the closures bound to this component's
  // state. Pass it the table id + col id + label + a default width, plus
  // optional align/extraClass and it does the rest.
  function Th(props: {
    tableId: string;
    col: string;
    label: string;
    defaultWidth: number;
    align?: "left" | "right";
    extraClass?: string;
  }) {
    return (
      <SortableTh
        tableId={props.tableId}
        col={props.col}
        label={props.label}
        defaultWidth={props.defaultWidth}
        width={colWidths[`${props.tableId}.${props.col}`]}
        sortState={sortBy[props.tableId]}
        onSort={() => cycleSort(props.tableId, props.col)}
        onResize={(w) => setColWidth(props.tableId, props.col, w)}
        align={props.align}
        extraClass={props.extraClass}
      />
    );
  }

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .no-print { display: none !important; }
          .runsheet-page { page-break-after: always; }
          .runsheet-page:last-child { page-break-after: auto; }
          .rs-comments-empty { display: none !important; }
          .rs-resize-handle { display: none !important; }
        }
        .runsheet-page {
          padding: 16px 24px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #1c1917;
          max-width: 1100px;
          margin: 0 auto;
        }
        .rs-h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
        .rs-h2 { font-size: 1.1rem; font-weight: 700; margin: 1rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 2px solid #1c1917; }
        .rs-meta { color: #57534e; font-size: 0.85rem; margin-bottom: 0.5rem; }
        table.rs-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-bottom: 0.5rem; table-layout: fixed; }
        table.rs-table th, table.rs-table td {
          padding: 0.35rem 0.5rem; border-bottom: 1px solid #d6d3d1; vertical-align: top; overflow: hidden; text-overflow: ellipsis;
          word-break: break-word;
        }
        table.rs-table th {
          background: #fafaf9; font-weight: 700; font-size: 0.7rem;
          text-transform: uppercase; letter-spacing: 0.04em; color: #57534e;
          user-select: none; position: relative;
        }
        .rs-th-label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 2px 0; }
        .rs-th-label:hover { color: #1c1917; }
        .rs-th-arrow { font-size: 0.65rem; line-height: 1; }
        .rs-th-arrow.dim { opacity: 0.3; }
        .rs-resize-handle {
          position: absolute; top: 0; right: -3px; bottom: 0; width: 7px;
          cursor: col-resize; z-index: 2; background: transparent;
        }
        .rs-resize-handle:hover { background: rgba(37, 99, 235, 0.3); }
        .rs-resize-handle.dragging { background: rgba(37, 99, 235, 0.7); }
        .rs-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rs-mono { font-family: ui-monospace, SFMono-Regular, monospace; }
        .rs-totals { background: #fafaf9; font-weight: 700; }
        .rs-recipe-card {
          border: 1px solid #d6d3d1; border-radius: 6px; padding: 0.5rem 0.75rem;
          margin-bottom: 0.5rem;
        }
        .rs-recipe-card-h {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: 0.5rem; margin-bottom: 0.4rem;
        }
        .rs-recipe-card-title { font-weight: 700; font-size: 0.9rem; }
        .rs-recipe-card-qty { font-weight: 700; color: #166534; font-size: 0.9rem; white-space: nowrap; }
        .rs-page-mini { font-size: 0.7rem; color: #78716c; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.4rem; }
        .rs-cat-pill {
          display: inline-block; padding: 0.05rem 0.4rem; border-radius: 999px;
          font-size: 0.6rem; font-weight: 700; line-height: 1.4;
        }
        .rs-comments {
          margin-top: 0.875rem; border: 1px dashed #cfc9bf; border-radius: 6px;
          padding: 0.625rem 0.75rem; background: #fffbeb;
        }
        .rs-comments-label { font-size: 0.7rem; color: #854d0e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.25rem; }
        .rs-comments-body { font-size: 0.8125rem; color: #1c1917; min-height: 1.4em; white-space: pre-wrap; }
        .rs-comments-input {
          width: 100%; min-height: 60px; resize: vertical;
          border: 1px solid #fde68a; background: #fffbeb; border-radius: 4px;
          padding: 0.4rem 0.5rem; font: inherit; color: inherit;
        }
        .rs-toolbar-btn {
          padding: 0.5rem 0.875rem; border: 1px solid #d6d3d1;
          border-radius: 0.375rem; font-weight: 600; cursor: pointer;
          font-size: 0.8125rem; background: #fff; color: #1c1917;
        }
        .rs-toolbar-btn.primary { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
        .rs-toolbar-btn:hover { background: #f5f5f4; }
        .rs-toolbar-btn.primary:hover { background: #1e40af; }
        .rs-batchno-head {
          background: #fef3c7; color: #854d0e; padding: 1px 5px;
          border-radius: 3px; font-weight: 700; letter-spacing: 0.02em;
        }
        .rs-batchno-tail { color: #78716c; margin-left: 3px; }
      `}</style>

      {/* Toolbar — Print / Save layout / Reset / Close ────────────────── */}
      <div className="no-print" style={{ position: "fixed", top: 12, right: 12, zIndex: 1000, display: "flex", gap: 6 }}>
        <button className="rs-toolbar-btn" onClick={saveAsDefault} title="Remember current sort + column widths as the default for this department on this browser.">
          📌 Save as default
        </button>
        <button className="rs-toolbar-btn" onClick={clearDefaults} title="Forget saved sort + widths and revert to factory defaults.">
          ↺ Reset
        </button>
        <button className="rs-toolbar-btn primary" onClick={() => window.print()}>🖨 Print</button>
        <button className="rs-toolbar-btn" onClick={() => window.close()}>✕ Close</button>
      </div>
      {toast && (
        <div className="no-print" style={{ position: "fixed", top: 60, right: 12, zIndex: 1001, background: "#166534", color: "#fff", padding: "0.5rem 0.875rem", borderRadius: "0.375rem", fontSize: "0.8125rem", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
          {toast}
        </div>
      )}

      {/* ─── PAGE 1 — Total Plan ────────────────────────────────────────── */}
      <div className="runsheet-page">
        <h1 className="rs-h1">{deptEmoji} {deptLabel} — Run Sheet</h1>
        <div className="rs-meta">{dayLabel} · {orders.length} work order{orders.length === 1 ? "" : "s"} · total <strong>{fmtQty(totalKg, "kg")}{" "}kg</strong></div>

        <div className={`rs-comments ${dayComments.trim() ? "" : "rs-comments-empty"}`}>
          <div className="rs-comments-label">Planner notes for the day</div>
          <textarea
            className="rs-comments-input no-print"
            value={dayComments}
            onChange={e => setDayComments(e.target.value)}
            placeholder="Type any instructions for the floor team — e.g. priority orders, allergen alerts, equipment changes…"
          />
          <div className="rs-comments-body" style={{ display: "none" }}>{dayComments}</div>
          <style>{`@media print { .rs-comments-input { display: none; } .rs-comments .rs-comments-body { display: block !important; } }`}</style>
        </div>

        <h2 className="rs-h2">1. Total plan for the day</h2>
        <table className="rs-table">
          <thead>
            <tr>
              <Th tableId="plan" col="idx" label="#" defaultWidth={36} />
              <Th tableId="plan" col="code" label="Code" defaultWidth={90} />
              <Th tableId="plan" col="item" label="Item" defaultWidth={290} />
              <Th tableId="plan" col="machine" label="Machine" defaultWidth={130} />
              <Th tableId="plan" col="batches" label="Batches" defaultWidth={80} align="right" />
              <Th tableId="plan" col="batchSize" label="Batch size" defaultWidth={110} align="right" />
              <Th tableId="plan" col="total" label="Total qty" defaultWidth={110} align="right" />
              <Th tableId="plan" col="batchNo" label="Batch #" defaultWidth={130} />
            </tr>
          </thead>
          <tbody>
            {sortedPlan.map((r) => (
              <tr key={r.o.id}>
                <td className="rs-mono">{r.idx}</td>
                <td className="rs-mono">{r.o.item?.code ?? "—"}</td>
                <td>{r.o.item?.name ?? "—"}</td>
                <td>{r.machineName}</td>
                <td className="rs-num">{r.o.n_of_batches ?? 1}</td>
                <td className="rs-num">{fmtQty(Number(r.o.batch_size) || (Number(r.o.planned_qty) || 0), r.o.unit)}{" "}{r.o.unit}</td>
                <td className="rs-num"><strong>{fmtQty(Number(r.o.planned_qty) || 0, r.o.unit)}{" "}{r.o.unit}</strong></td>
                <td><BatchNo value={r.o.batch_number} /></td>
              </tr>
            ))}
            <tr className="rs-totals">
              <td colSpan={6}>Total</td>
              <td className="rs-num">{fmtQty(totalKg, "kg")}{" "}kg</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ─── PAGE 2 — RM Summary ────────────────────────────────────────── */}
      <div className="runsheet-page">
        <h1 className="rs-h1">{deptEmoji} {deptLabel} — RM Summary</h1>
        <div className="rs-meta">{dayLabel} · {sortedRm.length} component{sortedRm.length === 1 ? "" : "s"} required</div>
        {sortedRm.length === 0 ? (
          <p style={{ color: "#78716c", fontStyle: "italic" }}>No raw materials needed for this day&apos;s orders.</p>
        ) : (
          <table className="rs-table">
            <thead>
              <tr>
                <Th tableId="rm" col="code" label="Code" defaultWidth={110} />
                <Th tableId="rm" col="name" label="Component" defaultWidth={440} />
                <Th tableId="rm" col="type" label="Type" defaultWidth={100} />
                <Th tableId="rm" col="required" label="Required" defaultWidth={150} align="right" />
                <Th tableId="rm" col="onhand" label="On hand" defaultWidth={150} align="right" />
              </tr>
            </thead>
            <tbody>
              {sortedRm.map((r) => {
                const shortage = r.required_qty > r.on_hand_qty;
                return (
                  <tr key={r.component_id}>
                    <td className="rs-mono">{r.component_code}</td>
                    <td>{r.component_name}</td>
                    <td style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase" }}>{r.component_type}</td>
                    <td className="rs-num"><strong>{fmtQty(r.required_qty, r.component_unit)}{" "}{r.component_unit}</strong></td>
                    <td className="rs-num" style={{ color: shortage ? "#b91c1c" : "#166534", fontWeight: shortage ? 700 : 400 }}>
                      {fmtQty(r.on_hand_qty, r.component_unit)}{" "}{r.component_unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── PAGE 3+ — One section per machine ──────────────────────────── */}
      {machineGroups.map(({ machine, orders: machineOrders }) => {
        const machineKey = machine?.id ?? "__unassigned";
        const machineName = machine?.name ?? "Unassigned";
        const machineSubtotalKg = machineOrders.reduce((s, o) => s + (Number(o.planned_qty) || 0), 0);
        const summaryTableId = `mach-${machineKey}`;

        const summaryRows = machineOrders.map((o, i) => ({ o, idx: i + 1 }));
        const sortedSummary = applySort(summaryTableId, summaryRows, (r, col) => {
          switch (col) {
            case "code":     return r.o.item?.code ?? "";
            case "item":     return r.o.item?.name ?? "";
            case "batches":  return r.o.n_of_batches ?? 1;
            case "batchSize":return Number(r.o.batch_size) || 0;
            case "total":    return Number(r.o.planned_qty) || 0;
            case "batchNo":  return r.o.batch_number;
            default:         return r.idx;
          }
        });

        return (
          <Fragment key={machineKey}>
          {/* — Machine summary page (one per machine) — */}
          <div className="runsheet-page">
            <h1 className="rs-h1">{deptEmoji} {machineName}</h1>
            <div className="rs-meta">
              {dayLabel} · {machineOrders.length} WO · total <strong>{fmtQty(machineSubtotalKg, "kg")}{" "}kg</strong>
              {machine?.capacity_value ? <> · capacity {fmtQty(machine.capacity_value, machine.capacity_unit ?? "kg")}{" "}{machine.capacity_unit ?? "kg"}</> : null}
            </div>

            <h2 className="rs-h2">Plan summary</h2>
            <table className="rs-table">
              <thead>
                <tr>
                  <Th tableId={summaryTableId} col="idx" label="#" defaultWidth={40} />
                  <Th tableId={summaryTableId} col="code" label="Code" defaultWidth={100} />
                  <Th tableId={summaryTableId} col="item" label="Item" defaultWidth={360} />
                  <Th tableId={summaryTableId} col="batches" label="Batches" defaultWidth={85} align="right" />
                  <Th tableId={summaryTableId} col="batchSize" label="Batch size" defaultWidth={115} align="right" />
                  <Th tableId={summaryTableId} col="total" label="Total qty" defaultWidth={115} align="right" />
                  <Th tableId={summaryTableId} col="batchNo" label="Batch #" defaultWidth={140} />
                </tr>
              </thead>
              <tbody>
                {sortedSummary.map((r) => (
                  <tr key={r.o.id}>
                    <td className="rs-mono">{r.idx}</td>
                    <td className="rs-mono">{r.o.item?.code ?? "—"}</td>
                    <td>{r.o.item?.name ?? "—"}</td>
                    <td className="rs-num">{r.o.n_of_batches ?? 1}</td>
                    <td className="rs-num">{fmt(Number(r.o.batch_size) || (Number(r.o.planned_qty) || 0))} {r.o.unit}</td>
                    <td className="rs-num"><strong>{fmt(Number(r.o.planned_qty) || 0)} {r.o.unit}</strong></td>
                    <td><BatchNo value={r.o.batch_number} /></td>
                  </tr>
                ))}
                <tr className="rs-totals">
                  <td colSpan={5}>Machine total</td>
                  <td className="rs-num">{fmtQty(machineSubtotalKg, "kg")}{" "}kg</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

          </div>

          {/* — One recipe per page (browser may span to 2+ pages if long) — */}
          {machineOrders.map((o) => {
              const recipe = o.item ? bomByItem[o.item.id] : undefined;
              const outputQty = Number(o.planned_qty) || 0;
              const batchSize = Number(o.batch_size) || outputQty;
              const recipeTableId = `recipe-${o.id}`;

              if (!recipe || recipe.lines.length === 0) {
                return (
                  <div key={o.id} className="runsheet-page">
                    <div className="rs-page-mini">{deptEmoji} {machineName} · {dayLabel}</div>
                    <h1 className="rs-h1">Recipe — {o.item?.code} {o.item?.name}</h1>
                    <div className="rs-recipe-card">
                      <div className="rs-recipe-card-h">
                        <span className="rs-recipe-card-title">{o.item?.code} — {o.item?.name}</span>
                        <span className="rs-recipe-card-qty">{fmtQty(outputQty, o.unit)}{" "}{o.unit}</span>
                      </div>
                      <div style={{ color: "#b91c1c", fontStyle: "italic", fontSize: "0.8rem" }}>No active BOM defined for this item.</div>
                    </div>
                  </div>
                );
              }

              const computed = recipe.lines.map((line, lineIdx) => ({
                ...line,
                _idx: lineIdx,
                _single: lineQty(line, batchSize, recipe.reference_batch_size, recipe.yield_factor),
                _total:  lineQty(line, outputQty, recipe.reference_batch_size, recipe.yield_factor),
              }));
              // If the user hasn't picked a custom sort for this recipe, fall
              // back to the default (category asc → total desc). Once they
              // click a header the user-sort wins.
              const userSort = sortBy[recipeTableId];
              const baseRows = userSort ? computed : sortRecipe(computed);
              const sortedRecipe = applySort(recipeTableId, baseRows, (r, col) => {
                switch (col) {
                  case "category": return r.category_name ?? "~";
                  case "code":     return r.code;
                  case "name":     return r.name;
                  case "single":   return r._single;
                  case "total":    return r._total;
                  default:         return null;
                }
              });

              const totalSingle = computed.filter(l => (l.unit ?? "").toLowerCase() === "kg").reduce((s, l) => s + l._single, 0);
              const totalAll = computed.filter(l => (l.unit ?? "").toLowerCase() === "kg").reduce((s, l) => s + l._total, 0);

              return (
                <div key={o.id} className="runsheet-page">
                  <div className="rs-page-mini">{deptEmoji} {machineName} · {dayLabel}</div>
                  <h1 className="rs-h1">Recipe — {o.item?.code} {o.item?.name}</h1>
                  <div className="rs-recipe-card">
                  <div className="rs-recipe-card-h">
                    <span className="rs-recipe-card-title">
                      {o.item?.code} — {o.item?.name}{" "}
                      <span style={{ color: "#78716c", fontSize: "0.75rem", fontWeight: 400 }}>
                        · {o.n_of_batches ?? 1} batch{(o.n_of_batches ?? 1) === 1 ? "" : "es"} × {fmtQty(batchSize, o.unit)}{" "}{o.unit}
                        {" "}· batch <BatchNo value={o.batch_number} />
                      </span>
                    </span>
                    <span className="rs-recipe-card-qty">{fmt(outputQty)} {o.unit}</span>
                  </div>
                  <table className="rs-table" style={{ fontSize: "0.75rem", marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <Th tableId={recipeTableId} col="category" label="Category" defaultWidth={140} />
                        <Th tableId={recipeTableId} col="code" label="Code" defaultWidth={100} />
                        <Th tableId={recipeTableId} col="name" label="Component" defaultWidth={420} />
                        <Th tableId={recipeTableId} col="single" label="Single batch" defaultWidth={150} align="right" />
                        <Th tableId={recipeTableId} col="total" label="Total" defaultWidth={150} align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRecipe.map((line) => (
                        <tr key={line.bom_line_id ?? `${line.component_id}-${line._idx}`}>
                          <td>
                            {line.category_name ? (
                              <span
                                className="rs-cat-pill"
                                style={{
                                  background: line.category_color ?? "#e7e5e4",
                                  color: pickContrast(line.category_color ?? "#e7e5e4"),
                                }}
                              >
                                {line.category_name}
                              </span>
                            ) : (
                              <span style={{ color: "#a8a29e", fontStyle: "italic", fontSize: "0.7rem" }}>—</span>
                            )}
                          </td>
                          <td className="rs-mono">{line.code}</td>
                          <td>
                            {line.name}
                            {line.grind_size ? <span style={{ color: "#78716c", fontSize: "0.7rem" }}> · {line.grind_size}</span> : null}
                          </td>
                          <td className="rs-num">{fmtQty(line._single, line.unit)}{" "}{line.unit}</td>
                          <td className="rs-num"><strong>{fmtQty(line._total, line.unit)}{" "}{line.unit}</strong></td>
                        </tr>
                      ))}
                      <tr className="rs-totals">
                        <td colSpan={3}>Total (kg lines)</td>
                        <td className="rs-num">{fmtQty(totalSingle, "kg")}{" "}kg</td>
                        <td className="rs-num">{fmtQty(totalAll, "kg")}{" "}kg</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

// ─── SortableTh — header cell with click-to-sort + drag-to-resize ──────────
function SortableTh({
  tableId, col, label, defaultWidth, width, sortState, onSort, onResize, align = "left", extraClass,
}: {
  tableId: string;
  col: string;
  label: string;
  defaultWidth: number;
  width: number | undefined;
  sortState: SortState | undefined;
  onSort: () => void;
  onResize: (w: number) => void;
  align?: "left" | "right";
  extraClass?: string;
}) {
  const effective = width ?? defaultWidth;
  const active = sortState?.col === col;
  const arrow = active ? (sortState?.dir === "asc" ? "▲" : "▼") : "⇅";

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = effective;
    const target = e.currentTarget as HTMLElement;
    target.classList.add("dragging");
    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      onResize(Math.max(40, startW + dx));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      target.classList.remove("dragging");
      document.body.style.cursor = "";
    }
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Title (sortable area) is a span — keeps the rest of the th cell from
  // accidentally triggering sort when a click lands near the resize handle.
  return (
    <th
      style={{ width: effective, textAlign: align }}
      className={extraClass}
      data-table-id={tableId}
      data-col={col}
    >
      <span className="rs-th-label" onClick={onSort} title="Click to sort (asc → desc → clear)">
        <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span className={`rs-th-arrow ${active ? "" : "dim"}`}>{arrow}</span>
      </span>
      <span
        onMouseDown={onMouseDown}
        className="rs-resize-handle no-print"
        title="Drag to resize column"
      />
    </th>
  );
}

// ─── BatchNo — first 5 chars (year+day) highlighted, rest dimmed ───────────
function BatchNo({ value }: { value: string | null | undefined }) {
  if (!value) return <span style={{ color: "#a8a29e" }}>—</span>;
  const head = value.slice(0, 5);
  const tail = value.slice(5);
  return (
    <span className="rs-mono" style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>
      <span className="rs-batchno-head">{head}</span>
      {tail && <span className="rs-batchno-tail">{tail}</span>}
    </span>
  );
}

// Pick black or white text depending on background luminance so category
// pills stay legible whatever colour the operator picked.
function pickContrast(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 3 && h.length !== 6) return "#1c1917";
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#1c1917" : "#fafaf9";
}
