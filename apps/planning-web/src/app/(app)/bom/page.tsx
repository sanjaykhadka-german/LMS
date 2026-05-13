import { createClient } from "@/lib/supabase/server";
import { BomTable } from "./bom-table";
import BomFormModal from "./_components/bom-form-modal";
import { fetchAllRows } from "@/lib/fetch-all";

export default async function BomListPage() {
  const supabase = await createClient();

  // Admin gate for the bulk-edit grid: only admins see "Edit Grid" / "Save All".
  // Floor + planner roles still get the read-only list with row click → detail.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = profile?.role === "admin";

  const { data: boms } = await fetchAllRows((from, to) => supabase
    .from("bom_headers")
    .select(
      `id, version, reference_batch_size, reference_batch_unit, yield_factor,
       is_active, approved_at, notes, created_at,
       item:item_id(id, code, name, item_type, department)`
    )
    .order("created_at", { ascending: false })
    .range(from, to));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bills of Materials</h1>
          <p className="page-subtitle">Recipes and ingredient lists for all items</p>
        </div>
        <BomFormModal triggerLabel="+ New BOM" triggerClassName="btn-primary" />
      </div>
      <BomTable
        boms={(boms ?? []) as Parameters<typeof BomTable>[0]["boms"]}
        isAdmin={isAdmin}
      />
    </div>
  );
}
