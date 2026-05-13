"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type OrderRow = {
  id: string;
  order_number: string;
  order_seq: number | null;
  order_date: string;
  required_date: string | null;
  status: string;
  currency: string;
  customer_po_number: string | null;
  customer: { id: string; code: string; name: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  draft:      "badge-gray",
  confirmed:  "badge-blue",
  dispatched: "badge-green",
  invoiced:   "badge-gray",
  cancelled:  "badge-red",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", confirmed: "Confirmed",
  dispatched: "Dispatched", invoiced: "Invoiced", cancelled: "Cancelled",
};

// Which statuses count as "open"
const OPEN_STATUSES = new Set(["draft", "confirmed"]);
const CLOSED_STATUSES = new Set(["dispatched", "invoiced", "cancelled"]);

type Tab = "all" | "open" | "closed";

const TABS: { id: Tab; label: string }[] = [
  { id: "all",    label: "All" },
  { id: "open",   label: "Open" },
  { id: "closed", label: "Dispatched / Invoiced" },
];

export default function OrdersTable({
  orders,
  customers,
}: {
  orders: OrderRow[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");

  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter(o => {
      // Tab filter
      if (tab === "open"   && !OPEN_STATUSES.has(o.status))   return false;
      if (tab === "closed" && !CLOSED_STATUSES.has(o.status)) return false;

      // Customer filter
      if (customerId && o.customer?.id !== customerId) return false;

      // Date filter
      if (fromDate && o.order_date < fromDate) return false;
      if (toDate   && o.order_date > toDate)   return false;

      // Search: order number, seq, customer name, PO
      if (q) {
        const num = String(o.order_seq ?? o.order_number).toLowerCase();
        const cust = (o.customer?.name ?? "").toLowerCase();
        const po   = (o.customer_po_number ?? "").toLowerCase();
        if (!num.includes(q) && !cust.includes(q) && !po.includes(q)) return false;
      }

      return true;
    });
  }, [orders, tab, search, customerId, fromDate, toDate]);

  // Tab counts
  const counts: Record<Tab, number> = {
    all:    orders.length,
    open:   orders.filter(o => OPEN_STATUSES.has(o.status)).length,
    closed: orders.filter(o => CLOSED_STATUSES.has(o.status)).length,
  };

  const tabStyle = (active: boolean) => ({
    padding: "0.4375rem 1rem",
    borderRadius: "999px",
    border: "none",
    background: active ? "#1c1917" : "transparent",
    color: active ? "#fff" : "#78716c",
    fontWeight: active ? 600 : 400,
    fontSize: "0.875rem",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  });

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>

        {/* Status tabs */}
        <div style={{ display: "flex", gap: "0.25rem", background: "#f5f5f4", borderRadius: "999px", padding: "0.25rem" }}>
          {TABS.map(t => (
            <button key={t.id} type="button" style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] > 0 && (
                <span style={{
                  marginLeft: "0.375rem",
                  background: tab === t.id ? "rgba(255,255,255,0.25)" : "#e7e5e4",
                  color: tab === t.id ? "#fff" : "#78716c",
                  borderRadius: "999px",
                  padding: "0.0625rem 0.4375rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}>
                  {counts[t.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: "160px" }}>
          <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#a8a29e", fontSize: "0.875rem", pointerEvents: "none" }}>🔍</span>
          <input
            className="form-input"
            style={{ paddingLeft: "1.875rem", fontSize: "0.875rem" }}
            placeholder="Order #, customer, PO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Customer filter */}
        <select
          className="form-select"
          style={{ fontSize: "0.875rem", flex: "0 1 180px" }}
          value={customerId}
          onChange={e => setCustomerId(e.target.value)}
        >
          <option value="">All customers</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Date range */}
        <input
          className="form-input"
          style={{ fontSize: "0.875rem", flex: "0 1 140px" }}
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          title="From date"
        />
        <input
          className="form-input"
          style={{ fontSize: "0.875rem", flex: "0 1 140px" }}
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          title="To date"
        />

        {/* Clear filters */}
        {(search || customerId || fromDate || toDate) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setCustomerId(""); setFromDate(""); setToDate(""); }}
            style={{ fontSize: "0.8125rem", color: "#78716c", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: "72px" }}>Order #</th>
              <th>Customer</th>
              <th>PO Ref</th>
              <th>Order Date</th>
              <th>Required</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "2.5rem", textAlign: "center", color: "#78716c" }}>
                  {orders.length === 0
                    ? <span>No orders yet. <Link href="/orders/new" style={{ color: "#b91c1c" }}>Create your first order →</Link></span>
                    : "No orders match your filters."}
                </td>
              </tr>
            )}
            {filtered.map(o => (
              <tr key={o.id} onClick={() => router.push(`/orders/${o.id}`)} style={{ cursor: "pointer" }}>
                <td>
                  <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1rem" }}>
                    #{o.order_seq ?? o.order_number}
                  </span>
                </td>
                <td>
                  {o.customer
                    ? <div>
                        <div style={{ fontWeight: 500 }}>{o.customer.name}</div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{o.customer.code}</div>
                      </div>
                    : <span style={{ color: "#a8a29e" }}>—</span>}
                </td>
                <td style={{ color: "#78716c", fontFamily: "monospace", fontSize: "0.8125rem" }}>
                  {o.customer_po_number ?? "—"}
                </td>
                <td style={{ color: "#78716c", fontSize: "0.875rem" }}>
                  {new Date(o.order_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td style={{ color: "#78716c", fontSize: "0.875rem" }}>
                  {o.required_date
                    ? new Date(o.required_date).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
                    : "—"}
                </td>
                <td>
                  <span className={`badge ${STATUS_COLORS[o.status] ?? "badge-gray"}`}
                    style={{ fontSize: "0.6875rem", textTransform: "capitalize" }}>
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.375rem" }} onClick={e => e.stopPropagation()}>
                    {o.status === "confirmed" && (
                      <Link
                        href={`/orders/floor/${o.id}`}
                        className="btn-primary"
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem", background: "#15803d", border: "none" }}
                      >
                        Dispatch →
                      </Link>
                    )}
                    <Link
                      href={`/orders/${o.id}`}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}
                    >
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length > 0 && (
          <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid #f5f5f4", fontSize: "0.8125rem", color: "#a8a29e" }}>
            Showing {filtered.length} of {orders.length} orders
          </div>
        )}
      </div>
    </div>
  );
}
