"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DAY_NAMES } from "@/lib/types";

interface Schedule { id: string; week_start: string; status: string }
interface RawMaterial { id: string; code: string; name: string; category: string | null; unit: string; current_stock: number; min_stock_level: number; spec_allergens: string | null; spec_storage_temp: string | null; spec_shelf_life: string | null; supplier: string | null }
interface Product { id: string; code: string; name: string; category: string | null; unit: string; current_stock: number; spec_allergens: string | null; spec_storage_temp: string | null; spec_shelf_life: string | null; batch_size: number; batch_unit: string }

interface Props {
  schedules: Schedule[];
  rawMaterials: RawMaterial[];
  products: Product[];
}

function downloadCSV(filename: string, rows: string[][]) {
  const content = rows.map(r => r.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsClient({ schedules, rawMaterials, products }: Props) {
  const supabase = createClient();
  const [selectedScheduleId, setSelectedScheduleId] = useState(schedules[0]?.id ?? "");
  const [loading, setLoading] = useState(false);

  function formatWeek(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }

  // Export raw material specs
  function exportRawMaterialSpecs() {
    const headers = ["Code", "Name", "Category", "Supplier", "Unit", "Origin", "Fat Content", "Protein", "Moisture", "pH", "Microbiological", "Allergens", "Storage Temp", "Shelf Life", "Notes"];
    const rows = rawMaterials.map(m => [
      m.code, m.name, m.category ?? "", m.supplier ?? "", m.unit,
      (m as Record<string, unknown>).spec_origin as string ?? "",
      (m as Record<string, unknown>).spec_fat_content as string ?? "",
      (m as Record<string, unknown>).spec_protein as string ?? "",
      (m as Record<string, unknown>).spec_moisture as string ?? "",
      (m as Record<string, unknown>).spec_ph as string ?? "",
      (m as Record<string, unknown>).spec_microbiological as string ?? "",
      m.spec_allergens ?? "", m.spec_storage_temp ?? "",
      m.spec_shelf_life ?? "",
      (m as Record<string, unknown>).spec_notes as string ?? "",
    ]);
    downloadCSV("raw-material-specs.csv", [headers, ...rows]);
  }

  // Export finished product specs
  function exportProductSpecs() {
    const headers = ["Code", "Name", "Category", "Unit", "Batch Size", "Batch Unit", "Weight/Unit", "Fat Content", "Protein", "Moisture", "pH", "Water Activity", "Allergens", "Storage Temp", "Shelf Life", "Packaging", "Labelling", "Notes"];
    const rows = products.map(p => [
      p.code, p.name, p.category ?? "", p.unit,
      String(p.batch_size), p.batch_unit,
      (p as Record<string, unknown>).spec_weight_per_unit as string ?? "",
      (p as Record<string, unknown>).spec_fat_content as string ?? "",
      (p as Record<string, unknown>).spec_protein as string ?? "",
      (p as Record<string, unknown>).spec_moisture as string ?? "",
      (p as Record<string, unknown>).spec_ph as string ?? "",
      (p as Record<string, unknown>).spec_water_activity as string ?? "",
      p.spec_allergens ?? "", p.spec_storage_temp ?? "", p.spec_shelf_life ?? "",
      (p as Record<string, unknown>).spec_packaging as string ?? "",
      (p as Record<string, unknown>).spec_labelling as string ?? "",
      (p as Record<string, unknown>).spec_notes as string ?? "",
    ]);
    downloadCSV("finished-product-specs.csv", [headers, ...rows]);
  }

  // Export inventory
  function exportInventory() {
    const headers = ["Type", "Code", "Name", "Category", "Current Stock", "Unit", "Min Level", "Status"];
    const rmRows = rawMaterials.map(m => ["Raw Material", m.code, m.name, m.category ?? "", String(m.current_stock), m.unit, String(m.min_stock_level), m.current_stock <= m.min_stock_level ? "Low" : "OK"]);
    const fgRows = products.map(p => ["Finished Product", p.code, p.name, p.category ?? "", String(p.current_stock), p.unit, "", ""]);
    downloadCSV("inventory-report.csv", [headers, ...rmRows, ...fgRows]);
  }

  // Export production schedule
  async function exportSchedule() {
    if (!selectedScheduleId) return;
    setLoading(true);
    const { data: items } = await supabase
      .from("schedule_items")
      .select("*, product:products(name, code)")
      .eq("schedule_id", selectedScheduleId)
      .order("day_of_week");

    const schedule = schedules.find(s => s.id === selectedScheduleId);
    const weekStart = schedule?.week_start ? formatWeek(schedule.week_start) : "Unknown";

    const headers = ["Day", "Product Code", "Product Name", "Planned Qty", "Actual Qty", "Unit", "Status", "Notes"];
    const rows = (items ?? []).map(i => [
      DAY_NAMES[i.day_of_week] ?? "",
      (i.product as Record<string, unknown>)?.code as string ?? "",
      (i.product as Record<string, unknown>)?.name as string ?? "",
      String(i.planned_quantity),
      i.actual_quantity != null ? String(i.actual_quantity) : "",
      i.unit, i.status, i.notes ?? "",
    ]);

    downloadCSV(`production-schedule-${weekStart.replace(/\s/g, "-")}.csv`, [headers, ...rows]);
    setLoading(false);
  }

  const reportCards = [
    {
      title: "Raw Material Specifications",
      description: "Export all raw material specs including origin, nutritional data, allergens, and storage requirements.",
      action: exportRawMaterialSpecs,
      label: "Download CSV",
      count: rawMaterials.length,
      countLabel: "materials",
      color: "#d97706",
    },
    {
      title: "Finished Product Specifications",
      description: "Export all finished product specs including nutritional data, packaging, labelling, and shelf life.",
      action: exportProductSpecs,
      label: "Download CSV",
      count: products.length,
      countLabel: "products",
      color: "#0284c7",
    },
    {
      title: "Inventory Report",
      description: "Export current stock levels for all raw materials and finished products with low-stock indicators.",
      action: exportInventory,
      label: "Download CSV",
      count: rawMaterials.length + products.length,
      countLabel: "items",
      color: "#16a34a",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Standard reports */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.25rem" }}>
        {reportCards.map(card => (
          <div key={card.title} className="card" style={{ borderTop: `3px solid ${card.color}` }}>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem" }}>{card.title}</h2>
            <p style={{ fontSize: "0.875rem", color: "#78716c", marginTop: 0, marginBottom: "1rem" }}>{card.description}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8125rem", color: "#a8a29e" }}>{card.count} {card.countLabel}</span>
              <button onClick={card.action} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {card.label}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Schedule export */}
      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem" }}>Production Schedule Export</h2>
        <p style={{ fontSize: "0.875rem", color: "#78716c", marginTop: 0, marginBottom: "1.25rem" }}>
          Select a week to export the full production schedule with planned and actual quantities.
        </p>
        {schedules.length === 0 ? (
          <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No schedules found.</p>
        ) : (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Select Week</label>
              <select className="form-select" value={selectedScheduleId} onChange={e => setSelectedScheduleId(e.target.value)}>
                {schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    Week of {formatWeek(s.week_start)} — {s.status}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={exportSchedule} disabled={loading || !selectedScheduleId} className="btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {loading ? "Exporting…" : "Download CSV"}
            </button>
          </div>
        )}
      </div>

      {/* CSV Import info */}
      <div className="card" style={{ borderLeft: "3px solid #0284c7", background: "#f0f9ff" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", marginTop: 0, marginBottom: "0.5rem", color: "#0c4a6e" }}>
          Importing Existing Data
        </h2>
        <p style={{ fontSize: "0.875rem", color: "#075985", marginTop: 0, marginBottom: "0.75rem" }}>
          When you&apos;re ready to import your existing data from CSV files, use the Supabase table editor to bulk-insert rows directly, or ask for an import tool to be built. The expected CSV formats for each table are available from the exports above.
        </p>
        <p style={{ fontSize: "0.8125rem", color: "#0369a1", margin: 0 }}>
          <strong>Tables to populate:</strong> raw_materials, products, recipe_ingredients, production_schedules, schedule_items
        </p>
      </div>
    </div>
  );
}
