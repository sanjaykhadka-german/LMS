import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import RoutingEditor, { type RoutingStep, type DeptOption } from "./_components/routing-editor";

/**
 * /bom/[id]/routing — per-BOM production routing editor.
 *
 * Each step is (department, step name, people, minutes, ref qty, ref basis).
 * Saves go to production_routings; the cascade (v3) sums labour cost up
 * the BOM tree.
 *
 * Lives on the BOM (not the item) so different versions can have different
 * routings, and shared WIPFs reuse one routing across every FG that
 * includes them.
 */

export const dynamic = "force-dynamic";

export default async function BomRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const bomP = supabase
    .from("bom_headers")
    .select("id, version, item_id, item:items(id, code, name, item_type, unit, target_weight_g, units_per_inner, units_per_outer, units_per_pallet)")
    .eq("id", id)
    .maybeSingle();

  const stepsP = supabase
    .from("production_routings")
    .select("id, department_id, step_name, people_count, std_minutes, reference_qty, reference_basis, sort_order, notes")
    .eq("bom_header_id", id)
    .order("sort_order");

  const deptsP = supabase
    .from("departments")
    .select("id, name, code, sort_order")
    .eq("tenant_id", tenantId ?? "")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");

  const rateP = supabase
    .from("v_labour_rate_current")
    .select("hourly_rate, effective_from")
    .maybeSingle();

  const [{ data: bom }, { data: steps }, { data: depts }, { data: rate }] =
    await Promise.all([bomP, stepsP, deptsP, rateP]);

  if (!bom) notFound();

  // The Supabase typegen sometimes returns "items" as an array even when
  // it's a single FK — normalise.
  const item = Array.isArray(bom.item) ? bom.item[0] : bom.item;

  const initialSteps: RoutingStep[] = ((steps ?? []) as Array<{
    id: string; department_id: string; step_name: string;
    people_count: number | string; std_minutes: number | string;
    reference_qty: number | string; reference_basis: string;
    sort_order: number; notes: string | null;
  }>).map(s => ({
    id: s.id,
    department_id: s.department_id,
    step_name: s.step_name,
    people_count: String(s.people_count),
    std_minutes:  String(s.std_minutes),
    reference_qty: String(s.reference_qty),
    reference_basis: s.reference_basis as RoutingStep["reference_basis"],
    sort_order: s.sort_order,
    notes: s.notes ?? "",
    _tempKey: s.id,
  }));

  const deptOptions: DeptOption[] = ((depts ?? []) as Array<{ id: string; name: string; code: string | null; sort_order: number }>)
    .map(d => ({ id: d.id, name: d.name, code: d.code }));

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href={`/bom/${id}`} label="Back to BOM" />
            {item && (
              <>
                <span style={{ color: "#78716c", fontSize: "0.875rem" }}>·</span>
                <Link href={`/items/${item.id}`} style={{ color: "#b91c1c", textDecoration: "none", fontSize: "0.8125rem", fontWeight: 500 }}>
                  {item.code} — Item Master
                </Link>
              </>
            )}
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            Routing — {item?.name ?? "BOM"} v{bom.version}
          </h1>
          <p className="page-subtitle">
            Production steps for this BOM. Each step is multiplied by the
            tenant&apos;s standard hourly rate to give labour $/kg of output.
            The cascade rolls these up at every node.
          </p>
        </div>
      </div>

      <RoutingEditor
        bomHeaderId={id}
        bomItemTargetWeightG={item?.target_weight_g != null ? Number(item.target_weight_g) : null}
        bomItemUnitsPerInner={item?.units_per_inner != null ? Number(item.units_per_inner) : null}
        bomItemUnitsPerOuter={item?.units_per_outer != null ? Number(item.units_per_outer) : null}
        bomItemUnitsPerPallet={item?.units_per_pallet != null ? Number(item.units_per_pallet) : null}
        currentHourlyRate={rate?.hourly_rate != null ? Number(rate.hourly_rate) : null}
        currentRateEffectiveFrom={rate?.effective_from ?? null}
        initialSteps={initialSteps}
        deptOptions={deptOptions}
      />
    </div>
  );
}
