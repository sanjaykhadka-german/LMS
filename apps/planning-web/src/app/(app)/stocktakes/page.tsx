import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import DeleteStocktakeButton from "./_components/delete-stocktake-button";

export const dynamic = "force-dynamic";

export default async function StocktakesPage() {
  const supabase = await createClient();

  // Resolve viewer role for admin-only delete button
  const { data: { user } } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const viewerRole = (viewerProfile as { role?: string } | null)?.role ?? "viewer";
  const canDelete = ["super_admin", "admin"].includes(viewerRole);

  const { data: stocktakes } = await supabase
    .from("stocktakes")
    .select("id, reference, status, notes, submitted_at, created_at, week_commencing, stocktake_type, counted_by:counted_by(full_name)")
    .order("week_commencing", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  const TYPE_LABELS: Record<string, string> = {
    raw_material: "Raw Material", wip: "WIP", fg: "Finished Good", mixed: "Mixed",
  };
  const TYPE_BADGE: Record<string, string> = {
    raw_material: "badge-blue", wip: "badge-yellow", fg: "badge-green", mixed: "badge-gray",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stocktakes</h1>
          <p className="page-subtitle">Physical stock counts grouped by type and week.</p>
        </div>
        <Link href="/stocktakes/new" className="btn-primary">+ New Stocktake</Link>
      </div>

      {(!stocktakes || stocktakes.length === 0) ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", color: "#78716c" }}>
          <p style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>No stocktakes yet</p>
          <p style={{ fontSize: "0.875rem" }}>Create your first stocktake to count stock levels.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Type</th>
                <th>Week Commencing</th>
                <th>Status</th>
                <th>Counted By</th>
                <th>Submitted</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stocktakes.map((st) => {
                const countedBy = (st.counted_by as { full_name?: string } | null)?.full_name ?? "—";
                const isDraft = st.status === "draft";
                return (
                  <tr key={st.id}>
                    <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{st.reference ?? "—"}</td>
                    <td>
                      <span className={`badge ${TYPE_BADGE[st.stocktake_type] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                        {TYPE_LABELS[st.stocktake_type] ?? st.stocktake_type ?? "—"}
                      </span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#57534e" }}>
                      {st.week_commencing
                        ? new Date(st.week_commencing).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td>
                      <span className={`badge ${isDraft ? "badge-yellow" : "badge-green"}`}>
                        {isDraft ? "Draft" : "Submitted"}
                      </span>
                    </td>
                    <td>{countedBy}</td>
                    <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>
                      {st.submitted_at ? new Date(st.submitted_at).toLocaleDateString("en-AU") : "—"}
                    </td>
                    <td style={{ color: "#78716c", fontSize: "0.875rem", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {st.notes ?? "—"}
                    </td>
                    <td style={{ display: "flex", gap: "0.375rem", whiteSpace: "nowrap" }}>
                      <Link
                        href={`/stocktakes/${st.id}`}
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                      >
                        {isDraft ? "Continue" : "View"}
                      </Link>
                      {isDraft && canDelete && (
                        <DeleteStocktakeButton stocktakeId={st.id} reference={st.reference} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
