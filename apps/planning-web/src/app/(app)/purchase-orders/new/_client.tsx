"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/back-button";

type Item = {
  id: string;
  code: string;
  name: string;
  unit: string;
  item_type: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  procurement_type: string;
  preferred_supplier_id: string | null;
};

type Supplier = { id: string; name: string; code: string | null };

type SupplierItem = {
  id: string;
  item_id: string;
  supplier_id: string;
  supplier_item_code: string | null;
  unit_price: number | null;
  currency: string | null;
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  is_preferred: boolean;
};

type OrderLine = {
  item: Item;
  supplierId: string;
  supplierItemId: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  currency: string;
  notes: string;
};

function stockStatus(item: Item) {
  if (item.max_stock > 0 && item.current_stock <= item.min_stock) return "low";
  if (item.max_stock > 0 && item.current_stock <= item.min_stock * 1.2) return "borderline";
  return "ok";
}

export default function NewPurchaseOrderClient({
  allItems,
  allSuppliers,
  supplierItems,
}: {
  allItems: Item[];
  allSuppliers: Supplier[];
  supplierItems: SupplierItem[];
}) {
  const supabase = createClient();
  const router = useRouter();

  // Tab: "suggested" (below min) or "all"
  const [tab, setTab] = useState<"suggested" | "all">("suggested");
  const [search, setSearch] = useState("");

  // Lines in the order being built
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [poNotes, setPoNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Items below min stock
  const suggestedItems = useMemo(() =>
    allItems.filter(it => it.min_stock > 0 && it.current_stock <= it.min_stock),
    [allItems]
  );

  const displayItems = useMemo(() => {
    const base = tab === "suggested" ? suggestedItems : allItems;
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter(it => it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q));
  }, [tab, search, suggestedItems, allItems]);

  const addedItemIds = new Set(lines.map(l => l.item.id));

  // Get suppliers for an item
  function getSuppliersForItem(itemId: string): { si: SupplierItem; supplier: Supplier }[] {
    return supplierItems
      .filter(si => si.item_id === itemId)
      .map(si => ({ si, supplier: allSuppliers.find(s => s.id === si.supplier_id)! }))
      .filter(x => !!x.supplier)
      .sort((a, b) => (b.si.is_preferred ? 1 : 0) - (a.si.is_preferred ? 1 : 0));
  }

  function addLine(item: Item) {
    if (addedItemIds.has(item.id)) return;
    const itemSuppliers = getSuppliersForItem(item.id);
    const preferred = itemSuppliers.find(x => x.si.is_preferred) ?? itemSuppliers[0];

    // Suggested order qty: max_stock - current_stock (or min_order_qty if larger)
    const suggestedQty = item.max_stock > item.current_stock
      ? item.max_stock - item.current_stock
      : item.min_stock - item.current_stock > 0
        ? item.min_stock - item.current_stock
        : 0;
    const minOrder = preferred?.si.min_order_qty ?? 0;
    const orderQty = Math.max(suggestedQty, minOrder);

    setLines(prev => [...prev, {
      item,
      supplierId: preferred?.supplier.id ?? "",
      supplierItemId: preferred?.si.id ?? null,
      qty: orderQty > 0 ? String(Math.ceil(orderQty * 100) / 100) : "",
      unit: preferred?.si.purchase_uom ?? item.unit,
      unitPrice: preferred?.si.unit_price != null ? String(preferred.si.unit_price) : "",
      currency: preferred?.si.currency ?? "AUD",
      notes: "",
    }]);
  }

  function addAllSuggested() {
    for (const item of suggestedItems) {
      if (!addedItemIds.has(item.id)) addLine(item);
    }
  }

  function removeLine(itemId: string) {
    setLines(prev => prev.filter(l => l.item.id !== itemId));
  }

  function updateLine(itemId: string, patch: Partial<OrderLine>) {
    setLines(prev => prev.map(l => l.item.id === itemId ? { ...l, ...patch } : l));
  }

  function handleSupplierChange(itemId: string, supplierId: string) {
    const itemSuppliers = getSuppliersForItem(itemId);
    const selected = itemSuppliers.find(x => x.supplier.id === supplierId);
    updateLine(itemId, {
      supplierId,
      supplierItemId: selected?.si.id ?? null,
      unit: selected?.si.purchase_uom ?? lines.find(l => l.item.id === itemId)?.item.unit ?? "kg",
      unitPrice: selected?.si.unit_price != null ? String(selected.si.unit_price) : "",
      currency: selected?.si.currency ?? "AUD",
    });
  }

  async function handleCreate() {
    if (lines.length === 0) { setError("Add at least one item to the order."); return; }
    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const tenantId = profile!.tenant_id;

    // Count existing POs for number generation
    const { count } = await supabase.from("purchase_orders").select("id", { count: "exact", head: true });
    const year = new Date().getFullYear();
    const poNumber = `PO-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;

    // Group by supplier: if all lines have same supplier, set on header; otherwise null
    const uniqueSuppliers = [...new Set(lines.map(l => l.supplierId).filter(Boolean))];
    const headerSupplierId = uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : null;

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        tenant_id: tenantId,
        po_number: poNumber,
        supplier_id: headerSupplierId || null,
        status: "draft",
        order_date: new Date().toISOString().slice(0, 10),
        expected_date: expectedDate || null,
        notes: poNotes || null,
        created_by: user!.id,
      })
      .select("id")
      .single();

    if (poErr || !po) { setError(poErr?.message ?? "Failed to create PO"); setSaving(false); return; }

    const lineInserts = lines.map(l => ({
      tenant_id: tenantId,
      purchase_order_id: po.id,
      item_id: l.item.id,
      supplier_item_id: l.supplierItemId || null,
      qty_ordered: parseFloat(l.qty) || 0,
      unit: l.unit,
      unit_price: l.unitPrice ? parseFloat(l.unitPrice) : null,
      currency: l.currency || "AUD",
      notes: l.notes || null,
    }));

    const { error: linesErr } = await supabase.from("purchase_order_lines").insert(lineInserts);
    if (linesErr) { setError(linesErr.message); setSaving(false); return; }

    router.push(`/purchase-orders/${po.id}`);
    router.refresh();
  }

  const totalLines = lines.length;
  const totalValue = lines.reduce((sum, l) => {
    const qty = parseFloat(l.qty) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  return (
    <div>
      <BackButton href="/purchase-orders" label="Purchase Orders" />
      <div className="page-header">
        <div>
          <h1 className="page-title">New Purchase Order</h1>
          <p className="page-subtitle">Select items to order and choose a supplier for each</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>

        {/* Left: item picker */}
        <div>
          <div className="card" style={{ padding: "0.875rem 1rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.75rem" }}>
              <button
                onClick={() => setTab("suggested")}
                className={tab === "suggested" ? "btn-primary" : "btn-secondary"}
                style={{ fontSize: "0.8125rem" }}
              >
                Below min stock ({suggestedItems.length})
              </button>
              <button
                onClick={() => setTab("all")}
                className={tab === "all" ? "btn-primary" : "btn-secondary"}
                style={{ fontSize: "0.8125rem" }}
              >
                All purchase items ({allItems.length})
              </button>
            </div>
            <input
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by code or name…"
            />
          </div>

          {tab === "suggested" && suggestedItems.length > 0 && (
            <button
              onClick={addAllSuggested}
              className="btn-secondary"
              style={{ fontSize: "0.8125rem", marginBottom: "0.75rem", width: "100%" }}
            >
              + Add all {suggestedItems.length} suggested items
            </button>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "60vh", overflowY: "auto" }}>
            {displayItems.length === 0 && (
              <div className="card" style={{ textAlign: "center", padding: "2rem", color: "#78716c" }}>
                {tab === "suggested"
                  ? "All purchase items are above their minimum stock level — nothing to order."
                  : "No items match your search."}
              </div>
            )}
            {displayItems.map(item => {
              const isAdded = addedItemIds.has(item.id);
              const status = stockStatus(item);
              const itemSuppliers = getSuppliersForItem(item.id);

              return (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    padding: "0.75rem 1rem",
                    opacity: isAdded ? 0.5 : 1,
                    borderLeft: `3px solid ${status === "low" ? "#dc2626" : status === "borderline" ? "#f59e0b" : "#e7e5e4"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{item.code}</div>
                      <div style={{ marginTop: "0.375rem", fontSize: "0.75rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        <span style={{ color: status === "low" ? "#dc2626" : "#78716c", fontWeight: status === "low" ? 600 : undefined }}>
                          Stock: {item.current_stock?.toFixed(2) ?? "0"} {item.unit}
                        </span>
                        <span style={{ color: "#a8a29e" }}>Min: {item.min_stock} / Max: {item.max_stock}</span>
                        {itemSuppliers.length > 0 && (
                          <span style={{ color: "#78716c" }}>
                            {itemSuppliers.length} supplier{itemSuppliers.length > 1 ? "s" : ""}
                            {itemSuppliers.find(x => x.si.is_preferred) ? " ★" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => addLine(item)}
                      disabled={isAdded}
                      className="btn-primary"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", flexShrink: 0 }}
                    >
                      {isAdded ? "Added ✓" : "+ Add"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: order lines */}
        <div>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.875rem" }}>Order Details</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Expected Delivery Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={expectedDate}
                  onChange={e => setExpectedDate(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Notes</label>
                <input
                  className="form-input"
                  value={poNotes}
                  onChange={e => setPoNotes(e.target.value)}
                  placeholder="Internal notes"
                />
              </div>
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "2.5rem", color: "#78716c" }}>
              <p style={{ margin: 0 }}>No items added yet.</p>
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.8125rem" }}>Add items from the list on the left.</p>
            </div>
          ) : (
            <div>
              {lines.map(line => {
                const itemSuppliers = getSuppliersForItem(line.item.id);
                const qty = parseFloat(line.qty) || 0;
                const price = parseFloat(line.unitPrice) || 0;
                const lineTotal = qty * price;

                return (
                  <div key={line.item.id} className="card" style={{ marginBottom: "0.75rem", padding: "0.875rem 1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{line.item.name}</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{line.item.code}</div>
                      </div>
                      <button
                        onClick={() => removeLine(line.item.id)}
                        style={{
                          border: "none", background: "none", color: "#a8a29e",
                          cursor: "pointer", fontSize: "1.125rem", lineHeight: 1, padding: "0.125rem",
                        }}
                      >
                        ×
                      </button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <div>
                        <label className="form-label" style={{ fontSize: "0.75rem" }}>Supplier</label>
                        {itemSuppliers.length > 0 ? (
                          <select
                            className="form-select"
                            value={line.supplierId}
                            onChange={e => handleSupplierChange(line.item.id, e.target.value)}
                          >
                            <option value="">— Select supplier —</option>
                            {itemSuppliers.map(({ si, supplier }) => (
                              <option key={supplier.id} value={supplier.id}>
                                {si.is_preferred ? "★ " : ""}{supplier.name}
                                {si.unit_price ? ` — ${si.currency ?? "AUD"} ${si.unit_price}/${si.purchase_uom ?? line.item.unit}` : ""}
                              </option>
                            ))}
                            {allSuppliers
                              .filter(s => !itemSuppliers.find(x => x.supplier.id === s.id))
                              .map(s => (
                                <option key={s.id} value={s.id}>{s.name} (no price set)</option>
                              ))}
                          </select>
                        ) : (
                          <select
                            className="form-select"
                            value={line.supplierId}
                            onChange={e => updateLine(line.item.id, { supplierId: e.target.value })}
                          >
                            <option value="">— Select supplier —</option>
                            {allSuppliers.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: "0.75rem" }}>Qty to Order</label>
                        <div style={{ display: "flex", gap: "0.375rem" }}>
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.001"
                            value={line.qty}
                            onChange={e => updateLine(line.item.id, { qty: e.target.value })}
                            style={{ flex: 1 }}
                          />
                          <input
                            className="form-input"
                            value={line.unit}
                            onChange={e => updateLine(line.item.id, { unit: e.target.value })}
                            placeholder="unit"
                            style={{ width: "72px", fontFamily: "monospace" }}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: "0.75rem" }}>Unit Price</label>
                        <div style={{ display: "flex", gap: "0.375rem" }}>
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={e => updateLine(line.item.id, { unitPrice: e.target.value })}
                            style={{ flex: 1 }}
                            placeholder="0.00"
                          />
                          <input
                            className="form-input"
                            value={line.currency}
                            onChange={e => updateLine(line.item.id, { currency: e.target.value.toUpperCase() })}
                            style={{ width: "56px", fontFamily: "monospace" }}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: "0.75rem" }}>Line Total</label>
                        <div style={{ padding: "0.5rem 0.75rem", background: "#f5f5f4", borderRadius: "0.375rem", fontFamily: "monospace", fontWeight: lineTotal > 0 ? 600 : undefined, color: lineTotal > 0 ? "#292524" : "#a8a29e" }}>
                          {lineTotal > 0 ? `${line.currency} ${lineTotal.toFixed(2)}` : "—"}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: "0.75rem" }}>Line Notes</label>
                      <input
                        className="form-input"
                        value={line.notes}
                        onChange={e => updateLine(line.item.id, { notes: e.target.value })}
                        placeholder="e.g. call ahead for availability"
                        style={{ fontSize: "0.8125rem" }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Summary + create */}
              <div className="card" style={{ background: "#fafaf9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.875rem" }}>
                  <span style={{ color: "#78716c" }}>{totalLines} line{totalLines !== 1 ? "s" : ""}</span>
                  {totalValue > 0 && (
                    <span style={{ fontWeight: 700, fontFamily: "monospace" }}>
                      Est. AUD {totalValue.toFixed(2)}
                    </span>
                  )}
                </div>
                {error && (
                  <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.875rem" }}>
                    {error}
                  </div>
                )}
                <button onClick={handleCreate} disabled={saving} className="btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                  {saving ? "Creating…" : "Create Purchase Order"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
