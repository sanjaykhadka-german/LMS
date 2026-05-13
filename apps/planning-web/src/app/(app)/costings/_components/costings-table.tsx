"use client";

import { useMemo, useState } from "react";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { useRouter } from "next/navigation";

export type CostingRow = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  category: string | null;
  unit: string;
  manual_standard_cost: number | null;
  rm_cost_per_unit: number;
  // v3 (mig 129) extras
  labour_cost_per_unit: number;
  overhead_cost_per_unit: number;
  total_cost_per_unit: number;
  labour_hierarchy_missing: boolean;
  component_count: number;
  leaves_missing_cost: number;
  leaves_missing_hierarchy: number;
  has_active_bom: boolean;
  variance_pct: number | null;
};

// Type filter — defaults to FG + WIPs (the things we actually want to cost).
// Toggleable so the planner can inspect raw materials or packaging cost too.
const TYPE_GROUPS: { value: string; label: string; types: string[] }[] = [
  { value: "producible", label: "FGs + WIPs",    types: ["finished_good", "wip", "wipf", "wipp"] },
  { value: "fg",         label: "Finished goods", types: ["finished_good"] },
  { value: "wip",        label: "WIPs only",     types: ["wip", "wipf", "wipp"] },
  { value: "raw",        label: "Raw materials", types: ["raw_material"] },
  { value: "packaging",  label: "Packaging",     types: ["packaging"] },
  { value: "all",        label: "All items",     types: [] },
];

function fmtMoney(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "—";
  return "$" + Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// Sum a numeric field across rows and render a styled cell. Renders as "—"
// when the sum is 0 (e.g. nobody has populated labour yet). Tino May 2026.
function sumFooter(key: keyof CostingRow, accent = "#166534") {
  return (rows: (CostingRow & Record<string, unknown>)[]) => {
    let s = 0;
    for (const r of rows) {
      const v = Number(r[key] ?? 0);
      if (Number.isFinite(v)) s += v;
    }
    if (s <= 0) return <span style={{ color: "#a8a29e", fontFamily: "monospace" }}>—</span>;
    return (
      <span style={{ fontFamily: "monospace", fontWeight: 700, color: accent }}>
        {"$" + s.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  };
}

// Item types get tinted pills so the eye can scan by category.
const TYPE_TINT: Record<string, { bg: string; fg: string }> = {
  finished_good: { bg: "#dcfce7", fg: "#166534" },
  wip:           { bg: "#fef3c7", fg: "#854d0e" },
  wipf:          { bg: "#fef3c7", fg: "#854d0e" },
  wipp:          { bg: "#fef3c7", fg: "#854d0e" },
  raw_material:  { bg: "#fee2e2", fg: "#991b1b" },
  packaging:     { bg: "#e0e7ff", fg: "#3730a3" },
  consumable:    { bg: "#f3e8ff", fg: "#6b21a8" },
};

export default function CostingsTable({ rows }: { rows: CostingRow[] }) {
  // Filters
  const [typeGroup, setTypeGroup] = useState<string>("producible");
  const [showMissing, setShowMissing] = useState<"all" | "missing" | "ok">("all");
  const [search, setSearch] = useState("");

  // Row click → navigate to the per-product breakdown page. The previous
  // implementation opened the Test Product modal; that's still reachable
  // from each item's own page. The breakdown page is the more useful drill
  // for "explain this product's $/kg".
  const router = useRouter();

  // Filter the row set.
  const filtered = useMemo(() => {
    const group = TYPE_GROUPS.find(g => g.value === typeGroup) ?? TYPE_GROUPS[0];
    const types = new Set(group.types);
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (group.types.length > 0 && !types.has(r.item_type)) return false;
      if (showMissing === "missing" && r.leaves_missing_cost === 0) return false;
      if (showMissing === "ok"      && r.leaves_missing_cost > 0)   return false;
      if (q && !r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, typeGroup, showMissing, search]);

  // Rolling totals for the bar across the top.
  const totals = useMemo(() => {
    const n = filtered.length;
    const noBom = filtered.filter(r => !r.has_active_bom && (r.item_type === "finished_good" || r.item_type.startsWith("wip"))).length;
    const noCost = filtered.filter(r => r.rm_cost_per_unit === 0).length;
    const withMissing = filtered.filter(r => r.leaves_missing_cost > 0).length;
    const avgTotal = n === 0 ? 0 : filtered.reduce((s, r) => s + r.total_cost_per_unit, 0) / n;
    return { n, noBom, noCost, withMissing, avgTotal };
  }, [filtered]);

  const columns: ColumnDef<CostingRow & Record<string, unknown>>[] = [
    {
      key: "code",
      label: "Code",
      width: 110,
      render: (v) => (
        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#57534e" }}>
          {String(v ?? "")}
        </span>
      ),
    },
    {
      key: "name",
      label: "Name",
      width: 320,
      footer: (rows) => (
        <span style={{ color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {rows.length} {rows.length === 1 ? "item" : "items"} → sums
        </span>
      ),
    },
    {
      key: "item_type",
      label: "Type",
      width: 110,
      render: (v) => {
        const t = String(v ?? "");
        const tint = TYPE_TINT[t] ?? { bg: "#fafaf9", fg: "#57534e" };
        return (
          <span style={{
            background: tint.bg, color: tint.fg,
            padding: "0.1rem 0.45rem", borderRadius: "999px",
            fontSize: "0.65rem", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.04em",
          }}>{t.replace("_", " ")}</span>
        );
      },
    },
    {
      key: "category",
      label: "Category",
      width: 140,
      render: (v) => v ? String(v) : <span style={{ color: "#a8a29e" }}>—</span>,
    },
    {
      key: "unit",
      label: "Unit",
      width: 60,
    },
    {
      key: "rm_cost_per_unit",
      label: "RM / unit",
      width: 110,
      render: (v) => {
        const n = Number(v ?? 0);
        if (n === 0) return <span style={{ color: "#a8a29e" }}>—</span>;
        return (
          <span style={{ fontFamily: "monospace", color: "#57534e", fontSize: "0.8125rem" }}>
            {fmtMoney(n)}
          </span>
        );
      },
      footer: sumFooter("rm_cost_per_unit", "#854d0e"),
    },
    {
      key: "labour_cost_per_unit",
      label: "Labour / unit",
      width: 110,
      render: (v, row) => {
        const n = Number(v ?? 0);
        if (n === 0) return <span style={{ color: "#a8a29e" }} title={row.labour_hierarchy_missing ? "Some routing steps can't compute qty — missing pack hierarchy on the BOM's item" : "No routing entered (or hourly rate not set)"}>—</span>;
        return (
          <span style={{ fontFamily: "monospace", color: "#57534e", fontSize: "0.8125rem" }}>
            {fmtMoney(n)}
            {row.labour_hierarchy_missing && (
              <span style={{ marginLeft: 4, color: "#b91c1c", fontSize: "0.7rem" }} title="Some routing steps couldn't compute — pack hierarchy missing">⚠</span>
            )}
          </span>
        );
      },
      footer: sumFooter("labour_cost_per_unit", "#1d4ed8"),
    },
    {
      key: "overhead_cost_per_unit",
      label: "OH / unit",
      width: 100,
      render: (v) => {
        const n = Number(v ?? 0);
        if (n === 0) return <span style={{ color: "#a8a29e" }} title="Standard overhead rate not set, or item not producible">—</span>;
        return (
          <span style={{ fontFamily: "monospace", color: "#57534e", fontSize: "0.8125rem" }}>
            {fmtMoney(n)}
          </span>
        );
      },
      footer: sumFooter("overhead_cost_per_unit", "#7e22ce"),
    },
    {
      key: "total_cost_per_unit",
      label: "Total / unit",
      width: 130,
      render: (v, row) => {
        const n = Number(v ?? 0);
        if (n === 0) return <span style={{ color: "#b91c1c", fontWeight: 600 }} title="No cost computed">—</span>;
        return (
          <span style={{
            fontFamily: "monospace", fontWeight: 700,
            color: "#166534", fontSize: "0.9rem",
          }}>
            {fmtMoney(n)} <span style={{ color: "#78716c", fontSize: "0.7rem", fontWeight: 400 }}>/ {row.unit}</span>
          </span>
        );
      },
      footer: sumFooter("total_cost_per_unit", "#166534"),
    },
    {
      key: "manual_standard_cost",
      label: "Manual override",
      width: 130,
      render: (v) => {
        if (v == null) return <span style={{ color: "#a8a29e" }}>—</span>;
        return (
          <span style={{ fontFamily: "monospace", color: "#1c1917" }} title="items.standard_cost — manually set, takes precedence in v_item_cost_health">
            {fmtMoney(Number(v))}
          </span>
        );
      },
    },
    {
      key: "variance_pct",
      label: "Variance vs manual",
      width: 140,
      render: (v) => {
        if (v == null) return <span style={{ color: "#a8a29e" }}>—</span>;
        const n = Number(v);
        const abs = Math.abs(n);
        const tint = abs < 5  ? { bg: "#dcfce7", fg: "#166534" }
                  : abs < 15 ? { bg: "#fef3c7", fg: "#854d0e" }
                  :             { bg: "#fee2e2", fg: "#991b1b" };
        const sign = n > 0 ? "+" : "";
        return (
          <span style={{
            background: tint.bg, color: tint.fg,
            padding: "0.1rem 0.5rem", borderRadius: "999px",
            fontSize: "0.72rem", fontWeight: 700, fontFamily: "monospace",
          }}
            title={
              n > 0
                ? `Computed total cost is ${abs.toFixed(1)}% HIGHER than the manual standard — standard may be stale`
                : `Computed total cost is ${abs.toFixed(1)}% LOWER than the manual standard — could be undercounted (missing data) or recipe is more efficient than the standard reflects`
            }
          >
            {sign}{n.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "component_count",
      label: "Components",
      width: 100,
      render: (v) => (
        <span style={{ fontFamily: "monospace", color: "#78716c", fontSize: "0.8125rem" }}>
          {String(v ?? 0)}
        </span>
      ),
    },
    {
      key: "leaves_missing_cost",
      label: "Health",
      width: 130,
      render: (v, row) => {
        const missingCost = Number(v ?? 0);
        const missingHier = Number(row.leaves_missing_hierarchy ?? 0);
        if (!row.has_active_bom && (row.item_type === "finished_good" || row.item_type.startsWith("wip"))) {
          return (
            <span style={{
              background: "#fee2e2", color: "#991b1b",
              padding: "0.1rem 0.5rem", borderRadius: "999px",
              fontSize: "0.7rem", fontWeight: 700,
            }} title="No active BOM defined for this producible item">No BOM</span>
          );
        }
        // Stack chips when both failure modes apply.
        const chips: React.ReactNode[] = [];
        if (missingHier > 0) {
          chips.push(
            <span key="hier" style={{
              background: "#fee2e2", color: "#991b1b",
              padding: "0.1rem 0.5rem", borderRadius: "999px",
              fontSize: "0.7rem", fontWeight: 700,
            }} title={`${missingHier} packaging line${missingHier === 1 ? "" : "s"} can't compute qty — pack hierarchy (target_weight_g + units_per_inner/outer/pallet) not set on item or any ancestor`}>
              {missingHier} no pack
            </span>
          );
        }
        if (missingCost > 0) {
          chips.push(
            <span key="cost" style={{
              background: "#fef3c7", color: "#854d0e",
              padding: "0.1rem 0.5rem", borderRadius: "999px",
              fontSize: "0.7rem", fontWeight: 700,
            }} title={`${missingCost} leaf component${missingCost === 1 ? "" : "s"} missing supplier price — cost is undercounted`}>
              {missingCost} no $
            </span>
          );
        }
        if (chips.length === 0 && row.rm_cost_per_unit > 0) {
          return (
            <span style={{
              background: "#dcfce7", color: "#166534",
              padding: "0.1rem 0.5rem", borderRadius: "999px",
              fontSize: "0.7rem", fontWeight: 700,
            }} title="All cascade leaves have supplier prices and pack hierarchy">Ready</span>
          );
        }
        if (chips.length === 0) return <span style={{ color: "#a8a29e" }}>—</span>;
        return <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>{chips}</span>;
      },
    },
  ];

  return (
    <div>
      {/* Filter / KPI bar */}
      <div style={{
        display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center",
        padding: "0.625rem 0.875rem", marginBottom: "0.625rem",
        background: "white", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
      }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#fafaf9", borderRadius: "0.375rem" }}>
          {TYPE_GROUPS.map(g => (
            <button
              key={g.value}
              onClick={() => setTypeGroup(g.value)}
              style={{
                padding: "0.35rem 0.75rem", fontSize: "0.75rem", fontWeight: 600,
                border: 0,
                borderRadius: "0.3rem",
                background: g.value === typeGroup ? "#1c1917" : "transparent",
                color: g.value === typeGroup ? "#fff" : "#57534e",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >{g.label}</button>
          ))}
        </div>

        <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#fafaf9", borderRadius: "0.375rem" }}>
          {([
            ["all",     "All"],
            ["missing", "Missing data only"],
            ["ok",      "Healthy only"],
          ] as const).map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setShowMissing(val)}
              style={{
                padding: "0.35rem 0.75rem", fontSize: "0.75rem", fontWeight: 600,
                border: 0,
                borderRadius: "0.3rem",
                background: val === showMissing ? "#1c1917" : "transparent",
                color: val === showMissing ? "#fff" : "#57534e",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >{lbl}</button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search code or name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200,
            padding: "0.4rem 0.625rem",
            border: "1px solid #cfc9bf", borderRadius: "0.375rem",
            fontSize: "0.8125rem", fontFamily: "inherit",
          }}
        />

        <div style={{ display: "flex", gap: "1rem", marginLeft: "auto", alignItems: "center" }}>
          <Stat label="Items" value={String(totals.n)} />
          <Stat label="No BOM" value={String(totals.noBom)} color={totals.noBom > 0 ? "#991b1b" : "#166534"} />
          <Stat label="Missing data" value={String(totals.withMissing)} color={totals.withMissing > 0 ? "#854d0e" : "#166534"} />
          <Stat label="Avg total/unit" value={fmtMoney(totals.avgTotal)} color="#1c1917" />
        </div>
      </div>

      <DataTable<CostingRow & Record<string, unknown>>
        columns={columns}
        data={filtered as (CostingRow & Record<string, unknown>)[]}
        onRowClick={(r) => router.push(`/costings/${(r as CostingRow).id}`)}
        storageKey="costings.v1"
        emptyMessage="No items match the current filters."
        rowStyle={(r) => r.leaves_missing_cost > 0 ? { background: "#fffbeb" } : undefined}
      />

      {/* Row click → navigate to /costings/[item_id] breakdown page (above).
          The Test Product modal is still reachable from each item's own page. */}
    </div>
  );
}

function Stat({ label, value, color = "#1c1917" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: "0.6rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "0.875rem", fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}
