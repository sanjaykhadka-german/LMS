"use client";

import { useState } from "react";
import CalcInput from "@/components/calc-input";
import { createClient } from "@/lib/supabase/client";

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
  default_sell_uom: Uom | null;
  production_loss_pct: number | null;
  cooking_loss_pct: number | null;
  packing_loss_pct: number | null;
  open_pack_pct: number | null;
  giveaway_pct: number | null;
} | null;

type PriceLine = {
  id: string;
  item_id: string;
  unit_price: number | null;
  unit: Uom | null;
  discount_pct: number | null;
  currency: string;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  item: LineItem;
};

type Buffers = {
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

// Status pill thresholds — same semantics as the item-master pricing matrix.
type Status = "on_margin" | "below_rbp" | "below_loaded" | "below_direct" | "no_cost";
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

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Compound a percentage onto a running cost basis.
function compound(running: number, pct: number): number {
  if (pct <= 0 || pct >= 100) return running;
  return running / (1 - pct / 100);
}

// Simplified per-item cost build-up — used for $/kg margin pills in this
// view. Doesn't walk the BOM stages (cheaper). FG's own loss columns win;
// fall back to tenant defaults. Loaded cost = post-loss × (1 + markups).
// RBP = Loaded / (1 - target_margin).
function buildPerItemCosts(item: NonNullable<LineItem>, cogsPerKg: number | null, buffers: Buffers | null): { directPerKg: number | null; loadedPerKg: number | null; rbpPerKg: number | null } {
  if (cogsPerKg == null || cogsPerKg <= 0) return { directPerKg: null, loadedPerKg: null, rbpPerKg: null };
  const pick = (own: number | null, def: number | string | null | undefined) => (own != null && own > 0) ? own : num(def);
  const prodLoss = pick(item.production_loss_pct, buffers?.production_loss_pct);
  const cookLoss = pick(item.cooking_loss_pct,    buffers?.cooking_loss_pct);
  const packLoss = pick(item.packing_loss_pct,    buffers?.packing_loss_pct);
  const openPack = pick(item.open_pack_pct,       buffers?.open_pack_pct);
  const giveaway = pick(item.giveaway_pct,        buffers?.giveaway_pct);
  let post = cogsPerKg;
  post = compound(post, prodLoss);
  post = compound(post, cookLoss);
  post = compound(post, packLoss);
  post = compound(post, openPack);
  post = compound(post, giveaway);
  const directPerKg = post;
  const markupSum = num(buffers?.depreciation_pct) + num(buffers?.sample_pct) + num(buffers?.product_dev_pct) + num(buffers?.error_pct);
  const loadedPerKg = post * (1 + markupSum / 100);
  const tm = num(buffers?.target_margin_pct);
  const rbpPerKg = (tm > 0 && tm < 100) ? loadedPerKg / (1 - tm / 100) : loadedPerKg;
  return { directPerKg, loadedPerKg, rbpPerKg };
}

// Convert qty across UOMs using pack hierarchy (same as pricing-matrix).
function convertQtyForItem(item: NonNullable<LineItem>, qty: number, fromUom: Uom, toUom: Uom): number | null {
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

function pricingStatus(pricePerKg: number | null, rbp: number | null, loaded: number | null, direct: number | null): Status {
  if (pricePerKg == null || rbp == null) return "no_cost";
  if (pricePerKg >= rbp) return "on_margin";
  if (loaded != null && pricePerKg >= loaded) return "below_rbp";
  if (direct != null && pricePerKg >= direct) return "below_loaded";
  return "below_direct";
}
function marginVsRbp(pricePerKg: number | null, rbpPerKg: number | null): number | null {
  if (pricePerKg == null || rbpPerKg == null || pricePerKg <= 0) return null;
  return ((pricePerKg - rbpPerKg) / pricePerKg) * 100;
}

type PriceGroup = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  is_standard?: boolean;
  default_margin_pct: number | string | null;
  default_target_unit: string | null;
  sort_order: number | null;
  lines: PriceLine[];
};

type Item = {
  id: string; code: string; name: string; unit: string; item_type: string;
  weight_mode?: string | null;
  target_weight_g?: number | null;
  fill_weight_g?: number | null;
  units_per_inner?: number | null;
  units_per_outer?: number | null;
  units_per_pallet?: number | null;
  default_sell_uom?: Uom | null;
};

// Tailwind-ish little chip palette for the item-type pill. Keep these in
// sync with how /items renders type badges so the visual language matches.
const TYPE_PILL: Record<string, { bg: string; color: string; label: string }> = {
  finished_good: { bg: "#dcfce7", color: "#166534", label: "Finished Good" },
  wip:           { bg: "#fef3c7", color: "#92400e", label: "WIP" },
  wipf:          { bg: "#fef3c7", color: "#92400e", label: "WIPF" },
  wipp:          { bg: "#fef3c7", color: "#92400e", label: "WIPP" },
  raw_material:  { bg: "#fef3c7", color: "#92400e", label: "Raw Material" },
  packaging:     { bg: "#e0e7ff", color: "#3730a3", label: "Packaging" },
  consumable:    { bg: "#f3f4f6", color: "#374151", label: "Consumable" },
};
function TypePill({ type }: { type: string | null | undefined }) {
  const p = type ? TYPE_PILL[type] : null;
  if (!p) return null;
  return (
    <span style={{ fontSize: "0.625rem", background: p.bg, color: p.color, borderRadius: "0.25rem", padding: "0.125rem 0.375rem", fontWeight: 600, whiteSpace: "nowrap" }}>
      {p.label}
    </span>
  );
}

export default function PriceGroupsManager({
  initialGroups, allItems, itemCosts, buffers, tenantId,
}: {
  initialGroups: PriceGroup[];
  allItems: Item[];
  itemCosts: Array<{ item_id: string; total_cost_per_unit: number | string | null }>;
  buffers: Buffers | null;
  tenantId: string;
}) {
  // item_id -> loaded cost lookup. Used by the line form to show the cost
  // context once an item is picked + live-calc the margin as the user types.
  const itemCostMap = new Map<string, number>();
  for (const c of itemCosts) {
    if (c.total_cost_per_unit != null) {
      const n = Number(c.total_cost_per_unit);
      if (Number.isFinite(n)) itemCostMap.set(c.item_id, n);
    }
  }
  const supabase = createClient();
  const [groups, setGroups] = useState<PriceGroup[]>(initialGroups);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroups[0]?.id ?? null);
  const [editingGroup, setEditingGroup] = useState<PriceGroup | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Line editing
  const [editingLine, setEditingLine] = useState<PriceLine | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineItemId, setLineItemId] = useState("");
  const [linePrice, setLinePrice] = useState("");
  const [lineDiscount, setLineDiscount] = useState("");
  const [lineCurrency, setLineCurrency] = useState("AUD");
  const [lineValidFrom, setLineValidFrom] = useState("");
  const [lineValidTo, setLineValidTo] = useState("");
  const [lineNotes, setLineNotes] = useState("");
  const [savingLine, setSavingLine] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");

  const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;

  // Items not yet in the selected group
  const usedItemIds = new Set(selectedGroup?.lines.map(l => l.item_id) ?? []);
  const availableItems = allItems.filter(i =>
    !usedItemIds.has(i.id) &&
    (i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.code.toLowerCase().includes(itemSearch.toLowerCase()))
  );

  // ── Group CRUD ──────────────────────────────────────────────────────────────

  async function createGroup() {
    if (!newGroupName.trim()) { setGroupError("Name is required."); return; }
    setSavingGroup(true); setGroupError(null);
    const { data, error } = await supabase.from("price_groups")
      .insert({ tenant_id: tenantId, name: newGroupName.trim(), description: newGroupDesc.trim() || null })
      .select("id, code, name, description, is_default, is_active, default_margin_pct, default_target_unit, sort_order").single();
    if (error) { setGroupError(error.message); setSavingGroup(false); return; }
    const newGroup: PriceGroup = { ...data, code: data.code ?? null, default_margin_pct: data.default_margin_pct ?? null, default_target_unit: data.default_target_unit ?? null, sort_order: data.sort_order ?? null, lines: [] };
    setGroups(prev => [...prev, newGroup].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedGroupId(newGroup.id);
    setShowNewGroup(false); setNewGroupName(""); setNewGroupDesc("");
    setSavingGroup(false);
  }

  async function saveGroupEdit() {
    if (!editingGroup) return;
    if (!editingGroup.name.trim()) { setGroupError("Name is required."); return; }
    setSavingGroup(true); setGroupError(null);
    const { data, error } = await supabase.from("price_groups")
      .update({ name: editingGroup.name.trim(), description: editingGroup.description || null, is_active: editingGroup.is_active })
      .eq("id", editingGroup.id).select("id, code, name, description, is_default, is_active, default_margin_pct, default_target_unit, sort_order").single();
    if (error) { setGroupError(error.message); setSavingGroup(false); return; }
    setGroups(prev => prev.map(g => g.id === data.id ? { ...g, ...data } : g).sort((a, b) => a.name.localeCompare(b.name)));
    setEditingGroup(null); setSavingGroup(false);
  }

  // ── Line CRUD ───────────────────────────────────────────────────────────────

  function openAddLine() {
    setEditingLine(null); setShowAddLine(true);
    setLineItemId(""); setLinePrice(""); setLineDiscount(""); setLineCurrency("AUD");
    setLineValidFrom(""); setLineValidTo(""); setLineNotes(""); setItemSearch(""); setLineError(null);
  }

  function openEditLine(line: PriceLine) {
    setEditingLine(line); setShowAddLine(false);
    setLineItemId(line.item_id);
    setLinePrice(line.unit_price?.toString() ?? "");
    setLineDiscount(line.discount_pct?.toString() ?? "");
    setLineCurrency(line.currency);
    setLineValidFrom(line.valid_from ?? "");
    setLineValidTo(line.valid_to ?? "");
    setLineNotes(line.notes ?? "");
    setLineError(null);
  }

  function cancelLine() { setEditingLine(null); setShowAddLine(false); setLineError(null); }

  async function saveLine() {
    if (!selectedGroup) return;
    if (showAddLine && !lineItemId) { setLineError("Select an item."); return; }
    setSavingLine(true); setLineError(null);

    const payload = {
      price_group_id: selectedGroup.id,
      tenant_id: tenantId,
      item_id: lineItemId || editingLine?.item_id,
      unit_price: linePrice ? parseFloat(linePrice) : null,
      discount_pct: lineDiscount ? parseFloat(lineDiscount) : null,
      currency: lineCurrency,
      valid_from: lineValidFrom || null,
      valid_to: lineValidTo || null,
      notes: lineNotes || null,
    };

    if (showAddLine) {
      const { data, error } = await supabase.from("price_group_lines")
        .insert(payload)
        .select("id, item_id, unit_price, discount_pct, currency, valid_from, valid_to, notes, item:item_id(id,code,name,unit,item_type)")
        .single();
      if (error) { setLineError(error.message); setSavingLine(false); return; }
      setGroups(prev => prev.map(g => g.id === selectedGroup.id
        ? { ...g, lines: [...g.lines, data as unknown as PriceLine].sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? "")) }
        : g));
    } else if (editingLine) {
      const { data, error } = await supabase.from("price_group_lines")
        .update(payload)
        .eq("id", editingLine.id)
        .select("id, item_id, unit_price, discount_pct, currency, valid_from, valid_to, notes, item:item_id(id,code,name,unit,item_type)")
        .single();
      if (error) { setLineError(error.message); setSavingLine(false); return; }
      setGroups(prev => prev.map(g => g.id === selectedGroup.id
        ? { ...g, lines: g.lines.map(l => l.id === data.id ? data as unknown as PriceLine : l) }
        : g));
    }

    setSavingLine(false); cancelLine();
  }

  async function deleteLine(lineId: string) {
    if (!selectedGroup) return;
    if (!confirm("Remove this item from the price group?")) return;
    await supabase.from("price_group_lines").delete().eq("id", lineId);
    setGroups(prev => prev.map(g => g.id === selectedGroup.id
      ? { ...g, lines: g.lines.filter(l => l.id !== lineId) }
      : g));
  }

  const lineForm = (
    <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
      <h4 style={{ margin: "0 0 0.875rem", fontSize: "0.9rem", fontWeight: 600 }}>
        {showAddLine ? "Add Item to Price Group" : `Edit — ${editingLine?.item?.name}`}
      </h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
        {showAddLine && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Item *</label>
            <input className="form-input" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
              placeholder="Search by name or code…" style={{ marginBottom: "0.375rem" }} />
            <div style={{ border: "1px solid #e7e5e4", borderRadius: "0.375rem", maxHeight: "220px", overflowY: "auto", background: "#fff" }}>
              {availableItems.length === 0 ? (
                <div style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#a8a29e", textAlign: "center" }}>
                  {itemSearch ? `No items match "${itemSearch}"` : "All available items are already in this group."}
                </div>
              ) : availableItems.slice(0, 100).map(i => {
                const selected = lineItemId === i.id;
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setLineItemId(i.id)}
                    style={{
                      display: "flex", width: "100%", alignItems: "center", gap: "0.625rem",
                      padding: "0.5rem 0.75rem",
                      border: "none",
                      borderBottom: "1px solid #f5f5f4",
                      textAlign: "left",
                      cursor: "pointer",
                      background: selected ? "#fef2f2" : "transparent",
                      color: selected ? "#991b1b" : "#1c1917",
                      fontWeight: selected ? 600 : 400,
                      fontSize: "0.8125rem",
                      transition: "background 0.05s",
                    }}
                    onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "#fafaf9"; }}
                    onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    {selected && <span style={{ color: "#b91c1c", fontSize: "0.85rem" }}>✓</span>}
                    <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c", minWidth: "5rem" }}>{i.code}</span>
                    <span style={{ flex: 1 }}>{i.name}</span>
                    <TypePill type={i.item_type} />
                    <span style={{ fontSize: "0.7rem", color: "#a8a29e" }}>{i.unit}</span>
                  </button>
                );
              })}
              {availableItems.length > 100 && (
                <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.7rem", color: "#a8a29e", textAlign: "center", borderTop: "1px solid #f5f5f4", background: "#fafaf9" }}>
                  Showing first 100 of {availableItems.length}. Search to narrow.
                </div>
              )}
            </div>
            {/* Cost context — once an item is picked we show its loaded
                cost so the user knows where the price they enter lands
                relative to landed cost (i.e. how much margin they're
                actually pricing for). */}
            {lineItemId && (() => {
              const picked = allItems.find(it => it.id === lineItemId);
              const cost = itemCostMap.get(lineItemId);
              const price = linePrice ? parseFloat(linePrice) : null;
              const margin = (price != null && cost != null && price > 0)
                ? ((price - cost) / price) * 100
                : null;
              const markup = (price != null && cost != null && cost > 0)
                ? ((price - cost) / cost) * 100
                : null;
              const fmt = (n: number | null | undefined) => n == null
                ? "—"
                : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
              const marginColor = margin == null
                ? "#78716c"
                : margin < 0 ? "#dc2626"
                : margin < 10 ? "#ea580c"
                : margin < 25 ? "#ca8a04"
                : "#16a34a";
              return (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.8125rem" }}>
                  <div>
                    <span style={{ color: "#78716c" }}>Cost basis:</span>{" "}
                    <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                      {cost == null ? "—" : `${fmt(cost)}/${picked?.unit ?? "unit"}`}
                    </span>
                    <span style={{ color: "#a8a29e", fontSize: "0.7rem", marginLeft: "0.25rem" }}>(RM + Labour + OH)</span>
                  </div>
                  {price != null && cost != null && (
                    <>
                      <div style={{ color: "#78716c", fontSize: "0.7rem" }}>→</div>
                      <div>
                        <span style={{ color: "#78716c" }}>Margin:</span>{" "}
                        <span style={{ fontWeight: 600, color: marginColor }}>
                          {margin == null ? "—" : `${margin.toFixed(1)}%`}
                        </span>
                        <span style={{ color: "#a8a29e", fontSize: "0.7rem", marginLeft: "0.375rem" }}>
                          ({markup == null ? "—" : `${markup >= 0 ? "+" : ""}${markup.toFixed(1)}% markup`})
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <div>
          <label className="form-label">Unit Price (per {editingLine?.item?.unit ?? "unit"})</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", fontSize: "0.875rem" }}>$</span>
            <CalcInput value={linePrice} onChange={setLinePrice} decimals={4} placeholder="0.00 — try 112.50/25" style={{ paddingLeft: "1.5rem" }} />
          </div>
        </div>
        <div>
          <label className="form-label">Discount %</label>
          <CalcInput value={lineDiscount} onChange={setLineDiscount} decimals={2} placeholder="e.g. 10" />
        </div>
        <div>
          <label className="form-label">Currency</label>
          <select className="form-select" value={lineCurrency} onChange={e => setLineCurrency(e.target.value)}>
            <option>AUD</option><option>USD</option><option>EUR</option><option>GBP</option><option>NZD</option>
          </select>
        </div>
        <div>
          <label className="form-label">Valid From</label>
          <input className="form-input" type="date" value={lineValidFrom} onChange={e => setLineValidFrom(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Valid To</label>
          <input className="form-input" type="date" value={lineValidTo} onChange={e => setLineValidTo(e.target.value)} />
        </div>
        <div style={{ gridColumn: "span 3" }}>
          <label className="form-label">Notes</label>
          <input className="form-input" value={lineNotes} onChange={e => setLineNotes(e.target.value)} placeholder="e.g. Promotional pricing, seasonal rate" />
        </div>
      </div>
      {lineError && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.5rem 0 0" }}>{lineError}</p>}
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.875rem" }}>
        <button className="btn-primary" onClick={saveLine} disabled={savingLine}>{savingLine ? "Saving…" : "Save"}</button>
        <button className="btn-secondary" onClick={cancelLine}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "1.5rem", alignItems: "start" }}>
      {/* Left — group list */}
      <div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#57534e" }}>Price Groups</span>
            <button onClick={() => { setShowNewGroup(s => !s); setGroupError(null); }}
              style={{ fontSize: "0.75rem", background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 600 }}>
              {showNewGroup ? "✕" : "+ New"}
            </button>
          </div>

          {showNewGroup && (
            <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
              <input className="form-input" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                placeholder="Group name" style={{ marginBottom: "0.5rem", fontSize: "0.875rem" }} />
              <input className="form-input" value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)}
                placeholder="Description (optional)" style={{ marginBottom: "0.5rem", fontSize: "0.875rem" }} />
              {groupError && <p style={{ color: "#dc2626", fontSize: "0.75rem", margin: "0 0 0.375rem" }}>{groupError}</p>}
              <button className="btn-primary" style={{ fontSize: "0.8125rem", width: "100%" }} onClick={createGroup} disabled={savingGroup}>
                {savingGroup ? "Creating…" : "Create Group"}
              </button>
            </div>
          )}

          {groups.map(g => (
            <button key={g.id} onClick={() => { setSelectedGroupId(g.id); setEditingLine(null); setShowAddLine(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "0.75rem 1rem",
                borderBottom: "1px solid #f5f5f4", background: g.id === selectedGroupId ? "#fff1f2" : "none",
                border: "none", borderLeft: g.id === selectedGroupId ? "3px solid #b91c1c" : "3px solid transparent",
                cursor: "pointer",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: g.id === selectedGroupId ? 600 : 400, fontSize: "0.875rem", color: "#1c1917" }}>{g.name}</span>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  {g.is_default && <span style={{ fontSize: "0.625rem", background: "#fef3c7", color: "#b45309", borderRadius: "0.25rem", padding: "0.125rem 0.375rem", fontWeight: 600 }}>DEFAULT</span>}
                  {!g.is_active && <span style={{ fontSize: "0.625rem", background: "#f5f5f4", color: "#78716c", borderRadius: "0.25rem", padding: "0.125rem 0.375rem", fontWeight: 600 }}>INACTIVE</span>}
                </div>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#a8a29e", marginTop: "0.125rem" }}>
                {g.lines.length} item{g.lines.length !== 1 ? "s" : ""}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right — selected group lines */}
      <div>
        {!selectedGroup ? (
          <div className="card" style={{ textAlign: "center", color: "#78716c", padding: "3rem" }}>
            Select a price group on the left to manage its prices.
          </div>
        ) : (
          <>
            {/* Group header */}
            <div className="card" style={{ marginBottom: "1rem" }}>
              {editingGroup?.id === selectedGroup.id ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                    <div>
                      <label className="form-label">Group Name</label>
                      <input className="form-input" value={editingGroup.name} onChange={e => setEditingGroup(g => g ? { ...g, name: e.target.value } : g)} />
                    </div>
                    <div>
                      <label className="form-label">Description</label>
                      <input className="form-input" value={editingGroup.description ?? ""} onChange={e => setEditingGroup(g => g ? { ...g, description: e.target.value } : g)} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <input type="checkbox" id="grp-active" checked={editingGroup.is_active} onChange={e => setEditingGroup(g => g ? { ...g, is_active: e.target.checked } : g)} />
                      <label htmlFor="grp-active" style={{ fontSize: "0.875rem" }}>Active</label>
                    </div>
                  </div>
                  {groupError && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0 0 0.5rem" }}>{groupError}</p>}
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button className="btn-primary" onClick={saveGroupEdit} disabled={savingGroup}>{savingGroup ? "Saving…" : "Save"}</button>
                    <button className="btn-secondary" onClick={() => setEditingGroup(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>{selectedGroup.name}</h2>
                      {selectedGroup.is_default && <span style={{ fontSize: "0.6875rem", background: "#fef3c7", color: "#b45309", borderRadius: "0.25rem", padding: "0.125rem 0.5rem", fontWeight: 600 }}>DEFAULT</span>}
                      {!selectedGroup.is_active && <span style={{ fontSize: "0.6875rem", background: "#f5f5f4", color: "#78716c", borderRadius: "0.25rem", padding: "0.125rem 0.5rem", fontWeight: 600 }}>INACTIVE</span>}
                    </div>
                    {selectedGroup.description && <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#78716c" }}>{selectedGroup.description}</p>}
                  </div>
                  <button className="btn-secondary" style={{ fontSize: "0.8125rem" }} onClick={() => setEditingGroup({ ...selectedGroup })}>Edit Group</button>
                </div>
              )}
            </div>

            {/* Lines */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.9375rem", fontWeight: 600 }}>Price Lines <span style={{ color: "#78716c", fontWeight: 400, fontSize: "0.875rem" }}>({selectedGroup.lines.length} items)</span></span>
              {!showAddLine && !editingLine && (
                <button className="btn-primary" style={{ fontSize: "0.875rem" }} onClick={openAddLine}>+ Add Item</button>
              )}
            </div>

            {(showAddLine || editingLine) && lineForm}

            {selectedGroup.lines.length === 0 ? (
              <div className="card" style={{ textAlign: "center", color: "#78716c", padding: "2rem" }}>
                No items in this price group yet. Click "+ Add Item" to set your first price.
              </div>
            ) : (
              <div className="card" style={{ padding: 0 }}>
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
                      <th>Expiry</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGroup.lines.map(line => {
                      const isExpired = line.valid_to && new Date(line.valid_to) < new Date();
                      const isEditing = editingLine?.id === line.id;
                      const it = line.item;
                      const cogsPerKg = it ? itemCostMap.get(it.id) ?? null : null;
                      const costs = it ? buildPerItemCosts(it, cogsPerKg ?? null, buffers) : { directPerKg: null, loadedPerKg: null, rbpPerKg: null };
                      const storedUom = (line.unit ?? "kg") as Uom;
                      // Convert price to $/kg via the item's pack hierarchy.
                      const oneInKg = it ? convertQtyForItem(it, 1, storedUom, "kg") : null;
                      const pricePerKg = (line.unit_price != null && oneInKg != null && oneInKg > 0) ? line.unit_price / oneInKg : null;
                      // $/unit (per piece) only if fixed-weight + target weight known.
                      const oneEaInKg = it ? convertQtyForItem(it, 1, "ea", "kg") : null;
                      const showUnitCol = !!(it && it.weight_mode !== "random" && oneEaInKg && oneEaInKg > 0);
                      const pricePerUnit = (showUnitCol && pricePerKg != null && oneEaInKg != null) ? pricePerKg * oneEaInKg : null;
                      const margin = marginVsRbp(pricePerKg, costs.rbpPerKg);
                      const status = pricingStatus(pricePerKg, costs.rbpPerKg, costs.loadedPerKg, costs.directPerKg);
                      const fmt2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n)) ? "—" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
                      return (
                        <tr key={line.id} style={{ background: isExpired ? "#fef2f2" : isEditing ? "#fafaf9" : undefined, opacity: isExpired ? 0.8 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{it?.name ?? "—"}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.125rem" }}>
                              <span style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{it?.code}</span>
                              <TypePill type={it?.item_type} />
                            </div>
                          </td>
                          <td style={{ color: "#57534e", fontSize: "0.8125rem" }}>{storedUom}</td>
                          <td style={{ fontWeight: 600, color: "#15803d", textAlign: "right", fontFamily: "monospace" }}>
                            {line.unit_price != null ? `$${line.unit_price.toFixed(2)}` : <span style={{ color: "#a8a29e" }}>—</span>}
                          </td>
                          <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt2(pricePerKg)}</td>
                          <td style={{ textAlign: "right", fontFamily: "monospace", color: showUnitCol ? "#1c1917" : "#d6d3d1" }}>
                            {showUnitCol ? fmt2(pricePerUnit) : "—"}
                          </td>
                          <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: margin == null ? "#78716c" : margin < 0 ? "#dc2626" : "#16a34a" }}>
                            {margin == null ? "—" : `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}%`}
                          </td>
                          <td>
                            <span style={pillStyle(status)}>{STATUS_STYLE[status].label}</span>
                          </td>
                          <td style={{ fontSize: "0.75rem" }}>
                            {line.valid_to
                              ? <span style={{ color: isExpired ? "#dc2626" : "#78716c" }}>
                                  {new Date(line.valid_to).toLocaleDateString("en-AU", { day:"numeric",month:"short",year:"2-digit" })}
                                  {isExpired && " ⚠"}
                                </span>
                              : <span style={{ color: "#d6d3d1" }}>—</span>}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button className="btn-secondary" style={{ fontSize:"0.75rem", padding:"0.25rem 0.5rem" }} onClick={() => openEditLine(line)}>Edit</button>
                              <button style={{ fontSize:"0.75rem", padding:"0.25rem 0.5rem", background:"none", border:"1px solid #fca5a5", borderRadius:"0.375rem", color:"#dc2626", cursor:"pointer" }}
                                onClick={() => deleteLine(line.id)}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
