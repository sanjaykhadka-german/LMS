import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { RmScheduleGrid, type Row } from "./_rm-schedule-grid";

/**
 * RM Schedule (Phase 9.4 v2 — Tino May 2026)
 *
 * Per-department × per-day Raw Material schedule for a demand plan, with
 * dept totals and a tenant-wide grand total. Backed by the
 * get_plan_dept_materials_by_day RPC (migration 102 / 103).
 *
 * Server component loads the rows; the client island
 * `<RmScheduleGrid>` owns the rendering, alignment, modal interaction,
 * and Print button.
 */

export default async function RmSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: plan }, { data: rows }] = await Promise.all([
    supabase
      .from("demand_plans")
      .select("id, week_start, status, locked_at")
      .eq("id", id)
      .single(),
    supabase.rpc("get_plan_dept_materials_by_day", { p_demand_plan_id: id }),
  ]);
  if (!plan) notFound();

  const data = (rows ?? []) as Row[];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }} className="no-print">
        <BackButton href={`/plans/${id}`} label="Plan" rememberKey="plans.lastPlanUrl" />
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">RM Schedule</h1>
          <p className="page-subtitle">
            Week commencing <strong>{new Date(plan.week_start).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</strong>
            {" · "}
            {data.length} line{data.length === 1 ? "" : "s"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }} className="no-print">
          <Link href={`/purchase-orders/suggestions?plan=${id}`} className="btn-primary" style={{ fontSize: "0.875rem" }}>
            📋 Order from plan
          </Link>
          <Link href={`/plans/${id}`} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
            Back to plan
          </Link>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
          No raw material requirements yet — run <strong>Save &amp; Build Work Orders</strong> on the plan to populate the schedule.
        </div>
      ) : (
        <RmScheduleGrid weekStart={plan.week_start} planId={id} rows={data} />
      )}
    </div>
  );
}
