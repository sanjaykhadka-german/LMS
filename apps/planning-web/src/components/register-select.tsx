"use client";

/**
 * RegisterSelect — a <select> bound to a tenant register, with an inline
 * "+ New …" option that opens a small modal so an authorised user can
 * add a row without leaving the screen. Rolls out the pattern Tino
 * locked in on the item ingredient-components panel (May 7 2026) to
 * every register dropdown across the app.
 *
 * Usage:
 *   <RegisterSelect
 *     value={form.department_id}
 *     onChange={v => set("department_id", v)}
 *     table="departments"
 *     labelField="name"
 *     codeField="code"
 *     options={departments.map(d => ({ value: d.id, label: d.name }))}
 *     placeholder="Pick a department"
 *     newDialogTitle="New department"
 *     newRecordExtras={{ tenant_id: tenantId, is_active: true }}
 *   />
 *
 * The component creates the row directly in the named table, then calls
 * onCreated(newId) so the host can refresh its options list and re-select
 * the new row.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Option = { value: string; label: string };

export function RegisterSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
  style,
  disabled,
  // Inline add config:
  table,
  labelField,
  codeField,
  newDialogTitle = "New record",
  newRecordExtras = {},
  onCreated,
  hideAddNew = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  table?: string;
  /** Column on the row that stores the user-facing label (e.g. "name", "label"). */
  labelField?: string;
  /** Optional column for an internal code (e.g. "code"). When supplied, the
   *  modal asks for it too and normalises to UPPERCASE. */
  codeField?: string;
  newDialogTitle?: string;
  /** Extra fields written into the insert (e.g. tenant_id, is_active = true). */
  newRecordExtras?: Record<string, unknown>;
  /** Callback fired with the new row id after successful insert. Host
   *  should re-fetch options so the row appears next render. */
  onCreated?: (newId: string, label: string, code?: string) => void;
  /** Suppress the "+ New …" option (e.g. when the current user has no
   *  add permission for this register). */
  hideAddNew?: boolean;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCode, setNewCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canAddInline = !!(table && labelField) && !hideAddNew;

  async function createRow() {
    if (!table || !labelField) return;
    if (!newLabel.trim()) { setErr("Label is required."); return; }
    setSaving(true); setErr(null);

    // If the host didn't pass tenant_id explicitly, resolve it from the
    // signed-in user's profile so the typical case is a one-line wire-up
    // at the call site. Hosts that need a different scope can still pass
    // their own tenant_id via newRecordExtras and we won't override.
    const extras = { ...newRecordExtras } as Record<string, unknown>;
    if (extras.tenant_id == null) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles").select("tenant_id").eq("id", user.id).single();
        if (profile && (profile as { tenant_id?: string }).tenant_id) {
          extras.tenant_id = (profile as { tenant_id: string }).tenant_id;
        }
      }
    }

    const payload: Record<string, unknown> = {
      ...extras,
      [labelField]: newLabel.trim(),
    };
    if (codeField) {
      payload[codeField] = newCode.trim().toUpperCase() || null;
    }
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) { setErr(error?.message ?? "Insert failed."); return; }
    const newId = (data as { id: string }).id;
    onChange(newId);
    onCreated?.(newId, newLabel.trim(), codeField ? newCode.trim().toUpperCase() : undefined);
    setOpen(false);
    setNewLabel("");
    setNewCode("");
  }

  return (
    <>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === "__new__") { setOpen(true); setErr(null); return; }
          onChange(e.target.value);
        }}
        className={className ?? "form-input"}
        style={style}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {canAddInline && <option value="__new__">+ New…</option>}
      </select>

      {open && (
        <div
          className="no-print"
          style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => !saving && setOpen(false)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.5rem", padding: "1.25rem", width: "min(380px, 92vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1c1917" }}>{newDialogTitle}</h2>
            <p style={{ margin: "0.25rem 0 0.875rem", fontSize: "0.8125rem", color: "#78716c" }}>
              Adds the row to the tenant register. You can still edit / deactivate it from the dedicated settings page later.
            </p>
            <label style={lbl}>Label *</label>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} className="form-input" autoFocus />
            {codeField && (
              <>
                <label style={lbl}>Code (optional)</label>
                <input
                  value={newCode}
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  className="form-input"
                  style={{ fontFamily: "monospace", textTransform: "uppercase" }}
                />
              </>
            )}
            {err && <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>{err}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
              <button type="button" onClick={createRow} disabled={saving} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const lbl: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "#57534e",
  margin: "0.5rem 0 0.25rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
