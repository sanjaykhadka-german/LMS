import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import SuppliersTable from "./_components/suppliers-table";
import SupplierExportImport from "./_components/supplier-export-import";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function SuppliersPage() {
  const supabase = await createClient();

  const { data: suppliers } = await fetchAllRows((from, to) => supabase
    .from("suppliers")
    .select("id, code, name, contact_name, email, phone, currency, payment_terms, is_active")
    .order("code")
    .range(from, to));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">Manage supplier records and their catalogue lines</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <SupplierExportImport />
          <Link href="/settings/suppliers/new" className="btn-primary">+ New Supplier</Link>
        </div>
      </div>

      {/* Sticky header needs the card to be a flex column with a bounded
          height so the table body can scroll inside while the <thead> stays
          pinned at top. Tino May 7 2026. */}
      <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 13rem)", minHeight: "400px" }}>
        <SuppliersTable suppliers={suppliers ?? []} />
      </div>
    </div>
  );
}
