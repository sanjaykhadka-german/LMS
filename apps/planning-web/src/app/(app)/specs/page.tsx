import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SpecsTable from "./_components/specs-table";
import { TENANT_FULL_FETCH } from "@/lib/limits";

export default async function SpecsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles").select("role, tenant_id").eq("id", user.id).single();

  const { data: specs } = await supabase
    .from("product_specs")
    .select(`
      id, version, version_label, status, approved_at, created_at, updated_at, internal_notes,
      item:item_id(id, code, name, item_type, department),
      approver:approved_by(id, full_name),
      creator:created_by(id, full_name),
      sends:spec_sends(id)
    `)
    .order("updated_at", { ascending: false })
    .limit(TENANT_FULL_FETCH);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Product Specs</h1>
          <p className="page-subtitle">Versioned specification sheets for all finished goods and WIP products</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/specs/sends" className="btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            Send history
          </Link>
          <Link href="/specs/new" className="btn-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Spec
          </Link>
        </div>
      </div>
      <SpecsTable specs={specs ?? []} />
    </div>
  );
}
