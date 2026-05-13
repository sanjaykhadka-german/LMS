"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import Link from "next/link";

const PAYMENT_TERMS = ["COD", "7 days", "14 days", "Net 30", "Net 60", "EOM 30", "Prepaid", "Account"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CustomerData = {
  id?: string;
  code?: string; name?: string; trading_name?: string;
  contact_name?: string; phone?: string; email?: string; website?: string;
  address_line1?: string; address_line2?: string;
  city?: string; state?: string; postcode?: string; country_code?: string;
  currency?: string; price_group_id?: string;
  payment_terms?: string; account_number?: string; tax_registration?: string;
  sales_account_code?: string;
  delivery_day?: number | null; delivery_instructions?: string; notes?: string;
  is_active?: boolean;
  receiving_days?: string[] | null;
  receiving_open?: string | null;
  receiving_close?: string | null;
  loading_dock_notes?: string | null;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_postcode?: string | null;
  billing_country_code?: string | null;
  delivery_is_same_as_billing?: boolean | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_postcode?: string | null;
};

const DEFAULTS = {
  code: "", name: "", trading_name: "",
  contact_name: "", phone: "", email: "", website: "",
  address_line1: "", address_line2: "",
  city: "", state: "", postcode: "", country_code: "AU",
  currency: "AUD", price_group_id: "",
  payment_terms: "", account_number: "", tax_registration: "",
  sales_account_code: "",
  delivery_day: "", delivery_instructions: "", notes: "",
  is_active: true,
  receiving_days: [] as string[],
  receiving_open: "", receiving_close: "", loading_dock_notes: "",
  billing_address_line1: "", billing_address_line2: "",
  billing_city: "", billing_state: "", billing_postcode: "", billing_country_code: "AU",
  delivery_is_same_as_billing: true,
  delivery_address_line1: "", delivery_address_line2: "",
  delivery_city: "", delivery_state: "", delivery_postcode: "",
};

export default function CustomerForm({ mode, initial }: { mode: "create" | "edit"; initial?: CustomerData }) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    ...DEFAULTS,
    ...Object.fromEntries(
      Object.entries(initial ?? {}).map(([k, v]) => {
        if (Array.isArray(v)) return [k, v];
        if (typeof v === "boolean") return [k, v];
        return [k, v == null ? "" : String(v)];
      })
    ),
    receiving_days: (initial?.receiving_days ?? []) as string[],
    is_active: initial?.is_active ?? true,
    delivery_is_same_as_billing: initial?.delivery_is_same_as_billing ?? true,
  });
  const [isEditing, setIsEditing] = useState(mode === "create");
  const [priceGroups, setPriceGroups] = useState<Array<{ id: string; code: string | null; name: string; default_margin_pct: number | string | null; sort_order: number | null; is_standard: boolean | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("price_groups").select("id, code, name, default_margin_pct, sort_order, is_standard").eq("is_active", true).order("sort_order", { nullsFirst: false }).order("name")
      .then(({ data }) => setPriceGroups(data ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type FormState = typeof DEFAULTS & { is_active: boolean; receiving_days: string[] };
  function set(k: string, v: string | boolean | string[]) {
    setForm((f: FormState) => ({ ...f, [k]: v }));
  }

  function toggleDay(field: string, day: string) {
    const curr = (form as Record<string, unknown>)[field] as string[] ?? [];
    set(field, curr.includes(day) ? curr.filter(d => d !== day) : [...curr, day]);
  }

  const inp = (field: string, placeholder = "") => ({
    className: "form-input",
    value: (form as Record<string, string | boolean>)[field] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(field, e.target.value),
    placeholder,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const tenantId = profile!.tenant_id;

    const payload = {
      ...(mode === "create" ? { tenant_id: tenantId } : {}),
      code: (form.code as string).trim().toUpperCase(),
      name: (form.name as string).trim(),
      trading_name: (form.trading_name as string) || null,
      contact_name: (form.contact_name as string) || null,
      phone: (form.phone as string) || null,
      email: (form.email as string) || null,
      website: (form.website as string) || null,
      address_line1: (form.address_line1 as string) || null,
      address_line2: (form.address_line2 as string) || null,
      city: (form.city as string) || null,
      state: (form.state as string) || null,
      postcode: (form.postcode as string) || null,
      country_code: (form.country_code as string) || "AU",
      currency: (form.currency as string) || "AUD",
      price_group_id: (form.price_group_id as string) || null,
      payment_terms: (form.payment_terms as string) || null,
      account_number: (form.account_number as string) || null,
      tax_registration: (form.tax_registration as string) || null,
      sales_account_code: (form.sales_account_code as string) || null,
      delivery_day: (form.delivery_day as string) !== "" ? parseInt(form.delivery_day as string) : null,
      delivery_instructions: (form.delivery_instructions as string) || null,
      notes: (form.notes as string) || null,
      is_active: form.is_active,
      receiving_days: (form.receiving_days as string[]).length > 0 ? form.receiving_days : null,
      receiving_open: (form.receiving_open as string) || null,
      receiving_close: (form.receiving_close as string) || null,
      loading_dock_notes: (form.loading_dock_notes as string) || null,
      billing_address_line1: (form.billing_address_line1 as string) || null,
      billing_address_line2: (form.billing_address_line2 as string) || null,
      billing_city: (form.billing_city as string) || null,
      billing_state: (form.billing_state as string) || null,
      billing_postcode: (form.billing_postcode as string) || null,
      billing_country_code: (form.billing_country_code as string) || null,
      delivery_is_same_as_billing: form.delivery_is_same_as_billing as boolean,
      delivery_address_line1: (form.delivery_address_line1 as string) || null,
      delivery_address_line2: (form.delivery_address_line2 as string) || null,
      delivery_city: (form.delivery_city as string) || null,
      delivery_state: (form.delivery_state as string) || null,
      delivery_postcode: (form.delivery_postcode as string) || null,
    };

    const { data, error: err } = mode === "create"
      ? await supabase.from("customers").insert(payload).select().single()
      : await supabase.from("customers").update(payload).eq("id", initial!.id!).select().single();

    if (err) { setError(err.message); setSaving(false); return; }
    if (mode === "create") {
      router.push(`/customers/${data.id}`);
    } else {
      setSaving(false);
      setIsEditing(false);
      router.refresh();
    }
  }

  const pg = priceGroups.find(p => p.id === (form.price_group_id as string));
  const dayLabel = DAY_NAMES;

  return (
    <div style={{ maxWidth: "900px" }}>
      <BackButton href="/customers" label="Customers" />
      <div className="page-header">
        <div>
          <h1 className="page-title">{mode === "create" ? "New Customer" : (form.name as string) || "Customer"}</h1>
          <p className="page-subtitle">
            {mode === "create" ? "Add a new customer account" : (form.trading_name as string) || (form.is_active ? "Active customer" : "Inactive customer")}
          </p>
        </div>
        {mode === "edit" && !isEditing && (
          <button type="button" className="btn-secondary" onClick={() => setIsEditing(true)}>Edit</button>
        )}
      </div>

      {/* ── View mode summary ─────────────────────────────────────────────── */}
      {!isEditing && mode === "edit" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Customer Details</h2>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
              {([
                ["Code", form.code],
                ["Company Name", form.name],
                ["Trading Name", form.trading_name || "—"],
                ["Contact Name", form.contact_name || "—"],
                ["Phone", form.phone || "—"],
                ["Email", form.email || "—"],
                ["ABN / Tax Reg.", form.tax_registration || "—"],
                ["Status", form.is_active ? "Active" : "Inactive"],
              ] as [string, string][]).map(([k, v]) => (
                <React.Fragment key={k}>
                  <div style={{ color: "#78716c" }}>{k}</div>
                  <div style={{ fontWeight: k === "Code" ? 600 : 400, fontFamily: k === "Code" ? "monospace" : undefined }}>{v || "—"}</div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {(form.address_line1 || form.city) && (
            <div className="card">
              <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Company Address</h2>
              <div style={{ fontSize: "0.875rem", lineHeight: 1.7, color: "#57534e" }}>
                {form.address_line1 && <div>{form.address_line1 as string}</div>}
                {form.address_line2 && <div>{form.address_line2 as string}</div>}
                {(form.city || form.state || form.postcode) && (
                  <div>{[form.city, form.state, form.postcode].filter(Boolean).join(" ")}</div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Pricing &amp; Finance</h2>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
              {([
                ["Price Group", pg?.name || "—"],
                ["Currency", form.currency || "AUD"],
                ["Payment Terms", form.payment_terms || "—"],
                ["Account Number", form.account_number || "—"],
              ] as [string, string][]).map(([k, v]) => (
                <React.Fragment key={k}>
                  <div style={{ color: "#78716c" }}>{k}</div><div>{v}</div>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Delivery &amp; Receiving</h2>
            {/* Delivery address — shown prominently for drivers */}
            {!(form.delivery_is_same_as_billing as boolean) && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0.5rem", padding: "0.75rem 1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#166534", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.375rem" }}>
                  📍 Delivery Address
                </div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#1c1917", lineHeight: 1.6 }}>
                  {form.delivery_address_line1 && <div>{form.delivery_address_line1 as string}</div>}
                  {form.delivery_address_line2 && <div>{form.delivery_address_line2 as string}</div>}
                  {(form.delivery_city || form.delivery_state || form.delivery_postcode) && (
                    <div>{[form.delivery_city, form.delivery_state, form.delivery_postcode].filter(Boolean).join(" ")}</div>
                  )}
                </div>
                {(form.address_line1 || form.city) && (
                  <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.375rem" }}>
                    HQ: {[form.address_line1, form.city, form.state].filter(Boolean).join(", ")}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
              {([
                ["Preferred Day", (form.delivery_day as string) !== "" ? dayLabel[parseInt(form.delivery_day as string)] : "—"],
                ["Receiving Days", (form.receiving_days as string[]).join(", ") || "—"],
                ["Receiving Hours", form.receiving_open ? `${form.receiving_open} – ${form.receiving_close}` : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <React.Fragment key={k}>
                  <div style={{ color: "#78716c" }}>{k}</div><div>{v}</div>
                </React.Fragment>
              ))}
              {form.delivery_instructions && (
                <><div style={{ color: "#78716c" }}>Delivery Notes</div><div style={{ whiteSpace: "pre-wrap" }}>{form.delivery_instructions as string}</div></>
              )}
              {form.loading_dock_notes && (
                <><div style={{ color: "#78716c" }}>Loading Dock</div><div style={{ whiteSpace: "pre-wrap" }}>{form.loading_dock_notes as string}</div></>
              )}
            </div>
          </div>

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
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Customer Details</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Customer Code *</label>
              <input className="form-input" value={form.code as string} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="e.g. CUST001" required style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="form-label">Company / Customer Name *</label>
              <input {...inp("name", "e.g. Woolworths Deli Dept")} required />
            </div>
            <div>
              <label className="form-label">Trading Name</label>
              <input {...inp("trading_name", "If different")} />
            </div>
            <div>
              <label className="form-label">Contact Name</label>
              <input {...inp("contact_name", "e.g. Jane Brown")} />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input {...inp("phone")} type="tel" />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input {...inp("email")} type="email" />
            </div>
            <div>
              <label className="form-label">ABN / Tax Registration</label>
              <input {...inp("tax_registration", "e.g. 12 345 678 901")} />
            </div>
          </div>
        </div>

        {/* Company Address */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Company / Head Office Address</h2>
          <p style={{ fontSize: "0.8rem", color: "#78716c", margin: "0 0 1rem" }}>The registered company address. Used as the default delivery address unless a separate one is set below.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 1</label>
              <input {...inp("address_line1")} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 2</label>
              <input {...inp("address_line2")} />
            </div>
            <div>
              <label className="form-label">City / Suburb</label>
              <input {...inp("city")} />
            </div>
            <div>
              <label className="form-label">State</label>
              <input {...inp("state", "e.g. VIC")} />
            </div>
            <div>
              <label className="form-label">Postcode</label>
              <input {...inp("postcode")} />
            </div>
            <div>
              <label className="form-label">Country Code</label>
              <input {...inp("country_code", "AU")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
          </div>
        </div>

        {/* Delivery Address */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.75rem" }}>Delivery Address</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "0.625rem", cursor: "pointer", marginBottom: "1rem" }}>
            <input
              type="checkbox"
              checked={form.delivery_is_same_as_billing as boolean}
              onChange={e => set("delivery_is_same_as_billing", e.target.checked)}
              style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.875rem" }}>Same as company address</span>
          </label>
          {!(form.delivery_is_same_as_billing as boolean) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Delivery Address Line 1</label>
                <input {...inp("delivery_address_line1", "e.g. 12 Warehouse Rd")} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Delivery Address Line 2</label>
                <input {...inp("delivery_address_line2")} />
              </div>
              <div>
                <label className="form-label">City / Suburb</label>
                <input {...inp("delivery_city")} />
              </div>
              <div>
                <label className="form-label">State</label>
                <input {...inp("delivery_state", "e.g. VIC")} />
              </div>
              <div>
                <label className="form-label">Postcode</label>
                <input {...inp("delivery_postcode")} />
              </div>
            </div>
          )}
        </div>

        {/* Pricing & Finance */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Pricing &amp; Finance</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Price Group</label>
              <select className="form-select" value={form.price_group_id as string} onChange={e => set("price_group_id", e.target.value)}>
                <option value="">— No price group —</option>
                {priceGroups.map(pg => {
                  const m = pg.default_margin_pct != null ? Number(pg.default_margin_pct) : null;
                  const label = `${pg.code ? pg.code + " — " : ""}${pg.name}${m != null ? ` (${m}%)` : ""}${pg.is_standard ? " · std" : ""}`;
                  return <option key={pg.id} value={pg.id}>{label}</option>;
                })}
              </select>
              <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.2rem" }}>Drives default per-item pricing for this customer.</div>
            </div>
            <div>
              <label className="form-label">Currency</label>
              <input {...inp("currency", "AUD")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="form-label">Payment Terms</label>
              <select className="form-select" value={form.payment_terms as string} onChange={e => set("payment_terms", e.target.value)}>
                <option value="">— Select —</option>
                {PAYMENT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Account Number (our ref)</label>
              <input {...inp("account_number")} />
            </div>
            <div>
              <label className="form-label">Sales Account Code</label>
              <input {...inp("sales_account_code", "e.g. 200")} style={{ fontFamily: "monospace" }} />
            </div>
          </div>
        </div>

        {/* Delivery */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Delivery Settings</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Preferred Delivery Day</label>
              <select className="form-select" value={form.delivery_day as string} onChange={e => set("delivery_day", e.target.value)}>
                <option value="">— Any day —</option>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Delivery Instructions</label>
              <textarea {...inp("delivery_instructions", "e.g. Deliver to loading dock, ring before 7am")} className="form-input" rows={2} style={{ resize: "vertical" }} />
            </div>
          </div>
        </div>

        {/* Receiving Hours */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Receiving Hours</h2>
          <div style={{ marginBottom: "1rem" }}>
            <label className="form-label">Days They Accept Deliveries</label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {SHORT_DAYS.map(day => {
                const active = ((form.receiving_days as string[]) ?? []).includes(day);
                return (
                  <button key={day} type="button" onClick={() => toggleDay("receiving_days", day)} style={{ padding: "0.25rem 0.6rem", borderRadius: "0.375rem", border: "1px solid", fontSize: "0.8rem", cursor: "pointer", borderColor: active ? "#2563eb" : "var(--border)", background: active ? "#dbeafe" : "transparent", color: active ? "#1d4ed8" : "inherit", fontWeight: active ? 600 : 400 }}>
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Receiving Opens</label>
              <input {...inp("receiving_open")} type="time" />
            </div>
            <div>
              <label className="form-label">Receiving Closes</label>
              <input {...inp("receiving_close")} type="time" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Loading Dock Notes</label>
              <textarea {...inp("loading_dock_notes", "e.g. Rear dock only, call ahead on 0412 000 000")} className="form-input" rows={2} style={{ resize: "vertical" }} />
            </div>
          </div>
        </div>

        {/* Billing Address */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Billing Address</h2>
          <p style={{ fontSize: "0.8rem", color: "#78716c", margin: "0 0 1rem" }}>Leave blank if same as delivery address above.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 1</label>
              <input {...inp("billing_address_line1")} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Address Line 2</label>
              <input {...inp("billing_address_line2")} />
            </div>
            <div>
              <label className="form-label">City / Suburb</label>
              <input {...inp("billing_city")} />
            </div>
            <div>
              <label className="form-label">State</label>
              <input {...inp("billing_state", "e.g. VIC")} />
            </div>
            <div>
              <label className="form-label">Postcode</label>
              <input {...inp("billing_postcode")} />
            </div>
            <div>
              <label className="form-label">Country Code</label>
              <input {...inp("billing_country_code", "AU")} style={{ fontFamily: "monospace", textTransform: "uppercase" }} />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Notes</h2>
          <textarea {...inp("notes", "Any notes about this customer...")} className="form-input" rows={3} style={{ resize: "vertical" }} />
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.75rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}

        {isEditing && (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving..." : mode === "create" ? "Create Customer" : "Save Changes"}
            </button>
            {mode === "create"
              ? <Link href="/customers" className="btn-secondary">Cancel</Link>
              : <button type="button" className="btn-secondary" onClick={() => { setIsEditing(false); setError(null); }}>Cancel</button>
            }
            {mode === "edit" && (
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                <input type="checkbox" checked={form.is_active as boolean} onChange={e => set("is_active", e.target.checked)} />
                Active customer
              </label>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
