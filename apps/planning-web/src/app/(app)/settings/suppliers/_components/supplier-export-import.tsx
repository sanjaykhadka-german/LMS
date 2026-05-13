"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

const COLUMNS = [
  "code", "name", "trading_name", "contact_name", "phone", "email", "website",
  "tax_registration", "address_line1", "address_line2", "city", "state", "postcode",
  "country_code", "currency", "payment_terms", "account_number", "purchase_account_code", "notes",
];

const EXAMPLE_ROW: Record<string, string> = {
  code: "SUP001",
  name: "Ace Meats Pty Ltd",
  trading_name: "Ace Meats",
  contact_name: "John Smith",
  phone: "0412 345 678",
  email: "orders@acemeats.com.au",
  website: "https://acemeats.com.au",
  tax_registration: "12 345 678 901",
  address_line1: "123 Main Street",
  address_line2: "",
  city: "Melbourne",
  state: "VIC",
  postcode: "3000",
  country_code: "AU",
  currency: "AUD",
  payment_terms: "Net 30",
  account_number: "ACC-001",
  purchase_account_code: "300",
  notes: "Minimum order $500",
};

export default function SupplierExportImport() {
  const supabase = createClient();

  // Supplier master import
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: number; errors: string[] } | null>(null);

  // Contacts import
  const contactsFileRef = useRef<HTMLInputElement>(null);
  const [importingContacts, setImportingContacts] = useState(false);
  const [contactsResult, setContactsResult] = useState<{ ok: number; skipped: number; errors: string[] } | null>(null);

  async function exportAll() {
    const { data } = await supabase
      .from("suppliers")
      .select("code, name, trading_name, contact_name, phone, email, website, tax_registration, address_line1, address_line2, city, state, postcode, country_code, currency, payment_terms, account_number, purchase_account_code, notes, is_active")
      .order("code");
    const ws = XLSX.utils.json_to_sheet(data ?? [], { header: [...COLUMNS, "is_active"] });
    applyColumnWidths(ws, [...COLUMNS, "is_active"]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, `suppliers_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([EXAMPLE_ROW], { header: COLUMNS });
    applyColumnWidths(ws, COLUMNS);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, "suppliers_import_template.xlsx");
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
        const { error } = await supabase.from("suppliers").upsert({
          tenant_id: tenantId,
          code,
          name,
          trading_name: row.trading_name || null,
          contact_name: row.contact_name || null,
          phone: row.phone || null,
          email: row.email || null,
          website: row.website || null,
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
          purchase_account_code: row.purchase_account_code || null,
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

  // ── Contacts import ──────────────────────────────────────────────────────────
  // Expected columns: code, supplier_name, person_num, first_name, last_name, email, include_in_email
  // Will also handle a flat sheet with just those columns (e.g. exported from our template)

  async function handleContactsImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingContacts(true);
    setContactsResult(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
      const tenantId = profile!.tenant_id;

      // Load the right sheet — prefer "Supplier Contacts", fall back to first sheet
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const sheetName = wb.SheetNames.find(n =>
        n.toLowerCase().includes("contact") && !n.toLowerCase().includes("(1)")
      ) ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });

      // Build a code → supplier_id lookup map
      const { data: suppliers } = await supabase
        .from("suppliers")
        .select("id, code")
        .eq("tenant_id", tenantId);
      const supplierMap = new Map<string, string>(
        (suppliers ?? []).map(s => [s.code.toUpperCase(), s.id])
      );

      let ok = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const [i, row] of rows.entries()) {
        const code = String(row.code ?? row.supplier_code ?? "").trim().toUpperCase();
        if (!code) { skipped++; continue; }

        const supplierId = supplierMap.get(code);
        if (!supplierId) {
          errors.push(`Row ${i + 2}: supplier code "${code}" not found — import the supplier master first`);
          continue;
        }

        const firstName = String(row.first_name ?? row.FirstName ?? "").trim();
        const lastName  = String(row.last_name  ?? row.LastName  ?? "").trim();
        const email     = String(row.email ?? row.Email ?? row.EmailAddress ?? "").trim();
        const personNum = Number(row.person_num ?? row.person_number ?? 0);

        // Derive a usable name — prefer full name, fall back to email prefix, then "Contact N"
        let name = [firstName, lastName].filter(Boolean).join(" ");
        if (!name && email) name = email.split("@")[0];
        if (!name) name = `Contact ${personNum || i + 1}`;

        const isPrimary = personNum === 1;
        const receivesOrders =
          String(row.include_in_email ?? row.IncludeInEmail ?? "")
            .trim().toLowerCase() === "yes";

        const { error } = await supabase.from("supplier_contacts").insert({
          tenant_id: tenantId,
          supplier_id: supplierId,
          name,
          email: email || null,
          is_primary: isPrimary,
          receives_orders: receivesOrders,
          receives_invoices: false,
          receives_claims: false,
          receives_cert_reminders: false,
          role: null,
          phone: null,
          mobile: null,
          notes: null,
        });

        if (error) errors.push(`Row ${i + 2} (${code} / ${name}): ${error.message}`);
        else ok++;
      }

      setContactsResult({ ok, skipped, errors });
    } catch (err) {
      setContactsResult({ ok: 0, skipped: 0, errors: [String(err)] });
    } finally {
      setImportingContacts(false);
      if (contactsFileRef.current) contactsFileRef.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {/* Supplier master row */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={exportAll} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          ↓ Export
        </button>
        <button onClick={downloadTemplate} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          ↓ Template
        </button>
        <label className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer", margin: 0 }}>
          ↑ Import Suppliers
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display: "none" }} disabled={importing} />
        </label>
        {importing && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>Importing…</span>}
        {result && (
          <span style={{ fontSize: "0.8125rem", color: result.errors.length ? "#dc2626" : "#15803d" }}>
            {result.ok} imported{result.errors.length > 0 ? `, ${result.errors.length} error(s): ${result.errors[0]}` : " ✓"}
          </span>
        )}
      </div>

      {/* Contacts import row */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer", margin: 0 }}>
          ↑ Import Contacts
          <input ref={contactsFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleContactsImport} style={{ display: "none" }} disabled={importingContacts} />
        </label>
        <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
          (reads the "Supplier Contacts" sheet — columns: code, first_name, last_name, email, include_in_email)
        </span>
        {importingContacts && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>Importing contacts…</span>}
        {contactsResult && (
          <span style={{ fontSize: "0.8125rem", color: contactsResult.errors.length ? "#dc2626" : "#15803d" }}>
            {contactsResult.ok} contacts imported
            {contactsResult.skipped > 0 ? `, ${contactsResult.skipped} skipped` : ""}
            {contactsResult.errors.length > 0
              ? `, ${contactsResult.errors.length} error(s): ${contactsResult.errors[0]}`
              : " ✓"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function applyColumnWidths(ws: XLSX.WorkSheet, cols: string[]) {
  ws["!cols"] = cols.map(c => ({ wch: Math.max(c.length + 2, 14) }));
}

async function parseFile(file: File): Promise<Record<string, string>[]> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
}
