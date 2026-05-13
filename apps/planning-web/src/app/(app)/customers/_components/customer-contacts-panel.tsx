"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const ROLES = ["Accounts", "Store Manager", "Ordering", "Receiving", "Logistics", "Customer Service", "Management", "Other"];

type Contact = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  is_primary: boolean;
  receives_orders: boolean;
  receives_invoices: boolean;
  receives_claims: boolean;
  receives_delivery_notices: boolean;
  notes: string | null;
};

const BLANK: Omit<Contact, "id"> = {
  name: "",
  role: "",
  phone: "",
  mobile: "",
  email: "",
  is_primary: false,
  receives_orders: false,
  receives_invoices: false,
  receives_claims: false,
  receives_delivery_notices: false,
  notes: "",
};

export default function CustomerContactsPanel({
  customerId,
  tenantId,
  initialContacts,
}: {
  customerId: string;
  tenantId: string;
  initialContacts: Contact[];
}) {
  const supabase = createClient();
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Contact, "id">>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setForm({ ...BLANK });
    setEditing("new");
    setError(null);
  }

  function startEdit(c: Contact) {
    setForm({
      name: c.name,
      role: c.role ?? "",
      phone: c.phone ?? "",
      mobile: c.mobile ?? "",
      email: c.email ?? "",
      is_primary: c.is_primary,
      receives_orders: c.receives_orders,
      receives_invoices: c.receives_invoices,
      receives_claims: c.receives_claims,
      receives_delivery_notices: c.receives_delivery_notices,
      notes: c.notes ?? "",
    });
    setEditing(c.id);
    setError(null);
  }

  function cancel() {
    setEditing(null);
    setError(null);
  }

  function set<K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      role: form.role || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      email: form.email || null,
      is_primary: form.is_primary,
      receives_orders: form.receives_orders,
      receives_invoices: form.receives_invoices,
      receives_claims: form.receives_claims,
      receives_delivery_notices: form.receives_delivery_notices,
      notes: form.notes || null,
    };

    if (editing === "new") {
      const { data, error: err } = await supabase
        .from("customer_contacts")
        .insert({ ...payload, customer_id: customerId, tenant_id: tenantId })
        .select()
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setContacts(prev => [...prev, data as Contact]);
    } else {
      const { data, error: err } = await supabase
        .from("customer_contacts")
        .update(payload)
        .eq("id", editing!)
        .select()
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      setContacts(prev => prev.map(c => c.id === editing ? data as Contact : c));
    }

    setSaving(false);
    setEditing(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact?")) return;
    const { error: err } = await supabase.from("customer_contacts").delete().eq("id", id);
    if (err) { alert(err.message); return; }
    setContacts(prev => prev.filter(c => c.id !== id));
    if (editing === id) setEditing(null);
  }

  const inp = (field: keyof typeof BLANK, placeholder = "") => ({
    className: "form-input",
    value: (form[field] ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(field, e.target.value as never),
    placeholder,
  });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Contacts</h2>
        {editing === null && (
          <button type="button" className="btn-secondary" onClick={startNew} style={{ fontSize: "0.8rem" }}>
            + Add Contact
          </button>
        )}
      </div>

      {contacts.length === 0 && editing === null && (
        <p style={{ color: "#78716c", fontSize: "0.875rem" }}>No contacts added yet.</p>
      )}

      {contacts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: editing ? "1.5rem" : 0 }}>
          {contacts.map(c => (
            <div
              key={c.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
                display: "flex",
                gap: "1rem",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{c.name}</span>
                  {c.is_primary && (
                    <span style={{ background: "#dbeafe", color: "#1d4ed8", fontSize: "0.7rem", fontWeight: 600, borderRadius: "9999px", padding: "0.1rem 0.5rem" }}>
                      PRIMARY
                    </span>
                  )}
                  {c.role && <span style={{ color: "#78716c", fontSize: "0.8rem" }}>{c.role}</span>}
                </div>
                <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "#57534e", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.mobile && <span>📱 {c.mobile}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                </div>
                {(c.receives_orders || c.receives_invoices || c.receives_claims || c.receives_delivery_notices) && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#78716c", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    Receives:
                    {c.receives_orders && <span style={{ background: "#f0fdf4", color: "#15803d", borderRadius: "4px", padding: "0 0.4rem" }}>Orders</span>}
                    {c.receives_invoices && <span style={{ background: "#f0fdf4", color: "#15803d", borderRadius: "4px", padding: "0 0.4rem" }}>Invoices</span>}
                    {c.receives_claims && <span style={{ background: "#f0fdf4", color: "#15803d", borderRadius: "4px", padding: "0 0.4rem" }}>Claims</span>}
                    {c.receives_delivery_notices && <span style={{ background: "#f0fdf4", color: "#15803d", borderRadius: "4px", padding: "0 0.4rem" }}>Delivery notices</span>}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button type="button" className="btn-secondary" onClick={() => startEdit(c)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}>Edit</button>
                <button type="button" onClick={() => handleDelete(c.id)} style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", background: "none", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "0.375rem", cursor: "pointer" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1rem", background: "var(--bg-subtle, #f9fafb)", marginTop: contacts.length > 0 ? "1rem" : 0 }}>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 1rem" }}>
            {editing === "new" ? "New Contact" : "Edit Contact"}
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="form-label">Name *</label>
              <input {...inp("name", "e.g. Sarah Jones")} />
            </div>
            <div>
              <label className="form-label">Role</label>
              <select className="form-select" value={form.role ?? ""} onChange={e => set("role", e.target.value)}>
                <option value="">— Select role —</option>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input {...inp("phone", "e.g. 03 9000 1234")} type="tel" />
            </div>
            <div>
              <label className="form-label">Mobile</label>
              <input {...inp("mobile", "e.g. 0412 345 678")} type="tel" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Email</label>
              <input {...inp("email", "e.g. sarah@customer.com.au")} type="email" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Notes</label>
              <textarea {...inp("notes", "Any notes about this contact")} rows={2} style={{ resize: "vertical" }} />
            </div>
          </div>

          <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_primary} onChange={e => set("is_primary", e.target.checked)} />
              Primary contact
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.receives_orders} onChange={e => set("receives_orders", e.target.checked)} />
              Receives orders
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.receives_invoices} onChange={e => set("receives_invoices", e.target.checked)} />
              Receives invoices
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.receives_claims} onChange={e => set("receives_claims", e.target.checked)} />
              Receives claims
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
              <input type="checkbox" checked={form.receives_delivery_notices} onChange={e => set("receives_delivery_notices", e.target.checked)} />
              Receives delivery notices
            </label>
          </div>

          {error && <div style={{ marginTop: "0.75rem", color: "#dc2626", fontSize: "0.8rem" }}>{error}</div>}

          <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: "0.875rem" }}>
              {saving ? "Saving…" : editing === "new" ? "Add Contact" : "Save Changes"}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel} style={{ fontSize: "0.875rem" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
