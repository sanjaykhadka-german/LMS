"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import LogoUpload from "./logo-upload";
import {
  TEMPLATE_IDS,
  TEMPLATE_LABELS,
  TEMPLATE_DESCRIPTIONS,
  type InvoiceTemplateId,
} from "@/lib/invoice-templates";

type TenantData = {
  id: string;
  name: string;
  invoice_prefix: string;
  has_multi_currency: boolean;
  abn: string | null;
  company_phone: string | null;
  company_email: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
  logo_url: string | null;
  brand_color: string;
  invoice_template_id: InvoiceTemplateId;
  bank_name: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  // Costing & purchasing (migrations 088, 089). default_currency is the
  // tenant's base / costing currency; purchasing_email is CC'd on every PO
  // email; email_send_domain is Phase-2 advanced (custom Resend domain).
  default_currency: string | null;
  purchasing_email: string | null;
  email_send_domain: string | null;
};

export default function TenantSettingsClient({ tenant }: { tenant: TenantData }) {
  const supabase = createClient();
  const router = useRouter();
  const [invoicePrefix, setInvoicePrefix] = useState(tenant.invoice_prefix ?? "INV");
  const [hasMultiCurrency, setHasMultiCurrency] = useState(tenant.has_multi_currency ?? false);

  const [abn, setAbn] = useState(tenant.abn ?? "");
  const [phone, setPhone] = useState(tenant.company_phone ?? "");
  const [email, setEmail] = useState(tenant.company_email ?? "");
  const [addr1, setAddr1] = useState(tenant.billing_address_line1 ?? "");
  const [addr2, setAddr2] = useState(tenant.billing_address_line2 ?? "");
  const [city, setCity]     = useState(tenant.billing_city ?? "");
  const [state, setState]   = useState(tenant.billing_state ?? "");
  const [postcode, setPostcode] = useState(tenant.billing_postcode ?? "");
  const [country, setCountry]   = useState(tenant.billing_country ?? "Australia");

  const [logoUrl, setLogoUrl] = useState<string | null>(tenant.logo_url);
  const [brandColor, setBrandColor] = useState<string>(tenant.brand_color ?? "#b91c1c");
  const [templateId, setTemplateId] = useState<InvoiceTemplateId>(tenant.invoice_template_id ?? "classic");

  const [bankName,    setBankName]    = useState(tenant.bank_name ?? "");
  const [bankBsb,     setBankBsb]     = useState(tenant.bank_bsb ?? "");
  const [bankAcctNo,  setBankAcctNo]  = useState(tenant.bank_account_number ?? "");
  const [bankAcctNm,  setBankAcctNm]  = useState(tenant.bank_account_name ?? "");

  // Costing & purchasing
  const [defaultCurrency,  setDefaultCurrency]  = useState(tenant.default_currency ?? "AUD");
  const [purchasingEmail,  setPurchasingEmail]  = useState(tenant.purchasing_email ?? "");
  const [emailSendDomain,  setEmailSendDomain]  = useState(tenant.email_send_domain ?? "");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function dirty() { setSaved(false); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const prefix = invoicePrefix.trim().toUpperCase().replace(/[^A-Z0-9\-]/g, "");
    if (!prefix) {
      setError("Invoice prefix cannot be empty.");
      setSaving(false);
      return;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
      setError("Brand colour must be a 6-digit hex like #b91c1c.");
      setSaving(false);
      return;
    }

    const { data, error: err } = await supabase
      .from("tenants")
      .update({
        invoice_prefix: prefix,
        has_multi_currency: hasMultiCurrency,
        abn: abn.trim() || null,
        company_phone: phone.trim() || null,
        company_email: email.trim() || null,
        billing_address_line1: addr1.trim() || null,
        billing_address_line2: addr2.trim() || null,
        billing_city: city.trim() || null,
        billing_state: state.trim() || null,
        billing_postcode: postcode.trim() || null,
        billing_country: country.trim() || null,
        logo_url: logoUrl,
        brand_color: brandColor,
        invoice_template_id: templateId,
        bank_name:           bankName.trim() || null,
        bank_bsb:            bankBsb.trim() || null,
        bank_account_number: bankAcctNo.trim() || null,
        bank_account_name:   bankAcctNm.trim() || null,
        // Costing & purchasing
        default_currency:    defaultCurrency.trim().toUpperCase() || null,
        purchasing_email:    purchasingEmail.trim() || null,
        email_send_domain:   emailSendDomain.trim() || null,
      })
      .eq("id", tenant.id)
      .select("id");

    if (err) {
      setError(err.message);
    } else if (!data || data.length === 0) {
      setError("Update returned no rows — likely blocked by row-level security. Apply migration 041_tenants_update_policy.sql.");
    } else {
      setSaved(true);
      setInvoicePrefix(prefix);
      router.refresh();
    }
    setSaving(false);
  }

  const exampleInvoice = `${invoicePrefix.trim().toUpperCase() || "INV"}-01001`;

  return (
    <div style={{ maxWidth: "720px" }}>
      <BackButton href="/settings" label="Settings" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Business Settings</h1>
          <p className="page-subtitle">{tenant.name} — invoicing, branding and currency</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* Invoice Numbering */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Invoice Numbering</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Set a prefix for your invoice numbers. Invoices are numbered sequentially as{" "}
            <span style={{ fontFamily: "monospace", background: "#f5f5f4", padding: "0.125rem 0.375rem", borderRadius: "0.25rem" }}>
              {exampleInvoice}
            </span>
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Invoice Prefix</label>
              <input
                className="form-input"
                value={invoicePrefix}
                onChange={e => { setInvoicePrefix(e.target.value.toUpperCase()); dirty(); }}
                placeholder="INV"
                maxLength={8}
                style={{ fontFamily: "monospace", textTransform: "uppercase", maxWidth: "120px" }}
              />
              <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.25rem" }}>
                Letters, numbers and hyphens only. Max 8 characters.
              </div>
            </div>
            <div style={{ paddingTop: "1.25rem" }}>
              <div style={{ fontSize: "0.8125rem", color: "#78716c" }}>Preview</div>
              <div style={{ fontFamily: "monospace", fontSize: "1rem", fontWeight: 600, color: "#1c1917", marginTop: "0.125rem" }}>
                {exampleInvoice}
              </div>
            </div>
          </div>
        </div>

        {/* Company info — appears on the invoice header */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Company Details</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Shown on every invoice header. ABN and address are required for a compliant tax invoice.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="form-label">ABN</label>
              <input className="form-input" value={abn} onChange={e => { setAbn(e.target.value); dirty(); }} placeholder="12 345 678 901" />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input className="form-input" value={phone} onChange={e => { setPhone(e.target.value); dirty(); }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Email</label>
              <input className="form-input" value={email} type="email" onChange={e => { setEmail(e.target.value); dirty(); }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Billing address line 1</label>
              <input className="form-input" value={addr1} onChange={e => { setAddr1(e.target.value); dirty(); }} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Billing address line 2</label>
              <input className="form-input" value={addr2} onChange={e => { setAddr2(e.target.value); dirty(); }} />
            </div>
            <div>
              <label className="form-label">City</label>
              <input className="form-input" value={city} onChange={e => { setCity(e.target.value); dirty(); }} />
            </div>
            <div>
              <label className="form-label">State</label>
              <input className="form-input" value={state} onChange={e => { setState(e.target.value); dirty(); }} />
            </div>
            <div>
              <label className="form-label">Postcode</label>
              <input className="form-input" value={postcode} onChange={e => { setPostcode(e.target.value); dirty(); }} />
            </div>
            <div>
              <label className="form-label">Country</label>
              <input className="form-input" value={country} onChange={e => { setCountry(e.target.value); dirty(); }} />
            </div>
          </div>
        </div>

        {/* Invoice Branding */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Invoice Branding</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Logo, accent colour and default template applied to every PDF invoice.
            Individual invoices can override the template if needed.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <LogoUpload
              tenantId={tenant.id}
              initialLogoUrl={logoUrl}
              onChanged={(path) => { setLogoUrl(path); dirty(); }}
            />
            <div>
              <label className="form-label">Brand colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                <input
                  type="color"
                  value={brandColor}
                  onChange={e => { setBrandColor(e.target.value); dirty(); }}
                  style={{
                    width: 40, height: 40, padding: 0, border: "1px solid #e7e5e4",
                    borderRadius: "0.375rem", cursor: "pointer", background: "transparent",
                  }}
                />
                <input
                  className="form-input"
                  value={brandColor}
                  onChange={e => { setBrandColor(e.target.value); dirty(); }}
                  style={{ fontFamily: "monospace", maxWidth: "120px", textTransform: "lowercase" }}
                  maxLength={7}
                />
              </div>
              <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.375rem" }}>
                Used for header bands, accents and the total card.
              </div>
            </div>
          </div>

          <div>
            <div className="form-label" style={{ marginBottom: "0.5rem" }}>Default template</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.625rem" }}>
              {TEMPLATE_IDS.map(id => {
                const isSelected = templateId === id;
                return (
                  <div
                    key={id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setTemplateId(id); dirty(); }}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setTemplateId(id); dirty();
                      }
                    }}
                    style={{
                      textAlign: "left", padding: "0.875rem",
                      border: `2px solid ${isSelected ? brandColor : "#e7e5e4"}`,
                      borderRadius: "0.5rem",
                      background: isSelected ? "#fafaf9" : "#ffffff",
                      cursor: "pointer", transition: "border-color 0.12s",
                      display: "flex", flexDirection: "column",
                    }}
                  >
                    <div style={{
                      width: "100%", aspectRatio: "1.4 / 1",
                      background: "#ffffff", borderRadius: "0.25rem",
                      border: "1px solid #e7e5e4", marginBottom: "0.625rem",
                      display: "flex", flexDirection: "column", overflow: "hidden",
                    }}>
                      <TemplatePreview id={id} brandColor={brandColor} />
                    </div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{TEMPLATE_LABELS[id]}</div>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>
                      {TEMPLATE_DESCRIPTIONS[id]}
                    </div>
                    {id === "custom" && (
                      <Link
                        href="/settings/tenant/invoice-template"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "inline-block",
                          marginTop: "0.5rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: brandColor,
                          textDecoration: "none",
                        }}
                      >
                        Customize layout →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Bank Details</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Rendered as a &quot;Payment Details&quot; band at the bottom of every invoice PDF. Leave fields blank to omit them.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Bank name</label>
              <input className="form-input" value={bankName} onChange={e => { setBankName(e.target.value); dirty(); }} placeholder="Commonwealth Bank" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Account name</label>
              <input className="form-input" value={bankAcctNm} onChange={e => { setBankAcctNm(e.target.value); dirty(); }} placeholder="German Butchery Pty Ltd" />
            </div>
            <div>
              <label className="form-label">BSB</label>
              <input className="form-input" value={bankBsb} onChange={e => { setBankBsb(e.target.value); dirty(); }} placeholder="062-000" style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Account number</label>
              <input className="form-input" value={bankAcctNo} onChange={e => { setBankAcctNo(e.target.value); dirty(); }} style={{ fontFamily: "monospace" }} />
            </div>
          </div>
        </div>

        {/* Currency */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Currency</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Enable multi-currency if you invoice customers in foreign currencies (e.g. export customers).
            When disabled, all orders use AUD and the currency selector is hidden.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: "0.625rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={hasMultiCurrency}
              onChange={e => { setHasMultiCurrency(e.target.checked); dirty(); }}
              style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
              Enable multi-currency on orders and invoices
            </span>
          </label>
          {hasMultiCurrency && (
            <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.875rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#1e40af" }}>
              Currency selector will appear on new orders and invoices.
            </div>
          )}
        </div>

        {/* ── Costing & Purchasing ───────────────────────────────────────
            default_currency drives the costing base (standard cost, FX
            comparisons). purchasing_email is CC'd on every PO email send.
            email_send_domain is Phase-2 advanced — leave blank for the
            default platform Resend domain (recommended). */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Costing &amp; Purchasing</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Base currency for cost calculations · email defaults for PO send-out.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
            <div>
              <label className="form-label">Base currency</label>
              <select
                className="form-select"
                value={defaultCurrency}
                onChange={e => { setDefaultCurrency(e.target.value); dirty(); }}
              >
                <option value="AUD">AUD — Australian Dollar</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — Pound Sterling</option>
                <option value="NZD">NZD — New Zealand Dollar</option>
                <option value="SGD">SGD — Singapore Dollar</option>
                <option value="JPY">JPY — Japanese Yen</option>
                <option value="CAD">CAD — Canadian Dollar</option>
              </select>
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                All standard costs and FX comparisons resolve to this currency.
              </div>
            </div>
            <div>
              <label className="form-label">Purchasing CC email</label>
              <input
                className="form-input"
                type="email"
                placeholder="purchasing@yourcompany.com"
                value={purchasingEmail}
                onChange={e => { setPurchasingEmail(e.target.value); dirty(); }}
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                CC&apos;d on every PO email sent. The user placing the order is also CC&apos;d automatically.
              </div>
            </div>
            <div>
              <label className="form-label">Custom email domain <span style={{ fontSize: "0.7rem", fontWeight: 500, color: "#78716c" }}>(advanced)</span></label>
              <input
                className="form-input"
                type="text"
                placeholder="leave blank for platform default"
                value={emailSendDomain}
                onChange={e => { setEmailSendDomain(e.target.value); dirty(); }}
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                Optional. Leave blank to send through the platform&apos;s shared domain (zero setup). Set to your verified Resend domain (e.g. <code>orders.yourcompany.com</code>) for branded From-line sending.
              </div>
            </div>
          </div>
        </div>

        {/* Save */}
        {error && (
          <div style={{ padding: "0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
            {error}
          </div>
        )}
        {saved && (
          <div style={{ padding: "0.75rem", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0.5rem", color: "#166534", fontSize: "0.875rem" }}>
            ✓ Settings saved.
          </div>
        )}
        <div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>

      </div>
    </div>
  );
}

// Inline lightweight previews — pure HTML/CSS sketches of each template.
function TemplatePreview({ id, brandColor }: { id: InvoiceTemplateId; brandColor: string }) {
  if (id === "classic") {
    return (
      <>
        <div style={{ height: "30%", background: brandColor, display: "flex", justifyContent: "space-between", padding: "0.25rem 0.5rem", alignItems: "center" }}>
          <div style={{ width: "30%", height: "55%", background: "rgba(255,255,255,0.8)", borderRadius: 2 }} />
          <div style={{ color: "#fff", fontSize: "0.5rem", fontWeight: 700, letterSpacing: 0.5 }}>INVOICE</div>
        </div>
        <div style={{ flex: 1, padding: "0.375rem 0.5rem", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ height: 4, background: "#e7e5e4", width: "70%", borderRadius: 1 }} />
          <div style={{ height: 4, background: "#e7e5e4", width: "55%", borderRadius: 1 }} />
          <div style={{ height: 4, background: "#e7e5e4", width: "65%", borderRadius: 1, marginTop: 2 }} />
          <div style={{ marginTop: "auto", alignSelf: "flex-end", width: "40%", height: 5, background: brandColor, borderRadius: 1 }} />
        </div>
      </>
    );
  }
  if (id === "modern") {
    return (
      <>
        <div style={{ display: "flex", height: "100%" }}>
          <div style={{ width: 4, background: brandColor }} />
          <div style={{ flex: 1, padding: "0.375rem 0.5rem", display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ width: "30%", height: 6, background: "#cbd5e1", borderRadius: 1 }} />
              <div style={{ fontSize: "0.6rem", color: brandColor, fontWeight: 700, letterSpacing: -0.5 }}>Invoice</div>
            </div>
            <div style={{ height: 3, background: "#e7e5e4", width: "70%", borderRadius: 1 }} />
            <div style={{ height: 3, background: "#e7e5e4", width: "55%", borderRadius: 1 }} />
            <div style={{ marginTop: "auto", alignSelf: "flex-end", width: "55%", height: 14, background: brandColor, borderRadius: 3 }} />
          </div>
        </div>
      </>
    );
  }
  // custom — stylised "design your own" tile
  return (
    <div style={{
      flex: 1, padding: "0.5rem 0.625rem",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 4,
      backgroundImage: "repeating-linear-gradient(45deg, #fafaf9 0 6px, transparent 6px 12px)",
    }}>
      <div style={{
        fontSize: "1.25rem", lineHeight: 1, fontWeight: 700, color: brandColor,
      }}>+</div>
      <div style={{ fontSize: "0.5rem", textTransform: "uppercase", letterSpacing: 1, color: "#57534e", fontWeight: 600 }}>
        Drag &amp; drop
      </div>
      <div style={{ fontSize: "0.45rem", color: "#78716c" }}>Design your own</div>
    </div>
  );
}
