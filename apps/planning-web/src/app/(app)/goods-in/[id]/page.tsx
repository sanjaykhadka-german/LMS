import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import { ITEM_TYPE_LABELS, ITEM_TYPE_COLORS, type ItemType } from "@/lib/types";

export default async function GoodsInDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: receipt } = await supabase
    .from("goods_in_receipts")
    .select(`
      *,
      supplier:supplier_id(id, code, name),
      lines:goods_in_lines(
        id, supplier_lot, supplier_barcode,
        purchase_uom, n_purchase_units, purchase_uom_qty_each,
        qty_received, unit, best_before_date, use_by_date,
        unit_price, total_price, is_quarantined, quarantine_reason, notes,
        item:item_id(id, code, name, item_type, unit),
        lot:lot_id(id, lot_code)
      )
    `)
    .eq("id", id)
    .single();

  if (!receipt) notFound();

  const supplier = receipt.supplier as { id: string; code: string; name: string } | null;
  const lines = (receipt.lines ?? []) as {
    id: string;
    supplier_lot: string | null;
    purchase_uom: string | null;
    n_purchase_units: number | null;
    purchase_uom_qty_each: number | null;
    qty_received: number;
    unit: string;
    best_before_date: string | null;
    is_quarantined: boolean;
    quarantine_reason: string | null;
    unit_price: number | null;
    notes: string | null;
    item: { id: string; code: string; name: string; item_type: string; unit: string } | null;
    lot: { id: string; lot_code: string } | null;
  }[];

  const STATUS_COLORS: Record<string, string> = {
    draft: "badge-gray", in_progress: "badge-yellow",
    completed: "badge-green", cancelled: "badge-red",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/goods-in" label="Goods In" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
          </div>
          <h1 className="page-title" style={{ marginTop: "0.375rem" }}>
            Receipt {receipt.receipt_number ?? id.slice(0, 8)}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginTop: "0.375rem" }}>
            <span className={`badge ${STATUS_COLORS[receipt.status] ?? "badge-gray"}`} style={{ textTransform: "capitalize" }}>
              {receipt.status.replace("_", " ")}
            </span>
            {supplier && <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>· {supplier.name}</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Receipt Details</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["Receipt #", receipt.receipt_number ?? "—"],
                ["Supplier", supplier ? `${supplier.code} — ${supplier.name}` : "—"],
                ["Received Date", new Date(receipt.received_date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })],
                ["Delivery Ref", receipt.supplier_delivery_ref ?? "—"],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderBottom: "1px solid #f5f5f4" }}>
                  <td style={{ padding: "0.4375rem 0", fontSize: "0.8125rem", color: "#78716c", width: "40%" }}>{k}</td>
                  <td style={{ padding: "0.4375rem 0", fontSize: "0.875rem", fontWeight: "500" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {receipt.notes && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.75rem", background: "#fafaf9", borderRadius: "0.375rem", fontSize: "0.875rem", color: "#78716c" }}>
              {receipt.notes}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Summary</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {[
              ["Lines", String(lines.length)],
              ["Quarantined", String(lines.filter(l => l.is_quarantined).length)],
            ].map(([l, v]) => (
              <div key={l} style={{ background: "#fafaf9", borderRadius: "0.5rem", padding: "0.75rem" }}>
                <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{l}</div>
                <div style={{ fontSize: "1.25rem", fontWeight: "700", color: "#292524", marginTop: "0.125rem" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="card" style={{ marginTop: "1.5rem", padding: 0 }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Items Received</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Lot Code</th>
              <th>Supplier Lot</th>
              <th>Purchase UOM</th>
              <th>Qty Received</th>
              <th>Best Before</th>
              <th>Unit Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.id} style={{ background: line.is_quarantined ? "#fff7ed" : undefined }}>
                <td>
                  {line.item
                    ? <div>
                        <div style={{ fontWeight: 500 }}>
                          <Link href={`/items/${line.item.id}`} style={{ textDecoration: "none", color: "inherit" }}>{line.item.name}</Link>
                        </div>
                        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                          <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#78716c" }}>{line.item.code}</span>
                          <span className={`badge ${ITEM_TYPE_COLORS[line.item.item_type as ItemType]}`} style={{ fontSize: "0.5625rem" }}>
                            {ITEM_TYPE_LABELS[line.item.item_type as ItemType]}
                          </span>
                        </div>
                      </div>
                    : "—"}
                </td>
                <td>
                  {line.lot
                    ? <Link href={`/lots/${line.lot.id}`} style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.8125rem", color: "#b91c1c", textDecoration: "none" }}>
                        {line.lot.lot_code}
                      </Link>
                    : <span style={{ color: "#a8a29e" }}>—</span>}
                </td>
                <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>{line.supplier_lot ?? "—"}</td>
                <td style={{ color: "#78716c" }}>
                  {line.purchase_uom
                    ? `${line.n_purchase_units ?? "?"} × ${line.purchase_uom} (${line.purchase_uom_qty_each ?? "?"} ${line.unit})`
                    : "—"}
                </td>
                <td style={{ fontWeight: 600 }}>{line.qty_received} {line.unit}</td>
                <td style={{ color: "#78716c" }}>{line.best_before_date ? new Date(line.best_before_date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                <td style={{ color: "#78716c" }}>{line.unit_price != null ? `$${line.unit_price.toFixed(2)}` : "—"}</td>
                <td>
                  {line.is_quarantined
                    ? <span className="badge badge-yellow" style={{ fontSize: "0.6875rem" }} title={line.quarantine_reason ?? undefined}>⚠ Quarantine</span>
                    : <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>✓ Released</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
