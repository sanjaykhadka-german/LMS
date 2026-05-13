import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import StandardRateEditor, { type StandardRateHistoryRow } from "./_components/standard-rate-editor";
import WeeklyTracker, { type RecentWeekRow } from "./_components/weekly-tracker";

/**
 * /costings/overheads — Phase 2 rebuild step 3.
 *
 * Two cards:
 *   1. Standard overhead $/kg used in cost cascade (effective-dated +
 *      override audit).
 *   2. Weekly actuals tracker — entries by category + kg-produced
 *      denominator → derived $/kg for the week. Lets Tino see real vs
 *      standard and update the standard when reality drifts.
 */

export const dynamic = "force-dynamic";

function mondayOf(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  return r.toISOString().slice(0, 10);
}

export default async function OverheadsPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  const todayMonday = mondayOf(new Date());

  const currentP = supabase
    .from("v_overhead_standard_current")
    .select("rate_per_kg, effective_from, override_reason, source, previous_rate")
    .maybeSingle();

  const histP = supabase
    .from("overhead_standard_rate")
    .select("id, effective_from, rate_per_kg, previous_rate, override_reason, source")
    .eq("tenant_id", tenantId ?? "")
    .order("effective_from", { ascending: false });

  // Last 8 weeks of summary so the user can spot drift.
  const summaryP = supabase
    .from("v_overhead_week_summary")
    .select("week_start_date, total_oh, kg_produced, derived_dollars_per_kg")
    .eq("tenant_id", tenantId ?? "")
    .order("week_start_date", { ascending: false })
    .limit(8);

  const [{ data: current }, { data: hist }, { data: summary }] =
    await Promise.all([currentP, histP, summaryP]);

  const history: StandardRateHistoryRow[] = ((hist ?? []) as Array<{
    id: string; effective_from: string;
    rate_per_kg: number | string;
    previous_rate: number | string | null;
    override_reason: string | null;
    source: string;
  }>).map(h => ({
    id: h.id,
    effective_from: h.effective_from,
    rate_per_kg: Number(h.rate_per_kg ?? 0),
    previous_rate: h.previous_rate != null ? Number(h.previous_rate) : null,
    override_reason: h.override_reason ?? "",
    source: (h.source === "derived" ? "derived" : "manual"),
  }));

  const recentWeeks: RecentWeekRow[] = ((summary ?? []) as Array<{
    week_start_date: string;
    total_oh: number | string;
    kg_produced: number | string | null;
    derived_dollars_per_kg: number | string | null;
  }>).map(r => ({
    week_start_date: r.week_start_date,
    total_oh: Number(r.total_oh ?? 0),
    kg_produced: r.kg_produced != null ? Number(r.kg_produced) : null,
    derived_dollars_per_kg: r.derived_dollars_per_kg != null ? Number(r.derived_dollars_per_kg) : null,
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">📊 Overheads</h1>
          <p className="page-subtitle">
            Standard $/kg used in costing, plus weekly actuals tracking
            (rent, insurance, freezer power, depreciation, admin labour, etc).
            Capture real numbers weekly, set the standard from a recent
            average — or override with a documented reason.
          </p>
        </div>
      </div>

      <StandardRateEditor
        currentRate={current ? Number(current.rate_per_kg ?? 0) : 0}
        currentEffectiveFrom={current?.effective_from ?? null}
        currentReason={current?.override_reason ?? ""}
        currentSource={current?.source === "derived" ? "derived" : "manual"}
        history={history}
        recentDerivedAvg={(() => {
          // Average of the last 4 weeks where derived $/kg is computable —
          // used as a "use this" suggestion button in the editor.
          const computable = recentWeeks
            .map(r => r.derived_dollars_per_kg)
            .filter((v): v is number => v != null && v > 0)
            .slice(0, 4);
          if (computable.length === 0) return null;
          return computable.reduce((s, v) => s + v, 0) / computable.length;
        })()}
      />

      <WeeklyTracker
        initialWeek={todayMonday}
        recentWeeks={recentWeeks}
      />
    </div>
  );
}
