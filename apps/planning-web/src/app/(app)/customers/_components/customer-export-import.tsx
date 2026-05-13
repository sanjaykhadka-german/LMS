"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

const COLUMNS = [
  "code", "name", "trading_name", "contact_name", "phone", "email",
  "tax_registration", "address_line1", "address_line2", "city", "state", "postcode",
  "country_code", "currency", "payment_terms", "account_number", "sales_account_code",
  "delivery_day", "delivery_instructions", "notes",
];

const EXAMPLE_ROW: Record<string, string> = {
  code: "CUST001",
  name: "Woolworths Deli Dept",
  trading_name: "",
  contact_name: "Jane Brown",
  phone: "03 9000 1234",
  email: "deli.orders@woolworths.com.au",
  tax_registration: "88 000 014 675",
  address_line1: "1 Woolworths Way",
  address_line2: "",
  city: "Bella Vista",
  state: "NSW",
  postcode: "2153",
  country_code: "AU",
  currency: "AUD",
  payment_terms: "Net 30",
  account_number: "WW-001",
  sales_account_code: "200",
  delivery_day: "1",
  delivery_instructions: "Deliver to loading dock, call ahead",
  notes: "",
};

export default function CustomerExportImport() {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: string[] } | null>(null);

  async function exportAll() {
    const { data } = await supabase
      .from("customers")
      .select("code, name, trading_name, contact_name, phone, email, tax_registration, address_line1, address_line2, city, state, postcode, country_code, currency, payment_terms, account_number, sales_account_code, delivery_day, delivery_instructions, notes, is_active")
      .order("code");
    const ws = XLSX.utils.json_to_sheet(data ?? [], { header: [...COLUMNS, "is_active"] });
    applyColumnWidths(ws, [...COLUMNS, "is_active"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, `customers_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([EXAMPLE_ROW], { header: COLUMNS });
    applyColumnWidths(ws, COLUMNS);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(wb, "customers_import_template.xlsx");
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setResult(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      const tenantId = profile!.tenant_id;

      const rows = await parseFile(file);
      let ok = 0;
      const errors: string[] = [];

      for (const [i, row] of rows.entries()) {
        const code = String(row.code ?? "").trim().toUpperCase();
        const name = String(row.name ?? "").trim();
        if (!code || !name) {
          errors.push(`Row ${i + 2}: code and name are required`);
          continue;
        }
        const deliveryDay = row.delivery_day !== "" ? parseInt(String(row.delivery_day)) : null;
        const { error } = await supabase.from("customers").upsert({
          tenant_id: tenantId,
          code,
          name,
          trading_name: row.trading_name || null,
          contact_name: row.contact_name || null,
          phone: row.phone || null,
          email: row.email || null,
          tax_registration: row.tax_registration || null,
          address_line1: row.address_line1 || null,
          address_line2: row.address_line2 || null,
          city: row.city || null,
          state: row.state || null,
          postcode: row.postcode || null,
          country_code: row.country_code || "AU",
          currency: row.currency || "AUD",
          payment_terms: row.payment_terms || null,
          account_number: row.account_number || null,
          sales_account_code: row.sales_account_code || null,
          delivery_day: isNaN(deliveryDay!) ? null : deliveryDay,
          delivery_instructions: row.delivery_instructions || null,
          notes: row.notes || null,
          is_active: true,
        }, { onConflict: "code" });
        if (error) errors.push(`Row ${i + 2} (${code}): ${error.message}`);
        else ok++;
      }

      setResult({ ok, errors });
    } catch (err) {
      setResult({ ok: 0, errors: [String(err)] });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={exportAll} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
        ↓ Export
      </button>
      <button onClick={downloadTemplate} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
        ↓ Template
      </button>
      <label className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer", margin: 0 }}>
        ↑ Import
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display: "none" }} disabled={importing} />
      </label>
      {importing && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>Importing…</span>}
      {result && (
        <span style={{ fontSize: "0.8125rem", color: result.errors.length ? "#dc2626" : "#15803d" }}>
          {result.ok} imported{result.errors.length > 0 ? `, ${result.errors.length} error(s): ${result.errors[0]}` : " ✓"}
        </span>
      )}
    </div>
  );
}

function applyColumnWidths(ws: XLSX.WorkSheet, cols: string[]) {
  ws["!cols"] = cols.map(c => ({ wch: Math.max(c.length + 2, 14) }));
}

async function parseFile(file: File): Promise<Record<string, string>[]> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
}
