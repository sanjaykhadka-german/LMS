import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { PlansTable } from "./plans-table";

function weekLabel(dateStr: string) {
  const d = new Date(dateStr);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

export default async function PlansPage() {
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from("demand_plans")
    .select("id, week_start, status, notes, created_at")
    .order("week_start", { ascending: false });

  // Get demand line counts per plan
  const planIds = (plans ?? []).map(p => p.id);
  const { data: lineCounts } = planIds.length
    ? await supabase
        .from("demand_lines")
        .select("demand_plan_id")
        .in("demand_plan_id", planIds)
    : { data: [] };

  const countMap = (lineCounts ?? []).reduce((acc, l) => {
    acc[l.demand_plan_id] = (acc[l.demand_plan_id] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Merge line count into plan rows
  const plansWithCount = (plans ?? []).map(p => ({
    ...p,
    line_count: countMap[p.id] ?? 0,
  }));

  // Find or suggest the current week's Monday
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  const mondayStr = monday.toISOString().split("T")[0];
  const hasThisWeek = (plans ?? []).some(p => p.week_start === mondayStr);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Demand Plans</h1>
          <p className="page-subtitle">Weekly production demand planning and MRP explosion</p>
        </div>
        <Link href="/plans/new" className="btn-primary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Plan
        </Link>
      </div>

      {!hasThisWeek && (
        <div style={{ marginBottom: "1.25rem", padding: "0.875rem 1rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.875rem", color: "#92400e" }}>
            📋 No plan exists for this week ({weekLabel(mondayStr)})
          </span>
          <Link href={`/plans/new?week=${mondayStr}`} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
            Create This Week&apos;s Plan →
          </Link>
        </div>
      )}

      <PlansTable plans={plansWithCount} />
    </div>
  );
}
