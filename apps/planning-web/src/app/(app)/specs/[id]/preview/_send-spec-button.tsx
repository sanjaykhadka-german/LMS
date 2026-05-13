"use client";

/**
 * Send-spec button + email-compose modal — lives on the spec preview toolbar.
 *
 * Tino May 7 2026 v2: previous modal was too small ("you really have to
 * look at things twice"). Rebuilt as an email-client layout —
 * To / Cc / Bcc / Subject / Body stacked rows, attachment line, action
 * footer. Scales to full-screen on mobile (≤640 px) and a centred 720 px
 * dialog on desktop.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sendProductSpec } from "../../actions";

export default function SendSpecButton({ specId }: { specId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<"spec" | "pif">("spec");
  const [to, setTo] = useState("");
  const [toName, setToName] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function reset() {
    setTo(""); setToName(""); setCc(""); setBcc("");
    setSubject(""); setBody("");
    setErr(null); setOkMsg(null);
  }

  async function handleSend() {
    if (!to.trim()) { setErr("Recipient (To) is required."); return; }
    setErr(null); setOkMsg(null); setSending(true);
    const result = await sendProductSpec({
      specId,
      documentType: docType,
      recipientName: toName.trim() || null,
      recipientEmail: to.trim(),
      extraCc: cc.trim() || null,
      extraBcc: bcc.trim() || null,
      subjectOverride: subject.trim() || null,
      bodyOverride: body.trim() || null,
      customerId: null,
      notes: null,
    });
    setSending(false);
    if (!result.ok) { setErr(result.error ?? "Send failed."); return; }
    setOkMsg("Sent.");
    setTimeout(() => { setOpen(false); reset(); router.refresh(); }, 800);
  }

  return (
    <>
      <button type="button" onClick={() => { reset(); setOpen(true); }}
        style={{ padding: "0.375rem 1rem", background: "#1c1917", border: "none", borderRadius: "0.375rem", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
        title="Send the spec PDF to a customer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
        Send
      </button>

      {open && (
        <div className="no-print"
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => !sending && setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="send-modal-shell"
            style={{ background: "#fff", width: "min(720px, 100vw)", maxHeight: "100vh", borderRadius: "0.5rem", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <style>{`
              @media (max-width: 640px) {
                .send-modal-shell { width: 100vw !important; height: 100vh !important; max-height: 100vh !important; border-radius: 0 !important; }
                .send-modal-row { flex-direction: column !important; align-items: stretch !important; gap: 0.25rem !important; }
                .send-modal-row > label { width: auto !important; padding: 0 !important; }
              }
            `}</style>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", background: "#fafaf9" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 7l10 7 10-7"/>
              </svg>
              <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700, color: "#1c1917", flex: 1 }}>New message — {docType === "pif" ? "PIF" : "Product Specification"}</h2>
              <button onClick={() => !sending && setOpen(false)} disabled={sending} aria-label="Close"
                style={{ background: "transparent", border: "none", padding: "0.25rem", cursor: sending ? "not-allowed" : "pointer", color: "#78716c" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0.875rem 1.25rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                {(["spec", "pif"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setDocType(t)} disabled={sending}
                    style={{ flex: 1, padding: "0.5rem", border: "1px solid", borderColor: docType === t ? "#1c1917" : "#d6d3d1", borderRadius: "0.375rem", background: docType === t ? "#1c1917" : "#fff", color: docType === t ? "#fff" : "#1c1917", fontWeight: 600, fontSize: "0.8125rem", cursor: sending ? "not-allowed" : "pointer" }}>
                    {t === "spec" ? "Spec sheet" : "Product Information Form"}
                  </button>
                ))}
              </div>

              <Row label="To *">
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <input value={toName} onChange={e => setToName(e.target.value)} placeholder="Name (optional)" disabled={sending} style={{ ...inp, flex: "0 0 200px" }} />
                  <input value={to} onChange={e => setTo(e.target.value)} placeholder="customer@example.com" disabled={sending} type="email" style={{ ...inp, flex: 1, minWidth: "180px" }} />
                </div>
              </Row>
              <Row label="Cc">
                <input value={cc} onChange={e => setCc(e.target.value)} placeholder="extra cc1@example.com, cc2@…" disabled={sending} style={inp} />
              </Row>
              <Row label="Bcc">
                <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="bcc1@example.com, bcc2@…" disabled={sending} style={inp} />
              </Row>
              <Row label="Subject">
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="(auto: Product Specification: <item> v<n> – <tenant>)" disabled={sending} style={inp} />
              </Row>
              <Row label="Body" align="top">
                <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="(auto: short cover note with sender + filename. Type here to override.)" disabled={sending} rows={6}
                  style={{ ...inp, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }} />
              </Row>

              <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.75rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#166534", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                <span>Spec PDF will be attached automatically. <strong>You</strong> + your tenant&apos;s QA address are auto-Cc&apos;d.</span>
              </div>

              {err && <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.75rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>{err}</div>}
              {okMsg && <div style={{ marginTop: "0.75rem", padding: "0.625rem 0.75rem", background: "#dcfce7", border: "1px solid #86efac", borderRadius: "0.375rem", color: "#166534", fontSize: "0.8125rem", fontWeight: 600 }}>{okMsg}</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.875rem 1.25rem", borderTop: "1px solid #e7e5e4", background: "#fafaf9", flexWrap: "wrap", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#78716c" }}>Subject + Body are auto-composed when left blank.</span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={() => setOpen(false)} disabled={sending}
                  style={{ padding: "0.5rem 1rem", background: "#fff", border: "1px solid #d6d3d1", borderRadius: "0.375rem", fontWeight: 600, fontSize: "0.8125rem", cursor: sending ? "not-allowed" : "pointer", color: "#44403c" }}>
                  Cancel
                </button>
                <button type="button" onClick={handleSend} disabled={sending || !to.trim()}
                  style={{ padding: "0.5rem 1.25rem", background: sending || !to.trim() ? "#a8a29e" : "#b91c1c", border: "none", borderRadius: "0.375rem", color: "#fff", fontWeight: 700, fontSize: "0.8125rem", cursor: sending ? "wait" : !to.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                  </svg>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, children, align = "center" }: { label: string; children: React.ReactNode; align?: "center" | "top" }) {
  return (
    <div className="send-modal-row" style={{ display: "flex", alignItems: align === "top" ? "flex-start" : "center", gap: "0.625rem", marginBottom: "0.625rem" }}>
      <label style={{ width: "70px", fontSize: "0.75rem", fontWeight: 700, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: align === "top" ? "0.5rem" : 0, flexShrink: 0 }}>
        {label}
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "0.5rem 0.625rem", border: "1px solid #d6d3d1", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#1c1917", background: "#fff", boxSizing: "border-box" };
