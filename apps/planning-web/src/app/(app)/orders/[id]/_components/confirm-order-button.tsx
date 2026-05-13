"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
}

export default function ConfirmOrderButton({ orderId, orderNumber, customerName, customerEmail }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState(customerEmail ?? "");
  const [extraInput, setExtraInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "warn" | "error"; text: string } | null>(null);

  function addExtra() {
    const val = extraInput.trim();
    if (!val) return;
    setRecipients(prev => prev ? `${prev}, ${val}` : val);
    setExtraInput("");
  }

  async function submit(sendEmail: boolean) {
    setLoading(true);
    setNotice(null);
    try {
      const recipientList = sendEmail
        ? recipients.split(",").map(r => r.trim()).filter(r => r.includes("@"))
        : [];

      const res = await fetch(`/api/orders/${orderId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: recipientList }),
      });

      const data = await res.json();

      if (!res.ok) {
        setNotice({ type: "error", text: data.error ?? "Something went wrong." });
        setLoading(false);
        return;
      }

      if (data.emailResult?.error) {
        setNotice({ type: "warn", text: data.emailResult.error });
        // Still refresh — order was confirmed
        setTimeout(() => { router.refresh(); setOpen(false); }, 3000);
      } else {
        router.refresh();
        setOpen(false);
      }
    } catch {
      setNotice({ type: "error", text: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen(true)}
      >
        Mark as Confirmed &rarr;
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{
            background: "#fff", borderRadius: "0.75rem",
            width: "min(480px, 92vw)", padding: "1.75rem",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }}>
            {/* Header */}
            <div style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.125rem", fontWeight: 700 }}>
                Confirm Order #{orderNumber}
              </h2>
              {customerName && (
                <p style={{ margin: 0, fontSize: "0.875rem", color: "#78716c" }}>{customerName}</p>
              )}
            </div>

            {/* Recipients */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#44403c", display: "block", marginBottom: "0.375rem" }}>
                Send confirmation email to
              </label>
              <textarea
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #d6d3d1", fontSize: "0.875rem",
                  fontFamily: "inherit", resize: "vertical", minHeight: "64px",
                  color: "#1c1917",
                }}
                placeholder="email@example.com, another@example.com"
                value={recipients}
                onChange={e => setRecipients(e.target.value)}
              />
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#a8a29e" }}>
                Separate multiple addresses with commas. Leave blank to confirm without sending.
              </p>
            </div>

            {/* Add extra recipient */}
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
              <input
                style={{
                  flex: 1, padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                  border: "1px solid #d6d3d1", fontSize: "0.8125rem",
                }}
                placeholder="Add another recipient…"
                value={extraInput}
                onChange={e => setExtraInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.8125rem", whiteSpace: "nowrap" }}
                onClick={addExtra}
              >
                + Add
              </button>
            </div>

            {/* Notice */}
            {notice && (
              <div style={{
                marginBottom: "1rem", padding: "0.625rem 0.875rem",
                borderRadius: "0.375rem",
                background: notice.type === "error" ? "#fef2f2" : "#fffbeb",
                border: `1px solid ${notice.type === "error" ? "#fecaca" : "#fde68a"}`,
                color: notice.type === "error" ? "#b91c1c" : "#b45309",
                fontSize: "0.8125rem",
              }}>
                {notice.text}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.875rem" }}
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: "0.875rem" }}
                onClick={() => submit(false)}
                disabled={loading}
              >
                Confirm without Email
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: "0.875rem" }}
                onClick={() => submit(true)}
                disabled={loading || !recipients.trim()}
              >
                {loading ? "Confirming…" : "Send & Confirm →"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
