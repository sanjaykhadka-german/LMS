"use client";

/**
 * Split-order modal — opens from the "Order by item" tab.
 *
 * Lets the operator order a SINGLE item across one or more suppliers.
 *  - Default line: preferred (or cheapest) supplier, recommended qty.
 *  - "+ Split with another supplier"  → adds a line; pick from any
 *    supplier_items already linked to this item.
 *  - "+ Add new supplier for this item" → opens an inline form (modeled on
 *    Link-a-Supplier) that writes to supplier_items, then comes back as a
 *    new line you can edit qty on.
 *
 * Save → calls addDraftLine() server action for each line. The page
 * revalidates so the draft cart bar at bottom updates.
 */

import { useMemo, useState, useTransition } from "react";
import { addDraftLine, saveSupplierLink, replaceDraftLinesForItem } from "../actions";
import { SearchableSelect } from "@/components/searchable-select";
import type { NeedNowRow, SupplierLink, SupplierOption, DraftLine } from "./purchasing-hub";

type Line = {
  key: string; // local-only client id
  supplier_link?: SupplierLink; // existing supplier_items link if known
  supplier_id: string;
  supplier_name: string;
  qty: string;
  unit_price: string;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
};

export default function SplitOrderModal({
  row, suppliers, existingDraftLines = [], onClose,
}: {
  row: NeedNowRow;
  suppliers: SupplierOption[];
  existingDraftLines?: DraftLine[];
  onClose: () => void;
}) {
  // Seed: if the item already has draft lines, edit those (mode="edit").
  // Otherwise seed one fresh line for the primary supplier @ recommended qty.
  const isEditMode = existingDraftLines.length > 0;
  const initialLines: Line[] = useMemo(() => {
    if (isEditMode) {
      return existingDraftLines.map(d => {
        const link = row.supplier_links.find(l => l.supplier_id === d.supplier_id);
        return {
          key: rid(),
          supplier_link: link,
          supplier_id: d.supplier_id,
          supplier_name: link?.supplier_name ?? "—",
          qty: String(d.qty),
          unit_price: d.unit_price != null ? String(d.unit_price) : (link?.unit_price ? String(link.unit_price) : ""),
          purchase_uom: d.purchase_uom ?? link?.purchase_uom ?? null,
          purchase_uom_qty: d.purchase_uom_qty ?? link?.purchase_uom_qty ?? null,
        };
      });
    }
    if (row.supplier_links.length === 0) return [];
    const primary = row.supplier_links.find(s => s.is_preferred) ?? row.supplier_links[0];
    return [{
      key: rid(),
      supplier_link: primary,
      supplier_id: primary.supplier_id,
      supplier_name: primary.supplier_name,
      qty: row.recommended_qty > 0 ? String(row.recommended_qty) : "0",
      unit_price: primary.unit_price ? String(primary.unit_price) : "",
      purchase_uom: primary.purchase_uom,
      purchase_uom_qty: primary.purchase_uom_qty,
    }];
  }, [row, isEditMode, existingDraftLines]);

  const [lines, setLines] = useState<Line[]>(initialLines);
  const [showAdd, setShowAdd] = useState(false); // "+ new supplier inline" form
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const linkedSupplierIds = new Set(row.supplier_links.map(s => s.supplier_id));
  const usedSupplierIds   = new Set(lines.map(l => l.supplier_id).filter(Boolean));

  // Suppliers we can split TO: linked to this item but not yet on a line.
  const splitOptions = row.supplier_links.filter(s => !usedSupplierIds.has(s.supplier_id));

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key));
  }
  function addSplitLine(link: SupplierLink) {
    setLines(prev => [...prev, {
      key: rid(),
      supplier_link: link,
      supplier_id: link.supplier_id,
      supplier_name: link.supplier_name,
      qty: "0",
      unit_price: link.unit_price ? String(link.unit_price) : "",
      purchase_uom: link.purchase_uom,
      purchase_uom_qty: link.purchase_uom_qty,
    }]);
  }

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const totalCost = lines.reduce((s, l) => {
    const q = Number(l.qty) || 0;
    const price = Number(l.unit_price) || 0;
    const pack = l.purchase_uom_qty && l.purchase_uom_qty > 0 ? l.purchase_uom_qty : 1;
    const perBase = pack > 0 ? price / pack : price;
    return s + q * perBase;
  }, 0);

  async function handleSubmit() {
    setErr(null);
    const valid = lines.filter(l => l.supplier_id && Number(l.qty) > 0);
    if (valid.length === 0 && !isEditMode) {
      setErr("Add at least one line with qty > 0");
      return;
    }
    start(async () => {
      // Edit mode = REPLACE the cart's lines for this item with the current set.
      // Add mode  = STACK new lines onto whatever's already there (none, here).
      if (isEditMode) {
        const res = await replaceDraftLinesForItem(
          row.id,
          valid.map(l => ({
            supplier_id: l.supplier_id,
            qty: Number(l.qty),
            unit: row.unit,
            unit_price: l.unit_price ? Number(l.unit_price) : null,
            purchase_uom: l.purchase_uom ?? null,
            purchase_uom_qty: l.purchase_uom_qty ?? null,
          })),
        );
        if ("error" in res) { setErr(res.error); return; }
        onClose();
        return;
      }
      for (const l of valid) {
        const res = await addDraftLine({
          item_id: row.id,
          supplier_id: l.supplier_id,
          qty: Number(l.qty),
          unit: row.unit,
          unit_price: l.unit_price ? Number(l.unit_price) : null,
          purchase_uom: l.purchase_uom ?? null,
          purchase_uom_qty: l.purchase_uom_qty ?? null,
        });
        if ("error" in res) { setErr(res.error); return; }
      }
      onClose();
    });
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            <div style={lblTiny}>{isEditMode ? "Edit planned order for" : "Order this item"}</div>
            <h2 style={{ margin: "0.2rem 0 0.1rem", fontSize: "1.125rem", fontWeight: 700 }}>{row.name}</h2>
            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>
              {row.code} · {row.item_type}
            </div>
            {isEditMode && (
              <div style={{ marginTop: "0.4rem", padding: "0.3rem 0.5rem", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.375rem", fontSize: "0.7rem", color: "#854d0e" }}>
                Editing existing draft cart lines. Save to replace; remove a line to drop it from the cart.
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: "1.5rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
        </div>

        {/* Stock/min/max + demand info panel */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.5rem", marginBottom: "0.875rem" }}>
          <Stat label="Stock"           value={`${fmtNum(row.current_stock)} ${row.unit}`} tone={row.current_stock <= 0 ? "red" : "default"} />
          <Stat label="Min / Max"       value={row.min_stock > 0 || row.max_stock > 0 ? `${fmtNum(row.min_stock, 0)} / ${fmtNum(row.max_stock, 0)}` : "—"} />
          <Stat label="Need (orders)"   value={row.needed_orders > 0 ? fmtNum(row.needed_orders) : "—"} sub={row.open_order_count > 0 ? `${row.open_order_count} open POs` : "future + today"} />
          <Stat label="Need (plan)"     value={row.needed_plan > 0 ? fmtNum(row.needed_plan) : "—"} sub="demand plan" />
          <Stat label="Gap"             value={row.gap > 0 ? fmtNum(row.gap) : "—"} tone={row.gap > 0 ? "red" : "default"} />
          <Stat label="Suggested order" value={row.recommended_qty > 0 ? `${fmtNum(row.recommended_qty)} ${row.unit}` : "—"} tone="primary" />
        </div>

        {/* Linked suppliers reference */}
        {row.supplier_links.length > 0 && (
          <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "0.5rem 0.75rem", marginBottom: "0.875rem" }}>
            <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.3rem" }}>Linked suppliers</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 70px 60px 60px", gap: "0.4rem", fontSize: "0.65rem", color: "#78716c", paddingBottom: "0.2rem", borderBottom: "1px solid #e7e5e4" }}>
              <span>Supplier</span>
              <span style={{ textAlign: "right" }}>Pack price</span>
              <span style={{ textAlign: "right" }}>Per {row.unit}</span>
              <span style={{ textAlign: "right" }}>Pack</span>
              <span style={{ textAlign: "right" }}>MOQ</span>
              <span style={{ textAlign: "center" }}>Lead</span>
            </div>
            {row.supplier_links.map(s => {
              const pack = s.purchase_uom_qty && s.purchase_uom_qty > 0 ? s.purchase_uom_qty : 1;
              const perBase = s.unit_price / pack;
              return (
                <div key={s.supplier_link_id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 70px 60px 60px", gap: "0.4rem", fontSize: "0.7rem", padding: "0.25rem 0", borderBottom: "1px solid #f5f5f4" }}>
                  <span>
                    {s.is_preferred && <span style={{ color: "#16a34a", marginRight: "0.25rem" }}>✓</span>}
                    {s.supplier_name}
                    {s.supplier_item_code && <span style={{ marginLeft: "0.4rem", fontSize: "0.6rem", color: "#a8a29e", fontFamily: "monospace" }}>{s.supplier_item_code}</span>}
                  </span>
                  <span style={{ textAlign: "right", fontFamily: "monospace" }}>${s.unit_price.toFixed(2)}</span>
                  <span style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>${perBase.toFixed(4)}</span>
                  <span style={{ textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>{s.purchase_uom_qty ? `${s.purchase_uom_qty} ${s.purchase_uom ?? ""}` : "—"}</span>
                  <span style={{ textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>{s.min_order_qty ?? "—"}</span>
                  <span style={{ textAlign: "center", color: "#78716c" }}>{s.lead_time_days != null ? `${s.lead_time_days}d` : "—"}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Section header for the order lines */}
        <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.4rem" }}>
          Order lines · split across suppliers
        </div>

        {/* Lines */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {lines.map((l) => (
            <LineRow
              key={l.key}
              line={l}
              unit={row.unit}
              onChange={(patch) => updateLine(l.key, patch)}
              onRemove={() => removeLine(l.key)}
              canRemove={lines.length > 1}
            />
          ))}
          {lines.length === 0 && (
            <div style={{ padding: "0.75rem", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#854d0e" }}>
              No supplier linked to this item yet. Use "+ Add new supplier" below to create the link before ordering.
            </div>
          )}
        </div>

        {/* Add-line buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.75rem" }}>
          {splitOptions.length > 0 && (
            <details style={{ position: "relative" }}>
              <summary style={{ ...btnGhost, listStyle: "none", cursor: "pointer", display: "inline-block" }}>
                + Split with another supplier
              </summary>
              <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 0.25rem)", left: 0, background: "white", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "0.4rem", minWidth: "240px", boxShadow: "0 4px 14px rgba(0,0,0,0.08)" }}>
                {splitOptions.map(s => (
                  <button
                    key={s.supplier_link_id}
                    type="button"
                    onClick={() => addSplitLine(s)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: 0, background: "transparent", cursor: "pointer", borderRadius: "0.25rem", fontSize: "0.8125rem", fontFamily: "inherit" }}
                  >
                    {s.supplier_name}
                    {s.unit_price ? <span style={{ color: "#78716c", fontSize: "0.7rem", marginLeft: "0.4rem" }}>${s.unit_price.toFixed(2)} {s.purchase_uom ? `/${s.purchase_uom_qty} ${s.purchase_uom}` : ""}</span> : null}
                  </button>
                ))}
              </div>
            </details>
          )}
          <button type="button" onClick={() => setShowAdd(v => !v)} style={btnGhost}>
            + Add new supplier for this item
          </button>
        </div>

        {showAdd && (
          <NewSupplierInlineForm
            row={row}
            suppliers={suppliers.filter(s => !linkedSupplierIds.has(s.id))}
            onSaved={(link) => {
              setShowAdd(false);
              addSplitLine(link);
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", padding: "0.625rem 0.875rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem" }}>
          <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>
            Total qty: <strong style={{ fontFamily: "monospace" }}>{totalQty.toFixed(2)} {row.unit}</strong>
          </span>
          <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>
            Estimated total: <strong style={{ fontFamily: "monospace" }}>${totalCost.toFixed(2)}</strong>
          </span>
        </div>

        {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0.5rem 0" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", marginTop: "1rem" }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "0.45rem 0.875rem", fontSize: "0.8125rem" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={pending} className="btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.8125rem" }}>
            {pending ? "Saving…" : isEditMode ? "Save changes" : "Add to PO draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineRow({
  line, unit, onChange, onRemove, canRemove,
}: {
  line: Line; unit: string;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const pack = line.purchase_uom_qty && line.purchase_uom_qty > 0 ? line.purchase_uom_qty : 1;
  const perBase = (Number(line.unit_price) || 0) / pack;
  const lineCost = (Number(line.qty) || 0) * perBase;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 110px 110px 100px 36px", gap: "0.5rem", alignItems: "center", padding: "0.5rem 0.625rem", border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: "white" }}>
      <div>
        <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{line.supplier_name}</div>
        {line.supplier_link?.supplier_item_code && (
          <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "#a8a29e" }}>
            {line.supplier_link.supplier_item_code}
            {line.purchase_uom_qty ? ` · ${line.purchase_uom_qty} ${line.purchase_uom ?? ""} pack` : ""}
          </div>
        )}
      </div>
      <label style={lblOnTop}>
        <span>Qty ({unit})</span>
        <input type="number" step="any" value={line.qty} onChange={e => onChange({ qty: e.target.value })} style={input} />
      </label>
      <label style={lblOnTop}>
        <span>Unit price</span>
        <input type="number" step="any" value={line.unit_price} onChange={e => onChange({ unit_price: e.target.value })} style={input} />
      </label>
      <div style={{ fontSize: "0.7rem", color: "#78716c", textAlign: "right" }}>
        <div>= ${perBase.toFixed(4)}/{unit}</div>
        <div style={{ fontWeight: 600, color: "#1c1917" }}>${lineCost.toFixed(2)}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        title={canRemove ? "Remove this line" : ""}
        style={{ border: "1px solid #e7e5e4", background: canRemove ? "white" : "#fafaf9", color: canRemove ? "#dc2626" : "#cfc9bf", borderRadius: "0.375rem", cursor: canRemove ? "pointer" : "not-allowed", padding: "0.25rem 0", fontSize: "0.875rem", fontFamily: "inherit" }}
      >×</button>
    </div>
  );
}

function NewSupplierInlineForm({
  row, suppliers, onSaved, onCancel,
}: {
  row: NeedNowRow;
  suppliers: SupplierOption[];
  onSaved: (link: SupplierLink) => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [puom, setPuom] = useState(row.unit ?? "kg");
  const [puomQty, setPuomQty] = useState("1");
  const [moq, setMoq] = useState("");
  const [price, setPrice] = useState("");
  const [pref, setPref] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Local supplier list grows when user creates a new one inline.
  const [localSuppliers, setLocalSuppliers] = useState(suppliers);

  function handleSave() {
    setErr(null);
    if (!supplierId) { setErr("Pick a supplier"); return; }
    if (!price)      { setErr("Enter a unit price"); return; }
    start(async () => {
      const res = await saveSupplierLink({
        item_id: row.id,
        supplier_id: supplierId,
        supplier_item_code: code || null,
        supplier_item_name: name || null,
        unit_price: Number(price),
        currency: "AUD",
        purchase_uom: puom || null,
        purchase_uom_qty: puomQty ? Number(puomQty) : null,
        min_order_qty: moq ? Number(moq) : null,
        lead_time_days: lead ? Number(lead) : null,
        is_preferred: pref,
      });
      if ("error" in res) { setErr(res.error); return; }
      const sup = localSuppliers.find(s => s.id === supplierId);
      onSaved({
        supplier_link_id: res.id,
        supplier_id: supplierId,
        supplier_name: sup?.name ?? "Supplier",
        supplier_item_code: code || null,
        supplier_item_name: name || null,
        unit_price: Number(price),
        currency: "AUD",
        lead_time_days: lead ? Number(lead) : null,
        purchase_uom: puom || null,
        purchase_uom_qty: puomQty ? Number(puomQty) : null,
        min_order_qty: moq ? Number(moq) : null,
        is_preferred: pref,
        notes: null,
      });
    });
  }

  return (
    <div style={{ marginTop: "0.75rem", border: "1px solid #fde68a", background: "#fef9c3", borderRadius: "0.5rem", padding: "0.875rem 1rem" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>Link a Supplier</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
        <Field label="Supplier *">
          <SearchableSelect
            value={supplierId}
            onChange={setSupplierId}
            options={localSuppliers.map(s => ({ value: s.id, label: s.code ? `${s.name} (${s.code})` : s.name }))}
            placeholder="Search supplier…"
            addNew={{
              table: "suppliers",
              labelField: "name",
              codeField: "code",
              dialogTitle: "New supplier",
              extras: { is_active: true },
              onCreated: (newId, label, codeStr) => {
                // Append to the local options list and select it.
                setLocalSuppliers(prev => [...prev, { id: newId, name: label, code: codeStr ?? null }]);
                setSupplierId(newId);
              },
            }}
          />
        </Field>
        <Field label="Supplier's Item Code">
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Supplier SKU" style={input} />
        </Field>
        <Field label="Supplier's Item Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="How supplier describes it" style={input} />
        </Field>
        <Field label="Lead Time (days)">
          <input type="number" value={lead} onChange={e => setLead(e.target.value)} placeholder="e.g. 2" style={input} />
        </Field>
        <Field label="Purchase Unit">
          <input value={puom} onChange={e => setPuom(e.target.value)} placeholder="kg / carton / each" style={input} />
        </Field>
        <Field label="Qty per Purchase Unit">
          <input type="number" step="any" value={puomQty} onChange={e => setPuomQty(e.target.value)} placeholder="e.g. 30" style={input} />
        </Field>
        <Field label="Min Order Qty">
          <input type="number" step="any" value={moq} onChange={e => setMoq(e.target.value)} placeholder="e.g. 1" style={input} />
        </Field>
        <Field label="Unit Price">
          <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="Per purchase unit" style={input} />
        </Field>
        <Field label="Preferred">
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem", background: "white", border: "1px solid #cfc9bf", borderRadius: "0.375rem", fontSize: "0.8125rem", cursor: "pointer" }}>
            <input type="checkbox" checked={pref} onChange={e => setPref(e.target.checked)} />
            Preferred supplier
          </label>
        </Field>
      </div>
      {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", marginTop: "0.5rem" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", marginTop: "0.75rem" }}>
        <button onClick={onCancel} className="btn-secondary" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8125rem" }}>Cancel</button>
        <button onClick={handleSave} disabled={pending} className="btn-primary" style={{ padding: "0.4rem 0.875rem", fontSize: "0.8125rem" }}>
          {pending ? "Linking…" : "Link Supplier"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", marginBottom: "0.2rem" }}>{label}</div>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "red" | "primary" }) {
  const colour = tone === "red" ? "#991b1b" : tone === "primary" ? "#b91c1c" : "#1c1917";
  const bg     = tone === "red" ? "#fef2f2" : tone === "primary" ? "#fef2f2" : "#fafaf9";
  const border = tone === "red" ? "#fca5a5" : tone === "primary" ? "#fca5a5" : "#e7e5e4";
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "0.375rem", padding: "0.4rem 0.5rem" }}>
      <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#78716c", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: colour, marginTop: "0.1rem", fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.6rem", color: "#a8a29e", marginTop: "0.05rem" }}>{sub}</div>}
    </div>
  );
}

function fmtNum(n: number, dec = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function rid() { return Math.random().toString(36).slice(2, 9); }

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  paddingTop: "5vh", overflowY: "auto",
};
const panel: React.CSSProperties = {
  background: "white", borderRadius: "0.625rem",
  width: "min(960px, 95vw)", padding: "1.5rem 1.75rem",
  boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
};
const input: React.CSSProperties = {
  width: "100%", padding: "0.4rem 0.625rem",
  border: "1px solid #cfc9bf", borderRadius: "0.375rem",
  fontSize: "0.8125rem", fontFamily: "inherit", background: "white",
};
const lblTiny: React.CSSProperties = {
  fontSize: "0.7rem", color: "#78716c", letterSpacing: "0.04em",
  textTransform: "uppercase", fontWeight: 600,
};
const lblOnTop: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "0.15rem",
  fontSize: "0.65rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em",
};
const btnGhost: React.CSSProperties = {
  padding: "0.4rem 0.75rem", border: "1px dashed #cfc9bf",
  background: "white", color: "#57534e", borderRadius: "0.375rem",
  fontSize: "0.75rem", fontFamily: "inherit", cursor: "pointer",
};
