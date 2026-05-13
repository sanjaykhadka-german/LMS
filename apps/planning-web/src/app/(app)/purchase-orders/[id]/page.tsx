import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { QuickNav } from "@/components/quick-nav";
import PurchaseOrderStatusClient from "./_status-client";
import SendPoButton from "./_send-po-button";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "badge-yellow",
  sent: "badge-blue",
  received: "badge-green",
  cancelled: "badge-red",
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Load PO + lines + everything the Send modal needs to pre-fill defaults
  // (current user email + profile.po_email_template + tenant name +
  // tenant.purchasing_email + supplier primary contact email). One round
  // trip per logical resource; Promise.all parallelises the fetches.
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: po }, { data: lines }, { data: profile }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, supplier:supplier_id(id, name, code), created_by:created_by(full_name)")
      .eq("id", id)
      .single(),
    supabase
      .from("purchase_order_lines")
      .select("*, item:item_id(id, code, name, unit), supplier_item:supplier_item_id(supplier_item_code, purchase_uom)")
      .eq("purchase_order_id", id)
      .order("created_at"),
    user
      ? supabase.from("profiles").select("email, full_name, tenant_id, po_email_template").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!po) notFound();

  const supplier = po.supplier as { id: string; name: string; code: string | null } | null;
  const createdBy = (po.created_by as { full_name?: string } | null)?.full_name ?? "—";

  const totalValue = (lines ?? []).reduce((sum: number, l: { qty_ordered: number; unit_price: number | null }) => {
    return sum + (l.qty_ordered ?? 0) * (l.unit_price ?? 0);
  }, 0);

  // Pre-fill the Send modal with supplier contact + user email + tenant
  // purchasing email + a substituted body. Modal is editable; these are
  // just defaults that match the server action's auto-resolve so the
  // operator sees what's about to be sent before clicking Send.
  let defaultTo = "";
  let hasContacts = false;
  if (supplier) {
    const { data: contact } = await supabase
      .from("supplier_contacts")
      .select("email")
      .eq("supplier_id", supplier.id)
      .not("email", "is", null)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    defaultTo = contact?.email ?? "";
    hasContacts = !!contact?.email;
  }
  let tenantName = "";
  let purchasingEmail = "";
  if (profile?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, purchasing_email")
      .eq("id", profile.tenant_id)
      .single();
    tenantName       = tenant?.name ?? "";
    purchasingEmail  = tenant?.purchasing_email ?? "";
  }
  const userEmail = profile?.email ?? user?.email ?? "";
  const ccSet = new Set<string>();
  if (userEmail)       ccSet.add(userEmail);
  if (purchasingEmail) ccSet.add(purchasingEmail);
  const defaultCc = [...ccSet].join(", ");

  const defaultSubject = `Purchase Order ${po.po_number ?? ""} — ${tenantName}`.trim();
  const rawBody = profile?.po_email_template
    ?? `Hi {{supplier_name}},\n\nPlease find attached our purchase order {{po_number}} for the items listed in the PDF.\n\nLet me know if anything is unclear or if there are any issues with availability or delivery dates.\n\nThanks,\n{{user_name}}\n{{tenant_name}}`;
  const defaultBody = rawBody
    .replaceAll("{{po_number}}",     po.po_number ?? "")
    .replaceAll("{{supplier_name}}", supplier?.name ?? "")
    .replaceAll("{{user_name}}",     profile?.full_name ?? "")
    .replaceAll("{{tenant_name}}",   tenantName);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <BackButton href="/purchase-orders" label="Purchase Orders" />
            <span style={{ color: "#d4d4d4" }}>|</span>
            <QuickNav />
          </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{po.po_number ?? "Purchase Order"}</h1>
          <p className="page-subtitle">
            {supplier ? `Supplier: ${supplier.name}` : "Multiple suppliers"}
            {po.order_date ? ` · ${new Date(po.order_date).toLocaleDateString("en-AU")}` : ""}
            {po.expected_date ? ` · Expected ${new Date(po.expected_date).toLocaleDateString("en-AU")}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${STATUS_COLORS[po.status] ?? "badge-yellow"}`} style={{ fontSize: "0.875rem", padding: "0.375rem 0.75rem" }}>
            {po.status.charAt(0).toUpperCase() + po.status.slice(1)}
          </span>
          <PurchaseOrderStatusClient poId={id} currentStatus={po.status} />
          {/* Send to supplier — only meaningful while the PO can still be
              sent. Disabled-but-visible on cancelled/received so the audit
              trail in purchase_order_sends keeps making sense (you can
              always look at past sends from here later). */}
          {supplier && po.status !== "cancelled" && (
            <SendPoButton
              poId={id}
              poNumber={po.po_number ?? "PO"}
              supplierName={supplier.name}
              defaultTo={defaultTo}
              defaultCc={defaultCc}
              defaultSubject={defaultSubject}
              defaultBody={defaultBody}
              hasContacts={hasContacts}
            />
          )}
        </div>
      </div>

      {po.notes && (
        <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#fafaf9" }}>
          <span style={{ color: "#78716c", fontSize: "0.875rem" }}><strong>Notes:</strong> {po.notes}</span>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>Order Lines</h2>
          <span style={{ color: "#78716c", fontSize: "0.875rem" }}>Created by {createdBy}</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Item</th>
              <th>Supplier</th>
              <th style={{ textAlign: "right" }}>Qty Ordered</th>
              <th>Unit</th>
              <th style={{ textAlign: "right" }}>Unit Price</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {(!lines || lines.length === 0) && (
              <tr>
                <td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>No lines</td>
              </tr>
            )}
            {(lines ?? []).map((line: {
              id: string;
              item: { id: string; code: string; name: string; unit: string } | null;
              supplier_item: { supplier_item_code: string | null; purchase_uom: string | null } | null;
              qty_ordered: number;
              unit: string | null;
              unit_price: number | null;
              currency: string | null;
              notes: string | null;
            }) => {
              const lineTotal = (line.qty_ordered ?? 0) * (line.unit_price ?? 0);
              return (
                <tr key={line.id}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "#78716c" }}>
                    {line.item?.code ?? "—"}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {line.item ? (
                      <Link href={`/items/${line.item.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        {line.item.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>
                    {line.supplier_item?.supplier_item_code ?? (supplier?.name ?? "—")}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    {line.qty_ordered?.toFixed(3) ?? "—"}
                  </td>
                  <td style={{ color: "#78716c" }}>{line.unit ?? line.item?.unit ?? "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                    {line.unit_price != null ? `${line.currency ?? "AUD"} ${line.unit_price.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: lineTotal > 0 ? 600 : undefined }}>
                    {lineTotal > 0 ? `${line.currency ?? "AUD"} ${lineTotal.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ fontSize: "0.8125rem", color: "#78716c" }}>{line.notes ?? "—"}</td>
                </tr>
              );
            })}
            {totalValue > 0 && (
              <tr style={{ background: "#fafaf9", borderTop: "2px solid #e7e5e4" }}>
                <td colSpan={6} style={{ textAlign: "right", fontWeight: 600, padding: "0.75rem 1rem" }}>Order Total</td>
                <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, padding: "0.75rem 1rem" }}>
                  AUD {totalValue.toFixed(2)}
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
