"use client";

/**
 * Stocktake bulk IO — three buttons:
 *   ↓ Template     — blank XLSX of all in-scope items, one row each, ready to fill
 *   ↓ Export current — XLSX of the lines currently in this stocktake (with line_id)
 *   ↑ Import       — accept .xlsx/.xls/.csv. line_id present → update; else create.
 *
 * Round-trip rule: the same column layout is used for all three. If line_id is
 * present in an imported row we update that line; otherwise we look up by
 * item_code and create a new line.
 */

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";

type BulkItem = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  item_type: string;
  current_stock: number | null;
  is_active: boolean;
  default_location?: { id: string; name: string; code: string | null } | null;
};

type BulkLine = {
  id: string;
  item_id: string;
  counted_qty: number | null;
  batch: string | null;
  ubd: string | null;
  notes: string | null;
  location_id: string | null;
  location?: { id: string; name: string; code: string | null } | null;
  item?: { id: string; code: string; name: string } | null;
};

type BulkLocation = {
  id: string;
  code: string | null;
  name: string;
  barcode: string | null;
  room_id: string;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

type RowShape = {
  line_id?: string;
  item_code?: string;
  item_name?: string;
  location_code?: string;
  location_name?: string;
  batch?: string;
  ubd?: string;
  counted_qty?: string | number;
  notes?: string;
  system_qty?: string | number;
};

const COLUMNS = [
  "line_id",
  "item_code",
  "item_name",
  "location_code",
  "location_name",
  "batch",
  "ubd",
  "counted_qty",
  "notes",
  "system_qty",
] as const;

const COL_WIDTHS: Record<string, number> = {
  line_id: 38, item_code: 14, item_name: 36, location_code: 14, location_name: 22,
  batch: 14, ubd: 12, counted_qty: 12, notes: 28, system_qty: 12,
};

export default function StocktakeBulkIO({
  stocktakeId,
  stocktakeReference,
  tenantId,
  items,
  lines,
  locations,
  inScopePredicate,
  onImported,
}: {
  stocktakeId: string;
  stocktakeReference: string | null;
  tenantId: string | null;
  items: BulkItem[];
  lines: BulkLine[];
  locations: BulkLocation[];
  /** items that match the stocktake's type/inactive scope — what the template should include by default */
  inScopePredicate: (it: BulkItem) => boolean;
  onImported?: () => void;
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const refForFile = (stocktakeReference ?? stocktakeId).replace(/[^A-Za-z0-9_-]/g, "_");

  // ── Helpers ──────────────────────────────────────────────────────────────
  function makeWorkbook(rows: RowShape[]): XLSX.WorkBook {
    const aoa: (string | number)[][] = [
      [...COLUMNS],
      ...rows.map(r => COLUMNS.map(c => {
        const v = (r as Record<string, unknown>)[c];
        return (v == null ? "" : v) as string | number;
      })),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLUMNS.map(c => ({ wch: COL_WIDTHS[c] ?? 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stocktake");
    return wb;
  }

  // ── ↓ Template (blank rows for every in-scope item) ──────────────────────
  function downloadTemplate() {
    const rows: RowShape[] = items
      .filter(inScopePredicate)
      .map(it => ({
        line_id: "",
        item_code: it.code,
        item_name: it.name,
        location_code: it.default_location?.code ?? "",
        location_name: it.default_location?.name ?? "",
        batch: "",
        ubd: "",
        counted_qty: "",
        notes: "",
        system_qty: it.current_stock ?? 0,
      }));
    const wb = makeWorkbook(rows);
    XLSX.writeFile(wb, `stocktake-${refForFile}-template.xlsx`);
  }

  // ── ↓ Export current (lines currently saved on this stocktake) ──────────
  function downloadCurrent() {
    const rows: RowShape[] = lines.map(l => ({
      line_id: l.id,
      item_code: l.item?.code ?? "",
      item_name: l.item?.name ?? "",
      location_code: l.location?.code ?? "",
      location_name: l.location?.name ?? "",
      batch: l.batch ?? "",
      ubd: l.ubd ?? "",
      counted_qty: l.counted_qty ?? "",
      notes: l.notes ?? "",
      system_qty: 0,
    }));
    const wb = makeWorkbook(rows);
    XLSX.writeFile(wb, `stocktake-${refForFile}-current.xlsx`);
  }

  // ── ↑ Import ─────────────────────────────────────────────────────────────
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      // Normalise headers to lowercase
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const rows: RowShape[] = raw.map(r => {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(r)) out[String(k).trim().toLowerCase()] = r[k];
        return out as RowShape;
      });

      const itemsByCode: Record<string, BulkItem> = {};
      for (const it of items) itemsByCode[it.code.toUpperCase()] = it;
      const locsByCode: Record<string, BulkLocation> = {};
      for (const l of locations) {
        if (l.code) locsByCode[l.code.toUpperCase()] = l;
        if (l.barcode) locsByCode[l.barcode.toUpperCase()] = l;
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNum = i + 2; // sheet row (1-indexed, +1 for header)
        const lineId = String(r.line_id ?? "").trim();
        const itemCode = String(r.item_code ?? "").trim().toUpperCase();
        if (!lineId && !itemCode) { res.skipped++; continue; }

        const counted = r.counted_qty === "" || r.counted_qty == null
          ? null
          : Number(r.counted_qty);
        if (counted != null && Number.isNaN(counted)) {
          res.errors.push({ row: rowNum, reason: `counted_qty "${r.counted_qty}" is not a number` });
          continue;
        }
        const ubd = String(r.ubd ?? "").trim();
        if (ubd && !/^\d{4}-\d{2}-\d{2}$/.test(ubd)) {
          res.errors.push({ row: rowNum, reason: `ubd "${ubd}" must be YYYY-MM-DD` });
          continue;
        }
        const batch = String(r.batch ?? "").trim() || null;
        const notes = String(r.notes ?? "").trim() || null;
        const locCode = String(r.location_code ?? "").trim().toUpperCase();
        const locId = locCode ? (locsByCode[locCode]?.id ?? null) : null;
        if (locCode && !locId) {
          res.errors.push({ row: rowNum, reason: `location_code "${r.location_code}" not found` });
          // continue anyway, we'll just leave location null
        }

        if (lineId) {
          // UPDATE path — only touch fields actually present
          const update: Record<string, unknown> = {
            counted_qty: counted, batch, ubd: ubd || null, notes,
          };
          if (locCode) update.location_id = locId;
          const { error: e2 } = await supabase.from("stocktake_lines")
            .update(update).eq("id", lineId).eq("stocktake_id", stocktakeId);
          if (e2) {
            res.errors.push({ row: rowNum, reason: `update line_id ${lineId}: ${e2.message}` });
          } else {
            res.updated++;
          }
        } else {
          // CREATE path
          const item = itemsByCode[itemCode];
          if (!item) {
            res.errors.push({ row: rowNum, reason: `item_code "${r.item_code}" not found` });
            continue;
          }
          if (!tenantId) {
            res.errors.push({ row: rowNum, reason: "no tenant context" });
            continue;
          }
          const { error: e3 } = await supabase.from("stocktake_lines").insert({
            tenant_id: tenantId,
            stocktake_id: stocktakeId,
            item_id: item.id,
            system_qty: item.current_stock ?? 0,
            counted_qty: counted,
            location_id: locId ?? item.default_location?.id ?? null,
            batch, ubd: ubd || null, notes,
            entry_source: "import",
          });
          if (e3) {
            res.errors.push({ row: rowNum, reason: `create for ${itemCode}: ${e3.message}` });
          } else {
            res.created++;
          }
        }
      }
    } catch (err) {
      res.errors.push({ row: 0, reason: String(err) });
    } finally {
      setResult(res);
      setResultOpen(true);
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      if (res.created > 0 || res.updated > 0) onImported?.();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        <button onClick={downloadTemplate} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.625rem" }} title="Download a blank XLSX with all in-scope items">
          ↓ Template
        </button>
        <button onClick={downloadCurrent} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.625rem" }} title="Download the current stocktake lines (line_id included for round-trip)">
          ↓ Export current
        </button>
        <label style={{ display: "inline-block" }}>
          <span className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.3rem 0.625rem", cursor: importing ? "wait" : "pointer", display: "inline-block" }}>
            {importing ? "Importing…" : "↑ Import"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={importing}
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {/* Result modal */}
      {resultOpen && result && (
        <div
          // No backdrop close — × in header or Close button dismisses.
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 70,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
          }}
        >
          <div className="card" style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>Import results</h3>
              <button onClick={() => setResultOpen(false)} style={{ background: "none", border: "none", fontSize: "1.5rem", color: "#a8a29e", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "0.875rem" }}>
              <Stat label="Created" value={result.created} color="#15803d" />
              <Stat label="Updated" value={result.updated} color="#1e40af" />
              <Stat label="Skipped" value={result.skipped} color="#78716c" />
              <Stat label="Errors"  value={result.errors.length} color={result.errors.length ? "#b91c1c" : "#78716c"} />
            </div>
            {result.errors.length > 0 && (
              <div>
                <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", color: "#b91c1c" }}>Errors</h4>
                <div style={{ maxHeight: "320px", overflow: "auto", border: "1px solid #fee2e2", borderRadius: "0.375rem", background: "#fef2f2", padding: "0.5rem 0.75rem" }}>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "#991b1b" }}>
                    {result.errors.map((e, i) => (
                      <li key={i} style={{ marginBottom: "0.25rem" }}>
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.875rem" }}>
              <button onClick={() => setResultOpen(false)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "0.5rem 0.625rem" }}>
      <div style={{ fontSize: "0.7rem", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color, marginTop: "0.15rem" }}>{value}</div>
    </div>
  );
}
