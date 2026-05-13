"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import { useUnitsOfMeasure } from "@/lib/hooks/use-reference-data";
import { RegisterSelect } from "@/components/register-select";
import Link from "next/link";

const MACHINE_TYPES = ["Slicer","Smoker","Oven","Grinder","Mixer","Filler","Packer","Sealer","Weigh-price labeller","Conveyor","Refrigeration unit","Saw","Brine injector","Tumbler","Other"];
const STATUSES = ["operational","maintenance","breakdown","decommissioned"] as const;

type Dept = { id: string; name: string };
type Room = { id: string; name: string; code: string | null };
type MachineData = Record<string, unknown>;

const DEFAULTS = {
  code: "", name: "", machine_type: "", department_id: "", room_id: "",
  capacity_value: "", capacity_unit: "",
  manufacturer: "", model: "", serial_number: "", asset_number: "",
  purchase_date: "", purchase_price: "",
  last_service_date: "", next_service_date: "", service_interval_days: "", service_notes: "",
  status: "operational", location: "", notes: "", is_active: true,
};

export default function MachineForm({
  mode, initial, departments, rooms = [],
}: {
  mode: "create" | "edit";
  initial?: MachineData;
  departments: Dept[];
  rooms?: Room[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const sanitized = initial
    ? Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v === null ? "" : v]))
    : {};
  const [form, setForm] = useState({ ...DEFAULTS, ...sanitized });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pull the tenant's UOM register so Capacity Unit picks from the same list
  // as the rest of the app (kg, kg/hr, links/min, etc). The value stored is
  // the UOM `code` string — same shape the legacy free-text input used, so
  // existing rows still render correctly.
  const { data: uomList } = useUnitsOfMeasure();
  const uoms = (uomList ?? []) as { id: string; code: string; name: string; category: string | null }[];

  function set(k: string, v: unknown) { setForm(f => ({ ...f, [k]: v })); }
  const inp = (field: string, placeholder = "") => ({
    className: "form-input",
    value: String(form[field] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(field, e.target.value),
    placeholder,
  });

  const toNum = (v: string) => v !== "" && !isNaN(parseFloat(v)) ? parseFloat(v) : null;
  const toDate = (v: string) => v || null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!String(form.name).trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

    const payload = {
      ...(mode === "create" ? { tenant_id: profile!.tenant_id } : {}),
      code: String(form.code).trim().toUpperCase() || null,
      name: String(form.name).trim(),
      machine_type: String(form.machine_type) || null,
      department_id: String(form.department_id) || null,
      capacity_value: toNum(String(form.capacity_value)),
      capacity_unit: String(form.capacity_unit) || null,
      manufacturer: String(form.manufacturer) || null,
      model: String(form.model) || null,
      serial_number: String(form.serial_number) || null,
      asset_number: String(form.asset_number) || null,
      purchase_date: toDate(String(form.purchase_date)),
      purchase_price: toNum(String(form.purchase_price)),
      last_service_date: toDate(String(form.last_service_date)),
      next_service_date: toDate(String(form.next_service_date)),
      service_interval_days: toNum(String(form.service_interval_days)) ? parseInt(String(form.service_interval_days)) : null,
      service_notes: String(form.service_notes) || null,
      status: String(form.status),
      location: String(form.location) || null,
      room_id: String(form.room_id ?? "") || null,
      notes: String(form.notes) || null,
      is_active: form.is_active,
    };

    const { data, error: err } = mode === "create"
      ? await supabase.from("machines").insert(payload).select().single()
      : await supabase.from("machines").update(payload).eq("id", initial!.id as string).select().single();

    if (err) { setError(err.message); setSaving(false); return; }
    router.push(`/settings/machines/${(data as { id: string }).id}`);
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/settings/machines" label="Machines" />
      <div className="page-header">
        <div>
          <h1 className="page-title">{mode === "create" ? "New Machine" : String(form.name) || "Edit Machine"}</h1>
          <p className="page-subtitle">{mode === "create" ? "Register a new piece of equipment" : "Update machine details, maintenance schedule and specifications"}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* Identity */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Machine Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Asset Code</label>
              <input {...inp("code", "Leave blank to auto-generate")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                Leave blank → auto-filled as <code>{`{TYPE}-NN`}</code> on save (e.g. MIX-03, TMB-01). Type-prefix uses the picked Type above.
              </div>
            </div>
            <div>
              <label className="form-label">Machine Name *</label>
              <input {...inp("name", "e.g. Kerres Smoker #1")} required />
            </div>
            <div>
              <label className="form-label">Type</label>
              <select className="form-select" value={String(form.machine_type)} onChange={e => set("machine_type", e.target.value)}>
                <option value="">— Select type —</option>
                {MACHINE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Department</label>
              {/* RegisterSelect adds an inline '+ New…' option that creates
                  the department directly in the tenant register — Tino's
                  cross-cutting ask to stop forcing a context-switch into
                  /settings/departments just to add a new one. */}
              <RegisterSelect
                value={String(form.department_id ?? "")}
                onChange={v => set("department_id", v)}
                options={departments.map(d => ({ value: d.id, label: d.name }))}
                placeholder="— No department —"
                className="form-select"
                table="departments"
                labelField="name"
                codeField="code"
                newDialogTitle="New department"
                newRecordExtras={{ is_active: true, sort_order: departments.length * 10 }}
                onCreated={() => router.refresh()}
              />
            </div>
            <div>
              <label className="form-label">Capacity</label>
              <input {...inp("capacity_value", "e.g. 200")} type="number" min="0" step="any" />
            </div>
            <div>
              <label className="form-label">Capacity Unit</label>
              <select
                className="form-select"
                value={String(form.capacity_unit ?? "")}
                onChange={e => set("capacity_unit", e.target.value)}
              >
                <option value="">— Select unit —</option>
                {/* Render the saved value first when it's not in the active
                    UOM register, so legacy machines keep showing their unit
                    instead of silently going blank. */}
                {form.capacity_unit && !uoms.some(u => u.code === form.capacity_unit) && (
                  <option value={String(form.capacity_unit)}>{String(form.capacity_unit)} (legacy)</option>
                )}
                {uoms.map(u => (
                  <option key={u.id} value={u.code}>
                    {u.code}{u.name && u.name !== u.code ? ` — ${u.name}` : ""}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                Manage units at{" "}
                <Link href="/settings/units-of-measure" style={{ color: "#1e40af" }}>Settings → Units of Measure</Link>
              </div>
            </div>
            <div>
              <label className="form-label">Room / Location</label>
              {rooms.length > 0 ? (
                <select className="form-select" value={String(form.room_id ?? "")} onChange={e => set("room_id", e.target.value)}>
                  <option value="">— No room assigned —</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.code ? `${r.code} — ` : ""}{r.name}</option>)}
                </select>
              ) : (
                <input {...inp("location", "e.g. Smoking Room, Bay 2")} />
              )}
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="form-select" value={String(form.status)} onChange={e => set("status", e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Asset Details */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Asset &amp; Purchase Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Manufacturer</label>
              <input {...inp("manufacturer", "e.g. Kerres")} />
            </div>
            <div>
              <label className="form-label">Model</label>
              <input {...inp("model", "e.g. KER-2000")} />
            </div>
            <div>
              <label className="form-label">Serial Number</label>
              <input {...inp("serial_number")} style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Asset / Tag Number</label>
              <input {...inp("asset_number")} style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Purchase Date</label>
              <input {...inp("purchase_date")} type="date" />
            </div>
            <div>
              <label className="form-label">Purchase Price ($)</label>
              <input {...inp("purchase_price")} type="number" min="0" step="0.01" />
            </div>
          </div>
        </div>

        {/* Maintenance */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Maintenance Schedule</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Last Service Date</label>
              <input {...inp("last_service_date")} type="date" />
            </div>
            <div>
              <label className="form-label">Next Service Date</label>
              <input {...inp("next_service_date")} type="date" />
            </div>
            <div>
              <label className="form-label">Service Interval (days)</label>
              <input {...inp("service_interval_days", "e.g. 90")} type="number" min="1" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Service Notes</label>
              <textarea {...inp("service_notes", "Maintenance instructions, service provider contact, etc.")}
                rows={2} style={{ resize: "vertical" }} />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>General Notes</h2>
          <textarea {...inp("notes", "Any additional notes about this machine...")} rows={3} style={{ resize: "vertical" }} />
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create Machine" : "Save Changes"}
          </button>
          <Link href="/settings/machines" className="btn-secondary">Cancel</Link>
          {mode === "edit" && (
            <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input type="checkbox" checked={Boolean(form.is_active)} onChange={e => set("is_active", e.target.checked)} />
              Active machine
            </label>
          )}
        </div>
      </form>
    </div>
  );
}
