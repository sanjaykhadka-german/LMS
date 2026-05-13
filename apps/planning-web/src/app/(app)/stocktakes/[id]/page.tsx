import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import StocktakeClient from "./_client";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  raw_material: "Raw Material",
  wip:          "WIP",
  fg:           "Finished Good",
  mixed:        "Mixed",
};

const TYPE_BADGE_COLOR: Record<string, string> = {
  raw_material: "badge-blue",
  wip:          "badge-yellow",
  fg:           "badge-green",
  mixed:        "badge-gray",
};

export default async function StocktakeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: viewerProfile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const viewerRole = (viewerProfile as { role?: string } | null)?.role ?? "viewer";
  const canSeeAudit = ["super_admin", "admin", "manager"].includes(viewerRole);

  // Pull stocktake header + lines + ALL items + barcode lookup + compliance flags.
  // Everything in parallel — slowest determines page load time.
  const [
    { data: st }, { data: lines }, { data: items }, { data: purchasableTypes },
    { data: itemBarcodes }, { data: rooms }, { data: locations }, { data: tenantRow },
  ] = await Promise.all([
    supabase.from("stocktakes").select("*").eq("id", id).single(),
    supabase
      .from("stocktake_lines")
      .select("*, item:item_id(id, code, name, unit, item_type, current_stock), counter:counted_by(id, full_name), location:location_id(id, name, code, room:room_id(id, name, department:department_id(id, name)))")
      .eq("stocktake_id", id).order("created_at"),
    fetchAllRows((from, to) => supabase
      .from("items")
      .select("id, code, name, unit, item_type, current_stock, min_stock, max_stock, procurement_type, is_active, default_location:default_location_id(id, name, code, room:room_id(id, name, department:department_id(id, name)))")
      .order("code")
      .range(from, to)),
    supabase
      .from("item_types").select("code").eq("is_purchasable", true).eq("is_active", true),
    fetchAllRows((from, to) => supabase
      .from("item_barcodes").select("item_id, barcode_value")
      .eq("is_active", true)
      .range(from, to)),
    supabase
      .from("rooms").select("id, name, code, barcode, department_id, department:department_id(id, name)")
      .eq("is_active", true).order("name"),
    supabase
      .from("locations").select("id, name, code, barcode, room_id, require_batch, require_ubd, room:room_id(id, name, department:department_id(id, name))")
      .eq("is_active", true).order("name"),
    (async () => {
      const tenantId = (await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single()).data?.tenant_id;
      if (!tenantId) return { data: null };
      return supabase.from("tenants").select("id, require_batch, require_ubd").eq("id", tenantId).single();
    })(),
  ]);
  if (!st) notFound();

  const purchasableCodes = (purchasableTypes ?? []).map(t => t.code);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <BackButton href="/stocktakes" label="Stocktakes" rememberKey="stocktakes.lastListUrl" />
        <span style={{ color: "#d4d4d4" }}>|</span>
        <QuickNav />
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {st.reference ?? "Stocktake"}
            <span
              className={`badge ${TYPE_BADGE_COLOR[st.stocktake_type] ?? "badge-gray"}`}
              style={{ marginLeft: "0.625rem", fontSize: "0.75rem", verticalAlign: "middle" }}
            >
              {TYPE_LABELS[st.stocktake_type] ?? st.stocktake_type}
            </span>
          </h1>
          <p className="page-subtitle">
            {st.week_commencing && (
              <>
                Week commencing{" "}
                <strong>
                  {new Date(st.week_commencing).toLocaleDateString("en-AU", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </strong>
                {" · "}
              </>
            )}
            {st.status === "submitted"
              ? `Submitted ${st.submitted_at ? new Date(st.submitted_at).toLocaleDateString("en-AU") : ""}`
              : "Draft — enter counts and submit to update stock levels"}
          </p>
        </div>
        <span
          className={`badge ${st.status === "submitted" ? "badge-green" : "badge-yellow"}`}
          style={{ fontSize: "0.875rem", padding: "0.375rem 0.75rem" }}
        >
          {st.status === "submitted" ? "Submitted" : "Draft"}
        </span>
      </div>

      <StocktakeClient
        stocktake={st}
        initialLines={lines ?? []}
        allItems={items ?? []}
        canSeeAudit={canSeeAudit}
        purchasableCodes={purchasableCodes}
        itemBarcodes={(itemBarcodes ?? []) as { item_id: string; barcode_value: string }[]}
        rooms={(rooms ?? []) as any}
        locations={(locations ?? []) as any}
        tenantCompliance={{
          require_batch: (tenantRow as { require_batch?: boolean } | null)?.require_batch ?? false,
          require_ubd:   (tenantRow as { require_ubd?: boolean }   | null)?.require_ubd   ?? false,
        }}
        tenantId={(tenantRow as { id?: string } | null)?.id ?? null}
      />
    </div>
  );
}
