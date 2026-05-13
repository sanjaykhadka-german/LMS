"use client";

import React from "react";

/**
 * Cost-sheet renderer for /costings/[item_id].
 *
 * Stacks each BOM stage as its own card with two DataTables (RM, Labour)
 * + a stage subtotal. Below the stages: Overhead card + Pricing card
 * (COGS → +buffers → loaded cost → +margin = MINIMUM SELL PRICE).
 *
 * DataTable instances get sort + resize + sticky + column-toggle for
 * free. Storage keys are shared across all stages so resizing the RM
 * table's "Code" column in one stage updates every RM table on the
 * page — feels consistent and saves layout decisions.
 */

import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/data-table";

export type RmLine = {
  item_id: string; code: string; name: string; item_type: string; unit: string;
  qty_per_unit: number | string;
  unit_cost: number | string;
  line_cost: number | string;
  supplier_name: string | null;
  hierarchy_missing: boolean;
};

export type LabourLine = {
  department: string; step_name: string;
  people: number | string; minutes: number | string;
  ref_qty: number | string; ref_basis: string;
  dollars_per_kg_at_node: number | string;
  qty_at_node: number | string;
  contribution_per_unit: number | string;
  hierarchy_missing: boolean;
};

export type StageLosses = {
  production_loss_pct: number | string | null;
  cooking_loss_pct:    number | string | null;
  packing_loss_pct:    number | string | null;
  open_pack_pct:       number | string | null;
  giveaway_pct:        number | string | null;
  /** Filling Attributes' fill→target derived loss. Cooking loss falls back to
   *  this if cooking_loss_pct is null. Tino May 2026. */
  process_loss_pct:    number | string | null;
};

export type Stage = {
  bom_header_id: string;
  node_id: string;
  node_code: string;
  node_name: string;
  node_type: string;
  depth: number;
  rm_lines: RmLine[];
  labour_lines: LabourLine[];
  rm_subtotal: number | string;
  labour_subtotal: number | string;
  subtotal: number | string;
  losses: StageLosses;
};

export type CostCentre = { centre: string; amount: number };

export type OverheadInfo = {
  rate_per_kg: number | string;
  effective_from: string;
  source: "manual" | "derived";
  override_reason: string | null;
};

export type Buffers = {
  production_loss_pct: number;
  cooking_loss_pct: number;
  packing_loss_pct: number;
  open_pack_pct: number;
  giveaway_pct: number;
  depreciation_pct: number;
  sample_pct: number;
  product_dev_pct: number;
  error_pct: number;
  target_margin_pct: number;
  effective_from: string | null;
};

// Item-specific overrides — each is null if the item hasn't been audited.
// Priority on the breakdown page: item value > tenant default > 0.
export type ItemLosses = {
  production_loss_pct: number | null;
  cooking_loss_pct: number | null;
  packing_loss_pct: number | null;
  open_pack_pct: number | null;
  giveaway_pct: number | null;
};

// ── Formatting helpers ───────────────────────────────────────────────
function fmtMoney(v: unknown, dp = 4): string {
  if (v == null) return "—";
  const n = Number(v); if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtQty(v: unknown, dp = 6): string {
  if (v == null) return "—";
  const n = Number(v); if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function pct(part: number, whole: number): string {
  if (!whole || whole === 0) return "—";
  return ((part / whole) * 100).toFixed(1) + "%";
}

// ── Stage type → colour scheme for the section header chip ───────────
const STAGE_TINT: Record<string, { bg: string; fg: string; label: string }> = {
  finished_good: { bg: "#dcfce7", fg: "#166534", label: "FG"   },
  wipp:          { bg: "#fef3c7", fg: "#854d0e", label: "WIPP" },
  wipf:          { bg: "#fef3c7", fg: "#854d0e", label: "WIPF" },
  wip:           { bg: "#fef3c7", fg: "#854d0e", label: "WIP"  },
};

const COST_CENTRE_COLOURS = ["#1d4ed8","#0891b2","#0d9488","#65a30d","#ca8a04","#dc2626","#9333ea","#db2777"];

export default function BreakdownContent({
  itemName, itemUnit, itemType,
  totals, costCentres, stages, overhead, buffers, itemLosses,
}: {
  itemName: string;
  itemUnit: string;
  itemType: string;
  totals: { rm: number; labour: number; overhead: number; total: number };
  costCentres: CostCentre[];
  stages: Stage[];
  overhead: OverheadInfo | null;
  buffers: Buffers | null;
  itemLosses: ItemLosses;
}) {
  // ── Pricing buildup — walk the cascade for each loss's natural stage ──
  // Each loss has a "natural home" in the family tree (production at WIP,
  // cooking at WIPF, packing at WIPP, open pack at FG, giveaway at WIPP/FG).
  // Look up the loss at its preferred stages first; fall back to tenant
  // default if the natural stage doesn't carry a value. Cooking loss also
  // falls back to that stage's process_loss_pct (Filling Attributes
  // fill→target shrink) before the tenant default — Tino May 2026.
  type LossKey = keyof Omit<StageLosses, "process_loss_pct">;
  // Treat 0 the same as null/unset — a zero on an early stage shouldn't
  // short-circuit the walk and pretend it found a meaningful value.
  // Tino May 2026: WIPP showed "0% · 2052.060.6 (process)" because process
  // loss on the WIPP was explicitly 0, hiding the WIPF's 10.45 deeper.
  function isSet(v: unknown): v is number | string {
    if (v == null) return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  }
  function lossFromStages(
    key: LossKey,
    preferred: string[],
    tenantVal: number,
    rootFallback?: number | null,
  ): { value: number; source: string } {
    // 1) Try preferred stages by node_type first (closest natural home).
    for (const t of preferred) {
      const st = stages.find(s => s.node_type === t);
      if (st && st.losses && isSet(st.losses[key])) {
        return { value: Number(st.losses[key]), source: st.node_code };
      }
    }
    // 2) Any stage in the cascade with a non-zero value (covers BOMs that
    //    skip a natural level — e.g. WIPP → WIP without WIPF).
    for (const st of stages) {
      if (st.losses && isSet(st.losses[key])) {
        return { value: Number(st.losses[key]), source: `${st.node_code} (any stage)` };
      }
    }
    // 3) The root item's own column (rootFallback) when > 0.
    if (rootFallback != null && rootFallback > 0) {
      return { value: rootFallback, source: "this item" };
    }
    // 4) Tenant default.
    if (tenantVal > 0) return { value: tenantVal, source: "tenant default" };
    return { value: 0, source: "none" };
  }
  function cookingLossEffective(tenantVal: number): { value: number; source: string } {
    // 1) Explicit cooking_loss_pct anywhere in the cascade (prefer WIPF), > 0.
    const wipfStage = stages.find(s => s.node_type === "wipf");
    if (wipfStage?.losses && isSet(wipfStage.losses.cooking_loss_pct)) {
      return { value: Number(wipfStage.losses.cooking_loss_pct), source: `${wipfStage.node_code} (override)` };
    }
    for (const st of stages) {
      if (st.losses && isSet(st.losses.cooking_loss_pct)) {
        return { value: Number(st.losses.cooking_loss_pct), source: `${st.node_code} (override)` };
      }
    }
    // 2) process_loss_pct on WIPF (Filling Attributes fill→target default), > 0.
    if (wipfStage?.losses && isSet(wipfStage.losses.process_loss_pct)) {
      return { value: Number(wipfStage.losses.process_loss_pct), source: `${wipfStage.node_code} (process)` };
    }
    // 3) process_loss_pct on ANY stage > 0.
    for (const st of stages) {
      if (st.losses && isSet(st.losses.process_loss_pct)) {
        return { value: Number(st.losses.process_loss_pct), source: `${st.node_code} (process)` };
      }
    }
    // 4) Tenant default.
    if (tenantVal > 0) return { value: tenantVal, source: "tenant default" };
    return { value: 0, source: "none" };
  }

  const cogs = totals.total;
  const eProdLoss = lossFromStages("production_loss_pct", ["wip", "wipf"],          buffers?.production_loss_pct ?? 0, itemLosses.production_loss_pct);
  const eCookLoss = cookingLossEffective(                                            buffers?.cooking_loss_pct    ?? 0);
  const ePackLoss = lossFromStages("packing_loss_pct",    ["wipp", "wipf"],          buffers?.packing_loss_pct    ?? 0, itemLosses.packing_loss_pct);
  const eOpenPack = lossFromStages("open_pack_pct",       ["finished_good", "wipp"], buffers?.open_pack_pct       ?? 0, itemLosses.open_pack_pct);
  const eGiveaway = lossFromStages("giveaway_pct",        ["wipp", "finished_good"], buffers?.giveaway_pct        ?? 0, itemLosses.giveaway_pct);
  // Compounded losses — each loss applies to the running cost after prior
  // losses have been absorbed, because if you lose 5% in production you
  // physically need 1/0.95 of the input to ship 1 kg, and the next stage
  // works from THAT new basis. Marginal $ per loss line shown below.
  function compound(running: number, pct: number): { running: number; marginal: number } {
    if (pct <= 0 || pct >= 100) return { running, marginal: 0 };
    const next = running / (1 - pct / 100);
    return { running: next, marginal: next - running };
  }
  const step1 = compound(cogs,         eProdLoss.value);  const prodLossAmt = step1.marginal;
  const step2 = compound(step1.running, eCookLoss.value); const cookLossAmt = step2.marginal;
  const step3 = compound(step2.running, ePackLoss.value); const packLossAmt = step3.marginal;
  const step4 = compound(step3.running, eOpenPack.value); const openPackAmt = step4.marginal;
  const step5 = compound(step4.running, eGiveaway.value); const giveawayAmt = step5.marginal;
  const costAfterLosses = step5.running;
  // Markups apply to the post-loss cost basis (the actual cost of what ships,
  // including losses absorbed). Additive in the sense that each line is %
  // of that same basis — no further compounding.
  const deprAmt   = costAfterLosses * (buffers?.depreciation_pct ?? 0) / 100;
  const sampleAmt = costAfterLosses * (buffers?.sample_pct       ?? 0) / 100;
  const pdevAmt   = costAfterLosses * (buffers?.product_dev_pct  ?? 0) / 100;
  const errorAmt  = costAfterLosses * (buffers?.error_pct        ?? 0) / 100;
  const loadedCost = costAfterLosses + deprAmt + sampleAmt + pdevAmt + errorAmt;
  const marginPct  = buffers?.target_margin_pct ?? 0;
  const minSell    = (marginPct > 0 && marginPct < 100)
    ? loadedCost / (1 - marginPct / 100)
    : loadedCost;
  const marginUplift = minSell - loadedCost;

  // ── Column definitions (one set, used by every stage's tables) ──────
  const rmColumns: ColumnDef<RmLine & { id: string } & Record<string, unknown>>[] = [
    {
      key: "code", label: "Code", width: 130,
      render: (_v, row) => (
        <Link href={`/items/${row.item_id}`} style={{ color: "#b91c1c", textDecoration: "none", fontFamily: "monospace", fontSize: "0.75rem" }} title="Open this item (browser back returns to the cost sheet)">
          {row.code} <span style={{ color: "#a8a29e", fontSize: "0.65rem" }}>›</span>
        </Link>
      ),
    },
    {
      key: "name", label: "Item",
      render: (_v, row) => (
        <span>
          {row.name}
          {row.hierarchy_missing && (
            <span style={{ marginLeft: 6, color: "#b91c1c", fontSize: "0.7rem", fontWeight: 600 }} title="Qty couldn't compute — pack hierarchy missing">⚠ no pack</span>
          )}
        </span>
      ),
      footer: (rows) => (
        <span style={{ color: "#78716c", fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {rows.length} {rows.length === 1 ? "line" : "lines"} → total
        </span>
      ),
    },
    {
      key: "qty_per_unit", label: "Qty / unit", width: 120,
      render: (v) => <span style={{ fontFamily: "monospace" }}>{fmtQty(v, 6)}</span>,
    },
    { key: "unit", label: "UoM", width: 60 },
    {
      key: "unit_cost", label: "Unit cost", width: 110,
      render: (v) => {
        const n = Number(v ?? 0);
        if (n <= 0) return <span style={{ color: "#b91c1c", fontWeight: 600 }}>missing</span>;
        return <span style={{ fontFamily: "monospace" }}>{fmtMoney(v)}</span>;
      },
    },
    {
      key: "line_cost", label: "Line $", width: 110,
      render: (v) => {
        const n = Number(v ?? 0);
        if (n <= 0) return <span style={{ color: "#a8a29e" }}>—</span>;
        return <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(v)}</span>;
      },
      footer: (rows) => {
        const s = rows.reduce((a, r) => a + (Number(r.line_cost) || 0), 0);
        return s > 0
          ? <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#854d0e" }}>{fmtMoney(s)}</span>
          : <span style={{ color: "#a8a29e", fontFamily: "monospace" }}>—</span>;
      },
    },
    {
      key: "supplier_name", label: "Supplier",
      render: (v) => v ? String(v) : <span style={{ color: "#a8a29e" }}>—</span>,
    },
  ];

  function makeLabourColumns(bomHeaderId: string): ColumnDef<LabourLine & { id: string } & Record<string, unknown>>[] {
    return [
      { key: "department", label: "Department", width: 130 },
      {
        key: "step_name", label: "Step",
        render: (_v, row) => (
          <Link href={`/bom/${bomHeaderId}/routing`} style={{ color: "#b91c1c", textDecoration: "none" }} title="Open this BOM's routing (browser back returns)">
            {row.step_name}
            {row.hierarchy_missing && (
              <span style={{ marginLeft: 6, color: "#b91c1c", fontSize: "0.7rem", fontWeight: 600 }} title="Step couldn't compute — pack hierarchy missing">⚠</span>
            )}
            <span style={{ marginLeft: 4, color: "#a8a29e", fontSize: "0.65rem" }}>›</span>
          </Link>
        ),
        footer: (rows) => (
          <span style={{ color: "#78716c", fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {rows.length} {rows.length === 1 ? "step" : "steps"} → total
          </span>
        ),
      },
      {
        key: "people_min", label: "P · M", width: 80, sortable: false,
        render: (_v, row) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#57534e" }}>
            {fmtQty(row.people, 0)} · {fmtQty(row.minutes, 0)}m
          </span>
        ),
      },
      {
        key: "ref", label: "per", width: 100, sortable: false,
        render: (_v, row) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#57534e" }}>
            {fmtQty(row.ref_qty, 0)} {row.ref_basis}
          </span>
        ),
      },
      {
        key: "dollars_per_kg_at_node", label: "$/kg @ node", width: 110,
        render: (v) => Number(v) > 0
          ? <span style={{ fontFamily: "monospace", color: "#57534e" }}>{fmtMoney(v)}</span>
          : <span style={{ color: "#a8a29e" }}>—</span>,
      },
      {
        key: "qty_at_node", label: "Qty @ node", width: 110,
        render: (v) => <span style={{ fontFamily: "monospace", color: "#57534e" }}>{fmtQty(v, 4)}</span>,
      },
      {
        key: "contribution_per_unit", label: "Contribution", width: 120,
        render: (v) => Number(v) > 0
          ? <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{fmtMoney(v)}</span>
          : <span style={{ color: "#a8a29e" }}>—</span>,
        footer: (rows) => {
          const s = rows.reduce((a, r) => a + (Number(r.contribution_per_unit) || 0), 0);
          return s > 0
            ? <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#1d4ed8" }}>{fmtMoney(s)}</span>
            : <span style={{ color: "#a8a29e", fontFamily: "monospace" }}>—</span>;
        },
      },
    ];
  }

  return (
    <>
      {/* ── Totals card ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) 1.4fr", gap: "1rem", alignItems: "center" }}>
          <SummaryStat label="Raw materials" value={totals.rm}       grand={totals.total} color="#854d0e" />
          <SummaryStat label="Labour"        value={totals.labour}   grand={totals.total} color="#1d4ed8" />
          <SummaryStat label="Overhead"      value={totals.overhead} grand={totals.total} color="#7e22ce" />
          <SummaryStat label="COGS / unit"   value={totals.total}    grand={totals.total} color="#166534" emphasis />
          <StackedBar  rm={totals.rm} labour={totals.labour} overhead={totals.overhead} total={totals.total} />
        </div>
        <div style={{ marginTop: "0.6rem", fontSize: "0.7rem", color: "#78716c" }}>
          All values per <strong>1 {itemUnit}</strong> of {itemName}.
        </div>
      </div>

      {/* ── Cost centres chip strip (labour by dept across all stages) ── */}
      {costCentres.length > 0 && (
        <div className="card" style={{ padding: "0.75rem 1.25rem", marginBottom: "1rem" }}>
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 700 }}>
            Labour by cost centre
          </h2>
          <CostCentreBar
            centres={costCentres}
            totalLabour={totals.labour}
          />
        </div>
      )}

      {/* ── Stage cards ─────────────────────────────────────────────── */}
      {stages.length === 0 && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem", textAlign: "center", color: "#a8a29e" }}>
          No active BOM for this item — no cascade to show.
        </div>
      )}
      {stages.map(stage => {
        const tint = STAGE_TINT[stage.node_type] ?? { bg: "#f5f5f4", fg: "#57534e", label: stage.node_type };
        const rmRows  = (stage.rm_lines     ?? []).map(r => ({ ...r, id: r.item_id })) as (RmLine & { id: string } & Record<string, unknown>)[];
        const labRows = (stage.labour_lines ?? []).map((l, i) => ({ ...l, id: `${stage.bom_header_id}-${i}` })) as (LabourLine & { id: string } & Record<string, unknown>)[];
        const subtotalN = Number(stage.subtotal);
        return (
          <div key={stage.bom_header_id} className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ background: tint.bg, color: tint.fg, padding: "0.1rem 0.45rem", borderRadius: "999px", fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {tint.label}
                </span>
                <span style={{ fontSize: "0.7rem", color: "#a8a29e" }}>depth {stage.depth}</span>
                <Link href={`/bom/${stage.bom_header_id}`} style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#b91c1c", textDecoration: "none" }} title="Open the BOM (browser back returns)">
                  {stage.node_code} <span style={{ color: "#a8a29e", fontSize: "0.65rem" }}>›</span>
                </Link>
                <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>{stage.node_name}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.65rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Stage subtotal</div>
                <div style={{ fontSize: "1.1rem", fontFamily: "monospace", fontWeight: 700, color: "#166534" }}>
                  {fmtMoney(subtotalN, 4)}
                  <span style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 400, marginLeft: 4 }}>
                    {pct(subtotalN, totals.total)} of total
                  </span>
                </div>
              </div>
            </div>

            {/* RM table — DataTable wraps in its own toolbar; the title sits above it. */}
            {rmRows.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "#854d0e", fontWeight: 700 }}>
                  Raw materials at this stage
                  <span style={{ marginLeft: "0.4rem", fontWeight: 400, fontSize: "0.7rem", color: "#78716c" }}>
                    ({rmRows.length} line{rmRows.length === 1 ? "" : "s"}, RM subtotal {fmtMoney(stage.rm_subtotal)})
                  </span>
                </h3>
                <DataTable
                  columns={rmColumns}
                  data={rmRows}
                  storageKey="breakdown.rm.v1"
                  emptyMessage="No RM at this stage."
                  stickyHeader={false}
                />
              </div>
            )}

            {/* Labour table */}
            {labRows.length > 0 && (
              <div>
                <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "#1d4ed8", fontWeight: 700 }}>
                  Labour at this stage
                  <span style={{ marginLeft: "0.4rem", fontWeight: 400, fontSize: "0.7rem", color: "#78716c" }}>
                    ({labRows.length} step{labRows.length === 1 ? "" : "s"}, labour subtotal {fmtMoney(stage.labour_subtotal)})
                  </span>
                </h3>
                <DataTable
                  columns={makeLabourColumns(stage.bom_header_id)}
                  data={labRows}
                  storageKey="breakdown.labour.v1"
                  emptyMessage="No labour steps at this stage."
                  stickyHeader={false}
                />
              </div>
            )}

            {rmRows.length === 0 && labRows.length === 0 && (
              <div style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>No RM or labour at this stage (BOM links straight through to its single child).</div>
            )}
          </div>
        );
      })}

      {/* ── Overhead card ───────────────────────────────────────────── */}
      <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", fontWeight: 700 }}>Overhead</h2>
        {overhead == null || Number(overhead.rate_per_kg) === 0 ? (
          <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>
            {itemType === "raw_material" || itemType === "packaging" || itemType === "consumable"
              ? <>This item type doesn&apos;t absorb plant overhead — OH allocates to producibles only.</>
              : <>No standard overhead rate set. <Link href="/costings/overheads" style={{ color: "#b91c1c" }}>Set it on /costings/overheads</Link>.</>}
          </div>
        ) : (
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <KV label="Standard rate"  value={`${fmtMoney(overhead.rate_per_kg)} /${itemUnit}`} colour="#7e22ce" big />
            <KV label="Effective from" value={String(overhead.effective_from)} />
            <KV label="Source"         value={overhead.source} />
            {overhead.override_reason && (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Override reason</div>
                <div style={{ fontSize: "0.8125rem", fontStyle: "italic", color: "#57534e" }}>{overhead.override_reason}</div>
              </div>
            )}
            <Link href="/costings/overheads" className="btn-secondary" style={{ marginLeft: "auto", fontSize: "0.75rem" }}>Edit</Link>
          </div>
        )}
      </div>

      {/* ── Pricing buildup ──────────────────────────────────────────── */}
      <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>Pricing — minimum sell</h2>
          <Link href="/costings/pricing" style={{ fontSize: "0.75rem", color: "#b91c1c" }}>Edit buffers →</Link>
        </div>
        {!buffers ? (
          <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>
            No pricing buffers set yet. <Link href="/costings/pricing" style={{ color: "#b91c1c" }}>Set them on /costings/pricing</Link>.
          </div>
        ) : (
          <div style={{ maxWidth: 540 }}>
            <BuildupRow label="COGS / unit" value={cogs} bold />
            <div style={{ fontSize: "0.65rem", color: "#a8a29e", padding: "0 0.05rem 0.15rem", fontStyle: "italic" }}>
              Loss percentages compound — each line is the marginal cost on top of the running total above it.
            </div>

            {/* ── Section 1 — Direct production losses (red) ────────────── */}
            <CostSection label="Direct losses" tint="red" subtotal={prodLossAmt + cookLossAmt + packLossAmt + openPackAmt + giveawayAmt} subtotalLabel="Direct losses subtotal" runningTotal={costAfterLosses}>
              <BuildupRow label={`+ Production loss (${eProdLoss.value}%)`} hint={eProdLoss.source} value={prodLossAmt} subtle />
              <BuildupRow label={`+ Cooking buffer (${eCookLoss.value}%)`}  hint={eCookLoss.source} value={cookLossAmt} subtle />
              <BuildupRow label={`+ Packing loss (${ePackLoss.value}%)`}    hint={ePackLoss.source} value={packLossAmt} subtle />
              <BuildupRow label={`+ Open packs (${eOpenPack.value}%)`}      hint={eOpenPack.source} value={openPackAmt} subtle />
              <BuildupRow label={`+ Giveaway (${eGiveaway.value}%)`}        hint={eGiveaway.source} value={giveawayAmt} subtle />
            </CostSection>

            {/* ── Section 2 — Indirect costs (blue) ─────────────────────── */}
            <CostSection label="Indirect costs" tint="blue" subtotal={deprAmt + sampleAmt + pdevAmt + errorAmt} subtotalLabel="Indirect costs subtotal" runningTotal={loadedCost}>
              <BuildupRow label={`+ Depreciation (${buffers.depreciation_pct}%)`}  value={deprAmt}   subtle />
              <BuildupRow label={`+ Samples / QA (${buffers.sample_pct}%)`}        value={sampleAmt} subtle />
              <BuildupRow label={`+ Product dev (${buffers.product_dev_pct}%)`}    value={pdevAmt}   subtle />
              <BuildupRow label={`+ Error margin (${buffers.error_pct}%)`}         value={errorAmt}  subtle />
            </CostSection>

            <Divider />
            <BuildupRow label="= Loaded cost" value={loadedCost} bold />

            {/* ── Section 3 — Profit buffer (green) ─────────────────────── */}
            <CostSection label="Profit buffer" tint="green" subtotal={marginUplift} subtotalLabel="Profit buffer subtotal" runningTotal={minSell} hideSubtotalWhenSingle>
              <BuildupRow label={`+ Target margin uplift (${buffers.target_margin_pct}%)`} value={marginUplift} subtle />
            </CostSection>

            <Divider thick />
            <BuildupRow label="MINIMUM SELL PRICE" value={minSell} emphasis unit={itemUnit} />
            {marginPct >= 100 && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#b91c1c" }}>
                Target margin must be &lt; 100% (else price → ∞).
              </div>
            )}
            {buffers.effective_from && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "#a8a29e" }}>
                Buffers effective from <span style={{ fontFamily: "monospace" }}>{buffers.effective_from}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

const SECTION_TINTS: Record<"red" | "blue" | "green", { border: string; bg: string; label: string }> = {
  red:   { border: "#fca5a5", bg: "#fef2f2", label: "#b91c1c" },
  blue:  { border: "#93c5fd", bg: "#eff6ff", label: "#1d4ed8" },
  green: { border: "#86efac", bg: "#f0fdf4", label: "#15803d" },
};

function CostSection({ label, tint, subtotal, subtotalLabel, runningTotal, hideSubtotalWhenSingle, children }: {
  label: string;
  tint: "red" | "blue" | "green";
  subtotal: number;
  subtotalLabel: string;
  /** Cumulative cost after this section's subtotal is applied. Shown alongside
   *  the marginal subtotal so the user can read "+$0.6334 → $8.2184" and
   *  follow the compounding total down the card. */
  runningTotal?: number;
  hideSubtotalWhenSingle?: boolean;
  children: React.ReactNode;
}) {
  const c = SECTION_TINTS[tint];
  const childArr = React.Children.toArray(children);
  // Don't double-print a subtotal when the section has only one line — for
  // the profit buffer where line-amount === section-total. But we still
  // want the runningTotal to print so the cumulative chain stays unbroken.
  const showSubtotalLabel = !(hideSubtotalWhenSingle && childArr.length <= 1);
  const fmtAud = (n: number) =>
    n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return (
    <div style={{
      borderLeft: `3px solid ${c.border}`,
      background: c.bg,
      borderRadius: "0 0.375rem 0.375rem 0",
      padding: "0.45rem 0.6rem 0.5rem",
      marginTop: "0.5rem",
      marginBottom: "0.5rem",
    }}>
      <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: c.label, marginBottom: "0.25rem" }}>
        {label}
      </div>
      {children}
      {(showSubtotalLabel || runningTotal != null) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "0.3rem", paddingTop: "0.3rem", borderTop: `1px dashed ${c.border}`, fontSize: "0.8125rem", fontWeight: 600, color: c.label, gap: "0.5rem" }}>
          <span>{showSubtotalLabel ? subtotalLabel : ""}</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: "0.625rem", fontFamily: "monospace" }}>
            {showSubtotalLabel && (
              <span>+{fmtAud(subtotal)}</span>
            )}
            {runningTotal != null && (
              <span style={{ color: c.label, opacity: 0.85, fontWeight: 700 }}>
                <span style={{ color: "#a8a29e", fontWeight: 400, fontStyle: "italic", marginRight: "0.2rem" }}>→</span>
                {fmtAud(runningTotal)}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, grand, color, emphasis = false }: {
  label: string; value: number; grand: number; color: string; emphasis?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: "0.65rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: emphasis ? "1.4rem" : "1.1rem", fontFamily: "monospace", fontWeight: 700, color }}>
        {fmtMoney(value, 4)}
      </div>
      <div style={{ fontSize: "0.7rem", color: "#a8a29e" }}>
        {grand > 0 ? pct(value, grand) + " of total" : "—"}
      </div>
    </div>
  );
}

function StackedBar({ rm, labour, overhead, total }: { rm: number; labour: number; overhead: number; total: number }) {
  if (total <= 0) return <div style={{ fontSize: "0.7rem", color: "#a8a29e" }}>No cost data.</div>;
  const rmPct  = (rm       / total) * 100;
  const labPct = (labour   / total) * 100;
  const ohPct  = (overhead / total) * 100;
  return (
    <div>
      <div style={{ display: "flex", height: 24, borderRadius: "0.3rem", overflow: "hidden", border: "1px solid #e7e5e4" }}>
        {rm        > 0 && <div style={{ width: `${rmPct}%`,  background: "#fde68a" }} title={`RM ${rmPct.toFixed(1)}%`} />}
        {labour    > 0 && <div style={{ width: `${labPct}%`, background: "#bfdbfe" }} title={`Labour ${labPct.toFixed(1)}%`} />}
        {overhead  > 0 && <div style={{ width: `${ohPct}%`,  background: "#e9d5ff" }} title={`Overhead ${ohPct.toFixed(1)}%`} />}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.4rem", fontSize: "0.7rem", color: "#57534e" }}>
        <Legend color="#fde68a" label="RM" />
        <Legend color="#bfdbfe" label="Labour" />
        <Legend color="#e9d5ff" label="OH" />
      </div>
    </div>
  );
}

function CostCentreBar({ centres, totalLabour }: { centres: CostCentre[]; totalLabour: number }) {
  if (centres.length === 0 || totalLabour <= 0) {
    return <div style={{ fontSize: "0.75rem", color: "#a8a29e" }}>No labour entered yet.</div>;
  }
  return (
    <div>
      <div style={{ display: "flex", height: 22, borderRadius: "0.3rem", overflow: "hidden", border: "1px solid #e7e5e4" }}>
        {centres.map((c, i) => {
          const widthPct = (c.amount / totalLabour) * 100;
          return widthPct > 0 ? (
            <div
              key={c.centre}
              style={{ width: `${widthPct}%`, background: COST_CENTRE_COLOURS[i % COST_CENTRE_COLOURS.length] }}
              title={`${c.centre} ${widthPct.toFixed(1)}% — ${fmtMoney(c.amount)}`}
            />
          ) : null;
        })}
      </div>
      <div style={{ display: "flex", gap: "0.875rem", marginTop: "0.5rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
        {centres.map((c, i) => (
          <span key={c.centre} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#57534e" }}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COST_CENTRE_COLOURS[i % COST_CENTRE_COLOURS.length] }} />
            <strong>{c.centre}</strong>
            <span style={{ fontFamily: "monospace", color: "#1c1917" }}>{fmtMoney(c.amount)}</span>
            <span style={{ color: "#78716c" }}>({((c.amount / totalLabour) * 100).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ display: "inline-block", width: 10, height: 10, background: color, borderRadius: 2, border: "1px solid #e7e5e4" }} />
      {label}
    </span>
  );
}

function KV({ label, value, colour = "#1c1917", big = false }: { label: string; value: string; colour?: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: big ? "1.4rem" : "0.875rem", fontFamily: "monospace", fontWeight: big ? 700 : 500, color: colour }}>{value}</div>
    </div>
  );
}

function BuildupRow({ label, value, hint, bold = false, subtle = false, emphasis = false, unit }: {
  label: string; value: number; hint?: string; bold?: boolean; subtle?: boolean; emphasis?: boolean; unit?: string;
}) {
  // hint is a free-form source string (e.g. "FG override", "WIPF (process)",
  // "tenant default", "none"). Empty / "none" → no chip rendered.
  const hintLabel = hint && hint !== "none" ? ` · ${hint}` : "";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.2rem 0" }}>
      <span style={{
        fontSize: subtle ? "0.78rem" : emphasis ? "0.95rem" : "0.85rem",
        color: subtle ? "#78716c" : "#1c1917",
        fontWeight: emphasis ? 700 : bold ? 700 : 400,
        textTransform: emphasis ? "uppercase" : "none",
        letterSpacing: emphasis ? "0.04em" : 0,
      }}>{label}{hintLabel && (
        <span style={{
          marginLeft: 6, fontSize: "0.65rem", fontStyle: "italic",
          color: (hint === "tenant default" || hint === "none") ? "#a8a29e" : "#166534",
        }}>{hintLabel}</span>
      )}</span>
      <span style={{
        fontFamily: "monospace",
        fontWeight: emphasis ? 700 : bold ? 700 : 500,
        fontSize: emphasis ? "1.4rem" : bold ? "0.95rem" : "0.85rem",
        color: emphasis ? "#166534" : subtle ? "#78716c" : "#1c1917",
      }}>
        {emphasis
          ? <>{ "$" + value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
              {unit && <span style={{ fontSize: "0.7rem", color: "#78716c", fontWeight: 400, marginLeft: 4 }}>/{unit}</span>}
            </>
          : fmtMoney(value, 4)}
      </span>
    </div>
  );
}

function Divider({ thick = false }: { thick?: boolean }) {
  return <hr style={{ border: 0, borderTop: thick ? "2px solid #1c1917" : "1px solid #cfc9bf", margin: "0.3rem 0" }} />;
}
