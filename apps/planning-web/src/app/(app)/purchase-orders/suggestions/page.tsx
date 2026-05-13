import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { fetchAllRows } from "@/lib/fetch-all";
import { PoSuggestionsGrid, type SuggestionRow, type SupplierLite, type SupplierItemLite } from "./_grid";

/**
 * PO Suggestions (Phase 9.5 — Tino May 2026)
 *
 * Mixed-trigger overview of items that should be ordered now:
 *   • min breach   — current_stock <= min_stock
 *   • plan need    — required > on-hand for the selected demand plan
 *   • lead time    — supplier lead time would push delivery past the
 *                    earliest-needed-date for this RM in the plan
 *
 * The buyer reviews, optionally splits each line across multiple suppliers,
 * then clicks "Create draft POs" — the server action groups by supplier
 * and inserts one draft PO per supplier.
 */

export const dynamic = "force-dynamic";

export default async function PoSuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { plan: planParam } = await searchParams;

  // Plan picker — list active draft / in_progress / locked plans
  const { data: plans } = await supabase
    .from("demand_plans")
    .select("id, week_start, status")
    .order("week_start", { ascending: false })
    .limit(20);

  // Resolve the active plan (param wins, otherwise newest)
  const activePlanId = planParam ?? plans?.[0]?.id ?? null;
  if (!activePlanId) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <BackButton href="/purchase-orders" label="Purchase Orders" />
        </div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Suggested Orders</h1>
            <p className="page-subtitle">No demand plans yet — <Link href="/plans/new" style={{ color: "#b91c1c" }}>create one</Link>.</p>
          </div>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Heavy lift in parallel: RPC + suppliers list + supplier_items map +
  // any existing POs against this plan (for the KPI strip).
  const [
    { data: rows },
    { data: suppliers },
    { data: supplierItems },
    { data: existingPOs },
    { data: plan },
  ] = await Promise.all([
    supabase.rpc("get_po_suggestions", { p_demand_plan_id: activePlanId, p_today: today }),
    supabase.from("suppliers").select("id, name, code").eq("is_active", true).order("name"),
    fetchAllRows((from, to) => supabase
      .from("supplier_items")
      .select("id, item_id, supplier_id, unit_price, currency, purchase_uom, purchase_uom_qty, lead_time_days, min_order_qty")
      .range(from, to)),
    supabase
      .from("purchase_orders")
      .select("id, po_number, status, approval_status, supplier:supplier_id(id, name), lines:purchase_order_lines(qty_ordered, unit_price)")
      .eq("source_plan_id", activePlanId),
    supabase.from("demand_plans").select("week_start, status").eq("id", activePlanId).single(),
  ]);

  const data = (rows ?? []) as SuggestionRow[];
  const sups = (suppliers ?? []) as SupplierLite[];
  const sItems = (supplierItems ?? []) as SupplierItemLite[];

  // KPI: plan-need value = sum(plan_to_order × cheapest unit_price)
  let planNeedValue = 0;
  for (const r of data) {
    const qty = Number(r.plan_to_order) || 0;
    const cost = Number(r.cheapest_supplier_unit_price) || 0;
    planNeedValue += qty * cost;
  }

  // KPI: orders already placed against this plan (draft + approved + sent)
  let draftValue = 0, approvedValue = 0, sentValue = 0;
  for (const po of (existingPOs ?? []) as Array<{
    status: string; approval_status: string;
    lines: Array<{ qty_ordered: number; unit_price: number | null }>;
  }>) {
    const v = (po.lines ?? []).reduce(
      (s, l) => s + (Number(l.qty_ordered) || 0) * (Number(l.unit_price) || 0), 0,
    );
    if (po.status === "sent" || po.status === "received") sentValue += v;
    else if (po.approval_status === "approved") approvedValue += v;
    else draftValue += v;
  }
  const allocatedValue = draftValue + approvedValue + sentValue;
  const coverage = planNeedValue > 0 ? Math.round((allocatedValue / planNeedValue) * 100) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }} className="no-print">
        <BackButton href="/purchase-orders" label="Purchase Orders" />
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Suggested Orders</h1>
          <p className="page-subtitle">
            Plan: <strong>Week of {plan ? new Date(plan.week_start).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}</strong>
            {" · "}
            {data.length} item{data.length === 1 ? "" : "s"} need ordering
          </p>
        </div>
        <form action="" style={{ display: "flex", gap: "0.5rem" }} className="no-print">
          <select
            name="plan"
            defaultValue={activePlanId}
            style={{ padding: "0.4rem 0.625rem", border: "1px solid #d6d3d1", borderRadius: "0.375rem", fontSize: "0.8125rem", background: "#fff" }}
            onChange={(e) => {
              const f = e.currentTarget.form;
              if (f) f.submit();
            }}
          >
            {(plans ?? []).map(p => (
              <option key={p.id} value={p.id}>
                {new Date(p.week_start).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} — {p.status}
              </option>
            ))}
          </select>
        </form>
      </div>

      {/* KPI strip */}
      <div className="card" style={{ padding: "0.875rem 1rem", marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "center" }}>
        <KpiStat label="Plan need" value={fmtMoney(planNeedValue)} />
        <KpiStat label="Allocated to suppliers" value={fmtMoney(allocatedValue)} sub={planNeedValue > 0 ? `${coverage}% covered` : undefined} accent={coverage >= 100 ? "#15803d" : "#92400e"} />
        <KpiStat label="Gap" value={fmtMoney(Math.max(0, planNeedValue - allocatedValue))} accent={planNeedValue > allocatedValue ? "#dc2626" : "#15803d"} />
        <div style={{ borderLeft: "1px solid #e7e5e4", height: "32px" }} />
        <KpiStat label="Draft" value={fmtMoney(draftValue)} small />
        <KpiStat label="Approved" value={fmtMoney(approvedValue)} small />
        <KpiStat label="Sent" value={fmtMoney(sentValue)} small accent={sentValue > 0 ? "#15803d" : undefined} />
      </div>

      {data.length === 0 ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
          ✓ Nothing flagged — every RM is above min stock and the plan&apos;s on-hand stock covers everything needed.
        </div>
      ) : (
        <PoSuggestionsGrid
          planId={activePlanId}
          rows={data}
          suppliers={sups}
          supplierItems={sItems}
        />
      )}
    </div>
  );
}

function KpiStat({ label, value, sub, accent, small }: { label: string; value: string; sub?: string; accent?: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: small ? "0.9375rem" : "1.125rem", fontWeight: 700, color: accent ?? "#1c1917", fontVariantNumeric: "tabular-nums", marginTop: "0.125rem" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.7rem", color: accent ?? "#78716c", marginTop: "0.125rem" }}>{sub}</div>
      )}
    </div>
  );
}

function fmtMoney(v: number) {
  return v.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });
}
