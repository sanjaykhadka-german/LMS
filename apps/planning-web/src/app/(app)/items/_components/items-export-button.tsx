"use client";

/**
 * Smart export button for the Item Master grid.
 *
 * Three behaviours layered on top of each other:
 *   1. FILTER-AWARE — when the user has filters set (type / category /
 *      department / search / etc), only matching items get exported.
 *      Uses the same filter URL params useItemsQuery reads.
 *   2. SELECTION-AWARE — if any row checkboxes are ticked, ONLY those
 *      rows export. Empty selection ⇒ all filtered items export.
 *   3. VISIBLE-COLUMNS-AWARE — exports only the columns currently on
 *      screen (per the column-toggle popover, persisted to
 *      localStorage under "items.v1"). Reuses the items grid's column
 *      visibility instead of duplicating a separate column picker.
 *
 * Mounts inline in the items-table toolbar so it has direct access to
 * filters / selection / column visibility — no prop drilling through
 * the page.tsx server component.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

/** Subset of the column metadata the export needs to format each cell.
 *  We pass this in from items-table.tsx where the full column defs already
 *  live, rather than duplicating column-by-column field maps here. */
export type ExportColumnSpec = {
  /** Column key — usually a column on items, or a virtual key like
   *  "category" / "subcategory" that we resolve via join below. */
  key: string;
  /** Header label rendered in the spreadsheet. */
  label: string;
  /** When true: render as "yes" / "no" instead of true / false. */
  asYesNo?: boolean;
  /** When true: stringify arrays as comma-joined text. */
  asCommaJoin?: boolean;
};

export default function ItemsExportButton({
  visibleColumns,
  selectedIds,
  selectedCount,
  totalFiltered,
  hasActiveFilters,
}: {
  visibleColumns: ExportColumnSpec[];
  /** IDs of ticked rows. Empty set ⇒ "export all filtered". */
  selectedIds: Set<string>;
  /** Convenience — same as selectedIds.size, but lets callers cheap-watch
   *  for changes without diffing the Set. */
  selectedCount: number;
  /** Count of filtered (server-side) items, displayed in the menu. */
  totalFiltered: number;
  /** Whether any filter is currently set (controls menu copy). */
  hasActiveFilters: boolean;
}) {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // ── Filter readers — mirror the URL-param shape useItemsQuery reads ──
  const filters = useMemo(() => {
    const csv = (k: string) => (searchParams.get(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
    return {
      code:    searchParams.get("code") ?? "",
      name:    searchParams.get("name") ?? "",
      desc:    searchParams.get("desc") ?? "",
      type:    csv("type"),
      cat:     csv("category"),
      subcat:  csv("subcat"),
      dept:    csv("dept"),
      suppliers: csv("suppliers"),
      status:  (searchParams.get("status") as "active" | "inactive" | "both" | null) ?? "active",
    };
  }, [searchParams]);

  /** Headers + DB column list to actually fetch from Supabase. We always
   *  include `id` (used to filter by selectedIds) and `code` (operator
   *  expects to see codes even if they unticked the column for the grid
   *  view) — the dual-purpose selection key. */
  const dbColsToFetch = useMemo(() => {
    const dbKeys = new Set<string>(["id", "code"]);
    let needsCategory = false;
    let needsSubcategory = false;
    for (const col of visibleColumns) {
      if (col.key === "category")        { needsCategory = true; continue; }
      if (col.key === "subcategory")     { needsSubcategory = true; continue; }
      // Skip virtual cost-health cols — they live in v_item_cost_health,
      // not items. Could fetch separately if needed; for the MVP export
      // we just skip them so the export query doesn't fail with
      // "column not found".
      if (col.key === "supplier_min_price" || col.key === "supplier_max_price"
       || col.key === "supplier_count"     || col.key === "is_below_cheapest") continue;
      // "_select" is the row-checkbox column on screen; skip in export.
      if (col.key === "_select") continue;
      // "item_category" is the joined relationship object; the canonical
      // column on items is item_category_id. We resolve via the category
      // join below if the operator wants the category NAME.
      if (col.key === "item_category") { needsCategory = true; continue; }
      dbKeys.add(col.key);
    }
    return { dbKeys: [...dbKeys], needsCategory, needsSubcategory };
  }, [visibleColumns]);

  async function runExport(scope: "filtered" | "selected") {
    setBusy(true);
    try {
      const sel = supabase.from("items");
      const selectParts: string[] = [...dbColsToFetch.dbKeys];
      if (dbColsToFetch.needsCategory)    selectParts.push("item_category:item_category_id(name)");
      if (dbColsToFetch.needsSubcategory) selectParts.push("item_subcategory:item_subcategory_id(name)");

      let q = sel.select(selectParts.join(", ")).order("item_type").order("code").range(0, 9999);

      // Apply filters when scope is "filtered" — selection scope skips
      // filters on purpose (operator might have selected items that don't
      // match the current filter and still want them in the export).
      if (scope === "filtered") {
        if (filters.code) q = q.ilike("code", `%${filters.code}%`);
        if (filters.name) q = q.ilike("name", `%${filters.name}%`);
        if (filters.desc) q = q.ilike("description", `%${filters.desc}%`);
        if (filters.type.length === 1)   q = q.eq("item_type", filters.type[0]);
        else if (filters.type.length > 1) q = q.in("item_type", filters.type);
        if (filters.cat.length === 1)    q = q.eq("item_category_id", filters.cat[0]);
        else if (filters.cat.length > 1) q = q.in("item_category_id", filters.cat);
        if (filters.subcat.length === 1)    q = q.eq("item_subcategory_id", filters.subcat[0]);
        else if (filters.subcat.length > 1) q = q.in("item_subcategory_id", filters.subcat);
        if (filters.dept.length === 1)    q = q.eq("department", filters.dept[0]);
        else if (filters.dept.length > 1) q = q.in("department", filters.dept);
        if (filters.status === "active")   q = q.eq("is_active", true);
        if (filters.status === "inactive") q = q.eq("is_active", false);
        if (filters.suppliers.length > 0) {
          const { data: siRows } = await supabase
            .from("supplier_items")
            .select("item_id")
            .in("supplier_id", filters.suppliers);
          const ids = [...new Set((siRows ?? []).map(r => r.item_id))];
          q = q.in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
        }
      }
      // Selection scope: short-circuit to the explicit ID list. Tiny
      // payload, ignores filter state (intentional — selection is the
      // explicit instruction).
      if (scope === "selected") {
        const ids = [...selectedIds];
        if (ids.length === 0) {
          setBusy(false);
          return;
        }
        q = q.in("id", ids);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      // Build sheet rows — skip "id" since it's the internal join key.
      const headers = visibleColumns.filter(c => c.key !== "id" && c.key !== "_select").map(c => c.label);
      const keys    = visibleColumns.filter(c => c.key !== "id" && c.key !== "_select").map(c => c.key);

      const sheet = (data ?? []).map((r) => {
        const row: Record<string, unknown> = {};
        const rec = r as Record<string, unknown> & {
          item_category?: { name: string } | null;
          item_subcategory?: { name: string } | null;
        };
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const label = headers[i];
          const col = visibleColumns.find(c => c.key === k);
          if (k === "category" || k === "item_category") {
            row[label] = rec.item_category?.name ?? "";
          } else if (k === "subcategory") {
            row[label] = rec.item_subcategory?.name ?? "";
          } else if (col?.asCommaJoin) {
            const v = rec[k];
            row[label] = Array.isArray(v) ? v.join(", ") : (v ?? "");
          } else if (col?.asYesNo) {
            row[label] = rec[k] ? "yes" : "no";
          } else {
            row[label] = rec[k] ?? "";
          }
        }
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(sheet, { header: headers });
      ws["!cols"] = headers.map(h => ({ wch: Math.max(String(h).length + 2, 18) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Items");
      const stamp = new Date().toISOString().slice(0, 10);
      const tag   = scope === "selected" ? "selected" : (hasActiveFilters ? "filtered" : "all");
      XLSX.writeFile(wb, `items_${tag}_${stamp}.xlsx`);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // Menu copy varies based on whether anything is filtered or selected.
  // Aim is the operator can see at a glance "how many rows is this going
  // to give me?" before clicking.
  const filteredLabel = hasActiveFilters
    ? `Export ${totalFiltered} filtered item${totalFiltered === 1 ? "" : "s"}`
    : `Export all ${totalFiltered} items`;

  return (
    <div style={{ position: "relative" }} ref={popRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="btn-secondary"
        style={{ fontSize: "0.8125rem" }}
        disabled={busy}
        title="Export items to Excel — uses your current filters and visible columns"
      >
        {busy ? "Exporting…" : "📥 Export"} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
          width: 320, background: "#fff", border: "1px solid #d6d3d1",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "0.5rem",
        }}>
          {/* Selection-scope option (only visible when something is selected) */}
          {selectedCount > 0 && (
            <button
              onClick={() => runExport("selected")}
              disabled={busy}
              className="btn-secondary"
              style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontSize: "0.8125rem", padding: "0.5rem 0.625rem", marginBottom: "0.375rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.15rem" }}
            >
              <span style={{ fontWeight: 600 }}>Export selected only</span>
              <span style={{ fontSize: "0.7rem", color: "#78716c" }}>{selectedCount} ticked row{selectedCount === 1 ? "" : "s"}</span>
            </button>
          )}
          {/* Filtered / all-items option (default) */}
          <button
            onClick={() => runExport("filtered")}
            disabled={busy}
            className="btn-primary"
            style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontSize: "0.8125rem", padding: "0.5rem 0.625rem", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.15rem" }}
          >
            <span style={{ fontWeight: 600 }}>{filteredLabel}</span>
            <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>
              {hasActiveFilters ? "Matches your current filters" : "No filters set — exports everything"}
            </span>
          </button>
          {/* Visible-column note — operator's expectation set */}
          <div style={{ fontSize: "0.7rem", color: "#78716c", padding: "0.5rem 0.625rem 0.25rem", lineHeight: 1.5 }}>
            Columns: {visibleColumns.filter(c => c.key !== "id" && c.key !== "_select").length} visible. Toggle columns via the <strong>Columns</strong> button on the table.
          </div>
        </div>
      )}
    </div>
  );
}
