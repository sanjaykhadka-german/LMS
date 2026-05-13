"use client";

/**
 * "Test this product" button + modal.
 *
 * Calls the test_product_cascade RPC to run a hypothetical order through
 * the BOM cascade without persisting anything. Shows:
 *   - Cascade stages with quantities in kg + the selected UOM
 *   - Sortable shopping list with totals
 *   - Readiness traffic lights (Costing / Planning / QA / Purchasing / Dispatch)
 *   - Summary cards (cost, cost/unit, cost/kg, stage count)
 *
 * The point: any time a user edits a BOM, they hit this button to verify
 * the math still produces sensible numbers. If something looks off, they
 * spot it here in one click.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { DraggableModal } from "@/components/draggable-modal";

type Uom = "units" | "kg" | "inner" | "outer" | "pallet";

type CascadeRow = {
  stage_name: string;
  stage_label: string;
  department: string;
  item_type: string;
  depth: number;
  required_qty: number;
  unit: string;
};

type ShoppingRow = {
  item_id: string;
  code: string;
  name: string;
  qty: number;
  unit: string;
  unit_cost: number;
  line_cost: number;
  supplier_id: string | null;
  supplier_name: string | null;
  lead_time_days: number | null;
  /** Mig 123 / v2: true when the cascade couldn't compute qty because no
   *  ancestor in the BOM tree had target_weight_g + units_per_inner/outer/
   *  pallet set. UI surfaces this so operators see a concrete fix path. */
  hierarchy_missing?: boolean;
};

type CascadeResult = {
  input: {
    item_id: string;
    item_code: string;
    item_name: string;
    quantity: number;
    uom: string;
    total_kg: number;
    total_units: number | null;
  };
  equivalents: {
    units: number | null;
    kg: number;
    inner: number | null;
    outer: number | null;
    pallet: number | null;
  };
  cascade: CascadeRow[];
  shopping_list: ShoppingRow[];
  totals: {
    total_cost: number;
    cost_per_unit: number | null;
    cost_per_kg: number | null;
  };
};

type ItemAttrs = {
  allergens?: string[] | null;
  is_rte?: boolean | null;
  ingredients_statement?: string | null;
  nut_energy_kj?: number | null;
  spec_storage_temp?: string | null;
  micro_reference?: string | null;
  units_per_inner?: number | null;
  units_per_outer?: number | null;
  outers_per_pallet?: number | null;
  target_weight_g?: number | null;
};

type SortKey = "code" | "name" | "qty" | "unit" | "supplier_name" | "lead_time_days" | "unit_cost" | "line_cost";
type SortDir = "asc" | "desc";

const DEFAULT_QTY: Record<Uom, number> = {
  units: 100,
  kg: 100,
  inner: 10,
  outer: 5,
  pallet: 1,
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TestProductButton({
  itemId, itemName, itemCode, itemType, itemAttrs,
  autoOpen, defaultQty, defaultUom,
}: {
  itemId: string;
  itemName: string;
  itemCode: string;
  itemType: string;
  itemAttrs?: ItemAttrs;
  autoOpen?: boolean;
  defaultQty?: number;
  defaultUom?: Uom;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary"
        title="Run a hypothetical order through this product's cascade and verify the numbers"
      >
        ▷ Test this product
      </button>
      {open && (
        <TestProductModal
          itemId={itemId}
          itemName={itemName}
          itemCode={itemCode}
          itemType={itemType}
          itemAttrs={itemAttrs ?? {}}
          initialQty={defaultQty}
          initialUom={defaultUom}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function TestProductModal({
  itemId, itemName, itemCode, itemType, itemAttrs, onClose,
  initialQty, initialUom,
}: {
  itemId: string;
  itemName: string;
  itemCode: string;
  itemType: string;
  itemAttrs: ItemAttrs;
  onClose: () => void;
  initialQty?: number;
  initialUom?: Uom;
}) {
  const supabase = createClient();
  const [uom, setUom]       = useState<Uom>(initialUom ?? "units");
  const [qty, setQty]       = useState<number>(initialQty ?? DEFAULT_QTY[initialUom ?? "units"]);
  const [result, setResult] = useState<CascadeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Sort state for the shopping list table
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Buy-list column visibility — Tino May 2026. Code/Item/Qty/Unit are
  // always shown (essential for identification). Supplier/Lead/Unit cost/
  // Total are toggleable + persisted in localStorage. Lets operators trim
  // to just "Item + Cost / unit" when hunting cost anomalies, or expand
  // for the full purchasing view.
  type BuyColKey = "supplier_name" | "lead_time_days" | "unit_cost" | "line_cost";
  const BUY_COL_DEFAULTS: Record<BuyColKey, boolean> = {
    supplier_name: true, lead_time_days: true, unit_cost: true, line_cost: true,
  };
  const [buyCols, setBuyCols] = useState<Record<BuyColKey, boolean>>(BUY_COL_DEFAULTS);
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("test-modal.buyCols.v1") : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<BuyColKey, boolean>>;
        setBuyCols(prev => ({ ...prev, ...parsed }));
      }
    } catch { /* ignore parse errors — fall back to defaults */ }
  }, []);
  // Persist whenever they change.
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("test-modal.buyCols.v1", JSON.stringify(buyCols));
      }
    } catch { /* localStorage may be disabled */ }
  }, [buyCols]);

  // Which readiness pill is expanded (showing fix actions)
  const [expandedPill, setExpandedPill] = useState<string | null>(null);

  const run = useCallback(async (q: number, u: Uom) => {
    setLoading(true);
    setError(null);
    // v2 (mig 123): basis-aware cascade. Walks the explosion path so
    // per_inner / per_outer / per_pallet / per_piece lines on WIPP/WIP-level
    // BOMs inherit the FG's target_weight_g + units_per_*. v1 was silently
    // dropping those contributions (qty * qty_per_batch / 1000 fall-through).
    const { data, error: err } = await supabase.rpc("test_product_cascade_v2", {
      p_item_id: itemId,
      p_quantity: q,
      p_uom: u,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setResult(data as CascadeResult);
  }, [supabase, itemId]);

  useEffect(() => {
    run(qty, uom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeUom(newUom: Uom) {
    if (!result) {
      setUom(newUom);
      const next = DEFAULT_QTY[newUom];
      setQty(next);
      run(next, newUom);
      return;
    }
    const equivVal = newUom === "kg"
      ? result.equivalents.kg
      : (result.equivalents[newUom] as number | null);
    if (equivVal == null) {
      setError("This product only supports kg — no piece weight is set.");
      return;
    }
    const rounded = newUom === "pallet" ? +equivVal.toFixed(3)
                  : newUom === "kg"     ? +equivVal.toFixed(2)
                  :                       Math.round(equivVal);
    setUom(newUom);
    setQty(rounded);
    run(rounded, newUom);
  }

  function commitQty() { run(qty, uom); }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Sorted shopping list — derived state, recomputes on sort change
  const sortedShopping = useMemo(() => {
    if (!result) return [];
    const rows = [...result.shopping_list];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // null/undefined sort to the end
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [result, sortKey, sortDir]);

  // Per-unit subtotals for the shopping list (kg / ea / carton / roll …).
  // We deliberately do NOT show a single mixed-unit total — that would be
  // meaningless. Per-unit subtotals are useful for purchasing.
  const unitSubtotals = useMemo(() => {
    if (!result) return [] as { unit: string; total: number }[];
    const map = new Map<string, number>();
    for (const r of result.shopping_list) {
      const u = r.unit || "—";
      map.set(u, (map.get(u) ?? 0) + (r.qty ?? 0));
    }
    return [...map.entries()]
      .map(([unit, total]) => ({ unit, total }))
      .sort((a, b) => {
        // weights first (kg), then count units alphabetically
        if (a.unit === "kg") return -1;
        if (b.unit === "kg") return 1;
        return a.unit.localeCompare(b.unit);
      });
  }, [result]);

  // Readiness checks — derived from result + itemAttrs
  const readiness = useMemo(() => {
    if (!result) return null;
    const shopping = result.shopping_list;
    const hasShopping = shopping.length > 0;

    // Costing — green if every shopping line has a positive unit_cost
    const missingCost = shopping.filter(s => !s.unit_cost || s.unit_cost <= 0);
    const costing = !hasShopping ? "n/a"
                  : missingCost.length === 0 ? "ready"
                  : missingCost.length === shopping.length ? "missing"
                  : "partial";

    // Planning — green if a cascade was produced (item has BOM)
    const planning = result.cascade.length > 0 ? "ready" : "missing";

    // QA — based on item attrs: allergens declared (or no), RTE set, ingredients statement, nutrition
    let qaScore = 0;
    let qaTotal = 0;
    qaTotal++;  if (itemAttrs.allergens != null) qaScore++;  // allergens at least defined (empty array is OK)
    qaTotal++;  if (itemAttrs.is_rte != null) qaScore++;
    qaTotal++;  if (itemAttrs.ingredients_statement && itemAttrs.ingredients_statement.trim().length > 0) qaScore++;
    qaTotal++;  if (itemAttrs.nut_energy_kj != null) qaScore++;
    const qa = qaScore === qaTotal ? "ready"
             : qaScore === 0 ? "missing"
             : "partial";

    // Purchasing — green if every shopping line has a supplier
    const missingSupplier = shopping.filter(s => !s.supplier_name);
    const purchasing = !hasShopping ? "n/a"
                     : missingSupplier.length === 0 ? "ready"
                     : missingSupplier.length === shopping.length ? "missing"
                     : "partial";

    // Dispatch — green if pack hierarchy set (target_weight_g + units_per_inner)
    const hasPackHier = (itemAttrs.target_weight_g ?? 0) > 0
                     && (itemAttrs.units_per_inner ?? 0) > 0;
    const dispatch = hasPackHier ? "ready" : "missing";

    return { costing, planning, qa, purchasing, dispatch, qaScore, qaTotal,
             missingCostCount: missingCost.length,
             missingSupplierCount: missingSupplier.length };
  }, [result, itemAttrs]);

  const isProducible = ["finished_good", "wip", "wipf", "wipp"].includes(itemType);

  // Pack hierarchy from itemAttrs (used to show selected UOM in cascade)
  const upi = Math.max(itemAttrs.units_per_inner ?? 1, 1);
  const ipo = Math.max((itemAttrs.units_per_outer ?? 0) > 0 && upi > 0
                        ? Math.round((itemAttrs.units_per_outer ?? 0) / upi)
                        : 1, 1);
  const opp = Math.max(itemAttrs.outers_per_pallet ?? 1, 1);
  const tg  = itemAttrs.target_weight_g ?? 0;

  function kgToSelectedUom(kg: number, u: Uom): number | null {
    if (u === "kg") return kg;
    if (tg <= 0) return null;
    const units = kg * 1000 / tg;
    if (u === "units")  return units;
    if (u === "inner")  return units / upi;
    if (u === "outer")  return units / upi / ipo;
    if (u === "pallet") return units / upi / ipo / opp;
    return null;
  }

  return (
    <DraggableModal
      title={`Test this product — ${itemCode}`}
      subtitle={itemName}
      accent="#b91c1c"
      width={1000}
      onClose={onClose}
    >
      {!isProducible && (
        <div style={{
          padding: "0.875rem 1rem", marginBottom: "1rem",
          background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.5rem",
          fontSize: "0.875rem", color: "#713f12",
        }}>
          This is a {itemType.replace("_", " ")}. Cascading only makes sense for items that have
          their own BOM. The test will run, but the cascade may be empty.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", margin: "0 0 1rem" }}>
        <p style={{ color: "#57534e", fontSize: "0.8125rem", margin: 0, flex: 1 }}>
          Pretend you got an order for this product. Tracey runs it through your process and
          shows what would happen.{" "}
          <strong>Try a few different UOMs — answers should stay consistent.</strong>
        </p>
        <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => run(qty, uom)}
            disabled={loading}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.4rem 0.625rem" }}
            title="Re-run the cascade — useful after fixing something in another tab"
          >
            {loading ? "Running…" : "↻ Refresh"}
          </button>
          <a
            href={`/items/${itemId}#bom`}
            className="btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.4rem 0.625rem", textDecoration: "none" }}
            title="Close the test and jump to the BOM section of this item"
          >
            Edit BOM →
          </a>
        </div>
      </div>

      {/* ─── Order input + UOM tabs + equivalents ───────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #fef2f2, #fef9c3)",
        borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem",
        border: "1px solid #e7e5e4",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
          <input
            type="number"
            value={qty}
            onChange={e => setQty(parseFloat(e.target.value) || 0)}
            onBlur={commitQty}
            onKeyDown={e => { if (e.key === "Enter") commitQty(); }}
            style={{
              width: "130px", padding: "0.5rem 0.625rem",
              border: "1px solid #cfc9bf", borderRadius: "0.375rem",
              fontSize: "1.125rem", fontWeight: 700, textAlign: "right",
              fontFamily: "inherit", background: "white",
            }}
          />
          <div style={{
            display: "inline-flex", background: "rgba(255,255,255,0.6)",
            border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "3px", gap: "2px",
            flexWrap: "wrap",
          }}>
            {(["units", "kg", "inner", "outer", "pallet"] as Uom[]).map(u => (
              <button
                key={u}
                type="button"
                onClick={() => changeUom(u)}
                style={{
                  border: 0, padding: "0.4rem 0.75rem",
                  borderRadius: "0.375rem", cursor: "pointer",
                  fontSize: "0.8125rem", fontWeight: 500,
                  background: u === uom ? "#1c1917" : "transparent",
                  color: u === uom ? "white" : "#57534e",
                  fontFamily: "inherit",
                }}
              >{u}</button>
            ))}
          </div>
          <span style={{ color: "#57534e", fontSize: "0.875rem" }}>
            of <strong>{itemName}</strong> ordered
          </span>
        </div>

        {result && (
          <div style={{
            marginTop: "0.75rem", padding: "0.625rem 0.875rem",
            background: "rgba(255,255,255,0.55)",
            borderRadius: "0.375rem", fontSize: "0.8125rem",
            display: "flex", flexWrap: "wrap", gap: "1.25rem",
          }}>
            {[
              ["units",  result.equivalents.units,  0],
              ["kg",     result.equivalents.kg,     1],
              ["inner",  result.equivalents.inner,  1],
              ["outer",  result.equivalents.outer,  2],
              ["pallet", result.equivalents.pallet, 3],
            ].map(([label, val, dec]) => (
              <span key={label as string} style={{ display: "inline-flex", alignItems: "baseline", gap: "0.3rem" }}>
                <span style={{ color: "#a8a29e", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {label}
                </span>
                <span style={{ fontWeight: 700, fontFamily: "monospace" }}>
                  {fmt(val as number | null, dec as number)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ─── Readiness traffic lights ─────────────────────────────────────── */}
      {readiness && result && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{
            fontSize: "0.6875rem", fontWeight: 600, color: "#78716c",
            textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem",
          }}>
            Readiness
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: "0.4rem", color: "#a8a29e" }}>
              · click any non-green pill to see how to fix
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {(["costing", "planning", "qa", "purchasing", "dispatch"] as const).map(key => {
              const state =
                key === "costing"    ? readiness.costing :
                key === "planning"   ? readiness.planning :
                key === "qa"         ? readiness.qa :
                key === "purchasing" ? readiness.purchasing :
                                       readiness.dispatch;
              const label =
                key === "costing"    ? "Costing" :
                key === "planning"   ? "Planning" :
                key === "qa"         ? "QA / spec" :
                key === "purchasing" ? "Purchasing" :
                                       "Dispatch";
              const detail =
                key === "costing"    ? (readiness.missingCostCount > 0
                                          ? `${readiness.missingCostCount} component${readiness.missingCostCount === 1 ? "" : "s"} missing cost`
                                          : "all components priced") :
                key === "planning"   ? (readiness.planning === "ready" ? "BOM cascade resolved" : "no active BOM") :
                key === "qa"         ? `${readiness.qaScore} of ${readiness.qaTotal} fields complete` :
                key === "purchasing" ? (readiness.missingSupplierCount > 0
                                          ? `${readiness.missingSupplierCount} component${readiness.missingSupplierCount === 1 ? "" : "s"} no supplier`
                                          : "all components have a supplier") :
                                       (readiness.dispatch === "ready" ? "pack hierarchy set" : "pack hierarchy missing");
              const fixable = state !== "ready" && state !== "n/a";
              return (
                <ReadinessPill
                  key={key}
                  label={label}
                  state={state}
                  detail={detail}
                  fixable={fixable}
                  active={expandedPill === key}
                  onClick={fixable ? () => setExpandedPill(expandedPill === key ? null : key) : undefined}
                />
              );
            })}
          </div>

          {/* ─── Expansion panel — shows specifically how to fix the selected pill */}
          {expandedPill && (
            <FixPanel
              pillKey={expandedPill}
              itemId={itemId}
              shopping={result.shopping_list}
              itemAttrs={itemAttrs}
              currentQty={qty}
              currentUom={uom}
              onClose={() => setExpandedPill(null)}
            />
          )}
        </div>
      )}

      {error && (
        <div style={{
          padding: "0.75rem 1rem", marginBottom: "1rem",
          background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem",
          fontSize: "0.875rem", color: "#991b1b",
        }}>{error}</div>
      )}

      {loading && (
        <div style={{ padding: "1rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
          Running cascade…
        </div>
      )}

      {result && !loading && (
        <>
          {/* ─── Summary cards ─── */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: "0.75rem", marginBottom: "1rem",
          }}>
            <SummaryCard
              label="Total raw cost"
              value={fmtMoney(result.totals.total_cost)}
              sub="ingredients + supplies"
              accent="#1c1917"
            />
            <SummaryCard
              label="Cost per unit"
              value={fmtMoney(result.totals.cost_per_unit)}
              sub={`across ${fmt(result.equivalents.units, 0)} units`}
              accent="#1c1917"
            />
            <SummaryCard
              label="Cost per kg"
              value={fmtMoney(result.totals.cost_per_kg)}
              sub={`across ${fmt(result.equivalents.kg, 1)} kg`}
              accent="#1c1917"
            />
            <SummaryCard
              label="Stages"
              value={String(result.cascade.length)}
              sub="in production cascade"
              accent="#166534"
            />
          </div>

          {/* ─── Cascade ─── */}
          {result.cascade.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
                What gets made at each stage
                <span style={{ fontWeight: 400, color: "#78716c", fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                  ({uom !== "kg" ? `kg + ${uom}s side-by-side` : "weight cascade"})
                </span>
              </h3>
              <table className="data-table" style={{ fontSize: "0.8125rem" }}>
                <thead>
                  <tr>
                    <th style={{ width: "30px" }}>#</th>
                    <th>Stage</th>
                    <th>Item</th>
                    <th>Department</th>
                    <th style={{ textAlign: "right" }}>Qty (kg)</th>
                    {uom !== "kg" && (
                      <th style={{ textAlign: "right" }}>= {uom}s</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.cascade.map(r => {
                    const inUom = kgToSelectedUom(r.required_qty, uom);
                    return (
                      <tr key={r.stage_name}>
                        <td style={{ color: "#a8a29e" }}>{r.depth}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>
                          {r.stage_name}
                        </td>
                        <td style={{ fontWeight: 500 }}>{r.stage_label}</td>
                        <td>{r.department}</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                          {fmt(r.required_qty, 2)}
                        </td>
                        {uom !== "kg" && (
                          <td style={{ textAlign: "right", fontFamily: "monospace", color: "#57534e" }}>
                            {inUom != null ? fmt(inUom, uom === "pallet" ? 3 : (uom === "outer" ? 2 : 0)) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ─── Shopping list — sortable headers ─── */}
          {result.shopping_list.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", margin: "0 0 0.5rem", gap: "1rem" }}>
                <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>
                  What you&apos;d need to buy{" "}
                  <span style={{ fontWeight: 400, color: "#78716c", fontSize: "0.75rem" }}>
                    (zero stock assumed — click a header to sort, click a row to edit)
                  </span>
                </h3>
                {/* Column selector dropdown — toggle Supplier / Lead / Unit
                    cost / Total. Persisted in localStorage. */}
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setColsMenuOpen(o => !o)}
                    style={{
                      fontSize: "0.7rem", fontFamily: "inherit", fontWeight: 600,
                      padding: "0.25rem 0.55rem",
                      background: "#fafaf9", border: "1px solid #cfc9bf",
                      borderRadius: "0.3rem", cursor: "pointer", color: "#57534e",
                    }}
                    title="Show or hide buy-list columns"
                  >
                    Columns ⌄
                  </button>
                  {colsMenuOpen && (
                    <>
                      {/* Click-outside catcher */}
                      <div
                        onClick={() => setColsMenuOpen(false)}
                        style={{ position: "fixed", inset: 0, zIndex: 1 }}
                      />
                      <div style={{
                        position: "absolute", top: "100%", right: 0, marginTop: 4,
                        background: "#fff", border: "1px solid #cfc9bf",
                        borderRadius: "0.375rem", boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                        padding: "0.4rem 0.5rem", zIndex: 2, minWidth: 160,
                      }}>
                        {([
                          ["supplier_name",  "Supplier"],
                          ["lead_time_days", "Lead time"],
                          ["unit_cost",      "Cost / unit"],
                          ["line_cost",      "Total"],
                        ] as [BuyColKey, string][]).map(([k, lbl]) => (
                          <label key={k} style={{
                            display: "flex", alignItems: "center", gap: "0.4rem",
                            padding: "0.25rem 0.2rem", fontSize: "0.75rem", cursor: "pointer",
                          }}>
                            <input
                              type="checkbox"
                              checked={buyCols[k]}
                              onChange={e => setBuyCols(prev => ({ ...prev, [k]: e.target.checked }))}
                            />
                            {lbl}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <table className="data-table" style={{ fontSize: "0.8125rem" }}>
                <thead>
                  <tr>
                    <SortableTh label="Code"     sortKey="code"           current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Item"     sortKey="name"           current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <SortableTh label="Qty"      sortKey="qty"            current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
                    <SortableTh label="Unit"     sortKey="unit"           current={sortKey} dir={sortDir} onClick={toggleSort} />
                    {buyCols.supplier_name  && <SortableTh label="Supplier"    sortKey="supplier_name"  current={sortKey} dir={sortDir} onClick={toggleSort} />}
                    {buyCols.lead_time_days && <SortableTh label="Lead"        sortKey="lead_time_days" current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />}
                    {buyCols.unit_cost      && <SortableTh label="Cost / unit" sortKey="unit_cost"      current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />}
                    {buyCols.line_cost      && <SortableTh label="Total"       sortKey="line_cost"      current={sortKey} dir={sortDir} onClick={toggleSort} align="right" />}
                  </tr>
                </thead>
                <tbody>
                  {sortedShopping.map(r => (
                    // Click-to-edit (Tino May 2026): clicking a buy-list row
                    // opens the component item's edit page in a new tab so
                    // the test modal stays alive — fix the item, switch back,
                    // hit Refresh to re-cascade. See active-threads.md.
                    <tr
                      key={r.item_id}
                      onClick={() => window.open(`/items/${r.item_id}/edit`, "_blank", "noopener,noreferrer")}
                      style={{ cursor: "pointer" }}
                      title={`Open ${r.name} to edit (new tab) — fix supplier, cost, BOM and re-test`}
                    >
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>
                        {r.code}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {r.name}
                        <span aria-hidden style={{ marginLeft: "0.4rem", color: "#a8a29e", fontSize: "0.7rem" }}>↗</span>
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}
                          title={r.hierarchy_missing
                            ? "Can't compute qty — set target_weight_g + units_per_inner/outer/pallet on this item's FG (or this item itself), then re-test."
                            : undefined}>
                        {r.hierarchy_missing ? (
                          <span style={{ color: "#b91c1c", fontWeight: 600 }}>? no pack</span>
                        ) : fmt(r.qty, 3)}
                      </td>
                      <td>{r.unit}</td>
                      {buyCols.supplier_name && (
                        <td style={{ color: r.supplier_name ? undefined : "#a8a29e" }}>
                          {r.supplier_name ?? "—"}
                        </td>
                      )}
                      {buyCols.lead_time_days && (
                        <td style={{ textAlign: "right", color: "#78716c" }}>
                          {r.lead_time_days != null ? `${r.lead_time_days}d` : "—"}
                        </td>
                      )}
                      {buyCols.unit_cost && (
                        <td style={{ textAlign: "right", fontFamily: "monospace", color: "#57534e" }}
                            title="Supplier price per single unit of the component">
                          {fmtMoney(r.unit_cost)}
                        </td>
                      )}
                      {buyCols.line_cost && (
                        <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 500 }}>
                          {fmtMoney(r.line_cost)}
                        </td>
                      )}
                    </tr>
                  ))}
                  {(() => {
                    // Compute visible col count for colspans below.
                    const togCount = (buyCols.supplier_name ? 1 : 0)
                                   + (buyCols.lead_time_days ? 1 : 0)
                                   + (buyCols.unit_cost ? 1 : 0)
                                   + (buyCols.line_cost ? 1 : 0);
                    const totalCols = 4 + togCount; // Code/Item/Qty/Unit + toggleables
                    return (
                      <>
                        {unitSubtotals.length > 0 && (
                          <tr style={{ borderTop: "1px solid #cfc9bf", background: "#fafaf9" }}>
                            <td colSpan={2} style={{
                              fontWeight: 600, textAlign: "right", padding: "0.5rem",
                              fontSize: "0.6875rem", color: "#78716c",
                              textTransform: "uppercase", letterSpacing: "0.04em",
                            }}>
                              Subtotal by unit
                            </td>
                            <td colSpan={Math.max(1, totalCols - 2)} style={{
                              padding: "0.5rem", fontSize: "0.75rem", color: "#1c1917",
                            }}>
                              {unitSubtotals.map((u, i) => (
                                <span key={u.unit} style={{ marginRight: i < unitSubtotals.length - 1 ? "1.25rem" : 0 }}>
                                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                    {fmt(u.total, 3)}
                                  </span>
                                  <span style={{ color: "#78716c", marginLeft: "0.25rem" }}>{u.unit}</span>
                                </span>
                              ))}
                              <span style={{ color: "#a8a29e", marginLeft: "1rem", fontStyle: "italic", fontSize: "0.7rem" }}>
                                (mixed units — no single sum, this is sums per unit)
                              </span>
                            </td>
                          </tr>
                        )}
                        {buyCols.line_cost && (
                          <tr style={{
                            borderTop: "3px double #1c1917",
                            background: "#fafaf9",
                          }}>
                            <td colSpan={Math.max(1, totalCols - 1)} style={{
                              fontWeight: 700, textAlign: "right", padding: "0.625rem 0.5rem",
                              fontSize: "0.875rem",
                            }}>Total raw cost</td>
                            <td style={{
                              textAlign: "right", fontFamily: "monospace", fontWeight: 700,
                              padding: "0.625rem 0.5rem", fontSize: "1rem",
                            }}>
                              {fmtMoney(result.totals.total_cost)}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* ─── QA detail panel — what's missing for spec sheet ─── */}
          {readiness && readiness.qa !== "ready" && (
            <div style={{
              marginTop: "1rem", padding: "0.75rem 1rem",
              background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.5rem",
              fontSize: "0.8125rem",
            }}>
              <div style={{ fontWeight: 600, color: "#713f12", marginBottom: "0.4rem" }}>
                QA / spec sheet — what&apos;s missing
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#854d0e", lineHeight: 1.6 }}>
                {itemAttrs.allergens == null && <li>Allergens declaration (even &ldquo;none&rdquo; needs to be set explicitly)</li>}
                {itemAttrs.is_rte == null && <li>Ready-to-eat flag (Yes / No)</li>}
                {(!itemAttrs.ingredients_statement || itemAttrs.ingredients_statement.trim().length === 0) && (
                  <li>Ingredients statement</li>
                )}
                {itemAttrs.nut_energy_kj == null && <li>Nutrition information panel (energy, protein, fat, etc.)</li>}
              </ul>
            </div>
          )}

          {result.cascade.length === 0 && result.shopping_list.length === 0 && (
            <div style={{
              padding: "1.5rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem",
              background: "#fafaf9", borderRadius: "0.5rem",
            }}>
              No cascade — this item has no active BOM. To see a cascade, define a recipe first.
            </div>
          )}
        </>
      )}
    </DraggableModal>
  );
}

function SummaryCard({
  label, value, sub, accent,
}: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div style={{
      background: "white", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
      padding: "0.75rem 0.875rem",
    }}>
      <div style={{
        fontSize: "0.6875rem", fontWeight: 600, color: "#78716c",
        textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.25rem",
      }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color: accent, letterSpacing: "-0.01em" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.125rem" }}>{sub}</div>
    </div>
  );
}

function ReadinessPill({
  label, state, detail, active, onClick, fixable,
}: {
  label: string;
  state: string;
  detail: string;
  active?: boolean;
  onClick?: () => void;
  fixable?: boolean;
}) {
  const colors: Record<string, { bg: string; border: string; fg: string; dot: string }> = {
    ready:   { bg: "#dcfce7", border: "#86efac", fg: "#166534", dot: "#22c55e" },
    partial: { bg: "#fef9c3", border: "#fde047", fg: "#854d0e", dot: "#eab308" },
    missing: { bg: "#fef2f2", border: "#fca5a5", fg: "#991b1b", dot: "#ef4444" },
    "n/a":   { bg: "#fafaf9", border: "#e7e5e4", fg: "#78716c", dot: "#a8a29e" },
  };
  const c = colors[state] ?? colors["n/a"];
  const clickable = !!onClick && !!fixable;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      title={clickable ? "Click to see how to fix" : detail}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.5rem",
        padding: "0.4rem 0.75rem",
        background: c.bg,
        border: `${active ? "2px" : "1px"} solid ${active ? c.fg : c.border}`,
        borderRadius: "9999px",
        fontSize: "0.75rem", fontWeight: 600, color: c.fg,
        cursor: clickable ? "pointer" : "default",
        fontFamily: "inherit",
        boxShadow: active ? `0 0 0 3px ${c.bg}` : undefined,
        transition: "transform 0.1s, box-shadow 0.1s",
        transform: active ? "translateY(-1px)" : undefined,
      }}
    >
      <span style={{ width: "8px", height: "8px", borderRadius: "9999px", background: c.dot, flexShrink: 0 }} />
      <span>{label}</span>
      <span style={{ fontWeight: 400, opacity: 0.85, fontSize: "0.6875rem" }}>· {detail}</span>
      {clickable && (
        <span style={{ marginLeft: "0.2rem", fontSize: "0.625rem", opacity: 0.7 }}>
          {active ? "▴" : "▾"}
        </span>
      )}
    </button>
  );
}

function SortableTh({
  label, sortKey, current, dir, onClick, align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      style={{
        cursor: "pointer", userSelect: "none",
        textAlign: align,
        background: active ? "#fafaf9" : undefined,
      }}
      title="Click to sort"
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        {label}
        <span style={{ fontSize: "0.625rem", color: active ? "#1c1917" : "#cfc9bf" }}>
          {active ? (dir === "asc" ? "▲" : "▼") : "▴▾"}
        </span>
      </span>
    </th>
  );
}

function FixPanel({
  pillKey, itemId, shopping, itemAttrs, currentQty, currentUom, onClose,
}: {
  pillKey: string;
  itemId: string;
  shopping: ShoppingRow[];
  itemAttrs: ItemAttrs;
  currentQty: number;
  currentUom: string;
  onClose: () => void;
}) {
  // What needs fixing for each pill
  const headers: Record<string, { title: string; subtitle: string; cta: React.ReactNode }> = {
    costing: {
      title: "Set unit cost on each component",
      subtitle: "Click any item to open it. A 'Back to test' banner will let you return.",
      cta: null,
    },
    planning: {
      title: "Create or activate a BOM for this item",
      subtitle: "Without an active BOM, no cascade can be computed.",
      cta: (
        <a href={`/items/${itemId}#bom`}
           className="btn-primary" style={{ fontSize: "0.8125rem", padding: "0.5rem 0.875rem" }}>
          Close test &amp; jump to BOM section
        </a>
      ),
    },
    qa: {
      title: "Complete the QA / spec fields on this item",
      subtitle: "Allergens, ready-to-eat flag, ingredients statement, nutrition information.",
      cta: (
        <a href={`/items/${itemId}/edit?back_to_test=${itemId}&qty=${currentQty}&uom=${currentUom}`}
           className="btn-primary" style={{ fontSize: "0.8125rem", padding: "0.5rem 0.875rem" }}>
          Open Item Edit page
        </a>
      ),
    },
    purchasing: {
      title: "Link suppliers to each component",
      subtitle: "Click any item to open it. A 'Back to test' banner will let you return.",
      cta: null,
    },
    dispatch: {
      title: "Set the pack hierarchy on this item",
      subtitle: "Target weight per piece + units per inner are needed for UOM conversions and dispatch.",
      cta: (
        <a href={`/items/${itemId}/edit?back_to_test=${itemId}&qty=${currentQty}&uom=${currentUom}`}
           className="btn-primary" style={{ fontSize: "0.8125rem", padding: "0.5rem 0.875rem" }}>
          Open Item Edit page
        </a>
      ),
    },
  };
  const h = headers[pillKey];
  if (!h) return null;

  // Item-level lists (Costing & Purchasing)
  const missingCostItems    = shopping.filter(s => !s.unit_cost || s.unit_cost <= 0);
  const missingSupplierItems = shopping.filter(s => !s.supplier_name);
  const showItemList = pillKey === "costing" || pillKey === "purchasing";
  const itemList = pillKey === "costing" ? missingCostItems : missingSupplierItems;

  // Field-level lists (QA & Dispatch)
  const qaMissing: string[] = [];
  if (itemAttrs.allergens == null) qaMissing.push("Allergens declaration");
  if (itemAttrs.is_rte == null) qaMissing.push("Ready-to-eat flag (Yes / No)");
  if (!itemAttrs.ingredients_statement || itemAttrs.ingredients_statement.trim().length === 0)
    qaMissing.push("Ingredients statement");
  if (itemAttrs.nut_energy_kj == null) qaMissing.push("Nutrition information panel");

  const dispatchMissing: string[] = [];
  if (!itemAttrs.target_weight_g || itemAttrs.target_weight_g <= 0)
    dispatchMissing.push("Target weight per piece (g)");
  if (!itemAttrs.units_per_inner || itemAttrs.units_per_inner <= 0)
    dispatchMissing.push("Pieces per inner");
  if (!itemAttrs.units_per_outer || itemAttrs.units_per_outer <= 0)
    dispatchMissing.push("Pieces per outer (or inners per outer)");
  if (!itemAttrs.outers_per_pallet || itemAttrs.outers_per_pallet <= 0)
    dispatchMissing.push("Outers per pallet");

  const fieldList = pillKey === "qa" ? qaMissing : pillKey === "dispatch" ? dispatchMissing : null;

  return (
    <div style={{
      marginTop: "0.75rem",
      padding: "0.875rem 1rem",
      background: "#fafaf9",
      border: "1px solid #e7e5e4",
      borderRadius: "0.5rem",
      animation: "fadeIn 0.15s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "0.625rem" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#1c1917" }}>{h.title}</div>
          <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.2rem" }}>{h.subtitle}</div>
        </div>
        <button
          type="button" onClick={onClose}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#a8a29e", fontSize: "1.125rem", padding: "0 0.25rem", flexShrink: 0 }}
          title="Close panel"
        >×</button>
      </div>

      {showItemList && (
        itemList.length === 0 ? (
          <div style={{ fontSize: "0.8125rem", color: "#a8a29e", padding: "0.5rem 0" }}>
            Nothing to fix.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", maxHeight: "240px", overflowY: "auto" }}>
            {itemList.map(it => (
              <a
                key={it.item_id}
                href={`/items/${it.item_id}?back_to_test=${itemId}&qty=${currentQty}&uom=${currentUom}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "0.4rem 0.625rem",
                  background: "white",
                  border: "1px solid #e7e5e4",
                  borderRadius: "0.375rem",
                  textDecoration: "none",
                  fontSize: "0.8125rem",
                  color: "#1c1917",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c", flexShrink: 0 }}>
                    {it.code}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.name}
                  </span>
                </span>
                <span style={{ color: "#b91c1c", fontWeight: 600, fontSize: "0.75rem", flexShrink: 0 }}>
                  Open →
                </span>
              </a>
            ))}
          </div>
        )
      )}

      {fieldList && (
        fieldList.length === 0 ? (
          <div style={{ fontSize: "0.8125rem", color: "#a8a29e", padding: "0.5rem 0" }}>
            Nothing to fix.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#57534e", fontSize: "0.8125rem", lineHeight: 1.7 }}>
            {fieldList.map(f => <li key={f}>{f}</li>)}
          </ul>
        )
      )}

      {h.cta && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          {h.cta}
        </div>
      )}
    </div>
  );
}
