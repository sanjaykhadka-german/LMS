"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

const TX_TYPES = [
  { value: "receipt", label: "Receipt (stock in)", sign: "+" },
  { value: "production_use", label: "Production Use (raw material used)", sign: "-" },
  { value: "production_output", label: "Production Output (finished product made)", sign: "+" },
  { value: "adjustment", label: "Stock Adjustment", sign: "±" },
  { value: "wastage", label: "Wastage / Loss", sign: "-" },
  { value: "dispatch", label: "Dispatch (finished product out)", sign: "-" },
];

export default function NewInventoryTransactionPage() {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawMaterials, setRawMaterials] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [form, setForm] = useState({
    item_type: "raw_material",
    item_id: "",
    transaction_type: "receipt",
    quantity: "",
    unit: "kg",
    reference: "",
    notes: "",
  });

  useEffect(() => {
    supabase.from("raw_materials").select("id, name, unit").order("name").then(({ data }) => setRawMaterials(data ?? []));
    supabase.from("products").select("id, name, unit").eq("is_active", true).order("name").then(({ data }) => setProducts(data ?? []));
  }, []);

  function set(field: string, value: string) { setForm(f => ({ ...f, [field]: value })); }

  const items = form.item_type === "raw_material" ? rawMaterials : products;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const txDef = TX_TYPES.find(t => t.value === form.transaction_type);
    const isNegative = ["production_use", "wastage", "dispatch"].includes(form.transaction_type);
    const qty = parseFloat(form.quantity) * (isNegative ? -1 : 1);

    // Insert transaction
    const { error: txError } = await supabase.from("inventory_transactions").insert({
      item_type: form.item_type,
      item_id: form.item_id,
      transaction_type: form.transaction_type,
      quantity: qty,
      unit: form.unit,
      reference: form.reference || null,
      notes: form.notes || null,
    });

    if (txError) { setError(txError.message); setSaving(false); return; }

    // Update stock level
    const table = form.item_type === "raw_material" ? "raw_materials" : "products";
    const { data: currentItem } = await supabase.from(table).select("current_stock").eq("id", form.item_id).single();
    if (currentItem) {
      const newStock = (currentItem.current_stock ?? 0) + qty;
      await supabase.from(table).update({ current_stock: Math.max(0, newStock) }).eq("id", form.item_id);
    }

    router.push("/inventory");
  }

  void TX_TYPES;

  return (
    <div style={{ maxWidth: "560px" }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Record Stock Movement</h1>
          <p className="page-subtitle">Log a receipt, production use, dispatch or adjustment</p>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <label className="form-label">Item Type</label>
            <select className="form-select" value={form.item_type} onChange={e => { set("item_type", e.target.value); set("item_id", ""); }}>
              <option value="raw_material">Raw Material</option>
              <option value="finished_product">Finished Product</option>
            </select>
          </div>

          <div>
            <label className="form-label">Item</label>
            <select className="form-select" value={form.item_id} onChange={e => { const item = items.find(i => i.id === e.target.value); set("item_id", e.target.value); if (item) set("unit", item.unit); }} required>
              <option value="">Select…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Transaction Type</label>
            <select className="form-select" value={form.transaction_type} onChange={e => set("transaction_type", e.target.value)}>
              {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="form-label">Quantity</label>
              <input className="form-input" type="number" min="0" step="0.001" value={form.quantity} onChange={e => set("quantity", e.target.value)} required placeholder="0.000" />
            </div>
            <div>
              <label className="form-label">Unit</label>
              <input className="form-input" value={form.unit} onChange={e => set("unit", e.target.value)} />
            </div>
          </div>

          <div>
            <label className="form-label">Reference (optional)</label>
            <input className="form-input" value={form.reference} onChange={e => set("reference", e.target.value)} placeholder="e.g. PO-12345, Schedule ID…" />
          </div>

          <div>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-input" value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="Any notes about this movement…" style={{ resize: "vertical" }} />
          </div>

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Record Movement"}</button>
            <Link href="/inventory" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
