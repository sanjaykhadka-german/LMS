"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Ingredient {
  id: string;
  product_id: string;
  raw_material_id: string;
  raw_material?: { id: string; name: string; code: string; unit: string };
  quantity: number;
  unit: string;
  percentage: number | null;
  notes: string | null;
  sort_order: number;
}

interface Material { id: string; name: string; code: string; unit: string }

interface Props {
  productId: string;
  productName: string;
  batchSize: number;
  batchUnit: string;
  initialIngredients: Ingredient[];
  allMaterials: Material[];
}

export default function RecipeManager({ productId, productName, batchSize, batchUnit, initialIngredients, allMaterials }: Props) {
  const supabase = createClient();
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [showAdd, setShowAdd] = useState(false);
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newUnit, setNewUnit] = useState("kg");
  const [newPct, setNewPct] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function addIngredient() {
    if (!newMaterialId || !newQty) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .insert({
        product_id: productId,
        raw_material_id: newMaterialId,
        quantity: parseFloat(newQty),
        unit: newUnit,
        percentage: newPct ? parseFloat(newPct) : null,
        notes: newNotes || null,
        sort_order: ingredients.length,
      })
      .select("*, raw_material:raw_materials(id, name, code, unit)")
      .single();

    if (!error && data) {
      setIngredients(prev => [...prev, data as Ingredient]);
      setShowAdd(false);
      setNewMaterialId(""); setNewQty(""); setNewUnit("kg"); setNewPct(""); setNewNotes("");
    }
    setSaving(false);
  }

  async function removeIngredient(id: string) {
    await supabase.from("recipe_ingredients").delete().eq("id", id);
    setIngredients(prev => prev.filter(i => i.id !== id));
  }

  const totalWeight = ingredients.reduce((sum, i) => sum + (i.unit === "kg" || i.unit === "g" ? (i.unit === "g" ? i.quantity / 1000 : i.quantity) : 0), 0);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Recipe / Ingredients</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0.125rem 0 0" }}>
            For {batchSize} {batchUnit} batch of {productName}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
          + Add Ingredient
        </button>
      </div>

      {showAdd && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: "600", margin: "0 0 0.75rem" }}>Add Ingredient</h3>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Raw Material</label>
              <select className="form-select" value={newMaterialId} onChange={e => { setNewMaterialId(e.target.value); setNewUnit(allMaterials.find(m => m.id === e.target.value)?.unit ?? "kg"); }}>
                <option value="">Select…</option>
                {allMaterials.filter(m => !ingredients.find(i => i.raw_material_id === m.id)).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Quantity</label>
              <input className="form-input" type="number" min="0" step="0.001" value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <label className="form-label">Unit</label>
              <input className="form-input" value={newUnit} onChange={e => setNewUnit(e.target.value)} />
            </div>
            <div>
              <label className="form-label">% of Batch</label>
              <input className="form-input" type="number" min="0" max="100" step="0.01" value={newPct} onChange={e => setNewPct(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label className="form-label">Notes</label>
            <input className="form-input" value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional notes…" />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={addIngredient} disabled={saving} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
              {saving ? "Adding…" : "Add"}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
          </div>
        </div>
      )}

      {ingredients.length === 0 ? (
        <p style={{ color: "#a8a29e", fontSize: "0.875rem" }}>No ingredients added yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Code</th>
              <th>Quantity per Batch</th>
              <th>% of Batch</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(ing => (
              <tr key={ing.id}>
                <td style={{ fontWeight: "500" }}>{ing.raw_material?.name ?? "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{ing.raw_material?.code}</td>
                <td>{ing.quantity} {ing.unit}</td>
                <td style={{ color: "#78716c" }}>{ing.percentage != null ? `${ing.percentage}%` : "—"}</td>
                <td style={{ color: "#78716c" }}>{ing.notes || "—"}</td>
                <td>
                  <button onClick={() => removeIngredient(ing.id)} className="btn-danger" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {totalWeight > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} style={{ padding: "0.625rem 1rem", fontWeight: "600", fontSize: "0.875rem" }}>Total (kg ingredients)</td>
                <td style={{ padding: "0.625rem 1rem", fontWeight: "600" }}>{totalWeight.toFixed(3)} kg</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
