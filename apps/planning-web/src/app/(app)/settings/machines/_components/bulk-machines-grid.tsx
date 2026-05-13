"use client";

/**
 * Machine register — bulk-edit grid.
 *
 * Mirrors the convention used by /items, /bom and the other tenant register
 * grids: a read-only DataTable by default, with an "Edit Grid" toggle in the
 * top-right that flips inline cells into edit mode. "Save N changes" / "Undo
 * all" / "✕ Exit" controls live in the same toolbar.
 *
 * Adding a new machine: stays on the existing single-machine form at
 * /settings/machines/new (linked from the page header). The Edit Grid is for
 * bulk-editing existing machines only — same as items-table.tsx.
 *
 * Field-level coercion in handleBulkSave converts text inputs into the right
 * shape for Supabase: empty strings become null for FK / numeric columns,
 * numerics are parsed, etc.
 */

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type ColumnDef } from "@/components/data-table";

const MACHINE_TYPES = [
  "Slicer", "Smoker", "Oven", "Grinder", "Mixer", "Filler", "Packer",
  "Sealer", "Weigh-price labeller", "Conveyor", "Refrigeration unit",
  "Saw", "Brine injector", "Tumbler", "Other",
];
const STATUSES = ["operational", "maintenance", "breakdown", "decommissioned"] as const;

type MachineRow = {
  id: string;
  code: string | null;
  name: string;
  machine_type: string | null;
  status: string;
  department_id: string | null;
  department: { name: string } | null;
  capacity_value: number | null;
  capacity_unit: string | null;
  room_id: string | null;
  next_service_date: string | null;
  is_active: boolean;
};

type Department = { id: string; name: string };
type Room = { id: string; name: string; code: string | null };
type Uom = { id: string; code: string; name: string };

export default function BulkMachinesGrid({
  machines,
  departments,
  rooms,
  uoms,
}: {
  machines: MachineRow[];
  departments: Department[];
  rooms: Room[];
  uoms: Uom[];
}) {
  // ── Filters ──────────────────────────────────────────────────────────────
  // Filter state lives in the parent so we can run the filter pass before
  // handing data to DataTable (which then sorts / paginates / edits the
  // already-filtered set). Same pattern as items-table.tsx.
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");

  const filteredMachines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines.filter((m) => {
      // Active toggle — defaults to "active only" matching the tenant
      // convention used elsewhere (items list, departments list, etc).
      if (activeFilter === "active"   && !m.is_active) return false;
      if (activeFilter === "inactive" &&  m.is_active) return false;
      if (typeFilter   && m.machine_type !== typeFilter) return false;
      if (deptFilter   && m.department_id !== deptFilter) return false;
      if (statusFilter && m.status !== statusFilter) return false;
      if (q) {
        // Free-text search hits Name + Code so the operator can hunt for
        // either "MIX" or "small mixer" interchangeably.
        const hay = [
          m.name ?? "",
          m.code ?? "",
          m.machine_type ?? "",
          m.department?.name ?? "",
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [machines, search, typeFilter, deptFilter, statusFilter, activeFilter]);

  const filtersActive =
    search.trim() !== "" || typeFilter !== "" || deptFilter !== "" ||
    statusFilter !== "" || activeFilter !== "active";

  function clearFilters() {
    setSearch(""); setTypeFilter(""); setDeptFilter(""); setStatusFilter("");
    setActiveFilter("active");
  }

  const columns: ColumnDef<MachineRow>[] = useMemo(() => [
    {
      key: "code",
      label: "Code",
      width: 110, minWidth: 80,
      render: (v) => (
        <span style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
          {String(v ?? "—")}
        </span>
      ),
      editable: { type: "text", placeholder: "Auto if blank" },
    },
    {
      key: "name",
      label: "Name",
      width: 240,
      render: (v, row) => (
        <span style={{ fontWeight: 500 }}>
          {String(v ?? "—")}
          {!row.is_active && (
            <span className="badge badge-gray" style={{ marginLeft: "0.375rem", fontSize: "0.6875rem" }}>Inactive</span>
          )}
        </span>
      ),
      editable: { type: "text", placeholder: "Machine name" },
    },
    {
      key: "machine_type",
      label: "Type",
      width: 150,
      render: (v) => v ? <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>{String(v)}</span>
                        : <span style={{ color: "#a8a29e" }}>—</span>,
      editable: {
        type: "select",
        options: MACHINE_TYPES.map((t) => ({ value: t, label: t })),
      },
    },
    {
      key: "department",
      label: "Department",
      width: 150,
      render: (_v, row) => {
        const name = row.department?.name ?? "";
        return name
          ? <span style={{ fontSize: "0.8125rem" }}>{name}</span>
          : <span style={{ color: "#a8a29e" }}>—</span>;
      },
      editable: departments.length > 0
        ? { type: "select", editKey: "department_id", options: departments.map((d) => ({ value: d.id, label: d.name })) }
        : undefined,
    },
    {
      key: "capacity_value",
      label: "Capacity",
      width: 100,
      render: (v) => v != null
        ? <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>{Number(v)}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
      editable: { type: "number", placeholder: "0" },
    },
    {
      key: "capacity_unit",
      label: "Unit",
      width: 110,
      render: (v) => v
        ? <span style={{ fontSize: "0.8125rem", color: "#57534e" }}>{String(v)}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
      editable: {
        type: "select",
        // Sourced from units_of_measure register so capacity unit stays
        // consistent with the rest of the app. Mirrors the dropdown on the
        // single-machine form.
        options: uoms.map((u) => ({ value: u.code, label: u.code })),
      },
    },
    {
      key: "room_id",
      label: "Room",
      width: 150,
      render: (_v, row) => {
        const room = rooms.find((r) => r.id === row.room_id);
        if (!room) return <span style={{ color: "#a8a29e" }}>—</span>;
        return <span style={{ fontSize: "0.8125rem" }}>{room.code ? `${room.code} — ` : ""}{room.name}</span>;
      },
      editable: rooms.length > 0
        ? { type: "select", options: rooms.map((r) => ({ value: r.id, label: r.code ? `${r.code} — ${r.name}` : r.name })) }
        : undefined,
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      render: (v) => {
        const s = String(v ?? "");
        if (s === "operational")    return <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Operational</span>;
        if (s === "maintenance")    return <span className="badge badge-blue"  style={{ fontSize: "0.6875rem" }}>Maintenance</span>;
        if (s === "breakdown")      return <span className="badge"             style={{ fontSize: "0.6875rem", background: "#fef2f2", color: "#dc2626" }}>Breakdown</span>;
        if (s === "decommissioned") return <span className="badge badge-gray"  style={{ fontSize: "0.6875rem" }}>Decommissioned</span>;
        return <span style={{ color: "#a8a29e" }}>—</span>;
      },
      editable: {
        type: "select",
        options: STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
      },
    },
    {
      key: "next_service_date",
      label: "Next Service",
      width: 130,
      render: (v) => v
        ? <span style={{ fontSize: "0.8125rem" }}>{new Date(String(v)).toLocaleDateString("en-AU")}</span>
        : <span style={{ color: "#a8a29e" }}>—</span>,
      defaultHidden: true,
    },
    {
      key: "is_active",
      label: "Active",
      width: 80,
      render: (v) => v
        ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Yes</span>
        : <span className="badge badge-gray"  style={{ fontSize: "0.6875rem" }}>No</span>,
      editable: {
        type: "select",
        options: [
          { value: "true",  label: "Yes" },
          { value: "false", label: "No" },
        ],
      },
    },
  ], [departments, rooms, uoms]);

  // ── Bulk save handler ─────────────────────────────────────────────────────
  // Same shape as items-table.tsx: changes is { id, fields }[]. Coerce empty
  // strings to null on the FK / numeric / nullable-text columns so we don't
  // write "" into a uuid column. Numeric columns parsed defensively.
  async function handleBulkSave(
    changes: { id: string; fields: Record<string, unknown> }[],
  ): Promise<string | null> {
    const supabase = createClient();
    const errors: string[] = [];

    const NUMERIC_FIELDS = new Set(["capacity_value"]);
    const BOOLEAN_FIELDS = new Set(["is_active"]);
    const NULLABLE_TEXT_FIELDS = new Set([
      "code", "machine_type", "capacity_unit",
      "department_id", "room_id",
    ]);

    await Promise.all(changes.map(async ({ id, fields }) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (BOOLEAN_FIELDS.has(k)) {
          payload[k] = v === true || v === "true";
          continue;
        }
        if (NUMERIC_FIELDS.has(k)) {
          if (v === "" || v == null) { payload[k] = null; continue; }
          const n = Number(v);
          payload[k] = isNaN(n) ? null : n;
          continue;
        }
        if (NULLABLE_TEXT_FIELDS.has(k)) {
          const s = typeof v === "string" ? v.trim() : v;
          payload[k] = s === "" || s == null ? null : s;
          continue;
        }
        // status / name etc — pass through as text.
        payload[k] = typeof v === "string" ? v : v ?? null;
      }
      const { error } = await supabase.from("machines").update(payload).eq("id", id);
      if (error) errors.push(`${id.slice(0, 8)}: ${error.message}`);
    }));

    return errors.length > 0 ? errors.join("; ") : null;
  }

  return (
    <>
      {/* ── Filter row ───────────────────────────────────────────────────────
          Free-text search (matches name / code / type / dept name) plus
          category dropdowns + active toggle. Filtering happens before the
          DataTable receives data so sort, column toggle, and Edit Grid all
          work on the visible subset only. */}
      <div style={{
        display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center",
        padding: "0.625rem 0.875rem", borderBottom: "1px solid #e7e5e4",
      }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, code, type…"
          className="form-input"
          style={{ fontSize: "0.8125rem", padding: "0.35rem 0.6rem", width: "240px", height: "2rem" }}
        />
        <select
          className="form-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem", height: "2rem", width: "auto" }}
        >
          <option value="">All types</option>
          {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          className="form-select"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem", height: "2rem", width: "auto" }}
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ fontSize: "0.8125rem", padding: "0.3rem 0.5rem", height: "2rem", width: "auto" }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        {/* Active / Inactive / Both — three-state toggle matching items table */}
        <div style={{ display: "inline-flex", border: "1px solid #e7e5e4", borderRadius: "0.375rem", overflow: "hidden", height: "2rem" }}>
          {([
            { v: "active",   label: "Active"   },
            { v: "inactive", label: "Inactive" },
            { v: "all",      label: "Both"     },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setActiveFilter(opt.v)}
              style={{
                fontSize: "0.75rem",
                padding: "0 0.7rem",
                border: "none",
                borderRight: opt.v !== "all" ? "1px solid #e7e5e4" : "none",
                background: activeFilter === opt.v ? "#1c1917" : "#fff",
                color: activeFilter === opt.v ? "#fff" : "#57534e",
                cursor: "pointer",
                fontWeight: activeFilter === opt.v ? 600 : 500,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            style={{
              background: "none", border: "1px solid #e7e5e4", borderRadius: "0.375rem",
              padding: "0.3rem 0.6rem", fontSize: "0.75rem", color: "#dc2626",
              cursor: "pointer", height: "2rem",
            }}
          >
            ✕ Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#78716c" }}>
          Showing {filteredMachines.length} of {machines.length}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filteredMachines}
        href={(row) => `/settings/machines/${row.id}`}
        onBulkSave={handleBulkSave}
        emptyMessage={
          filtersActive
            ? "No machines match the current filters. Clear filters to see all."
            : "No machines yet. Click + New Machine in the header to register your first."
        }
        storageKey="machines.v1"
      />
    </>
  );
}
