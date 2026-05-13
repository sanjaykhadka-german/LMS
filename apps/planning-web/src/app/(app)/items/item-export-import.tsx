"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// Column definitions
// ─────────────────────────────────────────────────────────────────────────────
//
// `key` is either a column on `items` or a virtual key resolved via join
// ("category" / "subcategory"). `type` drives parsing on import.
// `required: true` means the user can't untick it on the export selector
// (currently only `code`, since it's the match key for re-import).
// ─────────────────────────────────────────────────────────────────────────────

type Group =
  | "identity" | "classification" | "units" | "stock"
  | "production" | "pack" | "pricing" | "spec" | "micro" | "nutrition" | "other";

type ColType = "text" | "number" | "integer" | "boolean" | "array";

type ColumnDef = {
  key: string;
  label: string;
  group: Group;
  type: ColType;
  required?: boolean;
  defaultOn?: boolean;
};

const COLUMN_DEFS: ColumnDef[] = [
  { key: "code",                 label: "Code",                          group: "identity",       type: "text",    required: true, defaultOn: true },
  { key: "name",                 label: "Name",                          group: "identity",       type: "text",    defaultOn: true },
  { key: "item_number_upload",   label: "Item Number (upload)",          group: "identity",       type: "text",    defaultOn: true },

  { key: "item_type",            label: "Item Type",                     group: "classification", type: "text",    defaultOn: true },
  { key: "procurement_type",     label: "Procurement Type",              group: "classification", type: "text",    defaultOn: true },
  { key: "category",             label: "Category",                      group: "classification", type: "text",    defaultOn: true },
  { key: "subcategory",          label: "Subcategory",                   group: "classification", type: "text",    defaultOn: true },
  { key: "department",           label: "Department",                    group: "classification", type: "text",    defaultOn: true },
  { key: "description",          label: "Description",                   group: "classification", type: "text",    defaultOn: true },

  { key: "unit",                 label: "Stock Unit",                    group: "units",          type: "text",    defaultOn: true },
  { key: "default_batch_size",   label: "Default Batch Size",            group: "units",          type: "number",  defaultOn: true },
  { key: "batch_unit",           label: "Batch Unit",                    group: "units",          type: "text",    defaultOn: true },

  { key: "current_stock",        label: "Current Stock",                 group: "stock",          type: "number" },
  { key: "min_stock",            label: "Min Stock",                     group: "stock",          type: "number",  defaultOn: true },
  { key: "max_stock",            label: "Max Stock",                     group: "stock",          type: "number",  defaultOn: true },
  { key: "is_make_to_order",     label: "Make to Order",                 group: "stock",          type: "boolean", defaultOn: true },
  { key: "is_active",            label: "Active",                        group: "stock",          type: "boolean", defaultOn: true },
  { key: "min_shelf_life_days",  label: "Min Shelf Life (days)",         group: "stock",          type: "integer" },

  { key: "priority",             label: "Priority",                      group: "production",     type: "number",  defaultOn: true },
  { key: "production_method",    label: "Production Method",             group: "production",     type: "text",    defaultOn: true },
  { key: "machine",              label: "Machine",                       group: "production",     type: "text",    defaultOn: true },
  { key: "room",                 label: "Room",                          group: "production",     type: "text",    defaultOn: true },

  { key: "weight_mode",          label: "Weight Mode",                   group: "pack",           type: "text",    defaultOn: true },
  { key: "target_weight_g",      label: "Target Weight per Piece (g)",   group: "pack",           type: "number" },
  { key: "fill_weight_g",        label: "Fill Weight (g)",               group: "pack",           type: "number" },
  { key: "process_loss_pct",     label: "Process Loss (%)",              group: "pack",           type: "number" },
  { key: "tare_weight_g",        label: "Tare Weight (g)",               group: "pack",           type: "number" },
  { key: "tolerance_over_g",     label: "Tolerance Over (g)",            group: "pack",           type: "number" },
  { key: "tolerance_under_g",    label: "Tolerance Under (g)",           group: "pack",           type: "number" },
  { key: "units_per_inner",      label: "Pieces per Inner",              group: "pack",           type: "integer" },
  { key: "inner_per_outer",      label: "Inners per Outer",              group: "pack",           type: "integer" },
  // Derived (DB trigger) — included in export so spreadsheets show the totals,
  // but ignored on import (any value provided is overwritten by the trigger).
  { key: "units_per_outer",      label: "Pieces per Outer (derived)",    group: "pack",           type: "integer" },
  { key: "outers_per_pallet",    label: "Outers per Pallet",             group: "pack",           type: "integer" },
  { key: "units_per_pallet",     label: "Pieces per Pallet (derived)",   group: "pack",           type: "integer" },
  { key: "giveaway_pct",         label: "Giveaway %",                    group: "pack",           type: "number" },
  { key: "packaging_materials",  label: "Packaging Materials",           group: "pack",           type: "array" },

  { key: "sell_price_per_inner", label: "Sell Price per Inner",          group: "pricing",        type: "number" },
  { key: "sell_price_per_kg",    label: "Sell Price per kg",             group: "pricing",        type: "number" },
  { key: "purchase_unit_price",  label: "Purchase Unit Price",           group: "pricing",        type: "number" },
  { key: "purchase_currency",    label: "Purchase Currency",             group: "pricing",        type: "text" },
  { key: "purchase_uom",         label: "Purchase UOM",                  group: "pricing",        type: "text" },
  { key: "purchase_uom_qty",     label: "Purchase UOM Qty",              group: "pricing",        type: "number" },
  { key: "purchase_uom_type",    label: "Purchase UOM Type",             group: "pricing",        type: "text" },
  { key: "purchase_account_code",label: "Purchase Account Code",         group: "pricing",        type: "text" },
  { key: "sales_account_code",   label: "Sales Account Code",            group: "pricing",        type: "text" },
  { key: "supplier",             label: "Supplier (legacy text)",        group: "pricing",        type: "text" },
  { key: "supplier_code",        label: "Supplier Code (legacy text)",   group: "pricing",        type: "text" },

  { key: "allergens",            label: "Allergens",                     group: "other",          type: "array",   defaultOn: true },
  { key: "is_rte",               label: "Ready-to-Eat (RTE)",            group: "other",          type: "boolean" },
  { key: "ingredients_statement",label: "Ingredients Statement",         group: "other",          type: "text" },

  { key: "spec_storage_temp",    label: "Spec: Storage Temp",            group: "spec",           type: "text",    defaultOn: true },
  { key: "spec_shelf_life",      label: "Spec: Shelf Life",              group: "spec",           type: "text",    defaultOn: true },
  { key: "spec_notes",           label: "Spec: Notes",                   group: "spec",           type: "text",    defaultOn: true },
  { key: "spec_origin",          label: "Spec: Origin",                  group: "spec",           type: "text" },
  { key: "spec_fat_content",     label: "Spec: Fat Content",             group: "spec",           type: "text" },
  { key: "spec_protein",         label: "Spec: Protein",                 group: "spec",           type: "text" },
  { key: "spec_moisture",        label: "Spec: Moisture",                group: "spec",           type: "text" },
  { key: "spec_ph",              label: "Spec: pH",                      group: "spec",           type: "text" },
  { key: "spec_water_activity",  label: "Spec: Water Activity",          group: "spec",           type: "text" },
  { key: "spec_micro",           label: "Spec: Microbiological",         group: "spec",           type: "text" },
  { key: "spec_packaging",       label: "Spec: Packaging",               group: "spec",           type: "text" },
  { key: "spec_labelling",       label: "Spec: Labelling",               group: "spec",           type: "text" },
  { key: "spec_weight_per_unit", label: "Spec: Weight per Unit",         group: "spec",           type: "text" },

  { key: "micro_tpc",                label: "Micro: TPC",                          group: "micro",          type: "text" },
  { key: "micro_ecoli",              label: "Micro: E. coli",                      group: "micro",          type: "text" },
  { key: "micro_coliforms",          label: "Micro: Coliforms",                    group: "micro",          type: "text" },
  { key: "micro_salmonella",         label: "Micro: Salmonella",                   group: "micro",          type: "text" },
  { key: "micro_listeria",           label: "Micro: Listeria",                     group: "micro",          type: "text" },
  { key: "micro_s_aureus",           label: "Micro: S. aureus",                    group: "micro",          type: "text" },
  { key: "micro_yeast_mould",        label: "Micro: Yeast & Mould",                group: "micro",          type: "text" },
  { key: "micro_sulphite_clostridia",label: "Micro: Sulphite-reducing Clostridia", group: "micro",          type: "text" },
  { key: "micro_reference",          label: "Micro: Reference / Standard",         group: "micro",          type: "text" },

  { key: "nut_energy_kj",        label: "Nutrition: Energy (kJ)",        group: "nutrition",      type: "number" },
  { key: "nut_energy_kcal",      label: "Nutrition: Energy (kcal)",      group: "nutrition",      type: "number" },
  { key: "nut_protein_g",        label: "Nutrition: Protein (g)",        group: "nutrition",      type: "number" },
  { key: "nut_fat_total_g",      label: "Nutrition: Fat Total (g)",      group: "nutrition",      type: "number" },
  { key: "nut_fat_saturated_g",  label: "Nutrition: Fat Saturated (g)",  group: "nutrition",      type: "number" },
  { key: "nut_fat_trans_g",      label: "Nutrition: Fat Trans (g)",      group: "nutrition",      type: "number" },
  { key: "nut_carbs_total_g",    label: "Nutrition: Carbs Total (g)",    group: "nutrition",      type: "number" },
  { key: "nut_carbs_sugars_g",   label: "Nutrition: Sugars (g)",         group: "nutrition",      type: "number" },
  { key: "nut_fibre_g",          label: "Nutrition: Fibre (g)",          group: "nutrition",      type: "number" },
  { key: "nut_sodium_mg",        label: "Nutrition: Sodium (mg)",        group: "nutrition",      type: "number" },
  { key: "nut_per_serving_g",    label: "Nutrition: Serving Size (g)",   group: "nutrition",      type: "number" },
  { key: "nut_notes",            label: "Nutrition: Notes",              group: "nutrition",      type: "text" },
];

const GROUP_LABELS: Record<Group, string> = {
  identity: "Identity", classification: "Classification", units: "Units & Batch", stock: "Stock",
  production: "Production", pack: "Pack & Weights", pricing: "Pricing", spec: "Specification",
  micro: "Microbiological Limits", nutrition: "Nutrition (per 100g)", other: "Other",
};

const GROUP_ORDER: Group[] = [
  "identity", "classification", "units", "stock", "production",
  "pack", "pricing", "other", "spec", "micro", "nutrition",
];

const STORAGE_KEY = "items.exportCols.v1";

const ALL_DB_COLS: string[] = [
  ...COLUMN_DEFS.filter(c => c.key !== "category" && c.key !== "subcategory").map(c => c.key),
  "item_category_id", "item_subcategory_id",
];

const EXAMPLE_VALUES: Record<string, string> = {
  code: "RM001", name: "Pork Shoulder", item_number_upload: "1004.5000",
  item_type: "raw_material", procurement_type: "purchase", category: "Meat", subcategory: "Pork",
  description: "Bone-in pork shoulder for sausage production", department: "Receiving", unit: "kg",
  default_batch_size: "100", batch_unit: "kg", min_stock: "50", max_stock: "500",
  is_make_to_order: "no", is_active: "yes", priority: "5", weight_mode: "random",
  spec_shelf_life: "5 days", spec_storage_temp: "0-4C",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ItemExportImport() {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; unchanged: number; errors: string[] } | null>(null);
  const [showCols, setShowCols] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelected());
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        const next = new Set(arr.filter(k => COLUMN_DEFS.some(c => c.key === k)));
        for (const c of COLUMN_DEFS) if (c.required) next.add(c.key);
        setSelected(next);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!showCols) return;
    function onDoc(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setShowCols(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showCols]);

  function persistSelection(next: Set<string>) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }
  function toggleColumn(key: string) {
    const def = COLUMN_DEFS.find(c => c.key === key);
    if (def?.required) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistSelection(next);
      return next;
    });
  }
  function selectAll()      { const n = new Set(COLUMN_DEFS.map(c => c.key)); setSelected(n); persistSelection(n); }
  function selectNone()     { const n = new Set<string>(); for (const c of COLUMN_DEFS) if (c.required) n.add(c.key); setSelected(n); persistSelection(n); }
  function selectDefaults() { const n = new Set<string>(); for (const c of COLUMN_DEFS) if (c.defaultOn || c.required) n.add(c.key); setSelected(n); persistSelection(n); }

  // ─── Export ────────────────────────────────────────────────────────────────

  async function exportSelected() {
    setExporting(true);
    try {
      const dbCols = [...selected].filter(k => k !== "category" && k !== "subcategory");
      const needsCategory = selected.has("category");
      const needsSubcategory = selected.has("subcategory");
      const dbColSet = new Set<string>(["code", ...dbCols]);
      const selectParts: string[] = [...dbColSet];
      if (needsCategory)    selectParts.push("item_category:item_category_id(name)");
      if (needsSubcategory) selectParts.push("item_subcategory:item_subcategory_id(name)");

      const { data, error } = await supabase
        .from("items")
        .select(selectParts.join(", "))
        .order("item_type")
        .order("code")
        .range(0, 9999);
      if (error) throw new Error(error.message);

      const headers = COLUMN_DEFS.filter(c => selected.has(c.key)).map(c => c.key);
      const rows = (data ?? []).map((r: any) => {
        const row: Record<string, unknown> = {};
        for (const h of headers) {
          if (h === "category")          row.category    = r.item_category?.name ?? "";
          else if (h === "subcategory")  row.subcategory = r.item_subcategory?.name ?? "";
          else if (h === "allergens")    row.allergens   = Array.isArray(r.allergens) ? r.allergens.join(", ") : (r.allergens ?? "");
          else if (h === "is_make_to_order" || h === "is_active") row[h] = r[h] ? "yes" : "no";
          else                            row[h] = r[h] ?? "";
        }
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      applyColumnWidths(ws, headers);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Items");
      XLSX.writeFile(wb, `items_${new Date().toISOString().slice(0, 10)}.xlsx`);
      setShowCols(false);
    } catch (err) {
      setResult({ created: 0, updated: 0, unchanged: 0, errors: [String(err)] });
    } finally {
      setExporting(false);
    }
  }

  function downloadTemplate() {
    const headers = COLUMN_DEFS.filter(c => selected.has(c.key)).map(c => c.key);
    const example: Record<string, string> = {};
    for (const h of headers) example[h] = EXAMPLE_VALUES[h] ?? "";
    const ws = XLSX.utils.json_to_sheet([example], { header: headers });
    applyColumnWidths(ws, headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "items_import_template.xlsx");
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles").select("tenant_id").eq("id", user!.id).single();
      const tenantId = profile!.tenant_id;

      const { headers: sheetHeaders, rows } = await parseFile(file);
      const knownKeys = new Set(COLUMN_DEFS.map(c => c.key));
      const presentCols = sheetHeaders.filter(h => knownKeys.has(h));
      const presentSet = new Set(presentCols);

      if (!presentSet.has("code")) {
        setResult({ created: 0, updated: 0, unchanged: 0, errors: ["Sheet must include a 'code' column"] });
        return;
      }

      const { data: itemTypesData } = await supabase
        .from("item_types").select("code").eq("is_active", true);
      const validTypes = new Set((itemTypesData ?? []).map(t => t.code));
      const validProcurement = new Set(["purchase", "produce"]);
      const validWeightMode  = new Set(["fixed", "random"]);
      const validUomType     = new Set(["fixed", "average"]);

      const { data: catsData } = await supabase
        .from("item_categories").select("id, name").eq("tenant_id", tenantId).eq("is_active", true);
      const { data: subcatsData } = await supabase
        .from("item_subcategories").select("id, category_id, name").eq("tenant_id", tenantId).eq("is_active", true);
      const catByName    = new Map((catsData ?? []).map(c => [c.name.toLowerCase(), c.id]));
      const catNameById  = new Map((catsData ?? []).map(c => [c.id, c.name]));
      const subcatByNameAndCat = new Map(
        (subcatsData ?? []).map(s => [`${s.category_id}::${s.name.toLowerCase()}`, s.id])
      );

      // Bulk-fetch existing items by code (chunked) so we can diff per-field.
      const codes = rows.map(r => String(r.code ?? "").trim().toUpperCase()).filter(Boolean);
      const existingByCode = new Map<string, any>();
      for (let i = 0; i < codes.length; i += 500) {
        const chunk = codes.slice(i, i + 500);
        const { data: existing } = await supabase
          .from("items")
          .select(ALL_DB_COLS.join(", "))
          .eq("tenant_id", tenantId)
          .in("code", chunk);
        for (const e of (existing ?? [])) existingByCode.set((e as any).code, e);
      }

      let created = 0, updated = 0, unchanged = 0;
      const errors: string[] = [];

      for (const [i, row] of rows.entries()) {
        const code = String(row.code ?? "").trim().toUpperCase();
        if (!code) { errors.push(`Row ${i + 2}: 'code' is empty`); continue; }
        const existing = existingByCode.get(code);

        const parsed: Record<string, any> = {};
        let rowError: string | null = null;

        for (const col of presentCols) {
          if (col === "code") continue;
          const raw = row[col];
          const def = COLUMN_DEFS.find(c => c.key === col)!;

          if (col === "category") {
            const v = String(raw ?? "").trim();
            if (v === "") { parsed.item_category_id = null; }
            else {
              const id = catByName.get(v.toLowerCase());
              if (!id) { rowError = `category "${v}" not found`; break; }
              parsed.item_category_id = id;
            }
            continue;
          }
          if (col === "subcategory") {
            const v = String(raw ?? "").trim();
            if (v === "") { parsed.item_subcategory_id = null; }
            else {
              const catId = ("item_category_id" in parsed ? parsed.item_category_id : existing?.item_category_id) ?? null;
              if (!catId) { rowError = `subcategory "${v}" requires a category`; break; }
              const id = subcatByNameAndCat.get(`${catId}::${v.toLowerCase()}`);
              if (!id) {
                const catName = catNameById.get(catId) ?? "(unknown)";
                rowError = `subcategory "${v}" not found under "${catName}"`;
                break;
              }
              parsed.item_subcategory_id = id;
            }
            continue;
          }

          if (col === "item_type") {
            const v = String(raw ?? "").trim().toLowerCase();
            if (v === "") { parsed.item_type = null; continue; }
            if (!validTypes.has(v)) { rowError = `item_type "${v}" not found`; break; }
            parsed.item_type = v; continue;
          }
          if (col === "procurement_type") {
            const v = String(raw ?? "").trim().toLowerCase();
            if (v === "") { parsed.procurement_type = null; continue; }
            if (!validProcurement.has(v)) { rowError = `procurement_type must be 'purchase' or 'produce'`; break; }
            parsed.procurement_type = v; continue;
          }
          if (col === "weight_mode") {
            const v = String(raw ?? "").trim().toLowerCase();
            if (v === "") { parsed.weight_mode = null; continue; }
            if (!validWeightMode.has(v)) { rowError = `weight_mode must be 'fixed' or 'random'`; break; }
            parsed.weight_mode = v; continue;
          }
          if (col === "purchase_uom_type") {
            const v = String(raw ?? "").trim().toLowerCase();
            if (v === "") { parsed.purchase_uom_type = null; continue; }
            if (!validUomType.has(v)) { rowError = `purchase_uom_type must be 'fixed' or 'average'`; break; }
            parsed.purchase_uom_type = v; continue;
          }

          parsed[col] = parseByType(raw, def.type);
        }

        if (rowError) { errors.push(`Row ${i + 2} (${code}): ${rowError}`); continue; }

        if (existing) {
          const updateFields: Record<string, any> = {};
          for (const k of Object.keys(parsed)) {
            const before = (existing as any)[k] ?? null;
            const after  = parsed[k] ?? null;
            if (!valuesEqual(before, after)) updateFields[k] = after;
          }
          if (Object.keys(updateFields).length === 0) { unchanged++; continue; }
          const { error } = await supabase
            .from("items").update(updateFields)
            .eq("tenant_id", tenantId).eq("code", code);
          if (error) errors.push(`Row ${i + 2} (${code}): ${error.message}`);
          else updated++;
        } else {
          const name = parsed.name ?? null;
          const itemType = parsed.item_type ?? null;
          if (!name)     { errors.push(`Row ${i + 2} (${code}): 'name' is required for new items`); continue; }
          if (!itemType) { errors.push(`Row ${i + 2} (${code}): 'item_type' is required for new items`); continue; }
          const insertRow = { tenant_id: tenantId, code, ...parsed };
          const { error } = await supabase.from("items").insert(insertRow);
          if (error) errors.push(`Row ${i + 2} (${code}): ${error.message}`);
          else created++;
        }
      }

      setResult({ created, updated, unchanged, errors });
    } catch (err) {
      setResult({ created: 0, updated: 0, unchanged: 0, errors: [String(err)] });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const totalSel = selected.size;
  const totalAvail = COLUMN_DEFS.length;

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", position: "relative" }}>
      <div style={{ position: "relative" }} ref={popoverRef}>
        <button onClick={() => setShowCols(s => !s)} className="btn-secondary" style={{ fontSize: "0.8125rem" }} disabled={exporting}>
          Export {totalSel < totalAvail ? `(${totalSel}/${totalAvail} cols)` : ""} ▾
        </button>
        {showCols && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
            width: 360, maxHeight: 480, overflowY: "auto",
            background: "white", border: "1px solid #d6d3d1", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "0.75rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <strong style={{ fontSize: "0.875rem" }}>Choose columns</strong>
              <span style={{ fontSize: "0.75rem", color: "#78716c" }}>{totalSel} of {totalAvail}</span>
            </div>
            <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <button onClick={selectAll}      className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>All</button>
              <button onClick={selectNone}     className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>None</button>
              <button onClick={selectDefaults} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Defaults</button>
            </div>
            {GROUP_ORDER.map(group => {
              const cols = COLUMN_DEFS.filter(c => c.group === group);
              if (cols.length === 0) return null;
              return (
                <div key={group} style={{ marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#78716c", margin: "0.25rem 0" }}>
                    {GROUP_LABELS[group]}
                  </div>
                  {cols.map(c => (
                    <label key={c.key} style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.125rem 0", fontSize: "0.8125rem",
                      cursor: c.required ? "not-allowed" : "pointer",
                      opacity: c.required ? 0.6 : 1,
                    }}>
                      <input type="checkbox" checked={selected.has(c.key)} disabled={!!c.required} onChange={() => toggleColumn(c.key)} />
                      <span>{c.label}</span>
                      {c.required && <span style={{ fontSize: "0.7rem", color: "#78716c" }}>(required)</span>}
                    </label>
                  ))}
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem", borderTop: "1px solid #e7e5e4", paddingTop: "0.5rem" }}>
              <button onClick={() => setShowCols(false)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button onClick={exportSelected} className="btn-primary" style={{ fontSize: "0.8125rem" }} disabled={exporting}>
                {exporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        )}
      </div>

      <button onClick={downloadTemplate} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Template</button>
      <label className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer", margin: 0 }}>
        Import
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display: "none" }} disabled={importing} />
      </label>
      {importing && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>Importing...</span>}
      {result && (
        <span style={{ fontSize: "0.8125rem", color: result.errors.length ? "#dc2626" : "#15803d" }}>
          {result.created} created, {result.updated} updated, {result.unchanged} unchanged
          {result.errors.length > 0 ? `, ${result.errors.length} error(s): ${result.errors[0]}` : " ✓"}
        </span>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultSelected(): Set<string> {
  const s = new Set<string>();
  for (const c of COLUMN_DEFS) if (c.defaultOn || c.required) s.add(c.key);
  return s;
}

function applyColumnWidths(ws: XLSX.WorkSheet, cols: string[]) {
  ws["!cols"] = cols.map(c => ({ wch: Math.max(c.length + 2, 18) }));
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const headerMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
  const headers = (headerMatrix[0] ?? []).map(h => String(h ?? "").trim()).filter(Boolean);
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
  return { headers, rows };
}

function parseByType(raw: any, type: ColType): any {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  switch (type) {
    case "text":    return s;
    case "number": { const n = Number(s); return isNaN(n) ? null : n; }
    case "integer": { const n = parseInt(s, 10); return isNaN(n) ? null : n; }
    case "boolean": {
      const v = s.toLowerCase();
      if (["yes", "true", "1", "y", "t"].includes(v)) return true;
      if (["no", "false", "0", "n", "f"].includes(v)) return false;
      return null;
    }
    case "array": return s.split(/[,;]+/).map(x => x.trim()).filter(Boolean);
  }
}

function valuesEqual(a: any, b: any): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((x, i) => x === sb[i]);
  }
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (isNaN(na) && isNaN(nb)) return true;
    return na === nb;
  }
  return a === b;
}
