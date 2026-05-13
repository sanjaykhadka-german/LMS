import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import ScheduleEditor from "./schedule-editor";

export default async function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: schedule }, { data: products }] = await Promise.all([
    supabase
      .from("production_schedules")
      .select("*, items:schedule_items(*, product:products(id, name, code, unit))")
      .eq("id", id)
      .single(),
    supabase.from("products").select("id, name, code, unit").eq("is_active", true).order("name"),
  ]);

  if (!schedule) notFound();

  function formatWeek(dateStr: string) {
    const d = new Date(dateStr);
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })} – ${end.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`;
  }

  const statusColors: Record<string, string> = {
    draft: "badge-gray",
    published: "badge-blue",
    completed: "badge-green",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <Link href="/schedules" style={{ color: "#78716c", textDecoration: "none", fontSize: "0.875rem" }}>← Schedules</Link>
          </div>
          <h1 className="page-title">Week of {formatWeek(schedule.week_start)}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.375rem" }}>
            <span className={`badge ${statusColors[schedule.status] ?? "badge-gray"}`} style={{ textTransform: "capitalize" }}>{schedule.status}</span>
            {schedule.notes && <span style={{ fontSize: "0.875rem", color: "#78716c" }}>{schedule.notes}</span>}
          </div>
        </div>
      </div>

      <ScheduleEditor
        scheduleId={schedule.id}
        weekStart={schedule.week_start}
        initialStatus={schedule.status}
        initialItems={schedule.items ?? []}
        products={products ?? []}
      />
    </div>
  );
}
