"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Breakdown = {
  id: string;
  reported_at: string;
  severity: string;
  description: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  downtime_hours: number | null;
  repair_cost: number | null;
  parts_used: string | null;
  reported_by: { full_name: string } | null;
  resolved_by: { full_name: string } | null;
};

const SEVERITIES = ["low","medium","high","critical"] as const;
const SEVERITY_COLORS: Record<string, string> = {
  low: "#15803d", medium: "#d97706", high: "#dc2626", critical: "#7c2d12"
};

export default function MachineBreakdownsPanel({
  machineId, initialBreakdowns,
}: { machineId: string; initialBreakdowns: Breakdown[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [breakdowns, setBreakdowns] = useState(initialBreakdowns);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    severity: "medium", description: "",
    resolved_at: "", resolution_notes: "",
    downtime_hours: "", repair_cost: "", parts_used: "",
  });
  const [saving, setSaving] = useState(false);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.description.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      tenant_id: profile!.tenant_id,
      machine_id: machineId,
      severity: form.severity,
      description: form.description.trim(),
      resolved_at: form.resolved_at || null,
      resolution_notes: form.resolution_notes || null,
      downtime_hours: form.downtime_hours ? parseFloat(form.downtime_hours) : null,
      repair_cost: form.repair_cost ? parseFloat(form.repair_cost) : null,
      parts_used: form.parts_used || null,
    };

    if (editId) {
      await supabase.from("machine_breakdowns").update(payload).eq("id", editId);
    } else {
      await supabase.from("machine_breakdowns").insert({ ...payload, reported_by: user!.id });
    }

    setSaving(false);
    setShowForm(false); setEditId(null);
    setForm({ severity: "medium", description: "", resolved_at: "", resolution_notes: "", downtime_hours: "", repair_cost: "", parts_used: "" });
    router.refresh();
  }

  async function deleteBreakdown(id: string) {
    if (!confirm("Delete this breakdown record?")) return;
    await supabase.from("machine_breakdowns").delete().eq("id", id);
    setBreakdowns(b => b.filter(x => x.id !== id));
  }

  const openCount = breakdowns.filter(b => !b.resolved_at).length;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>
            Breakdowns &amp; Incidents
            {openCount > 0 && (
              <span style={{ marginLeft: "0.5rem", background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5",
                borderRadius: "999px", fontSize: "0.75rem", padding: "0.1rem 0.5rem", fontWeight: 600 }}>
                {openCount} open
              </span>
            )}
          </h2>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); }} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          + Log Breakdown
        </button>
      </div>

      {showForm && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div>
              <label className="form-label">Severity</label>
              <select className="form-select" value={form.severity} onChange={e => set("severity", e.target.value)}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Description *</label>
              <input className="form-input" value={form.description} onChange={e => set("description", e.target.value)}
                placeholder="What happened? What was the fault?" />
            </div>
            <div>
              <label className="form-label">Resolved At</label>
              <input className="form-input" type="datetime-local" value={form.resolved_at} onChange={e => set("resolved_at", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Resolution Notes</label>
              <input className="form-input" value={form.resolution_notes} onChange={e => set("resolution_notes", e.target.value)} placeholder="How was it fixed?" />
            </div>
            <div>
              <label className="form-label">Downtime (hours)</label>
              <input className="form-input" type="number" min="0" step="0.5" value={form.downtime_hours} onChange={e => set("downtime_hours", e.target.value)} />
            </div>
            <div>
              <label className="form-label">Repair Cost ($)</label>
              <input className="form-input" type="number" min="0" step="0.01" value={form.repair_cost} onChange={e => set("repair_cost", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Parts Used</label>
              <input className="form-input" value={form.parts_used} onChange={e => set("parts_used", e.target.value)}
                placeholder="List any parts replaced or consumed" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={save} className="btn-primary" disabled={saving} style={{ fontSize: "0.8125rem" }}>
              {saving ? "Saving…" : editId ? "Update" : "Log Breakdown"}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
          </div>
        </div>
      )}

      {breakdowns.length === 0 ? (
        <p style={{ color: "#78716c", fontSize: "0.875rem" }}>No breakdowns recorded.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Severity</th><th>Description</th><th>Status</th><th>Downtime</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>
            {breakdowns.map(b => (
              <tr key={b.id}>
                <td style={{ fontSize: "0.8125rem", whiteSpace: "nowrap" }}>
                  {new Date(b.reported_at).toLocaleDateString("en-AU")}
                </td>
                <td>
                  <span style={{ fontWeight: 600, fontSize: "0.75rem", color: SEVERITY_COLORS[b.severity] }}>
                    {b.severity.toUpperCase()}
                  </span>
                </td>
                <td style={{ maxWidth: "260px" }}>
                  <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{b.description}</div>
                  {b.parts_used && <div style={{ color: "#78716c", fontSize: "0.75rem" }}>Parts: {b.parts_used}</div>}
                </td>
                <td>
                  {b.resolved_at
                    ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Resolved</span>
                    : <span className="badge" style={{ fontSize: "0.6875rem", background: "#fef2f2", color: "#dc2626" }}>Open</span>}
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {b.downtime_hours != null ? `${b.downtime_hours}h` : "—"}
                </td>
                <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                  {b.repair_cost != null ? `$${b.repair_cost.toFixed(2)}` : "—"}
                </td>
                <td>
                  <button onClick={() => deleteBreakdown(b.id)}
                    style={{ fontSize: "0.75rem", background: "none", border: "1px solid #fca5a5",
                      borderRadius: "0.375rem", color: "#dc2626", cursor: "pointer", padding: "0.2rem 0.5rem" }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
