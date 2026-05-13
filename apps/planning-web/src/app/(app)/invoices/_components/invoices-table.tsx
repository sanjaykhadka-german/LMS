"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-gray", sent: "badge-blue", paid: "badge-green", void: "badge-red",
};

type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
  currency: string;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  customer: { id: string; code: string; name: string } | null;
  order: { id: string; order_number: string } | null;
};

export default function InvoicesTable({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter();

  if (invoices.length === 0) {
    return (
      <tr>
        <td colSpan={10} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
          No invoices yet. Dispatch an order to generate your first invoice.
        </td>
      </tr>
    );
  }

  return (
    <>
      {invoices.map(inv => {
        const isOverdue = inv.status === "sent" && inv.due_date && new Date(inv.due_date) < new Date();
        return (
          <tr
            key={inv.id}
            style={{ cursor: "pointer", background: isOverdue ? "#fef2f2" : undefined }}
            onClick={() => router.push(`/invoices/${inv.id}`)}
          >
            <td style={{ fontFamily: "monospace", fontWeight: 700, color: "#b91c1c" }}>{inv.invoice_number}</td>
            <td>
              <div style={{ fontWeight: 500 }}>{inv.customer?.name ?? "—"}</div>
              <div style={{ fontSize: "0.75rem", color: "#78716c", fontFamily: "monospace" }}>{inv.customer?.code}</div>
            </td>
            <td style={{ fontFamily: "monospace", color: "#78716c" }}>
              {inv.order
                ? <Link href={`/orders/${inv.order.id}`} onClick={e => e.stopPropagation()} style={{ color: "#b91c1c", textDecoration: "none" }}>{inv.order.order_number}</Link>
                : "—"}
            </td>
            <td style={{ color: "#78716c" }}>{new Date(inv.invoice_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</td>
            <td style={{ color: isOverdue ? "#dc2626" : "#78716c", fontWeight: isOverdue ? 600 : 400 }}>
              {inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}
              {isOverdue && " ⚠"}
            </td>
            <td style={{ color: "#78716c" }}>${(inv.subtotal ?? 0).toFixed(2)}</td>
            <td style={{ color: "#78716c" }}>${(inv.tax_total ?? 0).toFixed(2)}</td>
            <td style={{ fontWeight: 700 }}>${(inv.total ?? 0).toFixed(2)}</td>
            <td>
              <span className={`badge ${STATUS_COLORS[inv.status] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem", textTransform: "capitalize" }}>
                {inv.status}
              </span>
            </td>
            <td>
              <Link href={`/invoices/${inv.id}`} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }} onClick={e => e.stopPropagation()}>
                View
              </Link>
            </td>
          </tr>
        );
      })}
    </>
  );
}
