import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import { fetchAllRows } from "@/lib/fetch-all";
import CostingsTable, { type CostingRow } from "./_components/costings-table";

/**
 * /costings — Phase 1 of the costings module.
 *
 * Lists every item in the tenant with its cascaded RM cost per unit, sourced
 * from v_item_landed_cost_v1 (mig 121). The view recursively explodes the
 * BOM for each FG / WIP and sums leaf effective_cost × required qty using
 * the same math as test_product_cascade.
 *
 * What the page is for (today):
 *   • See where each FG / WIP sits cost-wise — sortable, filterable
 *   • Compare cascade vs manual override (items.standard_cost) — variance %
 *   • Spot data-quality issues — leaves_missing_cost flag, no-BOM rows
 *   • Drill down to the full cascade via the existing Test-Product modal
 *
 * What it ISN'T yet (Phases 2-5):
 *   • Conversion costs (labour, utilities, machine, overhead)
 *   • Customer margin / floor checks
 *   • Variance (actual vs standard)
 *   • Live ticker / sparklines (needs cost_history snapshot table)
 *
 * See docs/costings-roadmap.md for the full plan.
 */

export const dynamic = "force-dynamic";

export default async function CostingsPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  // Items meta (category name + active flag) — joined client-side with the cost view.
  const itemsPromise = fetchAllRows((from, to) => supabase
    .from("items")
    .select("id, item_category:item_category_id(name)")
    .eq("tenant_id", tenantId ?? "")
    .eq("is_active", true)
    .range(from, to)
  );

  // Cost cascade rows — one per item. v3 (mig 129) is the full landed-cost
  // view: RM (from v2 basis-aware cascade) + Labour (routings, summed up the
  // BOM tree) + Overhead (standard $/kg, applied once at root for producibles).
  //
  // Paginated via fetchAllRows: the view has ~1300 rows for German Butchery
  // and PostgREST silently caps un-paginated selects at 1000, so items past
  // the cut (e.g. 9004.11 Bavarian Style Pork Knuckle, May 2026) were
  // disappearing from the costings list even though the cascade computed
  // them fine.
  const costsPromise = fetchAllRows((from, to) => supabase
    .from("v_item_landed_cost_v3")
    .select("item_id, code, name, item_type, unit, manual_standard_cost, rm_cost_per_unit, labour_cost_per_unit, overhead_cost_per_unit, total_cost_per_unit, component_count, leaves_missing_cost, leaves_missing_hierarchy, labour_hierarchy_missing, has_active_bom, variance_pct")
    .range(from, to)
  );

  const [{ data: itemsMeta }, { data: costs }] = await Promise.all([itemsPromise, costsPromise]);

  // Build category lookup per item.
  const catByItem = new Map<string, string>();
  for (const r of (itemsMeta ?? []) as unknown as Array<{
    id: string;
    item_category: { name: string } | { name: string }[] | null;
  }>) {
    const cat = Array.isArray(r.item_category) ? r.item_category[0] : r.item_category;
    if (cat?.name) catByItem.set(r.id, cat.name);
  }
  const activeIds = new Set(((itemsMeta ?? []) as Array<{ id: string }>).map(r => r.id));

  const rows: CostingRow[] = ((costs ?? []) as Array<{
    item_id: string; code: string; name: string; item_type: string; unit: string;
    manual_standard_cost: number | null;
    rm_cost_per_unit: number | string;
    labour_cost_per_unit: number | string;
    overhead_cost_per_unit: number | string;
    total_cost_per_unit: number | string;
    component_count: number; leaves_missing_cost: number;
    leaves_missing_hierarchy: number;
    labour_hierarchy_missing: boolean;
    has_active_bom: boolean; variance_pct: number | string | null;
  }>)
    .filter(r => activeIds.has(r.item_id))      // only active items
    .map(r => ({
      id:                  r.item_id,
      code:                r.code,
      name:                r.name,
      item_type:           r.item_type,
      category:            catByItem.get(r.item_id) ?? null,
      unit:                r.unit,
      manual_standard_cost: r.manual_standard_cost != null ? Number(r.manual_standard_cost) : null,
      rm_cost_per_unit:    Number(r.rm_cost_per_unit ?? 0),
      labour_cost_per_unit:    Number(r.labour_cost_per_unit ?? 0),
      overhead_cost_per_unit:  Number(r.overhead_cost_per_unit ?? 0),
      total_cost_per_unit:     Number(r.total_cost_per_unit ?? 0),
      component_count:     Number(r.component_count ?? 0),
      leaves_missing_cost: Number(r.leaves_missing_cost ?? 0),
      leaves_missing_hierarchy: Number(r.leaves_missing_hierarchy ?? 0),
      labour_hierarchy_missing: !!r.labour_hierarchy_missing,
      has_active_bom:      !!r.has_active_bom,
      variance_pct:        r.variance_pct != null ? Number(r.variance_pct) : null,
    }));

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem" }}>
        <div>
          <h1 className="page-title">💰 Costings</h1>
          <p className="page-subtitle">
            Full landed cost per item — RM (cascaded from BOMs and supplier
            prices) + Labour (routings × hourly rate) + Overhead (standard
            $/kg). Click any row to drill into the cascade.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/costings/rates"
            className="btn-secondary"
            style={{ whiteSpace: "nowrap" }}
            title="Standard hourly labour rate (used by per-product routings)"
          >
            ⚙ Labour rate
          </a>
          <a
            href="/costings/overheads"
            className="btn-secondary"
            style={{ whiteSpace: "nowrap" }}
            title="Standard overhead $/kg + weekly actuals tracker"
          >
            📊 Overheads
          </a>
          <a
            href="/costings/pricing"
            className="btn-secondary"
            style={{ whiteSpace: "nowrap" }}
            title="Pricing buffers — production loss, depreciation, sample/R&D, error margin, target gross margin"
          >
            💵 Pricing
          </a>
        </div>
      </div>

      <CostingsTable rows={rows} />
    </div>
  );
}
