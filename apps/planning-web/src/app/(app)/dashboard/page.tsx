import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch summary counts in parallel — all from the correct tables
  const [
    { count: productCount },
    { count: rawMaterialCount },
    { count: planCount },
    { data: lowStockItems },
    { data: upcomingPlans },
  ] = await Promise.all([
    supabase.from("items").select("*", { count: "exact", head: true })
      .eq("is_active", true).eq("item_type", "finished_good"),
    supabase.from("items").select("*", { count: "exact", head: true })
      .eq("is_active", true).eq("item_type", "raw_material"),
    supabase.from("demand_plans").select("*", { count: "exact", head: true })
      .in("status", ["draft", "in_progress"]),
    supabase.from("items").select("id, name, current_stock, min_stock, unit")
      .eq("is_active", true).filter("current_stock", "lte", "min_stock").gt("min_stock", 0).limit(5),
    supabase.from("demand_plans").select("id, week_start, status")
      .in("status", ["draft", "in_progress"]).order("week_start").limit(4),
  ]);

  const stats = [
    { label: "Active Products", value: productCount ?? 0, href: "/items?type=finished_good", color: "#b91c1c" },
    { label: "Raw Materials", value: rawMaterialCount ?? 0, href: "/items?type=raw_material", color: "#d97706" },
    { label: "Active Plans", value: planCount ?? 0, href: "/plans", color: "#0284c7" },
    { label: "Low Stock Items", value: lowStockItems?.length ?? 0, href: "/items", color: lowStockItems?.length ? "#dc2626" : "#16a34a" },
  ];

  const statusColors: Record<string, string> = {
    draft: "badge-gray",
    in_progress: "badge-yellow",
    locked: "badge-blue",
    completed: "badge-green",
  };

  function formatWeek(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back — here&apos;s your production overview</p>
        </div>
        <Link href="/plans/new" className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Plan
        </Link>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        {stats.map(stat => (
          <Link key={stat.label} href={stat.href} style={{ textDecoration: "none" }}>
            <div className="stat-card" style={{ borderTop: `3px solid ${stat.color}` }}>
              <div style={{ fontSize: "2rem", fontWeight: "700", color: stat.color, lineHeight: 1 }}>{stat.value}</div>
              <div style={{ fontSize: "0.875rem", color: "#78716c", marginTop: "0.375rem" }}>{stat.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Upcoming schedules */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "#1c1917", margin: 0 }}>Upcoming Plans</h2>
            <Link href="/plans" style={{ fontSize: "0.8125rem", color: "#b91c1c", textDecoration: "none" }}>View all →</Link>
          </div>
          {!upcomingPlans?.length ? (
            <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No active plans. <Link href="/plans/new" style={{ color: "#b91c1c" }}>Create one →</Link></p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {upcomingPlans.map(s => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", background: "#fafaf9", borderRadius: "0.5rem", border: "1px solid #e7e5e4", gap: "0.5rem" }}>
                  <Link href={`/plans/${s.id}`} style={{ textDecoration: "none", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: "500", color: "#1c1917" }}>Week of {formatWeek(s.week_start)}</div>
                    <span className={`badge ${statusColors[s.status] ?? "badge-gray"}`} style={{ textTransform: "capitalize" }}>{s.status.replace("_", " ")}</span>
                  </Link>
                  <Link
                    href={`/plans/${s.id}/rm-schedule`}
                    style={{
                      fontSize: "0.75rem", fontWeight: 600,
                      padding: "0.3rem 0.55rem", borderRadius: "0.375rem",
                      border: "1px solid #fcd34d", background: "#fffaf0", color: "#854d0e",
                      textDecoration: "none", whiteSpace: "nowrap",
                    }}
                    title="Open the per-day raw material schedule for this plan"
                  >
                    📅 RM
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low stock */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", color: "#1c1917", margin: 0 }}>Low Stock Alerts</h2>
            <Link href="/inventory" style={{ fontSize: "0.8125rem", color: "#b91c1c", textDecoration: "none" }}>View all →</Link>
          </div>
          {!lowStockItems?.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#16a34a", fontSize: "0.875rem" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              All raw materials are well stocked
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {lowStockItems.map((item: { id: string; name: string; current_stock: number; min_stock: number; unit: string }) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.625rem 0.75rem", background: "#fef2f2", borderRadius: "0.5rem", border: "1px solid #fca5a5" }}>
                  <span style={{ fontSize: "0.875rem", color: "#1c1917", fontWeight: "500" }}>{item.name}</span>
                  <span style={{ fontSize: "0.8125rem", color: "#dc2626", fontWeight: "600" }}>
                    {item.current_stock} / {item.min_stock} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div style={{ marginTop: "1.5rem", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        {[
          { label: "Add Product", href: "/items/new", desc: "Create a new item (product, WIP, raw material)" },
          { label: "New Demand Plan", href: "/plans/new", desc: "Plan production for the week" },
          { label: "Record Stock Movement", href: "/inventory/new", desc: "Log a receipt, usage or adjustment" },
          { label: "Export Report", href: "/reports", desc: "Download production or inventory reports" },
        ].map(item => (
          <Link key={item.href} href={item.href} className="card" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ fontWeight: "600", color: "#1c1917", fontSize: "0.875rem" }}>{item.label}</div>
            <div style={{ color: "#78716c", fontSize: "0.8125rem", marginTop: "0.25rem" }}>{item.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
