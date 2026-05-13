"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";

type SupplierOption = { id: string; code: string; name: string; currency: string | null };
type ItemOption = {
  id: string; code: string; name: string;
  item_type: string; unit: string;
  purchase_uom: string | null; purchase_uom_qty: number | null; purchase_uom_type: string | null;
};

type ReceiptLine = {
  _key: string;
  item_id: string;
  item?: ItemOption;
  supplier_lot: string;
  supplier_barcode: string;
  n_purchase_units: string;
  purchase_uom: string;
  purchase_uom_qty_each: string;
  qty_received: string;
  unit: string;
  best_before_date: string;
  use_by_date: string;
  unit_price: string;
  is_quarantined: boolean;
  quarantine_reason: string;
  notes: string;
};

function makeKey() { return Math.random().toString(36).slice(2); }

function makeEmptyLine(): ReceiptLine {
  return {
    _key: makeKey(),
    item_id: "", supplier_lot: "", supplier_barcode: "",
    n_purchase_units: "1", purchase_uom: "", purchase_uom_qty_each: "",
    qty_received: "", unit: "kg",
    best_before_date: "", use_by_date: "",
    unit_price: "", is_quarantined: false, quarantine_reason: "", notes: "",
  };
}

export default function GoodsInFormClient({
  mode,
  suppliers,
  allItems,
  initial,
}: {
  mode: "create" | "edit";
  suppliers: SupplierOption[];
  allItems: ItemOption[];
  initial?: {
    id: string;
    receipt_number: string;
    supplier_id: string | null;
    supplier_delivery_ref: string | null;
    received_date: string;
    notes: string | null;
  };
}) {
  const router = useRouter();
  const supabase = createClient();

  const today = new Date().toISOString().split("T")[0];
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ?? "");
  const [deliveryRef, setDeliveryRef] = useState(initial?.supplier_delivery_ref ?? "");
  const [receivedDate, setReceivedDate] = useState(initial?.received_date ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<ReceiptLine[]>([makeEmptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineSearch, setLineSearch] = useState<Record<string, string>>({});
  const [lineDropdown, setLineDropdown] = useState<Record<string, boolean>>({});

  function addLine() { setLines(ls => [...ls, makeEmptyLine()]); }
  function removeLine(key: string) { setLines(ls => ls.filter(l => l._key !== key)); }

  function updateLine<K extends keyof ReceiptLine>(key: string, field: K, value: ReceiptLine[K]) {
    setLines(ls => ls.map(l => l._key === key ? { ...l, [field]: value } : l));
  }

  function selectItem(key: string, item: ItemOption) {
    setLines(ls => ls.map(l => l._key === key ? {
      ...l,
      item_id: item.id,
      item,
      unit: item.unit,
      purchase_uom: item.purchase_uom ?? "",
      purchase_uom_qty_each: item.purchase_uom_qty != null ? String(item.purchase_uom_qty) : "",
    } : l));
    setLineSearch(s => ({ ...s, [key]: `${item.code} — ${item.name}` }));
    setLineDropdown(d => ({ ...d, [key]: false }));
  }

  // Auto-calculate qty_received when n_purchase_units or purchase_uom_qty_each changes
  function recalcQty(line: ReceiptLine) {
    const n = parseFloat(line.n_purchase_units) || 0;
    const qty = parseFloat(line.purchase_uom_qty_each) || 0;
    if (n > 0 && qty > 0) return String(n * qty);
    return line.qty_received;
  }

  async function handleSave() {
    const validLines = lines.filter(l => l.item_id && parseFloat(l.qty_received) > 0);
    if (validLines.length === 0) { setError("Add at least one line with a valid quantity."); return; }

    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id, id").eq("id", user!.id).single();
    const tenantId = profile!.tenant_id;

    // Auto-generate receipt number
    const receiptNumber = `GR-${receivedDate.replace(/-/g, "")}-${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;

    const receiptPayload = {
      tenant_id: tenantId,
      supplier_id: supplierId || null,
      receipt_number: receiptNumber,
      supplier_delivery_ref: deliveryRef || null,
      received_date: receivedDate,
      received_by: profile!.id,
      status: "in_progress" as const,
      notes: notes || null,
    };

    const { data: receipt, error: receiptErr } = await supabase
      .from("goods_in_receipts")
      .insert(receiptPayload)
      .select("id")
      .single();

    if (receiptErr) { setError(receiptErr.message); setSaving(false); return; }

    // Insert lines and create lot numbers
    for (const line of validLines) {
      const qtyReceived = parseFloat(line.qty_received);

      // Generate lot code: {YYMMDD}{ITEM_CODE} (simplified — real format from tenant config)
      const dateStr = receivedDate.replace(/-/g, "").slice(2); // YYMMDD
      const lotCode = `${dateStr}${line.item!.code}${line.supplier_lot ? `-${line.supplier_lot}` : ""}`;

      // Create lot number
      const { data: lot } = await supabase
        .from("lot_numbers")
        .upsert({
          tenant_id: tenantId,
          item_id: line.item_id,
          lot_code: lotCode,
          supplier_lot: line.supplier_lot || null,
          received_date: receivedDate,
          best_before_date: line.best_before_date || null,
          use_by_date: line.use_by_date || null,
          qty_received: qtyReceived,
          qty_remaining: qtyReceived,
          unit: line.unit || line.item!.unit,
          is_quarantined: line.is_quarantined,
          quarantine_reason: line.quarantine_reason || null,
        }, { onConflict: "tenant_id,item_id,lot_code", ignoreDuplicates: false })
        .select("id")
        .single();

      // Create goods-in line
      await supabase.from("goods_in_lines").insert({
        goods_in_receipt_id: receipt.id,
        item_id: line.item_id,
        supplier_lot: line.supplier_lot || null,
        supplier_barcode: line.supplier_barcode || null,
        purchase_uom: line.purchase_uom || null,
        n_purchase_units: line.n_purchase_units ? parseInt(line.n_purchase_units) : null,
        purchase_uom_qty_each: line.purchase_uom_qty_each ? parseFloat(line.purchase_uom_qty_each) : null,
        qty_received: qtyReceived,
        unit: line.unit || line.item!.unit,
        received_date: receivedDate,
        best_before_date: line.best_before_date || null,
        use_by_date: line.use_by_date || null,
        lot_id: lot?.id ?? null,
        unit_price: line.unit_price ? parseFloat(line.unit_price) : null,
        is_quarantined: line.is_quarantined,
        quarantine_reason: line.quarantine_reason || null,
        notes: line.notes || null,
      });

      // Inventory transaction: receipt
      await supabase.from("inventory_transactions").insert({
        tenant_id: tenantId,
        item_id: line.item_id,
        lot_id: lot?.id ?? null,
        tx_type: "receipt",
        quantity: qtyReceived,
        unit: line.unit || line.item!.unit,
        reference_type: "goods_in_receipt",
        reference_id: receipt.id,
        created_by: profile!.id,
      });
    }

    // Mark receipt completed
    await supabase.from("goods_in_receipts").update({ status: "completed" }).eq("id", receipt.id);

    router.push(`/goods-in/${receipt.id}`);
  }

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BackButton href="/goods-in" label="Goods In" />
      <div className="page-header">
        <div>
          <h1 className="page-title">New Goods In Receipt</h1>
          <p className="page-subtitle">Record a delivery from a supplier. Each line creates or updates a lot number and posts an inventory transaction.</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* Header */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Delivery Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Supplier</label>
              <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Received Date</label>
              <input className="form-input" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} type="date" required />
            </div>
            <div>
              <label className="form-label">Supplier Delivery Ref / Docket</label>
              <input className="form-input" value={deliveryRef} onChange={e => setDeliveryRef(e.target.value)} placeholder="Supplier's delivery docket #" style={{ fontFamily: "monospace" }} />
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Notes</label>
            <textarea className="form-input" value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ resize: "vertical" }} />
          </div>
        </div>

        {/* Lines */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Lines — Items Received</h2>
          </div>
          <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {lines.map((line, idx) => {
              const filtered = allItems.filter(it => {
                const q = (lineSearch[line._key] ?? "").toLowerCase();
                return it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
              });
              const hasUom = !!(line.item?.purchase_uom || line.purchase_uom);

              return (
                <div key={line._key} style={{ padding: "1rem", background: "#fafaf9", borderRadius: "0.5rem", border: "1px solid #e7e5e4" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#78716c" }}>Line {idx + 1}</span>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(line._key)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", border: "1px solid #fca5a5", borderRadius: "0.25rem", background: "#fff", color: "#dc2626", cursor: "pointer" }}>Remove</button>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                    {/* Item search */}
                    <div style={{ position: "relative" }}>
                      <label className="form-label">Item *</label>
                      <input
                        className="form-input"
                        value={lineSearch[line._key] ?? (line.item ? `${line.item.code} — ${line.item.name}` : "")}
                        onChange={e => { setLineSearch(s => ({ ...s, [line._key]: e.target.value })); setLineDropdown(d => ({ ...d, [line._key]: true })); }}
                        onFocus={() => setLineDropdown(d => ({ ...d, [line._key]: true }))}
                        placeholder="Search item…"
                        autoComplete="off"
                      />
                      {lineDropdown[line._key] && (lineSearch[line._key] ?? "") && filtered.length > 0 && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "200px", overflowY: "auto" }}>
                          {filtered.slice(0, 25).map(it => (
                            <button key={it.id} type="button" onClick={() => selectItem(line._key, it)}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "0.4375rem 0.75rem", border: "none", background: "none", cursor: "pointer", borderBottom: "1px solid #f5f5f4", fontSize: "0.8125rem" }}
                              onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                              onMouseLeave={e => (e.currentTarget.style.background = "none")}
                            >
                              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{it.code}</span>
                              <span style={{ color: "#78716c", marginLeft: "0.5rem" }}>{it.name}</span>
                              <span className={`badge ${ITEM_TYPE_COLORS[it.item_type as ItemType]}`} style={{ fontSize: "0.5625rem", marginLeft: "0.375rem" }}>
                                {ITEM_TYPE_LABELS[it.item_type as ItemType]}
                              </span>
                              {it.purchase_uom && <span style={{ color: "#78716c", fontSize: "0.75rem", marginLeft: "0.375rem" }}>({it.purchase_uom})</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="form-label">Supplier Lot</label>
                      <input className="form-input" value={line.supplier_lot} onChange={e => updateLine(line._key, "supplier_lot", e.target.value)} placeholder="Supplier's lot ref" style={{ fontFamily: "monospace" }} />
                    </div>

                    <div>
                      <label className="form-label">Supplier Barcode</label>
                      <input className="form-input" value={line.supplier_barcode} onChange={e => updateLine(line._key, "supplier_barcode", e.target.value)} placeholder="Scanned or typed" style={{ fontFamily: "monospace" }} />
                    </div>

                    <div>
                      <label className="form-label">Best Before</label>
                      <input className="form-input" value={line.best_before_date} onChange={e => updateLine(line._key, "best_before_date", e.target.value)} type="date" />
                    </div>
                  </div>

                  {/* Purchase UOM + Qty row */}
                  <div style={{ display: "grid", gridTemplateColumns: hasUom ? "1fr 1fr 1fr 1fr 1fr" : "1fr 1fr 1fr 1fr", gap: "0.75rem" }}>
                    {hasUom && (
                      <>
                        <div>
                          <label className="form-label">Purchase Unit</label>
                          <input className="form-input" value={line.purchase_uom || line.item?.purchase_uom || ""} onChange={e => updateLine(line._key, "purchase_uom", e.target.value)} placeholder="e.g. bin" />
                        </div>
                        <div>
                          <label className="form-label"># of Units Received</label>
                          <input className="form-input" value={line.n_purchase_units} onChange={e => {
                            updateLine(line._key, "n_purchase_units", e.target.value);
                            const n = parseFloat(e.target.value) || 0;
                            const q = parseFloat(line.purchase_uom_qty_each) || 0;
                            if (n > 0 && q > 0) updateLine(line._key, "qty_received", String(n * q));
                          }} type="number" min="1" />
                        </div>
                        <div>
                          <label className="form-label">
                            kg each {line.item?.purchase_uom_type === "average" ? "(weigh at receipt)" : ""}
                          </label>
                          <input className="form-input" value={line.purchase_uom_qty_each} onChange={e => {
                            updateLine(line._key, "purchase_uom_qty_each", e.target.value);
                            const n = parseFloat(line.n_purchase_units) || 0;
                            const q = parseFloat(e.target.value) || 0;
                            if (n > 0 && q > 0) updateLine(line._key, "qty_received", String(n * q));
                          }} type="number" min="0" step="0.001" />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="form-label">Total Qty Received ({line.unit || line.item?.unit || "kg"})</label>
                      <input className="form-input" value={line.qty_received} onChange={e => updateLine(line._key, "qty_received", e.target.value)} type="number" min="0" step="0.001" required style={{ fontWeight: 600 }} />
                    </div>
                    <div>
                      <label className="form-label">Unit Price</label>
                      <input className="form-input" value={line.unit_price} onChange={e => updateLine(line._key, "unit_price", e.target.value)} type="number" min="0" step="0.01" placeholder="Per purchase unit" />
                    </div>
                  </div>

                  {/* Quarantine */}
                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem", alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                      <input type="checkbox" checked={line.is_quarantined} onChange={e => updateLine(line._key, "is_quarantined", e.target.checked)} />
                      <span style={{ color: line.is_quarantined ? "#dc2626" : undefined }}>Place on hold / quarantine</span>
                    </label>
                    {line.is_quarantined && (
                      <input className="form-input" style={{ flex: 1, fontSize: "0.8125rem" }} value={line.quarantine_reason} onChange={e => updateLine(line._key, "quarantine_reason", e.target.value)} placeholder="Reason for quarantine…" />
                    )}
                  </div>
                </div>
              );
            })}

            <button type="button" onClick={addLine} className="btn-secondary" style={{ alignSelf: "flex-start", fontSize: "0.8125rem" }}>
              + Add Another Item
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving & creating lots…" : "Confirm Receipt"}
          </button>
          <Link href="/goods-in" className="btn-secondary">Cancel</Link>
        </div>

        <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: 0 }}>
          Confirming the receipt will create lot numbers for each line and update inventory.
        </p>
      </div>
    </div>
  );
}
