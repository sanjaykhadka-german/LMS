"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";

type UomCategory = "weight" | "count" | "volume" | "length" | "other";

type Uom = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: UomCategory;
  is_base: boolean;
  is_active: boolean;
  sort_order: number;
};

const CATEGORIES: { value: UomCategory; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "count",  label: "Count / Each" },
  { value: "volume", label: "Volume" },
  { value: "length", label: "Length" },
  { value: "other",  label: "Other" },
];

const CATEGORY_COLORS: Record<UomCategory, string> = {
  weight: "badge-blue",
  count:  "badge-yellow",
  volume: "badge-green",
  length: "badge-gray",
  other:  "badge-gray",
};

const BLANK = {
  code: "", name: "", description: "",
  category: "other" as UomCategory, is_base: false, sort_order: 100,
};

export default function UnitsOfMeasureManager({
  initialUoms,
  usage,
}: {
  initialUoms: Uom[];
  // Map of lower(code) → number of items currently using that UOM. Drives the
  // "in use" badge and gates deletion (we don't let you delete a UOM that's
  // referenced anywhere — would orphan the text on those items).
  usage: Record<string, number>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState<Uom | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"" | UomCategory>("");

  function set<K extends keyof typeof BLANK>(k: K, v: typeof BLANK[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.code.trim()) { setError("Code is required"); return; }
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      tenant_id: profile!.tenant_id,
      code: form.code.trim().toLowerCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category,
      is_base: form.is_base,
      sort_order: Number(form.sort_order) || 100,
    };

    if (editing) {
      // If the operator changed the code on a UOM that's in use, that would
      // orphan items. Block it — they should rename the display name instead.
      if (editing.code !== payload.code && (usage[editing.code] ?? 0) > 0) {
        setError(`Can't change the code: ${usage[editing.code]} item(s) reference "${editing.code}". Rename the display name instead, or migrate items first.`);
        setSaving(false); return;
      }
      const { error: err } = await supabase
        .from("units_of_measure").update(payload).eq("id", editing.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from("units_of_measure").insert(payload);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    setSaving(false);
    setEditing(null); setAdding(false); setForm(BLANK);
    router.refresh();
  }

  async function toggleActive(u: Uom) {
    await supabase.from("units_of_measure").update({ is_active: !u.is_active }).eq("id", u.id);
    router.refresh();
  }

  async function deleteUom(u: Uom) {
    const inUse = usage[u.code] ?? 0;
    if (inUse > 0) {
      alert(`Can't delete "${u.code}" — it's used by ${inUse} item(s). Reassign those items to a different UOM first, or just deactivate this one.`);
      return;
    }
    if (!confirm(`Delete UOM "${u.code} (${u.name})"? This cannot be undone.`)) return;
    const { error: err } = await supabase.from("units_of_measure").delete().eq("id", u.id);
    if (err) { alert(err.message); return; }
    router.refresh();
  }

  function startEdit(u: Uom) {
    setEditing(u);
    setForm({
      code: u.code, name: u.name, description: u.description ?? "",
      category: u.category, is_base: u.is_base, sort_order: u.sort_order,
    });
    setAdding(false);
  }

  function cancel() { setEditing(null); setAdding(false); setForm(BLANK); setError(null); }

  const showForm = !!editing || adding;
  const visible = filter ? initialUoms.filter(u => u.category === filter) : initialUoms;
  const totalInUse = initialUoms.filter(u => (usage[u.code] ?? 0) > 0).length;

  return (
    <div style={{ maxWidth: "1100px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Units of Measure</h1>
          <p className="page-subtitle">
            Tenant-wide UOM register. {initialUoms.length} defined · {totalInUse} currently in use across items.
            Renaming the display name updates everywhere; the code is the join key, change with care.
          </p>
        </div>
        {!showForm && (
          <button onClick={() => { setAdding(true); setEditing(null); setForm(BLANK); }} className="btn-primary">
            + New UOM
          </button>
        )}
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>
            {editing ? `Edit UOM — ${editing.code}` : "New UOM"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Code *</label>
              <input
                className="form-input"
                value={form.code}
                onChange={e => set("code", e.target.value.toLowerCase())}
                placeholder="kg / ea / ltr"
                style={{ fontFamily: "monospace" }}
              />
              {editing && (usage[editing.code] ?? 0) > 0 && (
                <p style={{ fontSize: "0.7rem", color: "#92400e", margin: "0.3rem 0 0" }}>
                  ⚠ Used by {usage[editing.code]} item(s) — code can&apos;t be changed.
                </p>
              )}
            </div>
            <div>
              <label className="form-label">Display Name *</label>
              <input className="form-input" value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="Kilograms / Each / Litre" />
            </div>
            <div>
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category}
                onChange={e => set("category", e.target.value as UomCategory)}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Sort Order</label>
              <input className="form-input" type="number" min="0" value={form.sort_order}
                onChange={e => set("sort_order", parseInt(e.target.value) || 100)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description}
                onChange={e => set("description", e.target.value)}
                placeholder="Optional — what this UOM means in your operation" />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={form.is_base}
                onChange={e => set("is_base", e.target.checked)} />
              <span style={{ fontSize: "0.875rem" }}>Base unit for this category</span>
            </label>
          </div>
          {error && <p style={{ color: "#dc2626", fontSize: "0.875rem", margin: "0.75rem 0 0" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Create UOM"}
            </button>
            <button onClick={cancel} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Category filter pills */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button onClick={() => setFilter("")} className={filter === "" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}>
          All ({initialUoms.length})
        </button>
        {CATEGORIES.map(c => {
          const count = initialUoms.filter(u => u.category === c.value).length;
          if (count === 0) return null;
          return (
            <button key={c.value} onClick={() => setFilter(c.value)}
              className={filter === c.value ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}>
              {c.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "100px" }}>Code</th>
              <th>Display Name</th>
              <th>Description</th>
              <th style={{ width: "120px" }}>Category</th>
              <th style={{ width: "80px", textAlign: "center" }}>Base</th>
              <th style={{ width: "100px", textAlign: "right" }}>Used by</th>
              <th style={{ width: "70px" }}>Order</th>
              <th style={{ width: "90px" }}>Status</th>
              <th style={{ width: "210px" }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={9} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                {filter ? `No UOMs in the "${filter}" category yet.` : "No UOMs yet — click + New UOM to get started."}
              </td></tr>
            )}
            {visible.map(u => {
              const inUse = usage[u.code] ?? 0;
              return (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: 600 }}>{u.code}</td>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td style={{ color: "#78716c", fontSize: "0.8125rem" }}>{u.description ?? "—"}</td>
                  <td>
                    <span className={`badge ${CATEGORY_COLORS[u.category]}`} style={{ fontSize: "0.6875rem", textTransform: "capitalize" }}>
                      {u.category}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {u.is_base ? <span title="Base unit for this category">⭐</span> : <span style={{ color: "#d4d0cc" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem" }}>
                    {inUse > 0
                      ? <span style={{ color: "#166534", fontWeight: 600 }}>{inUse} item{inUse !== 1 ? "s" : ""}</span>
                      : <span style={{ color: "#a8a29e" }}>—</span>}
                  </td>
                  <td style={{ color: "#78716c" }}>{u.sort_order}</td>
                  <td>
                    {u.is_active
                      ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
                      : <span className="badge badge-gray" style={{ fontSize: "0.6875rem" }}>Inactive</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.375rem" }}>
                      <button onClick={() => startEdit(u)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Edit</button>
                      <button onClick={() => toggleActive(u)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => deleteUom(u)}
                        title={inUse > 0 ? `In use by ${inUse} item(s) — can't delete` : "Delete"}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem",
                          background: "none", border: "1px solid #fca5a5", borderRadius: "0.375rem",
                          color: inUse > 0 ? "#a8a29e" : "#dc2626",
                          cursor: inUse > 0 ? "not-allowed" : "pointer", opacity: inUse > 0 ? 0.6 : 1 }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
