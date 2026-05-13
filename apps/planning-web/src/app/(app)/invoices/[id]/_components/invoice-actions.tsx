"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  TEMPLATE_IDS,
  TEMPLATE_LABELS,
  type InvoiceTemplateId,
} from "@/lib/invoice-templates";

const NEXT_STATUS: Record<string, string> = { draft: "sent", sent: "paid" };
const NEXT_LABEL: Record<string, string> = { draft: "Mark as Sent", sent: "Mark as Paid" };

export default function InvoiceActions({
  invoiceId, status, orderId, templateId, tenantDefaultTemplate,
}: {
  invoiceId: string;
  status: string;
  orderId: string | null;
  templateId: InvoiceTemplateId | null;
  tenantDefaultTemplate: InvoiceTemplateId;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<InvoiceTemplateId | null>(templateId);

  async function advance() {
    const next = NEXT_STATUS[status];
    if (!next) return;
    setLoading(true);
    await supabase.from("invoices").update({ status: next }).eq("id", invoiceId);
    setLoading(false);
    router.refresh();
  }

  async function voidInvoice() {
    if (!confirm("Void this invoice? This cannot be undone.")) return;
    setLoading(true);
    await supabase.from("invoices").update({ status: "void" }).eq("id", invoiceId);
    setLoading(false);
    router.refresh();
  }

  async function changeTemplate(value: string) {
    const next = value === "default" ? null : (value as InvoiceTemplateId);
    setCurrentTemplate(next);
    setTplSaving(true);
    setTplError(null);
    const { error: err } = await supabase
      .from("invoices")
      .update({ template_id: next })
      .eq("id", invoiceId)
      .select("id")
      .single();
    setTplSaving(false);
    if (err) {
      setTplError(err.message);
      setCurrentTemplate(templateId);
    } else {
      router.refresh();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: "0.625rem" }}>
        <a
          href={`/api/invoices/${invoiceId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
          style={{ fontSize: "0.875rem", textDecoration: "none" }}
        >
          Download PDF
        </a>
        {orderId && (
          <Link href={`/orders/${orderId}`} className="btn-secondary" style={{ fontSize: "0.875rem" }}>
            View Order
          </Link>
        )}
        {status !== "void" && status !== "paid" && NEXT_STATUS[status] && (
          <button className="btn-primary" onClick={advance} disabled={loading} style={{ fontSize: "0.875rem" }}>
            {loading ? "Saving…" : NEXT_LABEL[status]}
          </button>
        )}
        {status !== "void" && status !== "paid" && (
          <button onClick={voidInvoice} disabled={loading}
            style={{ fontSize: "0.875rem", background: "none", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#dc2626", cursor: "pointer", padding: "0.5rem 1rem" }}>
            Void
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "#78716c" }}>
        <label htmlFor="invoice-template">Template:</label>
        <select
          id="invoice-template"
          value={currentTemplate ?? "default"}
          onChange={e => changeTemplate(e.target.value)}
          disabled={tplSaving}
          style={{
            fontSize: "0.75rem", padding: "0.25rem 0.5rem",
            border: "1px solid #e7e5e4", borderRadius: "0.375rem", background: "#fff",
          }}
        >
          <option value="default">Tenant default ({TEMPLATE_LABELS[tenantDefaultTemplate]})</option>
          {TEMPLATE_IDS.map(id => (
            <option key={id} value={id}>{TEMPLATE_LABELS[id]}</option>
          ))}
        </select>
        {tplSaving && <span>saving…</span>}
      </div>
      {tplError && (
        <div style={{ fontSize: "0.75rem", color: "#dc2626" }}>
          Couldn&apos;t save template: {tplError}
        </div>
      )}
    </div>
  );
}
