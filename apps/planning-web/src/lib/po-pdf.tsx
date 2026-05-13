/**
 * Purchase order PDF generator.
 *
 * Renders a printable PO using @react-pdf/renderer (already used by the
 * invoice PDF route at src/app/api/invoices/[id]/pdf). Keeps the layout
 * minimal-but-clean: tenant header, supplier address block, order meta,
 * line table, totals, optional notes, signature block.
 *
 * `showPrices` honours purchase_orders.show_prices_on_printout — when the
 * operator turned it off, unit-price/total columns are hidden so the
 * supplier-facing PDF only shows what was ordered (no internal cost data).
 */

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

export type PurchaseOrderPdfData = {
  poNumber: string;
  orderDate: string | null;
  expectedDate: string | null;
  notes: string | null;
  showPrices: boolean;
  currency: string;
  tenant: {
    name: string;
    abn: string | null;
    addressLines: string[];
    phone: string | null;
    email: string | null;
    brandColor: string;
    logoUrl: string | null; // unused at MVP — placeholder for future Image element
  };
  supplier: {
    name: string;
    code: string | null;
    addressLines: string[];
    contactName: string | null;
    contactEmail: string | null;
  };
  lines: {
    lineNumber: number;
    itemCode: string;
    itemName: string;
    qty: number;
    unit: string;
    unitPrice: number | null;
    total: number;
    supplierItemCode: string | null;
    notes: string | null;
  }[];
  total: number;
};

const styles = StyleSheet.create({
  page: {
    fontSize: 9.5, fontFamily: "Helvetica",
    paddingTop: 32, paddingBottom: 40, paddingHorizontal: 40,
    color: "#1c1917",
  },
  headerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    marginBottom: 18, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: "#1c1917",
  },
  tenantBlock: { width: "55%" },
  metaBlock:   { width: "40%", textAlign: "right" },
  tenantName:  { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  tenantLine:  { fontSize: 8.5, color: "#57534e", lineHeight: 1.45 },
  poTitle:     { fontSize: 18, fontFamily: "Helvetica-Bold" },
  poNumber:    { fontSize: 10, color: "#57534e", marginTop: 2 },
  metaLine:    { fontSize: 8.5, color: "#57534e", marginTop: 6 },

  twoCol: {
    flexDirection: "row", justifyContent: "space-between", marginBottom: 18, gap: 16,
  },
  colHalf: {
    flex: 1, padding: 10, borderWidth: 0.5, borderColor: "#d6d3d1", borderRadius: 4,
  },
  colHeading: {
    fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase",
    letterSpacing: 0.5, color: "#78716c", marginBottom: 6,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  body: { fontSize: 9.5, lineHeight: 1.45, color: "#1c1917" },

  table: { borderWidth: 0.5, borderColor: "#d6d3d1", borderRadius: 4, marginBottom: 14 },
  tHead: {
    flexDirection: "row", backgroundColor: "#1c1917", color: "#fff",
    fontSize: 8.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4,
    paddingVertical: 6, paddingHorizontal: 6,
  },
  tRow:  {
    flexDirection: "row", borderTopWidth: 0.5, borderTopColor: "#e7e5e4",
    paddingVertical: 5, paddingHorizontal: 6, fontSize: 9.5,
  },
  tRowAlt: { backgroundColor: "#fafaf9" },
  tcLine:  { width: 24 },
  tcCode:  { width: 70 },
  tcDesc:  { flex: 1 },
  tcQty:   { width: 70, textAlign: "right" },
  tcUnit:  { width: 40, textAlign: "left" },
  tcPrice: { width: 70, textAlign: "right" },
  tcTotal: { width: 70, textAlign: "right" },

  totalsRow: {
    flexDirection: "row", justifyContent: "flex-end",
    marginTop: 4, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: "#1c1917",
  },
  totalsLabel: { fontSize: 9, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.4, marginRight: 12 },
  totalsValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: "#1c1917" },

  notes: { marginTop: 16, padding: 10, borderWidth: 0.5, borderColor: "#d6d3d1", borderRadius: 4 },
  footer: { position: "absolute", bottom: 16, left: 40, right: 40, textAlign: "center", fontSize: 7.5, color: "#a8a29e" },
});

function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function PurchaseOrderPdf(data: PurchaseOrderPdfData): ReactElement<DocumentProps> {
  const { poNumber, orderDate, expectedDate, notes, showPrices, currency, tenant, supplier, lines, total } = data;

  return (
    <Document title={`PO ${poNumber}`}>
      <Page size="A4" style={styles.page}>
        {/* Header — tenant on the left, PO meta on the right */}
        <View style={styles.headerRow}>
          <View style={styles.tenantBlock}>
            <Text style={styles.tenantName}>{tenant.name}</Text>
            {tenant.addressLines.filter(Boolean).map((l, i) => (
              <Text key={i} style={styles.tenantLine}>{l}</Text>
            ))}
            {tenant.abn   && <Text style={styles.tenantLine}>ABN: {tenant.abn}</Text>}
            {tenant.phone && <Text style={styles.tenantLine}>{tenant.phone}</Text>}
            {tenant.email && <Text style={styles.tenantLine}>{tenant.email}</Text>}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.poTitle}>PURCHASE ORDER</Text>
            <Text style={styles.poNumber}>{poNumber}</Text>
            <Text style={styles.metaLine}>Order date: <Text style={styles.bold}>{formatDate(orderDate)}</Text></Text>
            <Text style={styles.metaLine}>Expected:   <Text style={styles.bold}>{formatDate(expectedDate)}</Text></Text>
            <Text style={styles.metaLine}>Currency:   <Text style={styles.bold}>{currency}</Text></Text>
          </View>
        </View>

        {/* Supplier block + ship-to (we only have tenant address; reuse for ship-to) */}
        <View style={styles.twoCol}>
          <View style={styles.colHalf}>
            <Text style={styles.colHeading}>Supplier</Text>
            <Text style={[styles.body, styles.bold]}>{supplier.name}</Text>
            {supplier.code && <Text style={styles.body}>Code: {supplier.code}</Text>}
            {supplier.addressLines.filter(Boolean).map((l, i) => (
              <Text key={i} style={styles.body}>{l}</Text>
            ))}
            {supplier.contactName  && <Text style={styles.body}>Attn: {supplier.contactName}</Text>}
            {supplier.contactEmail && <Text style={styles.body}>{supplier.contactEmail}</Text>}
          </View>
          <View style={styles.colHalf}>
            <Text style={styles.colHeading}>Ship to</Text>
            <Text style={[styles.body, styles.bold]}>{tenant.name}</Text>
            {tenant.addressLines.filter(Boolean).map((l, i) => (
              <Text key={i} style={styles.body}>{l}</Text>
            ))}
            {tenant.phone && <Text style={styles.body}>{tenant.phone}</Text>}
          </View>
        </View>

        {/* Lines */}
        <View style={styles.table}>
          <View style={styles.tHead}>
            <Text style={styles.tcLine}>#</Text>
            <Text style={styles.tcCode}>Code</Text>
            <Text style={styles.tcDesc}>Description</Text>
            <Text style={styles.tcQty}>Qty</Text>
            <Text style={styles.tcUnit}>UOM</Text>
            {showPrices && <Text style={styles.tcPrice}>Unit price</Text>}
            {showPrices && <Text style={styles.tcTotal}>Line total</Text>}
          </View>
          {lines.map((l, i) => (
            <View key={l.lineNumber} style={[styles.tRow, ...(i % 2 === 1 ? [styles.tRowAlt] : [])]}>
              <Text style={styles.tcLine}>{l.lineNumber}</Text>
              <Text style={styles.tcCode}>{l.supplierItemCode ?? l.itemCode}</Text>
              <Text style={styles.tcDesc}>
                {l.itemName}
                {l.notes ? ` — ${l.notes}` : ""}
              </Text>
              <Text style={styles.tcQty}>{fmt(l.qty, 2)}</Text>
              <Text style={styles.tcUnit}>{l.unit}</Text>
              {showPrices && <Text style={styles.tcPrice}>{fmt(l.unitPrice)}</Text>}
              {showPrices && <Text style={styles.tcTotal}>{fmt(l.total)}</Text>}
            </View>
          ))}
        </View>

        {/* Total — only when prices shown. When prices are hidden we suppress
            the total too; the supplier-facing PO becomes a pure goods list. */}
        {showPrices && (
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Total ({currency})</Text>
            <Text style={styles.totalsValue}>{fmt(total)}</Text>
          </View>
        )}

        {/* Notes */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.colHeading}>Notes</Text>
            <Text style={styles.body}>{notes}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          {poNumber} · Generated by Tracey Production Planning · {tenant.name}
        </Text>
      </Page>
    </Document>
  );
}

// react-pdf's Document type is wider than ReactElement<DocumentProps>; we
// re-export DocumentProps via a local alias so callers don't need to import
// it directly. (Mirrors how the invoice PDF route does it.)
type DocumentProps = Parameters<typeof Document>[0];

/** One-shot helper: render a `PurchaseOrderPdfData` to a Buffer for email
 *  attachment / API response. */
export async function renderPurchaseOrderPdfBuffer(data: PurchaseOrderPdfData): Promise<Buffer> {
  return await renderToBuffer(<PurchaseOrderPdf {...data} />);
}
