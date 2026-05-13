"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";
import { TENANT_FULL_FETCH } from "@/lib/limits";

type SupplierItemRow = {
  id: string;
  supplier_item_code: string | null;
  supplier_item_name: string | null;
  unit_price: number | null;
  currency: string | null;
  price_valid_from: string | null;
  price_valid_to: string | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  is_preferred: boolean;
  notes: string | null;
  item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    unit: string;
  } | null;
};

type ItemOption = { id: string; code: string; name: string; item_type: string; unit: string };

const EMPTY_LINE = {
  item_id: "",
  supplier_item_code: "",
  supplier_item_name: "",
  unit_price: "",
  currency: "AUD",
  price_valid_from: "",
  price_valid_to: "",
  purchase_uom: "",
  purchase_uom_qty: "",
  min_order_qty: "",
  lead_time_days: "",
  is_preferred: false,
  notes: "",
};

export default function SupplierItemsPanel({
  supplierId,
  initialItems,
}: {
  supplierId: string;
  initialItems: SupplierItemRow[];
}) {
  const supabase = createClient();
  const [items, setItems] = useState<SupplierItemRow[]>(initialItems);
  const [allItems, setAllItems] = useState<ItemOption[]>([]);
  const [form, setForm] = useState(EMPTY_LINE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("items")
      .select("id, code, name, item_type, unit")
      .order("code")
      .limit(TENANT_FULL_FETCH)
      .then(({ data }) => setAllItems(data ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof typeof EMPTY_LINE>(k: K, v: (typeof EMPTY_LINE)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function startEdit(si: SupplierItemRow) {
    setEditingId(si.id);
    const selectedItem = si.item;
    setSearch(selectedItem ? `${selectedItem.code} — ${selectedItem.name}` : "");
    setForm({
      item_id: si.item?.id ?? "",
      supplier_item_code: si.supplier_item_code ?? "",
      supplier_item_name: si.supplier_item_name ?? "",
      unit_price: si.unit_price != null ? String(si.unit_price) : "",
      currency: si.currency ?? "AUD",
      price_valid_from: si.price_valid_from ?? "",
      price_valid_to: si.price_valid_to ?? "",
      purchase_uom: si.purchase_uom ?? "",
      purchase_uom_qty: si.purchase_uom_qty != null ? String(si.purchase_uom_qty) : "",
      min_order_qty: si.min_order_qty != null ? String(si.min_order_qty) : "",
      lead_time_days: si.lead_time_days != null ? String(si.lead_time_days) : "",
      is_preferred: si.is_preferred,
      notes: si.notes ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setForm(EMPTY_LINE);
    setSearch("");
    setShowForm(false);
    setError(null);
  }

  async function handleSave() {
    if (!form.item_id) { setError("Please select an item."); return; }
    setSaving(true);
    setError(null);

    const payload = {
      tenant_id: undefined as string | undefined, // handled server-side via RLS
      supplier_id: supplierId,
      item_id: form.item_id,
      supplier_item_code: form.supplier_item_code || null,
      supplier_item_name: form.supplier_item_name || null,
      unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
      currency: form.currency || "AUD",
      price_valid_from: form.price_valid_from || null,
      price_valid_to: form.price_valid_to || null,
      purchase_uom: form.purchase_uom || null,
      purchase_uom_qty: form.purchase_uom_qty ? parseFloat(form.purchase_uom_qty) : null,
      min_order_qty: form.min_order_qty ? parseFloat(form.min_order_qty) : null,
      lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null,
      is_preferred: form.is_preferred,
      notes: form.notes || null,
    };
    delete payload.tenant_id;

    // Need tenant_id for insert
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const insertPayload = { ...payload, tenant_id: profile!.tenant_id };

    let result;
    if (editingId) {
      result = await supabase.from("supplier_items").update(payload).eq("id", editingId).select(`
        id, supplier_item_code, supplier_item_name,
        unit_price, currency, price_valid_from, price_valid_to,
        purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days,
        is_preferred, notes,
        item:item_id(id, code, name, item_type, unit)
      `).single();
    } else {
      result = await supabase.from("supplier_items").insert(insertPayload).select(`
        id, supplier_item_code, supplier_item_name,
        unit_price, currency, price_valid_from, price_valid_to,
        purchase_uom, purchase_uom_qty, min_order_qty, lead_time_days,
        is_preferred, notes,
        item:item_id(id, code, name, item_type, unit)
      `).single();
    }

    if (result.error) { setError(result.error.message); setSaving(false); return; }

    const saved = result.data as SupplierItemRow;
    setItems(prev => editingId
      ? prev.map(si => si.id === editingId ? saved : si)
      : [...prev, saved]
    );
    cancel();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("supplier_items").delete().eq("id", id);
    setItems(prev => prev.filter(si => si.id !== id));
    setDeletingId(null);
  }

  const filteredItems = allItems.filter(it => {
    const q = search.toLowerCase();
    return it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Catalogue Lines</h2>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_LINE); setSearch(""); }}
              className="btn-primary"
              style={{ fontSize: "0.8125rem" }}
            >
              + Add Item
            </button>
          )}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Supplier Code</th>
              <th>Purchase UOM</th>
              <th>Unit Price</th>
              <th>Price Valid</th>
              <th>Lead Time</th>
              <th>Min Order</th>
              <th>Preferred</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                  No catalogue lines yet. Add items this supplier can supply.
                </td>
              </tr>
            )}
            {items.map(si => (
              <tr key={si.id}>
                <td>
                  {si.item ? (
                    <div>
                      <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                        <span style={{ fontWeight: 500 }}>
                          <Link href={`/items/${si.item.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                            {si.item.name}
                          </Link>
                        </span>
                        <span className={`badge ${ITEM_TYPE_COLORS[si.item.item_type as ItemType]}`} style={{ fontSize: "0.6rem" }}>
                          {ITEM_TYPE_LABELS[si.item.item_type as ItemType]}
                        </span>
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{si.item.code}</div>
                    </div>
                  ) : "—"}
                </td>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
                  {si.supplier_item_code ?? "—"}
                </td>
                <td style={{ color: "#78716c" }}>
                  {si.purchase_uom ? `${si.purchase_uom}${si.purchase_uom_qty ? ` (${si.purchase_uom_qty} ${si.item?.unit ?? "kg"})` : ""}` : "—"}
                </td>
                <td style={{ fontWeight: si.unit_price ? 600 : undefined }}>
                  {si.unit_price != null ? `${si.currency ?? "AUD"} ${si.unit_price.toFixed(2)}` : "—"}
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {si.price_valid_from && si.price_valid_to
                    ? `${si.price_valid_from} – ${si.price_valid_to}`
                    : si.price_valid_from ?? "—"}
                </td>
                <td style={{ color: "#78716c" }}>
                  {si.lead_time_days != null ? `${si.lead_time_days}d` : "—"}
                </td>
                <td style={{ color: "#78716c" }}>
                  {si.min_order_qty != null ? `${si.min_order_qty} ${si.purchase_uom ?? si.item?.unit ?? ""}` : "—"}
                </td>
                <td>
                  {si.is_preferred && <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>★ Preferred</span>}
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <button
                      onClick={() => startEdit(si)}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(si.id)}
                      disabled={deletingId === si.id}
                      style={{
                        fontSize: "0.75rem", padding: "0.25rem 0.625rem",
                        border: "1px solid #fca5a5", borderRadius: "0.375rem",
                        background: "#fff", color: "#dc2626", cursor: "pointer",
                      }}
                    >
                      {deletingId === si.id ? "…" : "✕"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit line form */}
      {showForm && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>
            {editingId ? "Edit Catalogue Line" : "Add Catalogue Line"}
          </h2>

          {/* Item search */}
          <div style={{ marginBottom: "1rem", position: "relative" }}>
            <label className="form-label">Item *</label>
            <input
              className="form-input"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); set("item_id", ""); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search by code or name…"
              autoComplete="off"
            />
            {showDropdown && search && filteredItems.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "220px", overflowY: "auto",
              }}>
                {filteredItems.slice(0, 30).map(it => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      set("item_id", it.id);
                      setSearch(`${it.code} — ${it.name}`);
                      setShowDropdown(false);
                    }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "0.5rem 0.75rem", border: "none", background: "none",
                      cursor: "pointer", borderBottom: "1px solid #f5f5f4",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#fef2f2")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#292524" }}>{it.code}</span>
                    <span style={{ color: "#78716c", marginLeft: "0.5rem" }}>{it.name}</span>
                    <span className={`badge ${ITEM_TYPE_COLORS[it.item_type as ItemType]}`} style={{ fontSize: "0.625rem", marginLeft: "0.375rem" }}>
                      {ITEM_TYPE_LABELS[it.item_type as ItemType]}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label className="form-label">Supplier Item Code</label>
              <input className="form-input" value={form.supplier_item_code} onChange={e => set("supplier_item_code", e.target.value)} placeholder="Supplier's SKU / code" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Supplier Item Name</label>
              <input className="form-input" value={form.supplier_item_name} onChange={e => set("supplier_item_name", e.target.value)} placeholder="Supplier's product description" />
            </div>
            <div>
              <label className="form-label">Lead Time (days)</label>
              <input className="form-input" value={form.lead_time_days} onChange={e => set("lead_time_days", e.target.value)} type="number" min="0" placeholder="e.g. 3" />
            </div>
            <div>
              <label className="form-label">Purchase Unit</label>
              <input className="form-input" value={form.purchase_uom} onChange={e => set("purchase_uom", e.target.value)} placeholder="e.g. bin, bag, carton" />
            </div>
            <div>
              <label className="form-label">Qty per Purchase Unit</label>
              <input className="form-input" value={form.purchase_uom_qty} onChange={e => set("purchase_uom_qty", e.target.value)} type="number" min="0" step="0.001" placeholder="e.g. 30" />
            </div>
            <div>
              <label className="form-label">Min Order Qty</label>
              <input className="form-input" value={form.min_order_qty} onChange={e => set("min_order_qty", e.target.value)} type="number" min="0" step="0.001" placeholder="e.g. 1" />
            </div>
            <div>
              <label className="form-label">Unit Price</label>
              <input className="form-input" value={form.unit_price} onChange={e => set("unit_price", e.target.value)} type="number" min="0" step="0.01" placeholder="Price per purchase unit" />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <input className="form-input" value={form.currency} onChange={e => set("currency", e.target.value.toUpperCase())} placeholder="AUD" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Price Valid From</label>
              <input className="form-input" value={form.price_valid_from} onChange={e => set("price_valid_from", e.target.value)} type="date" />
            </div>
            <div>
              <label className="form-label">Price Valid To</label>
              <input className="form-input" value={form.price_valid_to} onChange={e => set("price_valid_to", e.target.value)} type="date" />
            </div>
          </div>

          <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_preferred} onChange={e => set("is_preferred", e.target.checked)} />
              Preferred supplier for this item
            </label>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label">Notes</label>
            <input className="form-input" value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Minimum order, special handling, etc." />
          </div>

          {error && (
            <div style={{ marginBottom: "0.75rem", padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.875rem" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.625rem" }}>
            <button onClick={handleSave} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save Changes" : "Add to Catalogue"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
