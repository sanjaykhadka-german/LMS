"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DAY_NAMES, DAY_SHORT, type ScheduleItem, type Product } from "@/lib/types";

interface Props {
  scheduleId: string;
  weekStart: string;
  initialStatus: string;
  initialItems: ScheduleItem[];
  products: Pick<Product, "id" | "name" | "code" | "unit">[];
}

interface AddItemForm {
  dayIndex: number;
  productId: string;
  quantity: string;
  unit: string;
  notes: string;
}

export default function ScheduleEditor({ scheduleId, weekStart, initialStatus, initialItems, products }: Props) {
  const supabase = createClient();
  const [items, setItems] = useState<ScheduleItem[]>(initialItems);
  const [status, setStatus] = useState(initialStatus);
  const [showAddForm, setShowAddForm] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<AddItemForm>({ dayIndex: 0, productId: "", quantity: "", unit: "kg", notes: "" });
  const [saving, setSaving] = useState(false);

  function getDateForDay(dayIndex: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  }

  async function addItem() {
    if (!addForm.productId || !addForm.quantity) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("schedule_items")
      .insert({
        schedule_id: scheduleId,
        product_id: addForm.productId,
        day_of_week: addForm.dayIndex,
        planned_quantity: parseFloat(addForm.quantity),
        unit: addForm.unit,
        notes: addForm.notes || null,
        status: "planned",
      })
      .select("*, product:products(id, name, code, unit)")
      .single();

    if (!error && data) {
      setItems(prev => [...prev, data as ScheduleItem]);
      setShowAddForm(null);
      setAddForm({ dayIndex: 0, productId: "", quantity: "", unit: "kg", notes: "" });
    }
    setSaving(false);
  }

  async function updateItemStatus(itemId: string, newStatus: ScheduleItem["status"]) {
    await supabase.from("schedule_items").update({ status: newStatus }).eq("id", itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: newStatus } : i));
  }

  async function updateActualQty(itemId: string, qty: string) {
    const val = parseFloat(qty) || null;
    await supabase.from("schedule_items").update({ actual_quantity: val }).eq("id", itemId);
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, actual_quantity: val } : i));
  }

  async function removeItem(itemId: string) {
    await supabase.from("schedule_items").delete().eq("id", itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  }

  async function updateScheduleStatus(newStatus: string) {
    await supabase.from("production_schedules").update({ status: newStatus }).eq("id", scheduleId);
    setStatus(newStatus);
  }

  const itemStatusColors: Record<string, string> = {
    planned: "badge-gray",
    in_progress: "badge-yellow",
    completed: "badge-green",
    cancelled: "badge-red",
  };

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", alignItems: "center" }}>
        <span style={{ fontSize: "0.875rem", color: "#78716c" }}>Schedule status:</span>
        {["draft", "published", "completed"].map(s => (
          <button
            key={s}
            onClick={() => updateScheduleStatus(s)}
            className={status === s ? "btn-primary" : "btn-secondary"}
            style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem", textTransform: "capitalize" }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Weekly grid */}
      <div className="schedule-grid">
        {DAY_NAMES.map((day, dayIndex) => {
          const dayItems = items.filter(i => i.day_of_week === dayIndex);
          return (
            <div key={day} className="schedule-day">
              <div className="schedule-day-header">
                <div>{DAY_SHORT[dayIndex]}</div>
                <div style={{ fontSize: "0.6875rem", color: "#a8a29e", fontWeight: "400", textTransform: "none" }}>{getDateForDay(dayIndex)}</div>
              </div>
              <div style={{ padding: "0.375rem" }}>
                {dayItems.map(item => (
                  <div key={item.id} className="schedule-item" title={item.product?.name}>
                    <div style={{ fontWeight: "600", fontSize: "0.6875rem", color: "#292524", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.product?.name ?? "—"}
                    </div>
                    <div style={{ color: "#78716c", fontSize: "0.6875rem" }}>
                      {item.planned_quantity} {item.unit}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginTop: "0.25rem" }}>
                      <span className={`badge ${itemStatusColors[item.status]}`} style={{ fontSize: "0.5625rem", padding: "0.0625rem 0.375rem" }}>
                        {item.status.replace("_", " ")}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#d1d5db", fontSize: "0.625rem", padding: "0 0.125rem" }}
                        title="Remove"
                      >✕</button>
                    </div>
                    {item.status !== "completed" && (
                      <input
                        type="number"
                        placeholder="Actual qty"
                        defaultValue={item.actual_quantity ?? ""}
                        onBlur={e => updateActualQty(item.id, e.target.value)}
                        style={{ width: "100%", marginTop: "0.25rem", padding: "0.125rem 0.25rem", fontSize: "0.625rem", border: "1px solid #e7e5e4", borderRadius: "0.25rem" }}
                      />
                    )}
                    {item.status === "planned" && (
                      <button
                        onClick={() => updateItemStatus(item.id, "completed")}
                        style={{ width: "100%", marginTop: "0.25rem", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.625rem", color: "#166534", padding: "0.125rem" }}
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                ))}

                {/* Add item button */}
                {showAddForm === dayIndex ? (
                  <div style={{ padding: "0.375rem", background: "#fafaf9", borderRadius: "0.375rem", border: "1px solid #e7e5e4", marginTop: "0.25rem" }}>
                    <select
                      className="form-select"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.375rem", marginBottom: "0.25rem" }}
                      value={addForm.productId}
                      onChange={e => setAddForm(f => ({ ...f, productId: e.target.value, unit: products.find(p => p.id === e.target.value)?.unit ?? "kg" }))}
                    >
                      <option value="">Select product…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.25rem" }}>
                      <input
                        type="number"
                        placeholder="Qty"
                        className="form-input"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.375rem", flex: 1 }}
                        value={addForm.quantity}
                        onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))}
                      />
                      <input
                        type="text"
                        placeholder="Unit"
                        className="form-input"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.375rem", width: "52px" }}
                        value={addForm.unit}
                        onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      <button
                        onClick={addItem}
                        disabled={saving}
                        style={{ flex: 1, background: "#b91c1c", color: "#fff", border: "none", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.6875rem", padding: "0.25rem" }}
                      >
                        {saving ? "…" : "Add"}
                      </button>
                      <button
                        onClick={() => setShowAddForm(null)}
                        style={{ flex: 1, background: "#f5f5f4", color: "#78716c", border: "1px solid #e7e5e4", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.6875rem", padding: "0.25rem" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setShowAddForm(dayIndex); setAddForm(f => ({ ...f, dayIndex })); }}
                    style={{ width: "100%", marginTop: "0.25rem", background: "none", border: "1px dashed #d6d3d1", borderRadius: "0.25rem", cursor: "pointer", color: "#a8a29e", fontSize: "0.6875rem", padding: "0.25rem 0" }}
                  >
                    + Add item
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: "0.9375rem", fontWeight: "600", marginTop: 0, marginBottom: "1rem" }}>Week Summary</h3>
        {items.length === 0 ? (
          <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No items scheduled yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Day</th>
                <th>Planned</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.sort((a, b) => a.day_of_week - b.day_of_week).map(item => (
                <tr key={item.id}>
                  <td style={{ fontWeight: "500" }}>{item.product?.name ?? "—"}</td>
                  <td style={{ color: "#78716c" }}>{DAY_NAMES[item.day_of_week]}</td>
                  <td>{item.planned_quantity} {item.unit}</td>
                  <td style={{ color: item.actual_quantity != null ? "#166534" : "#a8a29e" }}>
                    {item.actual_quantity != null ? `${item.actual_quantity} ${item.unit}` : "—"}
                  </td>
                  <td><span className={`badge ${itemStatusColors[item.status]}`} style={{ textTransform: "capitalize" }}>{item.status.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
