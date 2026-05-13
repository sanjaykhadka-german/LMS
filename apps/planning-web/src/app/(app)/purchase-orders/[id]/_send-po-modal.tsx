"use client";

/**
 * Modal launched from the PO detail page "📧 Send to supplier" button.
 *
 * Pre-fills:
 *   • To = supplier primary contact email (passed from server)
 *   • Cc = current user email + tenant.purchasing_email
 *   • Subject = "Purchase Order {po_number} — {tenant.name}"
 *   • Body   = profile.po_email_template (substituted) or default
 *
 * Operator can edit any field before clicking Send. PDF attachment is
 * generated server-side (sendPurchaseOrder action). Modal closes on
 * success; surfaces errors inline.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendPurchaseOrder } from "../actions";

export default function SendPoModal({
  poId,
  poNumber,
  supplierName,
  defaultTo,
  defaultCc,
  defaultSubject,
  defaultBody,
  onClose,
}: {
  poId: string;
  poNumber: string;
  supplierName: string;
  defaultTo: string;
  defaultCc: string;
  defaultSubject: string;
  defaultBody: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSend() {
    if (!to.trim()) {
      setError("To address is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await sendPurchaseOrder({
        orderId: poId,
        toOverride: to,
        ccOverride: cc,
        subject,
        body,
      });
      if (!res.ok) {
        setError(res.error ?? "Send failed");
        return;
      }
      setSuccess(true);
      // Wait a beat so the operator sees the success state, then close +
      // refresh so the PO status (draft → sent) updates.
      setTimeout(() => {
        router.refresh();
        onClose();
      }, 900);
    });
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: "#fff", borderRadius: "0.5rem", overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column",
          width: "100%", maxWidth: "720px", maxHeight: "calc(100vh - 2rem)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.75rem 1rem", borderBottom: "1px solid #e7e5e4",
          background: "#1c1917", color: "#fff",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>
              📧 Send {poNumber} to {supplierName}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            style={{
              background: "rgba(255,255,255,0.1)", color: "#fff",
              border: "1px solid #57534e", borderRadius: "0.375rem",
              padding: "0.35rem 0.75rem", cursor: "pointer", fontSize: "0.8125rem",
              fontWeight: 600,
            }}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: "1rem 1.25rem", overflowY: "auto", flex: 1 }}>
          {success ? (
            <div style={{ padding: "1.5rem", background: "#dcfce7", color: "#166534", borderRadius: "0.5rem", textAlign: "center", fontSize: "0.95rem", fontWeight: 600 }}>
              ✓ Sent! Closing…
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <label className="form-label">To</label>
                <input
                  className="form-input"
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="supplier@example.com (comma-separate for multiple)"
                  disabled={isPending}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                  Resolved from supplier&apos;s primary contact. Edit to override.
                </div>
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label className="form-label">Cc</label>
                <input
                  className="form-input"
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="(comma-separate for multiple)"
                  disabled={isPending}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                  Auto-includes you + your tenant&apos;s purchasing email. Add extras here.
                </div>
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label className="form-label">Subject</label>
                <input
                  className="form-input"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label className="form-label">Body</label>
                <textarea
                  className="form-input"
                  rows={9}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={isPending}
                  style={{ fontFamily: "inherit", lineHeight: 1.5 }}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                  Plain text. Set your default body in Profile → PO email template.
                </div>
              </div>

              <div style={{ padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#57534e", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                📎 PO PDF will be attached automatically as <code style={{ fontFamily: "monospace", color: "#1c1917" }}>{poNumber}.pdf</code>
              </div>

              {error && (
                <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.875rem", background: "#fee2e2", color: "#991b1b", borderRadius: "0.375rem", fontSize: "0.8125rem" }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!success && (
          <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e7e5e4", display: "flex", justifyContent: "flex-end", gap: "0.5rem", background: "#fafaf9" }}>
            <button onClick={onClose} disabled={isPending} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>Cancel</button>
            <button onClick={handleSend} disabled={isPending} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
              {isPending ? "Sending…" : "📧 Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
