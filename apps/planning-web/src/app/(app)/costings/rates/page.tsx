import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import LabourRateEditor, { type RateRow } from "./_components/rates-editor";

/**
 * /costings/rates — Phase 2 admin: cost-rate settings.
 *
 * Step 1 (today): standard hourly labour rate per tenant. One number, one
 * input, history kept via effective-dated rows.
 *
 * The routing math uses this rate as: step_$_per_kg = (people × min/60)
 * × hourly_rate ÷ ref_qty. Will eventually grow to also include the
 * standard overhead rate ($/kg) once the overhead module ships.
 */

export const dynamic = "force-dynamic";

export default async function CostRatesPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const currentP = supabase
    .from("v_labour_rate_current")
    .select("id, effective_from, hourly_rate, notes")
    .maybeSingle();

  const histP = supabase
    .from("labour_rates")
    .select("id, effective_from, hourly_rate, notes")
    .eq("tenant_id", tenantId ?? "")
    .order("effective_from", { ascending: false });

  const [{ data: current }, { data: hist }] = await Promise.all([currentP, histP]);

  const rows: RateRow[] = ((hist ?? []) as Array<{
    id: string; effective_from: string; hourly_rate: number | string; notes: string | null;
  }>).map(r => ({
    id: r.id,
    effective_from: r.effective_from,
    hourly_rate: Number(r.hourly_rate ?? 0),
    notes: r.notes ?? "",
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">💰 Cost rates</h1>
          <p className="page-subtitle">
            Standard hourly labour rate. The cascade uses this with each
            product&apos;s routing (people × minutes) to compute labour cost
            per kg. New save creates a new effective-dated row; today&apos;s
            edit updates the same row. Old rates stay queryable for
            historical WO costing.
          </p>
        </div>
      </div>

      <LabourRateEditor
        currentRate={current ? Number(current.hourly_rate ?? 0) : 0}
        currentNotes={current?.notes ?? ""}
        currentEffectiveFrom={current?.effective_from ?? null}
        history={rows}
      />
    </div>
  );
}
