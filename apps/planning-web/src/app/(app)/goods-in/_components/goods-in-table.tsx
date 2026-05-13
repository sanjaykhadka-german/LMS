"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Goods-in list table (client component). Receipts are fetched server-side
 * in /goods-in/page.tsx and passed in as props; this component is purely
 * presentational + handles the row-click navigation that previously sat
 * on the server component (which Next 16 now rejects).
 */

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-gray", in_progress: "badge-yellow",
  completed: "badge-green", cancelled: "badge-red",
};

export type GoodsInReceipt = {
  id: string;
  receipt_number: string | null;
  received_date: string;
  status: string;
  supplier_delivery_ref: string | null;
  notes: string | null;
  supplier: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null;
};

export default function GoodsInTable({ receipts }: { receipts: GoodsInReceipt[] }) {
  const router = useRouter();
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Receipt #</th>
          <th>Supplier</th>
          <th>Delivery Ref</th>
          <th>Received Date</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {receipts.length === 0 && (
          <tr>
            <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
              No receipts yet. <Link href="/goods-in/new" style={{ color: "#b91c1c" }}>Record your first delivery →</Link>
            </td>
          </tr>
        )}
        {receipts.map(r => {
          const supplier = Array.isArray(r.supplier) ? r.supplier[0] : r.supplier;
          return (
            <tr key={r.id} onClick={() => router.push(`/goods-in/${r.id}`)} style={{ cursor: "pointer" }}>
              <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.receipt_number ?? "—"}</td>
              <td>
                {supplier
                  ? <div>
                      <div style={{ fontWeight: 500 }}>{supplier.name}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{supplier.code}</div>
                    </div>
                  : <span style={{ color: "#a8a29e" }}>—</span>}
              </td>
              <td style={{ fontFamily: "monospace", color: "#78716c" }}>{r.supplier_delivery_ref ?? "—"}</td>
              <td style={{ color: "#78716c" }}>{new Date(r.received_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</td>
              <td>
                <span className={`badge ${STATUS_COLORS[r.status] ?? "badge-gray"}`} style={{ fontSize: "0.6875rem", textTransform: "capitalize" }}>
                  {r.status.replace("_", " ")}
                </span>
              </td>
              <td>
                <Link href={`/goods-in/${r.id}`} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }} onClick={e => e.stopPropagation()}>View</Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
