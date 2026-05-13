"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Barcode = {
  id: string;
  barcode_type: string;
  barcode_format: string;
  barcode_value: string;
  supplier_id: string | null;
  pool_id: string | null;
  description: string | null;
  is_primary: boolean;
  is_active: boolean;
  supplier?: { id: string; name: string } | null;
};

type PoolEntry = { id: string; barcode_value: string; barcode_format: string };
type Supplier = { id: string; name: string; code: string };

const TYPE_LABELS: Record<string, string> = {
  internal: "Internal", gs1: "GS1", supplier: "Supplier",
};
const TYPE_COLORS: Record<string, string> = {
  internal: "badge-blue", gs1: "badge-green", supplier: "badge-yellow",
};
const FORMAT_LABELS: Record<string, string> = {
  ean13: "EAN-13", ean8: "EAN-8", upc_a: "UPC-A", itf14: "ITF-14",
  code128: "Code 128", qr: "QR Code", gs1_128: "GS1-128", datamatrix: "DataMatrix",
};

export default function ItemBarcodesPanel({
  itemId, tenantId, barcodes, availablePool, suppliers,
}: {
  itemId: string;
  tenantId: string;
  barcodes: Barcode[];
  availablePool: PoolEntry[];
  suppliers: Supplier[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<"internal" | "gs1" | "supplier">("internal");
  const [format, setFormat] = useState("code128");
  const [value, setValue] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [poolId, setPoolId] = useState("");
  const [description, setDescription] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When gs1 type is selected, auto-fill value from pool selection
  function selectPool(pid: string) {
    setPoolId(pid);
    const entry = availablePool.find(p => p.id === pid);
    if (entry) { setValue(entry.barcode_value); setFormat(entry.barcode_format); }
  }

  async function addBarcode() {
    if (!value.trim()) { setError("Barcode value is required"); return; }
    setSaving(true); setError(null);
    const { error: err } = await supabase.from("item_barcodes").insert({
      tenant_id: tenantId,
      item_id: itemId,
      barcode_type: type,
      barcode_format: format,
      barcode_value: value.trim(),
      supplier_id: type === "supplier" ? (supplierId || null) : null,
      pool_id: type === "gs1" ? (poolId || null) : null,
      description: description || null,
      is_primary: isPrimary,
      is_active: true,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    setValue(""); setDescription(""); setSupplierId(""); setPoolId("");
    setIsPrimary(false); setShowAdd(false); setSaving(false);
    router.refresh();
  }

  async function setPrimary(id: string) {
    await supabase.from("item_barcodes").update({ is_primary: true }).eq("id", id);
    router.refresh();
  }

  async function removeBarcode(id: string) {
    await supabase.from("item_barcodes").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Barcodes</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0.25rem 0 0" }}>
            Internal, GS1, and supplier-specific barcodes for this item
          </p>
        </div>
        <button onClick={() => setShowAdd(s => !s)} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
          {showAdd ? "Cancel" : "+ Add Barcode"}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Type</label>
              <select className="form-select" value={type}
                onChange={e => { setType(e.target.value as typeof type); setValue(""); setPoolId(""); }}>
                <option value="internal">Internal</option>
                <option value="gs1">GS1 (from pool)</option>
                <option value="supplier">Supplier</option>
              </select>
            </div>

            {type === "gs1" ? (
              <div style={{ gridColumn: "span 2" }}>
                <label className="form-label">Select from Pool ({availablePool.length} available)</label>
                <select className="form-select" value={poolId}
                  onChange={e => selectPool(e.target.value)}>
                  <option value="">— Select a GS1 barcode —</option>
                  {availablePool.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.barcode_value} ({FORMAT_LABELS[p.barcode_format] ?? p.barcode_format})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="form-label">Format</label>
                  <select className="form-select" value={format} onChange={e => setFormat(e.target.value)}>
                    {type === "internal"
                      ? [["code128","Code 128"],["qr","QR Code"],["datamatrix","DataMatrix"],["ean13","EAN-13"],["ean8","EAN-8"]]
                        .map(([v,l]) => <option key={v} value={v}>{l}</option>)
                      : [["ean13","EAN-13"],["ean8","EAN-8"],["upc_a","UPC-A"],["itf14","ITF-14"],["code128","Code 128"]]
                        .map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Barcode Value</label>
                  <input className="form-input" value={value} onChange={e => setValue(e.target.value)}
                    placeholder="e.g. 9300675012345" style={{ fontFamily: "monospace" }} />
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: type === "supplier" ? "1fr 2fr" : "1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            {type === "supplier" && (
              <div>
                <label className="form-label">Supplier</label>
                <select className="form-select" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="form-label">Description / Label (optional)</label>
              <input className="form-input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder='e.g. "Retail 500g" or "Coles EDI code"' />
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button onClick={addBarcode} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Add Barcode"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} />
              Set as primary scan barcode
            </label>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.5rem 0 0" }}>{error}</p>}
        </div>
      )}

      {/* Barcode list */}
      {barcodes.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "#78716c", textAlign: "center", padding: "1.5rem 0" }}>
          No barcodes added yet.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Barcode</th>
              <th>Type</th>
              <th>Format</th>
              <th>Supplier</th>
              <th>Description</th>
              <th>Primary</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {barcodes.map(b => (
              <tr key={b.id} style={{ opacity: b.is_active ? 1 : 0.5 }}>
                <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{b.barcode_value}</td>
                <td>
                  <span className={`badge ${TYPE_COLORS[b.barcode_type] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                    {TYPE_LABELS[b.barcode_type] ?? b.barcode_type}
                  </span>
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {FORMAT_LABELS[b.barcode_format] ?? b.barcode_format}
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {b.supplier?.name ?? "—"}
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{b.description ?? "—"}</td>
                <td style={{ textAlign: "center" }}>
                  {b.is_primary
                    ? <span style={{ color: "#15803d", fontWeight: 700, fontSize: "0.875rem" }}>★ Primary</span>
                    : <button onClick={() => setPrimary(b.id)}
                        className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}>
                        Set primary
                      </button>}
                </td>
                <td>
                  <button onClick={() => removeBarcode(b.id)}
                    style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                      borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.25rem 0.5rem" }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
