"use client";

import { DataTable, type ColumnDef } from "@/components/data-table";

type PlanStatus = "draft" | "in_progress" | "locked" | "completed" | "archived";

const STATUS_COLORS: Record<PlanStatus, string> = {
  draft: "badge-gray",
  locked: "badge-blue",
  in_progress: "badge-yellow",
  completed: "badge-green",
  archived: "badge-gray",
};

const STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "Draft",
  locked: "Locked",
  in_progress: "In Progress",
  completed: "Completed",
  archived: "Archived",
};

function weekLabel(dateStr: string) {
  const d = new Date(dateStr);
  const end = new Date(d);
  end.setDate(d.getDate() + 6);
  return `${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;
}

interface PlanRow {
  id: string;
  week_start: string;
  status: string;
  notes: string | null;
  line_count: number;
}

const columns: ColumnDef<PlanRow>[] = [
  {
    key: "week_start",
    label: "Week",
    width: 240,
    render: (v) => {
      const dateStr = String(v ?? "");
      return (
        <div>
          <div style={{ fontWeight: 600, color: "#1c1917" }}>{weekLabel(dateStr)}</div>
          <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>
            {new Date(dateStr).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      );
    },
  },
  {
    key: "status",
    label: "Status",
    width: 130,
    render: (v) => (
      <span className={`badge ${STATUS_COLORS[v as PlanStatus] ?? "badge-gray"}`}>
        {STATUS_LABELS[v as PlanStatus] ?? String(v)}
      </span>
    ),
  },
  {
    key: "line_count",
    label: "Lines",
    width: 90,
    render: (v) => (
      <span style={{ color: "#78716c" }}>
        {String(v)} item{v !== 1 ? "s" : ""}
      </span>
    ),
  },
  {
    key: "notes",
    label: "Notes",
    render: (v) =>
      v ? (
        <span style={{
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
          color: "#78716c", fontSize: "0.875rem",
        }}>
          {String(v)}
        </span>
      ) : (
        <span style={{ color: "#a8a29e" }}>—</span>
      ),
  },
];

export function PlansTable({ plans }: { plans: PlanRow[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <DataTable
        columns={columns}
        data={plans}
        href={(row) => `/plans/${row.id}`}
        emptyMessage="No plans yet."
        emptyHref="/plans/new"
        emptyLabel="Create your first demand plan →"
      />
    </div>
  );
}
