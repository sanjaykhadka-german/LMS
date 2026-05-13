"use client";

/**
 * Send history table — filtered, light-themed, status-coloured.
 *
 * Filters (Tino May 7 2026):
 *   - free-text search across recipient name/email + customer name + item
 *     name + sender name + subject (single search bar)
 *   - status filter (all / sent / failed)
 *   - document type filter (all / spec / pif)
 *   - date range (from / to)
 */

import { useState, useMemo } from "react";

type Send = {
  id: string;
  sent_at: string;
  document_type: "spec" | "pif" | string;
  version_label: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string | null;
  status: "sent" | "failed" | null;
  error_message: string | null;
  provider_message_id: string | null;
  customer: { id: string; name: string } | null;
  sender:   { id: string; full_name: string } | null;
  item:     { id: string; code: string; name: string } | null;
  spec:     { id: string; version_label: string } | null;
};

export default function SendsTable({ sends }: { sends: Send[] }) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<"all" | "sent" | "failed">("all");
  const [docF, setDocF] = useState<"all" | "spec" | "pif">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return sends.filter(s => {
      if (statusF !== "all" && (s.status ?? "") !== statusF) return false;
      if (docF !== "all" && s.document_type !== docF) return false;
      if (from) { if (new Date(s.sent_at) < new Date(from)) return false; }
      if (to)   {
        const tEnd = new Date(to); tEnd.setHours(23,59,59,999);
        if (new Date(s.sent_at) > tEnd) return false;
      }
      if (ql) {
        const haystack = [
          s.recipient_name, s.recipient_email, s.to_addresses, s.cc_addresses,
          s.customer?.name, s.sender?.full_name, s.item?.name, s.item?.code,
          s.subject,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(ql)) return false;
      }
      return true;
    });
  }, [sends, q, statusF, docF, from, to]);

  function fmtDt(iso: string) {
    return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const anyFilter = !!(q || statusF !== "all" || docF !== "all" || from || to);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.625rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          placeholder="Search recipient, customer, product, sender…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="form-input"
          style={{ width: "320px" }}
        />
        <select value={statusF} onChange={e => setStatusF(e.target.value as "all" | "sent" | "failed")} className="form-input" style={{ width: "130px" }}>
          <option value="all">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <select value={docF} onChange={e => setDocF(e.target.value as "all" | "spec" | "pif")} className="form-input" style={{ width: "130px" }}>
          <option value="all">Spec + PIF</option>
          <option value="spec">Spec only</option>
          <option value="pif">PIF only</option>
        </select>
        <label style={{ fontSize: "0.75rem", color: "#78716c" }}>From</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="form-input" style={{ width: "150px" }} />
        <label style={{ fontSize: "0.75rem", color: "#78716c" }}>To</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="form-input" style={{ width: "150px" }} />
        {anyFilter && (
          <button type="button" className="btn-secondary" style={{ fontSize: "0.8125rem" }}
            onClick={() => { setQ(""); setStatusF("all"); setDocF("all"); setFrom(""); setTo(""); }}>
            Clear filters
          </button>
        )}
        <span style={{ fontSize: "0.8125rem", color: "#78716c", marginLeft: "auto" }}>
          {filtered.length} send{filtered.length !== 1 ? "s" : ""}
          {filtered.length !== sends.length && <span> · {sends.length} total</span>}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem", color: "#78716c" }}>
          {sends.length === 0
            ? "No spec emails have been sent yet. Send your first one from a spec preview page."
            : "No sends match those filters."}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", background: "#fff", color: "#1c1917" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e7e5e4", background: "#fafaf9" }}>
                {[
                  ["Sent",       "150px"],
                  ["Status",     "90px"],
                  ["Doc",        "70px"],
                  ["Recipient",  "auto"],
                  ["Customer",   "180px"],
                  ["Product",    "auto"],
                  ["Sender",     "150px"],
                ].map(([label, w]) => (
                  <th key={label} style={{ width: w, padding: "0.625rem 1rem", textAlign: "left", fontWeight: 700, color: "#57534e", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const isFail = s.status === "failed";
                return (
                  <tr key={s.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f4" : "none", background: isFail ? "#fef2f2" : "#fff" }}
                      title={s.error_message ?? s.subject ?? undefined}>
                    <td style={{ padding: "0.65rem 1rem", color: "#44403c", whiteSpace: "nowrap" }}>{fmtDt(s.sent_at)}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: "0.35rem",
                        padding: "0.15rem 0.55rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 700,
                        background: isFail ? "#fee2e2" : "#dcfce7",
                        color:      isFail ? "#991b1b" : "#166534",
                        border: `1px solid ${isFail ? "#fca5a5" : "#86efac"}`,
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: isFail ? "#dc2626" : "#16a34a" }} />
                        {isFail ? "Failed" : "Sent"}
                      </span>
                    </td>
                    <td style={{ padding: "0.65rem 1rem", color: "#44403c", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.05em", fontWeight: 700 }}>{s.document_type}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#1c1917" }}>{s.recipient_name ?? "—"}</div>
                      <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{s.recipient_email ?? "—"}</div>
                      {s.cc_addresses && <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: 1 }}>cc: {s.cc_addresses}</div>}
                    </td>
                    <td style={{ padding: "0.65rem 1rem", color: "#44403c" }}>{s.customer?.name ?? <span style={{ color: "#a8a29e" }}>—</span>}</td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <div style={{ color: "#1c1917" }}>{s.item?.name ?? "—"}</div>
                      <div style={{ fontSize: "0.7rem", color: "#78716c", fontFamily: "monospace" }}>
                        {s.item?.code ?? ""}{s.version_label ? ` · v${s.version_label}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "0.65rem 1rem", color: "#44403c", fontSize: "0.8125rem" }}>{s.sender?.full_name ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
