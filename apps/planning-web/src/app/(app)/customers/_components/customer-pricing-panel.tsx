"use client";

import Link from "next/link";

/**
 * Customer Pricing Panel — read-only summary for /customers/[id].
 *
 * Lists every item priced in this customer's price group, with the same
 * "bells and whistles" the item-master and price-groups views show:
 *   - UOM the price is stored in
 *   - $/kg
 *   - $/unit (for fixed-weight items only)
 *   - Margin vs RBP
 *   - Colour-coded status pill
 *   - Link to the item's cost sheet for the full breakdown
 *
 * If the customer has a row in item_price_targets for an item, that
 * override is shown instead of the group's price + flagged "Custom".
 * To edit overrides → use the CRUD panel below this one. To edit group
 * prices → use the link in the heading.
 */

type Uom = "kg" | "ea" | "inner" | "outer" | "pallet";

type LineItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  item_type: string;
  weight_mode: string | null;
  target_weight_g: number | null;
  fill_weight_g: number | null;
  units_per_inner: number | null;
  units_per_outer: number | null;
  units_per_pallet: number | null;
  production_loss_pct: number | null;
  cooking_loss_pct: number | null;
  packing_loss_pct: number | null;
  open_pack_pct: number | null;
  giveaway_pct: number | null;
} | null;

export type GroupPriceLine = {
  id: string;
  item_id: string;
  unit_price: number | null;
  unit: Uom | null;
  item: LineItem;
};

export type CustomerOverrideForPanel = {
  id: string;
  item_id: string;
  target_margin_pct: number | string | null;
  target_sell_price: number | string | null;
  target_unit: Uom | string;
  notes: string | null;
};

export type Buffers = {
  production_loss_pct: number | string | null;
  cooking_loss_pct: number | string | null;
  packing_loss_pct: number | string | null;
  open_pack_pct: number | string | null;
  giveaway_pct: number | string | null;
  depreciation_pct: number | string | null;
  sample_pct: number | string | null;
  product_dev_pct: number | string | null;
  error_pct: number | string | null;
  target_margin_pct: number | string | null;
};

export type ItemCost = { item_id: string; total_cost_per_unit: number | string | null };

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function compound(running: number, pct: number): number {
  if (pct <= 0 || pct >= 100) return running;
  return running / (1 - pct / 100);
}

function buildPerItemCosts(item: NonNullable<LineItem>, cogsPerKg: number | null, buffers: Buffers | null) {
  if (cogsPerKg == null || cogsPerKg <= 0) return { directPerKg: null, loadedPerKg: null, rbpPerKg: null };
  const pick = (own: number | null, def: number | string | null | undefined) => (own != null && own > 0) ? own : num(def);
  let post = cogsPerKg;
  post = compound(post, pick(item.production_loss_pct, buffers?.production_loss_pct));
  post = compound(post, pick(item.cooking_loss_pct,    buffers?.cooking_loss_pct));
  post = compound(post, pick(item.packing_loss_pct,    buffers?.packing_loss_pct));
  post = compound(post, pick(item.open_pack_pct,       buffers?.open_pack_pct));
  post = compound(post, pick(item.giveaway_pct,        buffers?.giveaway_pct));
  const direct = post;
  const markups = num(buffers?.depreciation_pct) + num(buffers?.sample_pct) + num(buffers?.product_dev_pct) + num(buffers?.error_pct);
  const loaded = post * (1 + markups / 100);
  const tm = num(buffers?.target_margin_pct);
  const rbp = (tm > 0 && tm < 100) ? loaded / (1 - tm / 100) : loaded;
  return { directPerKg: direct, loadedPerKg: loaded, rbpPerKg: rbp };
}

function convertQty(item: NonNullable<LineItem>, qty: number, fromUom: Uom, toUom: Uom): number | null {
  if (!Number.isFinite(qty)) return null;
  if (fromUom === toUom) return qty;
  const targetG = (item.fill_weight_g && item.fill_weight_g > 0)
    ? item.fill_weight_g
    : (item.target_weight_g && item.target_weight_g > 0 ? item.target_weight_g : null);
  const u_in = item.units_per_inner && item.units_per_inner > 0 ? item.units_per_inner : null;
  const u_out = item.units_per_outer && item.units_per_outer > 0 ? item.units_per_outer : null;
  const u_pl = item.units_per_pallet && item.units_per_pallet > 0 ? item.units_per_pallet : null;
  let pieces: number | null = null;
  switch (fromUom) {
    case "ea": pieces = qty; break;
    case "inner": pieces = u_in ? qty * u_in : null; break;
    case "outer": pieces = u_out ? qty * u_out : null; break;
    case "pallet": pieces = u_pl ? qty * u_pl : null; break;
    case "kg": pieces = targetG ? qty * 1000 / targetG : null; break;
  }
  if (pieces == null) return null;
  switch (toUom) {
    case "ea": return pieces;
    case "inner": return u_in ? pieces / u_in : null;
    case "outer": return u_out ? pieces / u_out : null;
    case "pallet": return u_pl ? pieces / u_pl : null;
    case "kg": return targetG ? pieces * targetG / 1000 : null;
  }
}

type Status = "on_margin" | "below_rbp" | "below_loaded" | "below_direct" | "no_cost";
function pricingStatus(p: number | null, rbp: number | null, loaded: number | null, direct: number | null): Status {
  if (p == null || rbp == null) return "no_cost";
  if (p >= rbp) return "on_margin";
  if (loaded != null && p >= loaded) return "below_rbp";
  if (direct != null && p >= direct) return "below_loaded";
  return "below_direct";
}
function marginVsRbp(p: number | null, rbp: number | null): number | null {
  if (p == null || rbp == null || p <= 0) return null;
  return ((p - rbp) / p) * 100;
}
const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  on_margin:    { bg: "#dcfce7", fg: "#166534", label: "On margin"      },
  below_rbp:    { bg: "#fef9c3", fg: "#854d0e", label: "Below RBP"      },
  below_loaded: { bg: "#ede9fe", fg: "#6b21a8", label: "Below loaded"   },
  below_direct: { bg: "#fee2e2", fg: "#991b1b", label: "Below direct $" },
  no_cost:      { bg: "#f5f5f4", fg: "#78716c", label: "No cost basis"  },
};
function pillStyle(status: Status): React.CSSProperties {
  const s = STATUS_STYLE[status];
  return { display: "inline-block", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.03em", background: s.bg, color: s.fg, padding: "0.1rem 0.4rem", borderRadius: "0.25rem", whiteSpace: "nowrap" };
}

function fmt2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function CustomerPricingPanel({
  priceGroupName, priceGroupCode, priceGroupId,
  groupLines, overrides, itemCosts, buffers,
}: {
  priceGroupName: string | null;
  priceGroupCode: string | null;
  priceGroupId: string | null;
  groupLines: GroupPriceLine[];
  overrides: CustomerOverrideForPanel[];
  itemCosts: ItemCost[];
  buffers: Buffers | null;
}) {
  // Build a quick lookup of overrides by item_id for the rows that have one.
  const overrideByItem = new Map<string, CustomerOverrideForPanel>();
  for (const o of overrides) overrideByItem.set(o.item_id, o);

  const itemCostMap = new Map<string, number>();
  for (const c of itemCosts) {
    const v = c.total_cost_per_unit == null ? null : Number(c.total_cost_per_unit);
    if (v != null && Number.isFinite(v)) itemCostMap.set(c.item_id, v);
  }

  return (
    <div className="card" style={{ padding: 0, borderLeft: "3px solid #1d4ed8" }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
            💲 Pricing for this customer
            {priceGroupCode && <span style={{ marginLeft: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{priceGroupCode}</span>}
            {priceGroupName && <span style={{ marginLeft: "0.25rem", fontSize: "0.8125rem", color: "#57534e" }}>· {priceGroupName}</span>}
          </h2>
          <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            Every item priced in this customer&apos;s group. Customer-specific overrides take precedence (flagged below).
            Click an item to see its full cost sheet.
          </p>
        </div>
        {priceGroupId && (
          <Link href="/settings/price-groups" style={{ fontSize: "0.75rem", color: "#b91c1c", textDecoration: "none" }}>
            Manage group prices →
          </Link>
        )}
      </div>
      <div style={{ padding: "0.5rem 1.25rem 0.25rem", fontSize: "0.7rem", color: "#a8a29e" }}>
        <span style={pillStyle("on_margin")}>On margin</span>{" "}
        <span style={pillStyle("below_rbp")}>Below RBP</span>{" "}
        <span style={pillStyle("below_loaded")}>Below loaded</span>{" "}
        <span style={pillStyle("below_direct")}>Below direct $</span>
      </div>

      {!priceGroupId ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
          No price group assigned. Click <strong>Edit</strong> at the top of this page and pick one to see pricing here.
        </div>
      ) : groupLines.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
          The group <strong>{priceGroupCode ?? priceGroupName}</strong> has no priced items yet.
          Set them on <Link href="/settings/price-groups" style={{ color: "#b91c1c" }}>/settings/price-groups</Link>.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>UOM</th>
              <th style={{ textAlign: "right" }}>Unit Price</th>
              <th style={{ textAlign: "right" }}>$/kg</th>
              <th style={{ textAlign: "right" }}>$/unit</th>
              <th style={{ textAlign: "right" }}>Margin vs RBP</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groupLines
              .filter(l => !!l.item)
              .sort((a, b) => (a.item!.code ?? "").localeCompare(b.item!.code ?? ""))
              .map(l => {
                const it = l.item!;
                const cogsPerKg = itemCostMap.get(it.id) ?? null;
                const costs = buildPerItemCosts(it, cogsPerKg, buffers);
                const ovr = overrideByItem.get(it.id);
                // Effective price: customer override (fixed price OR margin %) wins, else group line.
                let effUom: Uom = (l.unit ?? "kg") as Uom;
                let effPrice: number | null = l.unit_price;
                let isOverride = false;
                if (ovr) {
                  if (ovr.target_sell_price != null) {
                    effUom = (ovr.target_unit as Uom) ?? effUom;
                    effPrice = Number(ovr.target_sell_price);
                    isOverride = true;
                  } else if (ovr.target_margin_pct != null && costs.loadedPerKg != null) {
                    const m = Number(ovr.target_margin_pct);
                    if (m >= 0 && m < 100) {
                      const ovrKg = costs.loadedPerKg / (1 - m / 100);
                      effUom = (ovr.target_unit as Uom) ?? "kg";
                      const conv = convertQty(it, 1, effUom, "kg");
                      effPrice = (conv != null && conv > 0) ? ovrKg * conv : null;
                      isOverride = true;
                    }
                  }
                }
                const oneInKg = convertQty(it, 1, effUom, "kg");
                const pricePerKg = (effPrice != null && oneInKg != null && oneInKg > 0) ? effPrice / oneInKg : null;
                const oneEaInKg = convertQty(it, 1, "ea", "kg");
                const showUnitCol = !!(it.weight_mode !== "random" && oneEaInKg && oneEaInKg > 0);
                const pricePerUnit = (showUnitCol && pricePerKg != null && oneEaInKg != null) ? pricePerKg * oneEaInKg : null;
                const margin = marginVsRbp(pricePerKg, costs.rbpPerKg);
                const status = pricingStatus(pricePerKg, costs.rbpPerKg, costs.loadedPerKg, costs.directPerKg);
                return (
                  <tr key={l.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                        <Link href={`/items/${it.id}`} style={{ fontWeight: 600, fontSize: "0.875rem", color: "#1c1917", textDecoration: "none" }}>
                          {it.name}
                        </Link>
                        {isOverride && (
                          <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: "#ede9fe", color: "#6b21a8", borderRadius: "0.25rem", padding: "0.1rem 0.35rem" }}>Custom</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.15rem" }}>
                        <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{it.code}</span>
                        <Link href={`/costings/${it.id}`} style={{ fontSize: "0.65rem", color: "#b91c1c", textDecoration: "none" }} title="Open the full cost sheet for this item">cost sheet →</Link>
                      </div>
                    </td>
                    <td style={{ color: "#57534e", fontSize: "0.8125rem" }}>{effUom}</td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: "#15803d" }}>
                      {effPrice != null ? fmt2(effPrice) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt2(pricePerKg)}</td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", color: showUnitCol ? "#1c1917" : "#d6d3d1" }}>
                      {showUnitCol ? fmt2(pricePerUnit) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: margin == null ? "#78716c" : margin < 0 ? "#dc2626" : "#16a34a" }}>
                      {margin == null ? "—" : `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}%`}
                    </td>
                    <td><span style={pillStyle(status)}>{STATUS_STYLE[status].label}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link href={`/items/${it.id}`} style={{ fontSize: "0.7rem", color: "#b91c1c", textDecoration: "none" }}>Open</Link>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </div>
  );
}
