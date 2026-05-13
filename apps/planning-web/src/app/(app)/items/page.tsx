import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ItemsTable } from "./items-table";
import ItemExportImport from "./item-export-import";
import DuplicateItemButton from "./_components/duplicate-item-button";

export default async function ItemsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Master</h1>
          <p className="page-subtitle">All raw materials, WIPs, fill codes, finished goods and packaging</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <ItemExportImport />
          <DuplicateItemButton />
          <Link href="/items/new/start" className="btn-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Item
          </Link>
        </div>
      </div>
      <ItemsTable isAdmin={profile?.role === "admin"} />
    </div>
  );
}
