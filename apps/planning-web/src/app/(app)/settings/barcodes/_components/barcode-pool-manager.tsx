"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import Link from "next/link";

type PoolEntry = {
  id: string;
  barcode_value: string;
  barcode_format: string;
  status: string;
  assigned_item_id: string | null;
  assigned_at: string | null;
  notes: string | null;
  created_at: string;
  item?: { id: string; code: string; name: string } | null;
};

const FORMAT_LABELS: Record<string, string> = {
  ean13: "EAN-13", ean8: "EAN-8", upc_a: "UPC-A",
  itf14: "ITF-14", gs1_128: "GS1-128",
};

const STATUS_COLORS: Record<string, string> = {
  available: "badge-green", assigned: "badge-blue",
  reserved: "badge-yellow", retired: "badge-gray",
};

export default function BarcodePoolManager({
  pool, items, tenantId, stats,
}: {
  pool: PoolEntry[];
  items: { id: string; code: string; name: string; item_type: string }[];
  tenantId: string;
  stats: { available: number; assigned: number; reserved: number; total: number };
}) {
  const supabase = createClient();
  const router = useRouter();

  const [tab, setTab] = useState<"pool" | "add">("pool");
  const [filterStatus, setFilterStatus] = useState("all");

  // Bulk import
  const [bulkText, setBulkText] = useState("");
  const [bulkFormat, setBulkFormat] = useState("ean13");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);

  // Single add
  const [singleValue, setSingleValue] = useState("");
  const [singleFormat, setSingleFormat] = useState("ean13");
  const [singleNotes, setSingleNotes] = useState("");
  const [adding, setAdding] = useState(false);

  async function bulkImport() {
    const lines = bulkText.split(/[\n,\s]+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setImporting(true); setImportResult(null);
    let added = 0; let skipped = 0;
    const rows = lines.map(v => ({
      tenant_id: tenantId, barcode_value: v, barcode_format: bulkFormat, status: "available",
    }));
    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from("tenant_barcode_pool")
        .insert(rows.slice(i, i + 100))
        .select("id");
      if (error) skipped += Math.min(100, rows.length - i);
      else added += Math.min(100, rows.length - i);
    }
    setImportResult({ added, skipped });
    setBulkText("");
    setImporting(false);
    router.refresh();
  }

  async function addSingle() {
    if (!singleValue.trim()) return;
    setAdding(true);
    await supabase.from("tenant_barcode_pool").insert({
      tenant_id: tenantId,
      barcode_value: singleValue.trim(),
      barcode_format: singleFormat,
      status: "available",
      notes: singleNotes || null,
    });
    setSingleValue(""); setSingleNotes("");
    setAdding(false);
    router.refresh();
  }

  async function retireBarcode(id: string) {
    await supabase.from("tenant_barcode_pool").update({ status: "retired" }).eq("id", id);
    router.refresh();
  }

  async function restoreBarcode(id: string) {
    await supabase.from("tenant_barcode_pool").update({ status: "available" }).eq("id", id);
    router.refresh();
  }

  const filtered = pool.filter(b => filterStatus === "all" || b.status === filterStatus);

  return (
    <div style={{ maxWidth: "1000px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">GS1 Barcode Pool</h1>
          <p className="page-subtitle">Manage your GS1-allocated barcodes and assign them to items</p>
        </div>
        <button onClick={() => setTab(tab === "add" ? "pool" : "add")} className="btn-primary">
          {tab === "add" ? "View Pool" : "+ Add Barcodes"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total in Pool", value: stats.total, color: "#1c1917" },
          { label: "Available",     value: stats.available, color: "#15803d" },
          { label: "Assigned",      value: stats.assigned,  color: "#1d4ed8" },
          { label: "Reserved",      value: stats.reserved,  color: "#b45309" },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: "0.875rem 1rem" }}>
            <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{s.label}</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 800, color: s.color, marginTop: "0.125rem" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {tab === "add" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          {/* Bulk import */}
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>Bulk Import</h2>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 0.75rem" }}>
              Paste barcodes from your GS1 allocation — one per line, or comma/space separated.
            </p>
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="form-label">Format</label>
              <select className="form-select" value={bulkFormat} onChange={e => setBulkFormat(e.target.value)}>
                {Object.entries(FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="form-label">Barcode Values</label>
              <textarea
                className="form-input"
                rows={8}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder={"9300675012345\n9300675012352\n9300675012369"}
                style={{ fontFamily: "monospace", fontSize: "0.8125rem", resize: "vertical" }}
              />
            </div>
            {importResult && (
              <p style={{ fontSize: "0.875rem", color: importResult.skipped ? "#b45309" : "#15803d", margin: "0 0 0.75rem" }}>
                {importResult.added} added{importResult.skipped ? `, ${importResult.skipped} skipped (duplicates)` : ""}
              </p>
            )}
            <button onClick={bulkImport} className="btn-primary" disabled={importing || !bulkText.trim()}>
              {importing ? "Importing…" : `Import ${bulkText.split(/[\n,\s]+/).filter(Boolean).length || 0} barcodes`}
            </button>
          </div>

          {/* Single add */}
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>Add Single Barcode</h2>
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="form-label">Format</label>
              <select className="form-select" value={singleFormat} onChange={e => setSingleFormat(e.target.value)}>
                {Object.entries(FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="form-label">Barcode Value</label>
              <input className="form-input" value={singleValue} onChange={e => setSingleValue(e.target.value)}
                placeholder="e.g. 9300675012345" style={{ fontFamily: "monospace" }} />
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label className="form-label">Notes (optional)</label>
              <input className="form-input" value={singleNotes} onChange={e => setSingleNotes(e.target.value)}
                placeholder="e.g. Retail 500g pack" />
            </div>
            <button onClick={addSingle} className="btn-primary" disabled={adding || !singleValue.trim()}>
              {adding ? "Adding…" : "Add to Pool"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {/* Filter row */}
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #f5f5f4", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {["all","available","assigned","reserved","retired"].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                style={{
                  padding: "0.25rem 0.75rem", borderRadius: "9999px", fontSize: "0.8125rem", cursor: "pointer",
                  border: "1px solid", fontWeight: filterStatus === s ? 600 : 400,
                  borderColor: filterStatus === s ? "#b91c1c" : "#e7e5e4",
                  background: filterStatus === s ? "#fef2f2" : "transparent",
                  color: filterStatus === s ? "#b91c1c" : "#78716c",
                }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <span style={{ marginLeft: "auto", fontSize: "0.8125rem", color: "#78716c" }}>
              {filtered.length} barcodes
            </span>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Format</th>
                <th>Status</th>
                <th>Assigned To</th>
                <th>Notes</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "2rem", color: "#78716c" }}>
                  No barcodes found. Add some using the &quot;Add Barcodes&quot; button.
                </td></tr>
              )}
              {filtered.map(b => (
                <tr key={b.id} style={{ opacity: b.status === "retired" ? 0.5 : 1 }}>
                  <td style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.875rem" }}>{b.barcode_value}</td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{FORMAT_LABELS[b.barcode_format] ?? b.barcode_format}</td>
                  <td>
                    <span className={`badge ${STATUS_COLORS[b.status] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                      {b.status}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.8125rem" }}>
                    {b.item
                      ? <Link href={`/items/${b.item.id}`} style={{ color: "#b91c1c", textDecoration: "none", fontWeight: 500 }}>
                          {b.item.code} — {b.item.name}
                        </Link>
                      : <span style={{ color: "#78716c" }}>—</span>}
                  </td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{b.notes ?? "—"}</td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                    {new Date(b.created_at).toLocaleDateString("en-AU")}
                  </td>
                  <td>
                    {b.status !== "assigned" && (
                      b.status === "retired"
                        ? <button onClick={() => restoreBarcode(b.id)} className="btn-secondary"
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Restore</button>
                        : <button onClick={() => retireBarcode(b.id)}
                            style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                              borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.25rem 0.5rem" }}>
                            Retire
                          </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
