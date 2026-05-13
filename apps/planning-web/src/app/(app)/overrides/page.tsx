import { createClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/tenant";
import OverridesTable, { type OverrideRow } from "./_components/overrides-table";
import Link from "next/link";

/**
 * /overrides — admin review page for manual MRP overrides.
 *
 * Lists every active override across plans so a manager can decide:
 *   - "leave it" (override is correct, BOM bug isn't worth fixing yet)
 *   - "clear it" (BOM has been fixed; the override is now obsolete)
 *
 * Resolved (cleared) overrides remain in the audit trail with resolved_by /
 * resolved_at / resolved_note for accountability.
 */

export default async function OverridesPage() {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return <div>Tenant not found</div>;

  const { data: rows } = await supabase
    .from("mrp_overrides")
    .select(`
      id, demand_plan_id, item_id, department, override_qty, reason,
      overridden_by, overridden_at, resolved_at, resolved_by, resolved_note,
      plan:demand_plan_id(week_start, status),
      item:item_id(code, name, item_type, unit)
    `)
    .eq("tenant_id", tenantId)
    .order("overridden_at", { ascending: false });

  const list: OverrideRow[] = ((rows ?? []) as Array<{
    id: string; demand_plan_id: string; item_id: string;
    department: string; override_qty: number; reason: string | null;
    overridden_by: string | null; overridden_at: string;
    resolved_at: string | null; resolved_by: string | null; resolved_note: string | null;
    plan: { week_start: string; status: string } | { week_start: string; status: string }[] | null;
    item: { code: string; name: string; item_type: string; unit: string } | { code: string; name: string; item_type: string; unit: string }[] | null;
  }>).map(r => {
    const plan = Array.isArray(r.plan) ? r.plan[0] : r.plan;
    const item = Array.isArray(r.item) ? r.item[0] : r.item;
    return {
      id:            r.id,
      plan_id:       r.demand_plan_id,
      plan_week:     plan?.week_start ?? "",
      plan_status:   plan?.status ?? "",
      item_id:       r.item_id,
      item_code:     item?.code ?? "—",
      item_name:     item?.name ?? "—",
      item_unit:     item?.unit ?? "",
      department:    r.department,
      override_qty:  Number(r.override_qty),
      reason:        r.reason ?? "",
      overridden_by: r.overridden_by,
      overridden_at: r.overridden_at,
      resolved_at:   r.resolved_at,
      resolved_by:   r.resolved_by,
      resolved_note: r.resolved_note,
    };
  });

  const active   = list.filter(r => !r.resolved_at);
  const resolved = list.filter(r => r.resolved_at);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">MRP overrides</h1>
          <p className="page-subtitle">
            Manual qty overrides per (plan, item, department). Use as a release valve when a BOM bug or typo would otherwise stall production. Admin reviews + clears them once the source data is fixed.
          </p>
        </div>
        <Link href="/" className="btn-secondary" style={{ fontSize: "0.8125rem" }}>← Dashboard</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.625rem", marginBottom: "1rem" }}>
        <Kpi label="Active overrides" value={active.length.toString()} sub="awaiting review" warning={active.length > 0} />
        <Kpi label="Resolved" value={resolved.length.toString()} sub="audit trail kept" />
      </div>

      <h2 style={{ fontSize: "1rem", margin: "1rem 0 0.5rem", fontWeight: 600 }}>Active</h2>
      <OverridesTable rows={active} mode="active" />

      {resolved.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem", fontWeight: 600, color: "#78716c" }}>Resolved (history)</h2>
          <OverridesTable rows={resolved} mode="resolved" />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, warning = false }: { label: string; value: string; sub: string; warning?: boolean }) {
  return (
    <div style={{ background: warning ? "#fef2f2" : "#fafaf9", border: `1px solid ${warning ? "#fca5a5" : "#e7e5e4"}`, borderRadius: "0.5rem", padding: "0.75rem 0.875rem" }}>
      <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.04em", color: warning ? "#991b1b" : "#78716c", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "0.2rem", color: warning ? "#991b1b" : "#1c1917" }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: warning ? "#dc2626" : "#a8a29e", marginTop: "0.125rem" }}>{sub}</div>
    </div>
  );
}
