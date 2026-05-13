"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LogEntry = {
  id: string;
  log_type: string;
  performed_date: string;
  performed_by: string | null;
  description: string;
  cost: number | null;
  parts_used: string | null;
  next_service_date: string | null;
  downtime_hours: number | null;
  is_resolved: boolean;
  notes: string | null;
};

const LOG_TYPES = [
  { value: "service", label: "Scheduled Service" },
  { value: "breakdown", label: "Breakdown" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "calibration", label: "Calibration" },
  { value: "other", label: "Other" },
];

const TYPE_COLORS: Record<string, string> = {
  service: "badge-blue",
  breakdown: "badge-red",
  repair: "badge-yellow",
  inspection: "badge-green",
  calibration: "badge-blue",
  other: "badge-gray",
};

const BLANK = {
  log_type: "service",
  performed_date: new Date().toISOString().split("T")[0],
  performed_by: "",
  description: "",
  cost: "",
  parts_used: "",
  next_service_date: "",
  downtime_hours: "",
  is_resolved: true,
  notes: "",
};

export default function MachineMaintenancePanel({
  machineId,
  initialLogs,
}: {
  machineId: string;
  initialLogs: LogEntry[];
}) {
  const supabase = createClient();
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.description.trim()) { setError("Description is required"); return; }
    if (!form.performed_date) { setError("Date is required"); return; }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    const { data, error: e } = await supabase
      .from("machine_maintenance_logs")
      .insert({
        machine_id: machineId,
        tenant_id: profile!.tenant_id,
        log_type: form.log_type,
        performed_date: form.performed_date,
        performed_by: form.performed_by.trim() || null,
        description: form.description.trim(),
        cost: form.cost !== "" ? parseFloat(form.cost as string) : null,
        parts_used: form.parts_used.trim() || null,
        next_service_date: form.next_service_date || null,
        downtime_hours: form.downtime_hours !== "" ? parseFloat(form.downtime_hours as string) : null,
        is_resolved: form.is_resolved,
        notes: form.notes.trim() || null,
      })
      .select("id, log_type, performed_date, performed_by, description, cost, parts_used, next_service_date, downtime_hours, is_resolved, notes")
      .single();

    if (e || !data) { setError(e?.message ?? "Failed to save"); setSaving(false); return; }
    setLogs(prev => [data as LogEntry, ...prev]);
    setForm(BLANK);
    setShowForm(false);
    setSaving(false);

    // If a next_service_date was provided, update the machine record too
    if (form.next_service_date) {
      await supabase.from("machines").update({ next_service_date: form.next_service_date, last_service_date: form.performed_date }).eq("id", machineId);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this log entry?")) return;
    const { error: e } = await supabase.from("machine_maintenance_logs").delete().eq("id", id);
    if (!e) setLogs(prev => prev.filter(l => l.id !== id));
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>Maintenance Log</div>
          <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>{logs.length} entr{logs.length === 1 ? "y" : "ies"}</div>
        </div>
        <button onClick={() => { setShowForm(v => !v); setError(null); }} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          {showForm ? "Cancel" : "+ Log Entry"}
        </button>
      </div>

      {/* Add entry form */}
      {showForm && (
        <div style={{ background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.625rem", padding: "1rem", marginBottom: "1.25rem" }}>
          {error && <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b" }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="form-label">Type</label>
              <select className="form-select" value={form.log_type} onChange={e => set("log_type", e.target.value)}>
                {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Date *</label>
              <input className="form-input" type="date" value={form.performed_date} onChange={e => set("performed_date", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Description *</label>
              <textarea className="form-input" rows={2} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What was done…" style={{ resize: "vertical" }} />
            </div>
            <div>
              <label className="form-label">Performed By</label>
              <input className="form-input" value={form.performed_by} onChange={e => set("performed_by", e.target.value)} placeholder="Technician name or company" />
            </div>
            <div>
              <label className="form-label">Cost ($)</label>
              <input className="form-input" type="number" step="0.01" value={form.cost} onChange={e => set("cost", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Downtime (hours)</label>
              <input className="form-input" type="number" step="0.5" value={form.downtime_hours} onChange={e => set("downtime_hours", e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="form-label">Next Service Due</label>
              <input className="form-input" type="date" value={form.next_service_date} onChange={e => set("next_service_date", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Parts Used</label>
              <input className="form-input" value={form.parts_used} onChange={e => set("parts_used", e.target.value)} placeholder="e.g. Belt ref #123, Bearing 6205" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Additional Notes</label>
              <textarea className="form-input" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional…" style={{ resize: "vertical" }} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" id="is_resolved" checked={form.is_resolved} onChange={e => set("is_resolved", e.target.checked)} style={{ width: "1rem", height: "1rem" }} />
              <label htmlFor="is_resolved" style={{ fontSize: "0.875rem", cursor: "pointer" }}>Issue resolved / work completed</label>
            </div>
          </div>
          <div style={{ marginTop: "0.875rem", display: "flex", gap: "0.5rem" }}>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save Log Entry"}
            </button>
            <button onClick={() => { setShowForm(false); setError(null); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Log list */}
      {logs.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem", background: "#fafaf9", borderRadius: "0.5rem" }}>
          No maintenance records yet. Click &ldquo;+ Log Entry&rdquo; to start the history.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {logs.map(log => (
            <div key={log.id} style={{ border: "1px solid #e7e5e4", borderRadius: "0.625rem", padding: "0.875rem 1rem", background: log.is_resolved ? "#fff" : "#fffbeb" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem", flexWrap: "wrap" }}>
                    <span className={`badge ${TYPE_COLORS[log.log_type] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                      {LOG_TYPES.find(t => t.value === log.log_type)?.label ?? log.log_type}
                    </span>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#292524" }}>
                      {new Date(log.performed_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    {log.performed_by && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>— {log.performed_by}</span>}
                    {!log.is_resolved && <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }}>Unresolved</span>}
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#292524", marginBottom: "0.375rem" }}>{log.description}</div>
                  <div style={{ display: "flex", gap: "1rem", fontSize: "0.8125rem", color: "#78716c", flexWrap: "wrap" }}>
                    {log.cost != null && <span>💰 ${log.cost.toFixed(2)}</span>}
                    {log.downtime_hours != null && <span>⏱ {log.downtime_hours}h downtime</span>}
                    {log.next_service_date && <span>📅 Next: {new Date(log.next_service_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>}
                    {log.parts_used && <span>🔧 {log.parts_used}</span>}
                  </div>
                  {log.notes && <div style={{ marginTop: "0.375rem", fontSize: "0.8125rem", color: "#78716c", fontStyle: "italic" }}>{log.notes}</div>}
                </div>
                <button
                  onClick={() => handleDelete(log.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#a8a29e", fontSize: "1rem", padding: "0.125rem", lineHeight: 1, flexShrink: 0 }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
