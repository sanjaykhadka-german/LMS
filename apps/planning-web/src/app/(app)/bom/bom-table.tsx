"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type ColumnDef } from "@/components/data-table";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";

interface BomRow {
  id: string;
  version: number;
  reference_batch_size: number;
  reference_batch_unit: string;
  yield_factor: number;
  is_active: boolean;
  approved_at: string | null;
  item: {
    id: string;
    code: string;
    name: string;
    item_type: string;
    department: string | null;
  } | null;
}

// Flat row that DataTable receives — includes derived edit-friendly fields so
// the operator can edit Yield as a percent (95) instead of a factor (0.95) and
// flip Active / Approved as a yes/no select that round-trips to bom_headers.
type FlatBomRow = BomRow & {
  item_name: string;
  item_type: string;
  yield_percent: number | null;
  active_str: "yes" | "no";
  approved_str: "yes" | "no";
};

// Same fallback used in bom-form.tsx — keep them aligned so creating a BOM and
// bulk-editing one offers the same units.
const UNIT_OPTIONS = [
  { value: "kg",   label: "kg" },
  { value: "g",    label: "g" },
  { value: "L",    label: "L" },
  { value: "mL",   label: "mL" },
  { value: "ea",   label: "ea" },
  { value: "pack", label: "pack" },
];

const YN_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no",  label: "No" },
];

// Static "data columns" — these never change between renders. The actual
// `columns` passed to DataTable is built inside BomTable so we can prepend a
// dynamic _select checkbox column that closes over the selection state.
const dataColumns: ColumnDef<FlatBomRow>[] = [
  {
    key: "item_name",
    label: "Item",
    width: 240,
    render: (_v, row) =>
      row.item ? (
        <div>
          <div style={{ fontWeight: 500, color: "#1c1917" }}>{row.item.name}</div>
          <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>
            {row.item.code}
          </div>
        </div>
      ) : (
        <span style={{ color: "#a8a29e" }}>—</span>
      ),
    sortable: true,
  },
  {
    key: "item_type",
    label: "Type",
    width: 130,
    render: (_v, row) =>
      row.item ? (
        <span
          className={`badge ${ITEM_TYPE_COLORS[row.item.item_type as ItemType] ?? "badge-gray"}`}
          style={{ fontSize: "0.6875rem" }}
        >
          {ITEM_TYPE_LABELS[row.item.item_type as ItemType] ?? row.item.item_type}
        </span>
      ) : null,
    sortable: true,
  },
  {
    key: "version",
    label: "Version",
    width: 90,
    render: (v) => (
      <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#292524" }}>
        v{String(v)}
      </span>
    ),
  },
  {
    key: "reference_batch_size",
    label: "Batch Size",
    width: 110,
    render: (v) => (
      <span style={{ color: "#78716c" }}>{String(v)}</span>
    ),
    editable: { type: "number", placeholder: "100" },
  },
  {
    key: "reference_batch_unit",
    label: "Unit",
    width: 80,
    render: (v) => (
      <span style={{ color: "#78716c" }}>{String(v ?? "")}</span>
    ),
    editable: { type: "select", options: UNIT_OPTIONS },
  },
  {
    key: "yield_percent",
    label: "Yield %",
    width: 90,
    render: (v) =>
      v == null ? <span style={{ color: "#a8a29e" }}>—</span> :
      <span style={{ color: "#78716c" }}>{Number(v)}%</span>,
    editable: { type: "number", placeholder: "100" },
  },
  {
    key: "active_str",
    label: "Active",
    width: 90,
    render: (_v, row) =>
      row.is_active ? (
        <span className="badge badge-green" style={{ fontSize: "0.625rem" }}>Yes</span>
      ) : (
        <span className="badge badge-gray" style={{ fontSize: "0.625rem" }}>No</span>
      ),
    editable: { type: "select", options: YN_OPTIONS },
  },
  {
    key: "approved_str",
    label: "Approved",
    width: 100,
    render: (_v, row) =>
      row.approved_at ? (
        <span className="badge badge-blue" style={{ fontSize: "0.625rem" }}>Yes</span>
      ) : (
        <span className="badge badge-gray" style={{ fontSize: "0.625rem" }}>No</span>
      ),
    editable: { type: "select", options: YN_OPTIONS },
  },
];

const BOM_TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "wip", label: "WIP / Mix" },
  { value: "fill", label: "Fill Code" },
  { value: "finished_good", label: "Finished Good" },
  { value: "raw_material", label: "Raw Material" },
];

export function BomTable({ boms, isAdmin = false }: { boms: BomRow[]; isAdmin?: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState("all");

  // ── Tick-and-flip selection ────────────────────────────────────────────────
  // Independent of the inline-edit "Edit Grid" mode. Operator ticks rows and
  // clicks Activate / Deactivate / Approve / Unapprove to flip those flags on
  // every selected row at once. No need to enter edit mode for the common
  // case of approving a batch of drafts.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boms.filter(b => {
      const item = b.item;
      if (!item) return false;
      if (activeType !== "all" && item.item_type !== activeType) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q);
    });
  }, [boms, search, activeType]);

  // Flatten + derive edit-friendly fields. yield_percent is the bridge between
  // the stored 0..1 factor and the percent the operator types.
  const flat = useMemo<FlatBomRow[]>(() => filtered.map(b => ({
    ...b,
    item_name:     b.item?.name ?? "",
    item_type:     b.item?.item_type ?? "",
    yield_percent: b.yield_factor != null ? Math.round(b.yield_factor * 100) : null,
    active_str:    b.is_active ? "yes" : "no",
    approved_str:  b.approved_at ? "yes" : "no",
  })), [filtered]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(b => selected.has(b.id));
  const someSelected = selected.size > 0;

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      // Untick only the currently-visible rows; selections elsewhere stay put.
      setSelected(prev => {
        const n = new Set(prev);
        filtered.forEach(b => n.delete(b.id));
        return n;
      });
    } else {
      setSelected(prev => {
        const n = new Set(prev);
        filtered.forEach(b => n.add(b.id));
        return n;
      });
    }
  }

  // Dynamic columns — admin gets a leading checkbox column, everyone else
  // just sees the data columns. Memo'd on (selected, isAdmin) so each render
  // cycle gets a fresh closure when the selection changes.
  const columns = useMemo<ColumnDef<FlatBomRow>[]>(() => {
    if (!isAdmin) return dataColumns;
    return [
      {
        key: "_select" as keyof FlatBomRow,
        label: "",
        width: 40,
        hideable: false,
        sortable: false,
        render: (_v, row) => (
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            onChange={e => { e.stopPropagation(); toggleRow(row.id); }}
            onClick={e => e.stopPropagation()}
            style={{ cursor: "pointer", width: "1rem", height: "1rem" }}
          />
        ),
      },
      ...dataColumns,
    ];
  }, [isAdmin, selected]);

  // ── Bulk flip handlers — Active / Approved on every ticked row ──────────
  // Each runs one UPDATE against bom_headers with .in("id", [...selected]).
  // We confirm() on the destructive direction (deactivate / unapprove) so a
  // mis-click on a big selection doesn't silently nuke a week of work.
  async function bulkSetActive(isActive: boolean) {
    if (selected.size === 0) return;
    const verb = isActive ? "Activate" : "Deactivate";
    if (!isActive && !confirm(`Deactivate ${selected.size} BOM${selected.size !== 1 ? "s" : ""}? Items pointing at deactivated BOMs will no longer explode in MRP.`)) return;
    setBulkWorking(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("bom_headers")
      .update({ is_active: isActive })
      .in("id", Array.from(selected));
    setBulkWorking(false);
    if (error) { alert(`${verb} failed: ${error.message}`); return; }
    setSelected(new Set());
    router.refresh();
  }

  async function bulkSetApproved(approve: boolean) {
    if (selected.size === 0) return;
    if (!approve && !confirm(`Unapprove ${selected.size} BOM${selected.size !== 1 ? "s" : ""}? They'll go back to Draft and won't be usable on the floor.`)) return;
    setBulkWorking(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const payload = approve
      ? { approved_at: new Date().toISOString(), approved_by: userId }
      : { approved_at: null, approved_by: null };
    const { error } = await supabase
      .from("bom_headers")
      .update(payload)
      .in("id", Array.from(selected));
    setBulkWorking(false);
    if (error) { alert(`${approve ? "Approve" : "Unapprove"} failed: ${error.message}`); return; }
    setSelected(new Set());
    router.refresh();
  }

  // Bulk save: convert each derived field back to its DB shape, then update
  // bom_headers row-by-row in parallel. Approving stamps approved_at +
  // approved_by; unapproving clears both.
  async function handleBulkSave(
    changes: { id: string; fields: Record<string, unknown> }[],
  ): Promise<string | null> {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const errors: string[] = [];

    await Promise.all(changes.map(async ({ id, fields }) => {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (k === "yield_percent") {
          const n = v !== "" && v != null ? parseFloat(String(v)) : NaN;
          if (!isFinite(n)) continue;
          // Clamp to a sane range so a fat-finger 950 doesn't write 9.5 factor.
          const clamped = Math.max(0, Math.min(200, n));
          payload.yield_factor = clamped / 100;
        } else if (k === "reference_batch_size") {
          const n = v !== "" && v != null ? parseFloat(String(v)) : NaN;
          if (!isFinite(n) || n <= 0) continue;
          payload.reference_batch_size = n;
        } else if (k === "reference_batch_unit") {
          if (!v) continue;
          payload.reference_batch_unit = String(v);
        } else if (k === "active_str") {
          payload.is_active = String(v) === "yes";
        } else if (k === "approved_str") {
          if (String(v) === "yes") {
            payload.approved_at = new Date().toISOString();
            if (userId) payload.approved_by = userId;
          } else {
            payload.approved_at = null;
            payload.approved_by = null;
          }
        }
      }
      if (Object.keys(payload).length === 0) return;
      const { error } = await supabase.from("bom_headers").update(payload).eq("id", id);
      if (error) errors.push(`${id.slice(0, 8)}: ${error.message}`);
    }));

    if (errors.length > 0) return errors[0];
    // Pull fresh server data so the read-only render reflects new values.
    router.refresh();
    return null;
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Search bar */}
      <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4", display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: "360px" }}>
          <svg style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#a8a29e" }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="form-input"
            placeholder="Search by item name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: "2rem", fontSize: "0.875rem" }}
          />
        </div>
        <span style={{ fontSize: "0.8125rem", color: "#a8a29e", whiteSpace: "nowrap" }}>
          {filtered.length} of {boms.length}
        </span>
        {isAdmin && (
          <span style={{
            fontSize: "0.75rem", color: "#78716c", marginLeft: "auto",
            display: "inline-flex", alignItems: "center", gap: "0.375rem",
          }}>
            <span aria-hidden>✎</span>
            Click <strong style={{ color: "#1c1917" }}>Edit Grid</strong> below to bulk-edit Batch Size, Unit, Yield %, Active &amp; Approved.
          </span>
        )}
      </div>

      {/* ── Bulk action toolbar (admin) ─────────────────────────────────
          Appears only when 1+ rows are ticked. Click any of the four buttons
          to flip Active / Approved on every selected row at once. Independent
          from the inline "Edit Grid" mode below — use whichever fits the job. */}
      {isAdmin && (
        <div style={{
          padding: "0.5rem 1rem",
          borderBottom: someSelected ? "1px solid #e7e5e4" : "1px dashed #f5f5f4",
          background: someSelected ? "#fefce8" : "transparent",
          display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
          minHeight: "2.25rem",
        }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#78716c", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAllFiltered}
              style={{ cursor: "pointer", width: "1rem", height: "1rem" }}
            />
            Select all visible ({filtered.length})
          </label>
          {someSelected ? (
            <>
              <span style={{ fontSize: "0.8125rem", color: "#92400e", fontWeight: 600 }}>
                {selected.size} selected
              </span>
              <span style={{ color: "#d6d3d1" }}>·</span>
              <button onClick={() => bulkSetActive(true)}    disabled={bulkWorking} className="btn-secondary" style={{ fontSize: "0.75rem" }} title="Set is_active = true">✓ Activate</button>
              <button onClick={() => bulkSetActive(false)}   disabled={bulkWorking} className="btn-secondary" style={{ fontSize: "0.75rem" }} title="Set is_active = false">⊘ Deactivate</button>
              {/* Approve / Unapprove bulk buttons hidden — Tino May 2026:
                  active is the only state that matters now. */}
              <button onClick={() => setSelected(new Set())} className="btn-secondary" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>Clear selection</button>
            </>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "#a8a29e", fontStyle: "italic" }}>
              Tick rows to bulk-flip Active without entering Edit Grid mode.
            </span>
          )}
        </div>
      )}

      {/* Type tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e7e5e4", overflowX: "auto" }}>
        {BOM_TYPE_TABS.map(tab => {
          const count = tab.value === "all" ? boms.length : boms.filter(b => b.item?.item_type === tab.value).length;
          const isActive = activeType === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveType(tab.value)}
              style={{
                padding: "0.5rem 0.875rem", fontSize: "0.8125rem",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#b91c1c" : "#78716c",
                background: "transparent", border: "none",
                borderBottom: isActive ? "2px solid #b91c1c" : "2px solid transparent",
                cursor: "pointer", whiteSpace: "nowrap", marginBottom: "-1px",
              }}
            >
              {tab.label}
              <span style={{ marginLeft: "0.375rem", fontSize: "0.75rem", color: isActive ? "#b91c1c" : "#a8a29e" }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={flat}
        href={(row) => `/bom/${row.id}`}
        onBulkSave={isAdmin ? handleBulkSave : undefined}
        storageKey="bom.v1"
        emptyMessage={search || activeType !== "all" ? "No BOMs match your search." : "No BOMs found."}
        emptyHref={search || activeType !== "all" ? undefined : "/bom/new"}
        emptyLabel={search || activeType !== "all" ? undefined : "Create your first BOM →"}
      />
    </div>
  );
}
