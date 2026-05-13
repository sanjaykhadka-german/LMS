"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import Link from "next/link";

const PAYMENT_TERMS = ["COD", "7 days", "14 days", "Net 30", "Net 60", "EOM 30", "Prepaid"];

type SupplierData = {
  id?: string;
  code?: string;
  name?: string;
  trading_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
  currency?: string;
  payment_terms?: string;
  account_number?: string;
  tax_registration?: string;
  purchase_account_code?: string;
  notes?: string;
  is_active?: boolean;
  // Operating hours
  operating_days?: string[] | null;
  operating_open?: string | null;
  operating_close?: string | null;
  loading_dock_open?: string | null;
  loading_dock_close?: string | null;
  loading_dock_notes?: string | null;
  order_cutoff_time?: string | null;
  delivery_days?: string[] | null;
};

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DEFAULTS: Required<Omit<SupplierData, "id">> = {
  code: "",
  name: "",
  trading_name: "",
  contact_name: "",
  phone: "",
  email: "",
  website: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postcode: "",
  country_code: "AU",
  currency: "AUD",
  payment_terms: "",
  account_number: "",
  tax_registration: "",
  purchase_account_code: "",
  notes: "",
  is_active: true,
  // Operating hours
  operating_days: [],
  operating_open: "",
  operating_close: "",
  loading_dock_open: "",
  loading_dock_close: "",
  loading_dock_notes: "",
  order_cutoff_time: "",
  delivery_days: [],
};

export default function SupplierForm({ mode, initial }: { mode: "create" | "edit"; initial?: SupplierData }) {
  const router = useRouter();
  const supabase = createClient();
  const sanitized = initial
    ? Object.fromEntries(
        Object.entries(initial).map(([k, v]) => [k, v === null ? ((DEFAULTS as Record<string, unknown>)[k] ?? "") : v])
      )
    : {};
  const [form, setForm] = useState({ ...DEFAULTS, ...sanitized });
  const [isEditing, setIsEditing] = useState(mode === "create");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Code availability check ────────────────────────────────────────────────
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [codeTakenBy, setCodeTakenBy] = useState<string | null>(null);
  const [suggestingCode, setSuggestingCode] = useState(false);

  useEffect(() => {
    const code = form.code.trim().toUpperCase();
    if (!code || (mode === "edit" && code === (initial?.code ?? "").toUpperCase())) {
      setCodeStatus("idle");
      return;
    }
    setCodeStatus("checking");
    const timeout = setTimeout(async () => {
      let query = supabase.from("suppliers").select("id, name").eq("code", code);
      if (mode === "edit" && initial?.id) {
        query = query.neq("id", initial.id);
      }
      const { data } = await query.maybeSingle();
      if (data) {
        setCodeStatus("taken");
        setCodeTakenBy((data as { name: string }).name);
      } else {
        setCodeStatus("available");
        setCodeTakenBy(null);
      }
    }, 350);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.code]);

  async function suggestNextCode() {
    setSuggestingCode(true);
    const { data } = await supabase
      .from("suppliers")
      .select("code")
      .order("code");

    const codes: string[] = (data ?? []).map((r: { code: string }) => r.code);

    // Strategy 1: purely numeric codes → max + 1
    const numericCodes = codes.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
    if (numericCodes.length > 0) {
      set("code", String(Math.max(...numericCodes) + 1));
      setSuggestingCode(false);
      return;
    }

    // Strategy 2: PREFIX-NNN pattern (e.g. SUP001, SUPP-042)
    const prefixPattern = /^([A-Z]+[-_]?)(\d+)$/i;
    const prefixCodes = codes.filter(c => prefixPattern.test(c));
    if (prefixCodes.length > 0) {
      const prefixes = prefixCodes.map(c => c.match(prefixPattern)![1]);
      const prefix = prefixes.sort(
        (a, b) => prefixes.filter(p => p === b).length - prefixes.filter(p => p === a).length
      )[0];
      const nums = prefixCodes
        .filter(c => c.startsWith(prefix))
        .map(c => parseInt(c.replace(prefix, ""), 10))
        .filter(n => !isNaN(n));
      const nextNum = Math.max(...nums) + 1;
      const sampleLen = String(Math.max(...nums)).length;
      const padded = String(nextNum).padStart(sampleLen, "0");
      set("code", `${prefix}${padded}`);
      setSuggestingCode(false);
      return;
    }

    // Fallback: no existing pattern — seed with SUP001
    set("code", "SUP001");
    setSuggestingCode(false);
  }

  function set<K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  const inp = (field: keyof typeof DEFAULTS, placeholder = "") => ({
    className: "form-input",
    value: (form[field] ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(field, e.target.value as never),
    placeholder,
  });

  async function handleToggleActive() {
    const next = !form.is_active;
    const label = next ? "reactivate" : "deactivate";
    if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} this supplier?`)) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("suppliers")
      .update({ is_active: next })
      .eq("id", initial!.id!);
    if (err) { alert(err.message); setSaving(false); return; }
    set("is_active", next);
    setSaving(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete "${form.name}"? This cannot be undone.`)) return;
    if (!confirm("Are you sure? All contacts, certifications and catalogue links for this supplier will also be removed.")) return;
    setSaving(true);
    const { error: err } = await supabase.from("suppliers").delete().eq("id", initial!.id!);
    if (err) { alert(err.message); setSaving(false); return; }
    router.push("/settings/suppliers");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (codeStatus === "taken") { setError("That supplier code is already in use."); return; }
    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const tenantId = profile!.tenant_id;

    const payload = {
      ...(mode === "create" ? { tenant_id: tenantId } : {}),
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      trading_name: form.trading_name || null,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      website: form.website || null,
      address_line1: form.address_line1 || null,
      address_line2: form.address_line2 || null,
      city: form.city || null,
      state: form.state || null,
      postcode: form.postcode || null,
      country_code: form.country_code || "AU",
      currency: form.currency || "AUD",
      payment_terms: form.payment_terms || null,
      account_number: form.account_number || null,
      tax_registration: form.tax_registration || null,
      purchase_account_code: form.purchase_account_code || null,
      notes: form.notes || null,
      is_active: form.is_active,
      operating_days: (form.operating_days as string[]).length > 0 ? form.operating_days : null,
      operating_open: (form.operating_open as string) || null,
      operating_close: (form.operating_close as string) || null,
      loading_dock_open: (form.loading_dock_open as string) || null,
      loading_dock_close: (form.loading_dock_close as string) || null,
      loading_dock_notes: (form.loading_dock_notes as string) || null,
      order_cutoff_time: (form.order_cutoff_time as string) || null,
      delivery_days: (form.delivery_days as string[]).length > 0 ? form.delivery_days : null,
    };

    const { data, error: err } = mode === "create"
      ? await supabase.from("suppliers").insert(payload).select().single()
      : await supabase.from("suppliers").update(payload).eq("id", initial!.id!).select().single();

    if (err) { setError(err.message); setSaving(false); return; }
    if (mode === "create") {
      router.push(`/settings/suppliers/${data.id}`);
    } else {
      setSaving(false);
      setIsEditing(false);
      router.refresh();
    }
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/settings/suppliers" label="Suppliers" />
      <div className="page-header">
        <div>
          <h1 className="page-title">{mode === "create" ? "New Supplier" : form.name || "Supplier"}</h1>
          <p className="page-subtitle">
            {mode === "create" ? "Add a new supplier to your approved supplier list" : form.trading_name || (form.is_active ? "Active supplier" : "Inactive supplier")}
          </p>
        </div>
        {mode === "edit" && !isEditing && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button type="button" className="btn-secondary" onClick={() => setIsEditing(true)}>Edit</button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleToggleActive}
              disabled={saving}
              style={{ color: form.is_active ? "#92400e" : "#15803d", borderColor: form.is_active ? "#fcd34d" : "#86efac" }}
            >
              {form.is_active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              style={{ fontSize: "0.8125rem", padding: "0.375rem 0.75rem", background: "none", border: "1px solid #fca5a5", color: "#dc2626", borderRadius: "0.375rem", cursor: "pointer" }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* ── View mode summary ─────────────────────────────────────────────── */}
      {!isEditing && mode === "edit" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Supplier Details</h2>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
              {[
                ["Code", form.code],
                ["Company Name", form.name],
                ["Trading Name", form.trading_name || "—"],
                ["Primary Contact", form.contact_name || "—"],
                ["Phone", form.phone || "—"],
                ["Email", form.email || "—"],
                ["Website", form.website || "—"],
                ["ABN / Tax Reg.", form.tax_registration || "—"],
                ["Status", form.is_active ? "Active" : "Inactive"],
              ].map(([k, v]) => (
                <React.Fragment key={k as string}>
                  <div style={{ color: "#78716c" }}>{k}</div>
                  <div style={{ fontWeight: k === "Code" ? 600 : 400, fontFamily: k === "Code" ? "monospace" : undefined }}>{v}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
          {(form.address_line1 || form.city || form.state) && (
            <div className="card">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Address</h2>
              <div style={{ fontSize: "0.875rem", lineHeight: 1.7, color: "#57534e" }}>
                {form.address_line1 && <div>{form.address_line1 as string}</div>}
                {form.address_line2 && <div>{form.address_line2 as string}</div>}
                {(form.city || form.state || form.postcode) && <div>{[form.city, form.state, form.postcode].filter(Boolean).join(" ")}</div>}
                {form.country_code && <div>{form.country_code as string}</div>}
              </div>
            </div>
          )}
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Financial Settings</h2>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
              {[
                ["Currency", form.currency || "—"],
                ["Payment Terms", form.payment_terms || "—"],
                ["Account Number", form.account_number || "—"],
                ["Purchase Acct Code", form.purchase_account_code || "—"],
              ].map(([k, v]) => (
                <React.Fragment key={k as string}>
                  <div style={{ color: "#78716c" }}>{k}</div>
                  <div>{v}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
          {((form.operating_days as string[]).length > 0 || form.operating_open || form.loading_dock_open) && (
            <div className="card">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Operating Hours</h2>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
                {[
                  ["Operating Days", (form.operating_days as string[]).join(", ") || "—"],
                  ["Hours", form.operating_open ? `${form.operating_open} – ${form.operating_close}` : "—"],
                  ["Order Cutoff", (form.order_cutoff_time as string) || "—"],
                  ["Loading Dock", form.loading_dock_open ? `${form.loading_dock_open} – ${form.loading_dock_close}` : "—"],
                  ["Delivery Days", (form.delivery_days as string[]).join(", ") || "—"],
                ].map(([k, v]) => (
                  <React.Fragment key={k as string}>
                    <div style={{ color: "#78716c" }}>{k}</div>
                    <div>{v as string}</div>
                  </React.Fragment>
                ))}
              </div>
              {form.loading_dock_notes && <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#78716c" }}>{form.loading_dock_notes as string}</div>}
            </div>
          )}
          {form.notes && (
            <div className="card">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.5rem" }}>Notes</h2>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "#57534e", whiteSpace: "pre-wrap" }}>{form.notes as string}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Edit form ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} style={{ display: isEditing ? "flex" : "none", flexDirection: "column", gap: "1.5rem" }}>

        {/* Core */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Supplier Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Supplier Code *</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  className="form-input"
                  value={form.code}
                  onChange={e => set("code", e.target.value.toUpperCase())}
                  placeholder="e.g. SUP001"
                  style={{ fontFamily: "monospace", textTransform: "uppercase", flex: 1 }}
                  required
                />
                <button
                  type="button"
                  onClick={suggestNextCode}
                  disabled={suggestingCode}
                  className="btn-secondary"
                  title="Suggest the next available supplier code"
                  style={{ padding: "0.5rem 0.625rem", fontSize: "0.75rem", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {suggestingCode ? "…" : "Next free →"}
                </button>
              </div>
              {/* Availability indicator */}
              {form.code.trim() && codeStatus !== "idle" && (
                <div style={{ marginTop: "0.3rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  {codeStatus === "checking" && (
                    <span style={{ color: "#78716c" }}>Checking availability…</span>
                  )}
                  {codeStatus === "available" && (
                    <span style={{ color: "#15803d", fontWeight: 500 }}>✓ Available</span>
                  )}
                  {codeStatus === "taken" && (
                    <span style={{ color: "#dc2626", fontWeight: 500 }}>
                      ✗ Already used by &ldquo;{codeTakenBy}&rdquo;
                    </span>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Company Name *</label>
              <input {...inp("name", "e.g. Ace Meats Pty Ltd")} required />
            </div>
            <div>
              <label className="form-label">Trading Name</label>
              <input {...inp("trading_name", "If different from company name")} />
            </div>
            <div>
              <label className="form-label">Contact Name</label>
              <input {...inp("contact_name", "e.g. John Smith")} />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input {...inp("phone", "e.g. 0412 345 678")} type="tel" />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input {...inp("email", "e.g. orders@supplier.com.au")} type="email" />
            </div>
            <div>
              <label className="form-label">Website</label>
              <input {...inp("website", "e.g. https://supplier.com.au")} type="url" />
            </div>
            <div>
              <label className="form-label">ABN / Tax Registration No.</label>
              <input {...inp("tax_registration", "e.g. 12 345 678 901")} />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Address</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 1</label>
              <input {...inp("address_line1", "Street address")} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 2</label>
              <input {...inp("address_line2", "Suite, unit, etc.")} />
            </div>
            <div>
              <label className="form-label">City / Suburb</label>
              <input {...inp("city", "e.g. Melbourne")} />
            </div>
            <div>
              <label className="form-label">State / Region</label>
              <input {...inp("state", "e.g. VIC")} />
            </div>
            <div>
              <label className="form-label">Postcode</label>
              <input {...inp("postcode", "e.g. 3000")} />
            </div>
            <div>
              <label className="form-label">Country Code</label>
              <input {...inp("country_code", "AU")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
          </div>
        </div>

        {/* Finance */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Financial Settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Currency</label>
              <input {...inp("currency", "AUD")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="form-label">Payment Terms</label>
              <select className="form-select" value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)}>
                <option value="">— Select or type below —</option>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Our Account Number</label>
              <input {...inp("account_number", "Our account # with this supplier")} />
            </div>
            <div>
              <label className="form-label">Default Purchase Account Code</label>
              <input {...inp("purchase_account_code", "e.g. 300 (for Xero)")} style={{ fontFamily: "monospace" }} />
            </div>
          </div>
        </div>

        {/* Operating Hours */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Operating Hours &amp; Logistics</h2>

          {/* Operating days multi-select */}
          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label">Operating Days</label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {ALL_DAYS.map(day => {
                const active = (form.operating_days as string[] ?? []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const curr = (form.operating_days as string[]) ?? [];
                      set("operating_days", active ? curr.filter(d => d !== day) : [...curr, day]);
                    }}
                    style={{
                      padding: "0.25rem 0.6rem",
                      borderRadius: "0.375rem",
                      border: "1px solid",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      borderColor: active ? "#2563eb" : "var(--border)",
                      background: active ? "#dbeafe" : "transparent",
                      color: active ? "#1d4ed8" : "inherit",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Opens</label>
              <input {...inp("operating_open")} type="time" />
            </div>
            <div>
              <label className="form-label">Closes</label>
              <input {...inp("operating_close")} type="time" />
            </div>
            <div>
              <label className="form-label">Order Cutoff Time</label>
              <input {...inp("order_cutoff_time")} type="time" />
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Loading Dock Hours</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "#78716c" }}>Open</label>
                <input {...inp("loading_dock_open")} type="time" />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: "0.75rem", color: "#78716c" }}>Close</label>
                <input {...inp("loading_dock_close")} type="time" />
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Loading Dock Notes</label>
            <textarea {...inp("loading_dock_notes", "e.g. Rear dock only, no access before 7am")} rows={2} style={{ resize: "vertical" }} />
          </div>

          {/* Delivery days */}
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Days They Deliver To Us</label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {ALL_DAYS.map(day => {
                const active = (form.delivery_days as string[] ?? []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const curr = (form.delivery_days as string[]) ?? [];
                      set("delivery_days", active ? curr.filter(d => d !== day) : [...curr, day]);
                    }}
                    style={{
                      padding: "0.25rem 0.6rem",
                      borderRadius: "0.375rem",
                      border: "1px solid",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      borderColor: active ? "#2563eb" : "var(--border)",
                      background: active ? "#dbeafe" : "transparent",
                      color: active ? "#1d4ed8" : "inherit",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Notes</h2>
          <textarea
            {...inp("notes", "Any notes about this supplier — minimum order requirements, special terms, handling instructions, etc.")}
            className="form-input"
            rows={3}
            style={{ resize: "vertical" }}
          />
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {isEditing && (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button type="submit" className="btn-primary" disabled={saving || codeStatus === "taken"}>
              {saving ? "Saving…" : mode === "create" ? "Create Supplier" : "Save Changes"}
            </button>
            {mode === "create"
              ? <Link href="/settings/suppliers" className="btn-secondary">Cancel</Link>
              : <button type="button" className="btn-secondary" onClick={() => { setIsEditing(false); setError(null); }}>Cancel</button>
            }
            {mode === "edit" && (
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />
                Active supplier
              </label>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
