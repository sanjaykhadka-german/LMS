"use client";

/**
 * Quick-fix modal — opens on row click in any /purchasing tab.
 *
 * Lets the operator fix the four most-likely-edited fields in place:
 *   - current_stock
 *   - min_stock / max_stock
 *   - default supplier (sets is_preferred on the chosen supplier_items row)
 *   - standard_cost override
 *
 * Plus an "Open full editor →" link to /items/[id] for everything else.
 *
 * Save → closes → page revalidates → DataTable rerender shows the fresh row.
 * Scroll position is restored by the caller (passed down via onClose).
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { saveQuickFix, saveSupplierLink } from "../actions";
import { SearchableSelect } from "@/components/searchable-select";
import type { NeedNowRow, SupplierLink, SupplierOption } from "./purchasing-hub";

export default function QuickFixModal({
  row, suppliers = [], onClose,
}: {
  row: NeedNowRow;
  suppliers?: SupplierOption[];
  onClose: () => void;
}) {
  const [stock, setStock]       = useState(String(row.current_stock ?? 0));
  const [min,   setMin]         = useState(String(row.min_stock ?? 0));
  const [max,   setMax]         = useState(String(row.max_stock ?? 0));
  const [cost,  setCost]        = useState(row.standard_cost != null ? String(row.standard_cost) : "");
  const [defSup, setDefSup]     = useState(row.supplier_id ?? "");
  const [pending, start]        = useTransition();
  const [err, setErr]           = useState<string | null>(null);

  // Local copy of supplier links so the inline "+ Add new supplier" form can
  // append a row immediately without waiting for the page to refetch.
  const [supplierLinks, setSupplierLinks] = useState<SupplierLink[]>(row.supplier_links);
  const [showAdd, setShowAdd]   = useState(false);

  // Per-base price stats — used for the cost-override hint and the
  // below-cheapest warning on save.
  const stats = useMemo(() => {
    const perBase = supplierLinks
      .map(s => {
        const pack = s.purchase_uom_qty && s.purchase_uom_qty > 0 ? s.purchase_uom_qty : 1;
        return s.unit_price / pack;
      })
      .filter(n => Number.isFinite(n) && n > 0);
    if (perBase.length === 0) return { cheapest: null as number | null, highest: null as number | null };
    return { cheapest: Math.min(...perBase), highest: Math.max(...perBase) };
  }, [supplierLinks]);

  function handleSave() {
    setErr(null);
    // Below-cheapest warning — admin can still proceed.
    if (cost.trim() !== "" && stats.cheapest != null && Number(cost) < stats.cheapest) {
      const ok = confirm(
        `The cost override $${Number(cost).toFixed(4)} is BELOW the cheapest supplier price ($${stats.cheapest.toFixed(4)}/${row.unit}).\n\n` +
        `This will undervalue inventory and any cost calc that uses standard_cost. ` +
        `Are you sure you want to save this override?`
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await saveQuickFix({
        item_id:        row.id,
        current_stock:  Number(stock),
        min_stock:      Number(min),
        max_stock:      Number(max),
        standard_cost:  cost.trim() === "" ? null : Number(cost),
        default_supplier_id: defSup || null,
      });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      onClose();
    });
  }

  const hasSuppliers = supplierLinks.length > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)", zIndex: 1000,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "5vh", overflowY: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "white", borderRadius: "0.625rem",
          width: "min(720px, 95vw)", padding: "1.5rem 1.75rem",
          boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ fontSize: "0.7rem", color: "#78716c", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
              Quick fix
            </div>
            <h2 style={{ fontSize: "1.125rem", margin: "0.2rem 0 0.1rem", fontWeight: 700 }}>{row.name}</h2>
            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{row.code} · {row.item_type}</div>
          </div>
          <button onClick={onClose} style={{ border: 0, background: "transparent", fontSize: "1.5rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
          <Field label="Current stock" hint={row.unit}>
            <input type="number" step="any" value={stock} onChange={e => setStock(e.target.value)} style={input} />
          </Field>
          <Field label="Min stock" hint={row.unit}>
            <input type="number" step="any" value={min} onChange={e => setMin(e.target.value)} style={input} />
          </Field>
          <Field label="Max stock" hint={row.unit}>
            <input type="number" step="any" value={max} onChange={e => setMax(e.target.value)} style={input} />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
          <Field label="Default supplier">
            <select value={defSup} onChange={e => setDefSup(e.target.value)} style={input}>
              <option value="">— None set —</option>
              {supplierLinks.map(s => (
                <option key={s.supplier_link_id} value={s.supplier_id}>
                  {s.supplier_name}
                  {s.unit_price ? ` · $${s.unit_price.toFixed(2)}` : ""}
                  {s.is_preferred ? " ✓ preferred" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Cost override (per consume UOM)"
            hint={
              stats.cheapest != null && stats.highest != null
                ? `Cheapest $${stats.cheapest.toFixed(4)} · Highest $${stats.highest.toFixed(4)} · Effective $${row.effective_cost.toFixed(4)} per ${row.unit}`
                : `Falls back to supplier price if blank. Effective: $${row.effective_cost.toFixed(4)}`
            }
          >
            <input
              type="number" step="any"
              placeholder={`e.g. ${(stats.highest ?? row.effective_cost).toFixed(2)}`}
              value={cost} onChange={e => setCost(e.target.value)}
              style={input}
            />
            {cost.trim() !== "" && stats.cheapest != null && Number(cost) < stats.cheapest && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.65rem", color: "#b91c1c", fontWeight: 600 }}>
                ⚠ Below cheapest supplier ($ {stats.cheapest.toFixed(4)}/{row.unit}) — you'll be asked to confirm.
              </div>
            )}
          </Field>
        </div>

        {/* Suppliers compact summary */}
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
              Linked suppliers
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(v => !v)}
              style={{ padding: "0.25rem 0.5rem", border: "1px dashed #cfc9bf", background: "white", color: "#57534e", borderRadius: "0.25rem", fontSize: "0.65rem", fontFamily: "inherit", cursor: "pointer" }}
            >
              + Add new supplier
            </button>
          </div>
          {hasSuppliers ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 70px 50px 50px", gap: "0.4rem", fontSize: "0.65rem", color: "#78716c", paddingBottom: "0.2rem", borderBottom: "1px solid #e7e5e4" }}>
                <span>Supplier</span>
                <span style={{ textAlign: "right" }}>Pack $</span>
                <span style={{ textAlign: "right" }}>Per {row.unit}</span>
                <span style={{ textAlign: "right" }}>Pack</span>
                <span style={{ textAlign: "right" }}>MOQ</span>
                <span style={{ textAlign: "center" }}>Lead</span>
              </div>
              {supplierLinks.map((s: SupplierLink) => {
                const pack = s.purchase_uom_qty && s.purchase_uom_qty > 0 ? s.purchase_uom_qty : 1;
                const perBase = s.unit_price / pack;
                return (
                  <div key={s.supplier_link_id} style={{ display: "grid", gridTemplateColumns: "1fr 70px 80px 70px 50px 50px", gap: "0.4rem", fontSize: "0.7rem", padding: "0.3rem 0", borderBottom: "1px solid #f5f5f4" }}>
                    <span>
                      {s.is_preferred && <span style={{ color: "#16a34a", marginRight: "0.25rem" }}>✓</span>}
                      {s.supplier_name}
                      {s.supplier_item_code && <span style={{ marginLeft: "0.4rem", fontSize: "0.6rem", color: "#a8a29e", fontFamily: "monospace" }}>{s.supplier_item_code}</span>}
                    </span>
                    <span style={{ textAlign: "right", fontFamily: "monospace" }}>{s.unit_price ? `$${s.unit_price.toFixed(2)}` : "—"}</span>
                    <span style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{s.unit_price ? `$${perBase.toFixed(4)}` : "—"}</span>
                    <span style={{ textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>{s.purchase_uom_qty ? `${s.purchase_uom_qty} ${s.purchase_uom ?? ""}` : "—"}</span>
                    <span style={{ textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>{s.min_order_qty ?? "—"}</span>
                    <span style={{ textAlign: "center", color: "#78716c" }}>{s.lead_time_days != null ? `${s.lead_time_days}d` : "—"}</span>
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ fontSize: "0.7rem", color: "#a8a29e", padding: "0.25rem 0" }}>
              No suppliers linked yet. Use + Add new supplier to set one.
            </div>
          )}
        </div>

        {showAdd && (
          <AddSupplierInline
            row={row}
            suppliers={suppliers.filter(s => !supplierLinks.some(l => l.supplier_id === s.id))}
            onSaved={(link) => {
              setShowAdd(false);
              setSupplierLinks(prev => [...prev, link]);
              if (link.is_preferred) setDefSup(link.supplier_id);
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {err && <div style={{ color: "#dc2626", fontSize: "0.8125rem", margin: "0.5rem 0" }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
          <Link href={`/items/${row.id}`} style={{ color: "#b91c1c", fontSize: "0.8125rem", textDecoration: "none" }}>
            Open full item editor →
          </Link>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button onClick={onClose} className="btn-secondary" style={{ padding: "0.45rem 0.875rem", fontSize: "0.8125rem" }}>Cancel</button>
            <button onClick={handleSave} disabled={pending} className="btn-primary" style={{ padding: "0.45rem 1rem", fontSize: "0.8125rem" }}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%", padding: "0.4rem 0.625rem",
  border: "1px solid #cfc9bf", borderRadius: "0.375rem",
  fontSize: "0.8125rem", fontFamily: "inherit", background: "white",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: "0.65rem", color: "#a8a29e", marginTop: "0.15rem" }}>{hint}</div>}
    </label>
  );
}

// Inline form to link an existing or NEW supplier to this item without
// leaving the Quick-fix modal. Mirrors the form in split-order-modal.
function AddSupplierInline({
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
    <div style={{ marginTop: "0.4rem", marginBottom: "0.75rem", border: "1px solid #fde68a", background: "#fef9c3", borderRadius: "0.5rem", padding: "0.875rem 1rem" }}>
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
