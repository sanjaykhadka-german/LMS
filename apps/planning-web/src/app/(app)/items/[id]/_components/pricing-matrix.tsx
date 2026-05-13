"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import CalcInput from "@/components/calc-input";

/**
 * Pricing Matrix v2 — per-group prices for one item.
 *
 * Display:
 *   For every active price group, one row showing:
 *     - Group code + name + Standard/Custom pill
 *     - Stored UOM
 *     - $/kg, $/unit (both as display columns; $/unit hidden for random-weight items)
 *     - Margin vs RBP (Rock-Bottom Price = loaded cost / (1 - target_margin_pct))
 *     - Colour-coded status pill:
 *         green  on margin (>= RBP)
 *         yellow >= Loaded Cost (covering loaded cost but below target margin)
 *         purple >= COGS+Direct (covering direct production cost)
 *         red    < COGS+Direct (losing money on direct production cost)
 *     - Last set / "default" badge if no explicit price
 *
 * Edit mode: $/kg and $/unit are both editable AND bidirectionally linked
 * for fixed-weight items — typing in one updates the other live. UOM
 * dropdown decides what is persisted to price_group_lines.
 */

const UOMS = ["kg", "ea", "inner", "outer", "pallet"] as const;
type Uom = typeof UOMS[number];

export type ItemPackInfo = {
  default_sell_uom: Uom | null;
  target_weight_g: number | null;
  fill_weight_g: number | null;
  units_per_inner: number | null;
  units_per_outer: number | null;
  units_per_pallet: number | null;
  weight_mode: string | null;
};

export type PriceGroupRow = {
  id: string;
  code: string | null;
  name: string;
  default_margin_pct: number | string | null;
  default_target_unit: string | null;
  sort_order: number | null;
  is_active: boolean;
  is_standard?: boolean;
};

export type PriceLine = {
  id: string;
  price_group_id: string;
  unit_price: number | string | null;
  unit: Uom | null;
  currency: string | null;
  valid_from: string | null;
  valid_to: string | null;
  updated_at: string | null;
};

function convertQty(item: ItemPackInfo, qty: number, fromUom: Uom, toUom: Uom): number | null {
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
    case "ea":     pieces = qty; break;
    case "inner":  pieces = u_in  ? qty * u_in  : null; break;
    case "outer":  pieces = u_out ? qty * u_out : null; break;
    case "pallet": pieces = u_pl  ? qty * u_pl  : null; break;
    case "kg":     pieces = targetG ? qty * 1000 / targetG : null; break;
  }
  if (pieces == null) return null;
  switch (toUom) {
    case "ea":     return pieces;
    case "inner":  return u_in  ? pieces / u_in  : null;
    case "outer":  return u_out ? pieces / u_out : null;
    case "pallet": return u_pl  ? pieces / u_pl  : null;
    case "kg":     return targetG ? pieces * targetG / 1000 : null;
  }
}

function availableUoms(item: ItemPackInfo): Uom[] {
  const targetG = (item.fill_weight_g && item.fill_weight_g > 0)
    ? item.fill_weight_g
    : (item.target_weight_g && item.target_weight_g > 0 ? item.target_weight_g : null);
  const list: Uom[] = ["kg"];
  if (targetG)              list.push("ea");
  if (item.units_per_inner) list.push("inner");
  if (item.units_per_outer) list.push("outer");
  if (item.units_per_pallet) list.push("pallet");
  return list;
}

function fmtAud(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

type Status = "on_margin" | "below_rbp" | "below_loaded" | "below_direct" | "no_cost";
function pricingStatus(
  pricePerKg: number | null,
  rbpPerKg: number | null,
  loadedPerKg: number | null,
  directPerKg: number | null,
): Status {
  if (pricePerKg == null || rbpPerKg == null) return "no_cost";
  if (pricePerKg >= rbpPerKg) return "on_margin";
  if (loadedPerKg != null && pricePerKg >= loadedPerKg) return "below_rbp";
  if (directPerKg != null && pricePerKg >= directPerKg) return "below_loaded";
  return "below_direct";
}

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  on_margin:    { bg: "#dcfce7", fg: "#166534", label: "On margin"      },
  below_rbp:    { bg: "#fef9c3", fg: "#854d0e", label: "Below RBP"      },
  below_loaded: { bg: "#ede9fe", fg: "#6b21a8", label: "Below loaded"   },
  below_direct: { bg: "#fee2e2", fg: "#991b1b", label: "Below direct $" },
  no_cost:      { bg: "#f5f5f4", fg: "#78716c", label: "No cost basis"  },
};

function marginVsRbp(pricePerKg: number | null, rbpPerKg: number | null): number | null {
  if (pricePerKg == null || rbpPerKg == null || pricePerKg <= 0) return null;
  return ((pricePerKg - rbpPerKg) / pricePerKg) * 100;
}

function pillStyle(status: Status): React.CSSProperties {
  const s = STATUS_STYLE[status];
  return {
    display: "inline-block",
    fontSize: "0.65rem",
    fontWeight: 700,
    letterSpacing: "0.03em",
    background: s.bg,
    color: s.fg,
    padding: "0.1rem 0.4rem",
    borderRadius: "0.25rem",
    whiteSpace: "nowrap",
  };
}

export default function PricingMatrix({
  itemId, itemName, itemPack, priceGroups, existingLines,
  loadedCostPerKg, rbpPerKg, directCostPerKg,
}: {
  itemId: string;
  itemName: string;
  itemPack: ItemPackInfo;
  priceGroups: PriceGroupRow[];
  existingLines: PriceLine[];
  loadedCostPerKg: number | null;
  rbpPerKg: number | null;
  directCostPerKg: number | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [draftUom, setDraftUom] = useState<Uom>("kg");
  // draftPrice is the price in draftUom — what gets persisted as unit_price.
  // Eg draftUom="outer" + draftPrice="96" stores $96/outer.
  const [draftPrice, setDraftPrice] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lineByGroup = new Map<string, PriceLine>();
  for (const l of existingLines) lineByGroup.set(l.price_group_id, l);

  const isRandomWeight = itemPack.weight_mode === "random";
  const hasUnitInfo = !!(itemPack.fill_weight_g && itemPack.fill_weight_g > 0)
                     || !!(itemPack.target_weight_g && itemPack.target_weight_g > 0);
  const showUnitColumn = !isRandomWeight && hasUnitInfo;

  function defaultUomForGroup(g: PriceGroupRow): Uom {
    const item_default = itemPack.default_sell_uom;
    const avail = availableUoms(itemPack);
    if (item_default && avail.includes(item_default)) return item_default;
    if (g.default_target_unit && avail.includes(g.default_target_unit as Uom)) return g.default_target_unit as Uom;
    return "kg";
  }

  function pricePerKgFromUom(price: number, uom: Uom): number | null {
    const oneInKg = convertQty(itemPack, 1, uom, "kg");
    if (oneInKg == null || oneInKg <= 0) return null;
    return price / oneInKg;
  }

  function openEdit(groupId: string) {
    const existing = lineByGroup.get(groupId);
    const grp = priceGroups.find(g => g.id === groupId);
    if (!grp) return;
    setEditingGroupId(groupId);
    setError(null);
    let uom: Uom = defaultUomForGroup(grp);
    let priceInUom: number | null = null;
    if (existing && existing.unit_price != null) {
      uom = (existing.unit as Uom) ?? uom;
      priceInUom = Number(existing.unit_price);
    } else if (loadedCostPerKg != null) {
      // Seed from the group's default margin so the user starts at the
      // computed default price in the chosen UOM, not blank.
      const m = grp.default_margin_pct != null ? Number(grp.default_margin_pct) : 0;
      if (m > 0 && m < 100) {
        const computedKg = loadedCostPerKg / (1 - m / 100);
        const conv = convertQty(itemPack, 1, uom, "kg");
        if (conv != null && conv > 0) priceInUom = computedKg * conv;
      }
    }
    setDraftUom(uom);
    setDraftPrice(priceInUom != null ? priceInUom.toFixed(4).replace(/\.?0+$/, "") : "");
  }

  // When the UOM changes mid-edit, convert the current draft price into the
  // new UOM so the user doesn't lose their place — eg switching from $/outer
  // to $/kg reframes "$96/outer" as "$10/kg" automatically.
  function changeDraftUom(nextUom: Uom) {
    const old = draftUom;
    setDraftUom(nextUom);
    const n = parseFloat(draftPrice);
    if (!Number.isFinite(n) || n <= 0) return;
    const oneOldInKg = convertQty(itemPack, 1, old, "kg");
    const oneNewInKg = convertQty(itemPack, 1, nextUom, "kg");
    if (oneOldInKg == null || oneNewInKg == null || oneOldInKg <= 0 || oneNewInKg <= 0) return;
    const perKg = n / oneOldInKg;
    const inNew = perKg * oneNewInKg;
    setDraftPrice(inNew.toFixed(4).replace(/\.?0+$/, ""));
  }

  function cancelEdit() {
    setEditingGroupId(null);
    setDraftUom("kg"); setDraftPrice("");
    setError(null);
  }

  async function saveEdit() {
    if (!editingGroupId) return;
    const price = parseFloat(draftPrice);
    if (!Number.isFinite(price) || price < 0) { setError("Price must be a number >= 0."); return; }
    setSaving(true); setError(null);
    const existing = lineByGroup.get(editingGroupId);
    // draftPrice is already in draftUom — no conversion needed.
    const priceInUom = price;
    let err: { message: string } | null = null;
    if (existing) {
      const { error } = await supabase
        .from("price_group_lines")
        .update({ unit_price: priceInUom, unit: draftUom })
        .eq("id", existing.id);
      err = error;
    } else {
      const { error } = await supabase
        .from("price_group_lines")
        .insert({ price_group_id: editingGroupId, item_id: itemId, unit_price: priceInUom, unit: draftUom, currency: "AUD" });
      err = error;
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    cancelEdit();
    router.refresh();
  }

  async function clearPrice(groupId: string) {
    const existing = lineByGroup.get(groupId);
    if (!existing) return;
    if (!confirm("Remove the explicit price for this group? It will revert to the group default.")) return;
    setSaving(true);
    const { error: e } = await supabase.from("price_group_lines").delete().eq("id", existing.id);
    setSaving(false);
    if (e) { setError(e.message); return; }
    router.refresh();
  }

  const sortedGroups = [...priceGroups]
    .filter(g => g.is_active)
    .sort((a, b) => {
      const sa = a.sort_order ?? 999, sb = b.sort_order ?? 999;
      if (sa !== sb) return sa - sb;
      return (a.code ?? a.name).localeCompare(b.code ?? b.name);
    });

  // Live editor preview — convert the draftPrice (in draftUom) to $/kg
  // for margin + status calcs, plus derive $/unit (ea).
  const editorPriceNum = parseFloat(draftPrice);
  const editorPricePerKg = (Number.isFinite(editorPriceNum) && editorPriceNum >= 0)
    ? (() => {
        const one = convertQty(itemPack, 1, draftUom, "kg");
        return (one != null && one > 0) ? editorPriceNum / one : null;
      })()
    : null;
  const oneEaInKgForPreview = convertQty(itemPack, 1, "ea", "kg");
  const editorPricePerUnit = (editorPricePerKg != null && oneEaInKgForPreview != null && oneEaInKgForPreview > 0)
    ? editorPricePerKg * oneEaInKgForPreview
    : null;
  const editorPreviewStatus = pricingStatus(editorPricePerKg, rbpPerKg, loadedCostPerKg, directCostPerKg);
  const editorPreviewMargin = marginVsRbp(editorPricePerKg, rbpPerKg);

  return (
    <div className="card" style={{ borderLeft: "3px solid #1d4ed8", marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
          💲 Pricing
          <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "#78716c", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>admin view</span>
        </h2>
        <Link href="/settings/price-groups" style={{ fontSize: "0.75rem", color: "#b91c1c", textDecoration: "none" }}>Manage groups →</Link>
      </div>
      <p style={{ fontSize: "0.75rem", color: "#78716c", margin: "0 0 0.5rem" }}>
        Per-group prices for <strong>{itemName}</strong>. Margin is vs <strong>RBP</strong> ({fmtAud(rbpPerKg, 4)}/kg). Loaded {fmtAud(loadedCostPerKg, 4)}/kg · COGS+direct {fmtAud(directCostPerKg, 4)}/kg.
      </p>
      <p style={{ fontSize: "0.7rem", color: "#a8a29e", margin: "0 0 0.75rem" }}>
        <span style={pillStyle("on_margin")}>On margin</span>{" "}
        <span style={pillStyle("below_rbp")}>Below RBP</span>{" "}
        <span style={pillStyle("below_loaded")}>Below loaded</span>{" "}
        <span style={pillStyle("below_direct")}>Below direct $</span>
      </p>
      {error && (
        <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>
          {error}
        </div>
      )}
      {sortedGroups.length === 0 ? (
        <div style={{ fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>
          No active price groups yet. <Link href="/settings/price-groups" style={{ color: "#b91c1c" }}>Set them up here.</Link>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e7e5e4", color: "#78716c", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem 0.4rem 0", fontWeight: 600 }}>Group</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, width: 80 }}>Type</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, width: 80 }}>UOM</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>$/kg</th>
              {showUnitColumn && <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>$/unit</th>}
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Margin vs RBP</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Status</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600 }}>Last set</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map(g => {
              const line = lineByGroup.get(g.id);
              const isEditing = editingGroupId === g.id;
              const hasExplicit = !!line && line.unit_price != null;
              const defaultMargin = g.default_margin_pct != null ? Number(g.default_margin_pct) : null;
              let storedUom: Uom = defaultUomForGroup(g);
              let displayPriceKg: number | null = null;
              let displayPriceUnit: number | null = null;
              if (hasExplicit && line) {
                storedUom = (line.unit as Uom) ?? storedUom;
                displayPriceKg = pricePerKgFromUom(Number(line.unit_price), storedUom);
              } else if (defaultMargin != null && loadedCostPerKg != null && defaultMargin > 0 && defaultMargin < 100) {
                displayPriceKg = loadedCostPerKg / (1 - defaultMargin / 100);
              }
              if (displayPriceKg != null && showUnitColumn) {
                const oneEaInKg = convertQty(itemPack, 1, "ea", "kg");
                if (oneEaInKg != null && oneEaInKg > 0) displayPriceUnit = displayPriceKg * oneEaInKg;
              }
              const margin = marginVsRbp(displayPriceKg, rbpPerKg);
              const status = pricingStatus(displayPriceKg, rbpPerKg, loadedCostPerKg, directCostPerKg);
              return (
                <tr key={g.id} style={{ borderBottom: "1px solid #f5f5f4", background: isEditing ? "#fffbeb" : "transparent" }}>
                  <td style={{ padding: "0.5rem 0.5rem 0.5rem 0" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{g.code ?? "—"}</div>
                    <div style={{ fontWeight: 500, color: "#1c1917" }}>{g.name}</div>
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {g.is_standard ? (
                      <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: "#dbeafe", color: "#1e40af", padding: "0.1rem 0.35rem", borderRadius: "0.25rem" }}>Standard</span>
                    ) : (
                      <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: "#f3f4f6", color: "#57534e", padding: "0.1rem 0.35rem", borderRadius: "0.25rem" }}>Custom</span>
                    )}
                  </td>
                  {isEditing ? (
                    <>
                      <td style={{ padding: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                          <select value={draftUom} onChange={e => changeDraftUom(e.target.value as Uom)} className="form-select" style={{ fontSize: "0.8125rem", padding: "0.2rem 0.4rem", flex: "0 0 auto" }}>
                            {availableUoms(itemPack).map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <CalcInput value={draftPrice} onChange={setDraftPrice} decimals={4} placeholder={`$/${draftUom}`} style={{ fontSize: "0.8125rem", padding: "0.2rem 0.4rem", textAlign: "right", flex: 1 }} />
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                          Enter price per <strong>{draftUom}</strong>
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "monospace", color: "#57534e", fontStyle: "italic" }}>
                        {fmtAud(editorPricePerKg, 4)}
                      </td>
                      {showUnitColumn && (
                        <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "monospace", color: "#57534e", fontStyle: "italic" }}>
                          {fmtAud(editorPricePerUnit, 4)}
                        </td>
                      )}
                      <td style={{ padding: "0.5rem", textAlign: "right", color: editorPreviewMargin != null ? (editorPreviewMargin < 0 ? "#dc2626" : "#16a34a") : "#a8a29e", fontWeight: 600, fontFamily: "monospace" }}>
                        {editorPreviewMargin == null ? "—" : `${editorPreviewMargin >= 0 ? "+" : ""}${editorPreviewMargin.toFixed(1)}%`}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }}>
                        <span style={pillStyle(editorPreviewStatus)}>{STATUS_STYLE[editorPreviewStatus].label}</span>
                      </td>
                      <td />
                      <td style={{ padding: "0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button type="button" onClick={saveEdit} disabled={saving} className="btn-primary" style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}>{saving ? "…" : "Save"}</button>
                        <button type="button" onClick={cancelEdit} disabled={saving} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", fontSize: "0.7rem", marginLeft: "0.25rem" }}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: "0.5rem", color: "#78716c", fontSize: "0.75rem" }}>{storedUom}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "monospace", fontWeight: hasExplicit ? 600 : 400, color: hasExplicit ? "#1c1917" : "#a8a29e" }}>{fmtAud(displayPriceKg, 4)}</td>
                      {showUnitColumn && (
                        <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "monospace", fontWeight: hasExplicit ? 600 : 400, color: hasExplicit ? "#1c1917" : "#a8a29e" }}>{fmtAud(displayPriceUnit, 4)}</td>
                      )}
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: margin == null ? "#78716c" : margin < 0 ? "#dc2626" : "#16a34a" }}>
                        {margin == null ? "—" : `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}%`}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }}>
                        <span style={pillStyle(status)}>{STATUS_STYLE[status].label}</span>
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", color: "#a8a29e", fontSize: "0.7rem" }}>
                        {hasExplicit ? fmtDate(line!.updated_at) : <em>default</em>}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button type="button" onClick={() => openEdit(g.id)} disabled={saving} style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: "0.7rem", padding: 0 }}>{hasExplicit ? "Edit" : "Set"}</button>
                        {hasExplicit && (
                          <button type="button" onClick={() => clearPrice(g.id)} disabled={saving} title="Remove explicit price (revert to group default)" style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", fontSize: "0.7rem", padding: 0, marginLeft: "0.4rem" }}>✕</button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
