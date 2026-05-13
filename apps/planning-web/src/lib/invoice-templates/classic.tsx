import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateProps } from "./types";
import { fmtAddress, fmtCurrency, fmtDate, fmtLot, fmtQty } from "./format";

export function ClassicTemplate({ invoice, tenant, customer, order, lines }: TemplateProps) {
  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#1c1917" },
    headerBand: {
      backgroundColor: tenant.brand_color, color: "#ffffff",
      padding: 16, marginBottom: 16,
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    logo: { width: 56, height: 56, objectFit: "contain", backgroundColor: "#ffffff", padding: 4, borderRadius: 4 },
    companyName: { fontSize: 14, fontWeight: "bold" },
    companyMeta: { fontSize: 8, marginTop: 2, opacity: 0.9 },
    headerRight: { alignItems: "flex-end" },
    invoiceTitle: { fontSize: 20, fontWeight: "bold", letterSpacing: 2 },
    invoiceNumber: { fontSize: 10, marginTop: 2 },
    qrCode: {
      width: 56, height: 56, marginTop: 6,
      backgroundColor: "#ffffff", padding: 3, borderRadius: 2,
    },
    twoCol: { flexDirection: "row", gap: 16, marginBottom: 16 },
    panel: { flex: 1, borderWidth: 1, borderColor: "#e7e5e4", padding: 10, borderRadius: 2 },
    panelLabel: {
      fontSize: 7, color: "#78716c", textTransform: "uppercase",
      letterSpacing: 0.8, marginBottom: 6, fontWeight: "bold",
    },
    panelText: { fontSize: 9, marginBottom: 2, color: "#44403c" },
    panelStrong: { fontSize: 10, fontWeight: "bold", marginBottom: 4 },
    metaRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 9, marginBottom: 3 },
    metaLabel: { color: "#78716c" },
    metaValue: { fontWeight: "bold" },
    table: { borderWidth: 1, borderColor: "#e7e5e4" },
    th: {
      flexDirection: "row", backgroundColor: "#f5f5f4",
      borderBottomWidth: 1, borderBottomColor: "#e7e5e4",
      padding: 6, fontSize: 8, fontWeight: "bold", textTransform: "uppercase",
      color: "#57534e", letterSpacing: 0.5,
    },
    tr: {
      flexDirection: "row", padding: 6,
      borderBottomWidth: 0.5, borderBottomColor: "#f5f5f4",
    },
    cNum:    { width: "6%" },
    cItem:   { width: "44%" },
    cQty:    { width: "16%" },
    cPrice:  { width: "16%", textAlign: "right" },
    cTotal:  { width: "18%", textAlign: "right" },
    itemName: { fontSize: 9, fontWeight: "bold" },
    itemCode: { fontSize: 7, color: "#78716c", marginTop: 1 },
    itemLot:  { fontSize: 7, color: "#57534e", marginTop: 2 },
    totals: { marginTop: 10, alignSelf: "flex-end", width: 220 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, fontSize: 9 },
    grandTotal: {
      flexDirection: "row", justifyContent: "space-between",
      paddingVertical: 6, marginTop: 4,
      borderTopWidth: 2, borderTopColor: tenant.brand_color,
      fontSize: 12, fontWeight: "bold",
    },
    grandValue: { color: tenant.brand_color },
    notes: { marginTop: 16, padding: 10, backgroundColor: "#fafaf9", fontSize: 8, color: "#57534e" },
    bankBand: {
      marginTop: 16, padding: 10,
      borderWidth: 1, borderColor: tenant.brand_color, borderRadius: 2,
      backgroundColor: "#ffffff",
    },
    bankLabel: {
      fontSize: 7, color: tenant.brand_color, textTransform: "uppercase",
      letterSpacing: 0.8, fontWeight: "bold", marginBottom: 6,
    },
    bankRow:  { flexDirection: "row", flexWrap: "wrap", gap: 0 },
    bankCol:  { width: "50%", marginBottom: 4 },
    bankFieldLabel: { fontSize: 7, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5 },
    bankFieldValue: { fontSize: 9, fontWeight: "bold", color: "#1c1917", marginTop: 1 },
    footer: {
      position: "absolute", bottom: 24, left: 36, right: 36,
      textAlign: "center", fontSize: 7, color: "#a8a29e",
      borderTopWidth: 0.5, borderTopColor: "#e7e5e4", paddingTop: 6,
    },
  });

  const tenantAddr = fmtAddress({
    line1: tenant.billing_address_line1, line2: tenant.billing_address_line2,
    city: tenant.billing_city, state: tenant.billing_state,
    postcode: tenant.billing_postcode, country: tenant.billing_country,
  });
  const custAddr = customer ? fmtAddress({
    line1: customer.billing_address_line1, line2: customer.billing_address_line2,
    city: customer.billing_city, state: customer.billing_state,
    postcode: customer.billing_postcode, country: customer.billing_country,
  }) : [];
  const deliverAddr = customer && !customer.delivery_is_same_as_billing ? fmtAddress({
    line1: customer.delivery_address_line1, line2: customer.delivery_address_line2,
    city: customer.delivery_city, state: customer.delivery_state,
    postcode: customer.delivery_postcode, country: null,
  }) : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBand}>
          <View style={styles.headerLeft}>
            {tenant.logo_data_url && <Image src={tenant.logo_data_url} style={styles.logo} />}
            <View>
              <Text style={styles.companyName}>{tenant.name}</Text>
              {tenant.abn && <Text style={styles.companyMeta}>ABN {tenant.abn}</Text>}
              {tenant.company_phone && <Text style={styles.companyMeta}>{tenant.company_phone}</Text>}
              {tenant.company_email && <Text style={styles.companyMeta}>{tenant.company_email}</Text>}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
            {invoice.qr_data_url && <Image src={invoice.qr_data_url} style={styles.qrCode} />}
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Invoice To</Text>
            {customer ? (
              <>
                <Text style={styles.panelStrong}>{customer.name}</Text>
                {customer.abn && <Text style={styles.panelText}>ABN {customer.abn}</Text>}
                {custAddr.map((l, i) => <Text key={i} style={styles.panelText}>{l}</Text>)}
                {customer.email && <Text style={styles.panelText}>{customer.email}</Text>}
                {customer.phone && <Text style={styles.panelText}>{customer.phone}</Text>}
              </>
            ) : <Text style={styles.panelText}>—</Text>}
          </View>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Deliver To</Text>
            {customer ? (
              customer.delivery_is_same_as_billing ? (
                <Text style={styles.panelText}>Same as Invoice To</Text>
              ) : (
                <>
                  <Text style={styles.panelStrong}>{customer.name}</Text>
                  {deliverAddr.map((l, i) => <Text key={i} style={styles.panelText}>{l}</Text>)}
                </>
              )
            ) : <Text style={styles.panelText}>—</Text>}
          </View>
        </View>

        <View style={[styles.panel, { marginBottom: 16 }]}>
          <Text style={styles.panelLabel}>Invoice Details</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Invoice Date</Text>
            <Text style={styles.metaValue}>{fmtDate(invoice.invoice_date)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Due Date</Text>
            <Text style={styles.metaValue}>{fmtDate(invoice.due_date)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Customer Order No</Text>
            <Text style={styles.metaValue}>{order?.customer_po_number ?? "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Order #</Text>
            <Text style={styles.metaValue}>{order?.order_number ?? "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Currency</Text>
            <Text style={styles.metaValue}>{invoice.currency}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cNum}>#</Text>
            <Text style={styles.cItem}>Item</Text>
            <Text style={styles.cQty}>Qty</Text>
            <Text style={styles.cPrice}>Unit Price</Text>
            <Text style={styles.cTotal}>Total</Text>
          </View>
          {lines.length === 0 ? (
            <View style={styles.tr}>
              <Text style={{ width: "100%", textAlign: "center", color: "#a8a29e" }}>
                No line items.
              </Text>
            </View>
          ) : lines.map(l => (
            <View key={l.line_number} style={styles.tr}>
              <Text style={styles.cNum}>{l.line_number}</Text>
              <View style={styles.cItem}>
                <Text style={styles.itemName}>{l.item_name ?? "—"}</Text>
                {l.item_code && <Text style={styles.itemCode}>{l.item_code}</Text>}
                {l.lots.map((lot, i) => {
                  const meta = fmtLot(lot);
                  if (!meta) return null;
                  return <Text key={i} style={styles.itemLot}>{meta}</Text>;
                })}
              </View>
              <Text style={styles.cQty}>{fmtQty(l.qty_units, l.qty_kg)}</Text>
              <Text style={styles.cPrice}>
                {l.unit_price != null ? fmtCurrency(l.unit_price, invoice.currency) : "—"}
              </Text>
              <Text style={styles.cTotal}>
                {l.line_total != null ? fmtCurrency(l.line_total, invoice.currency) : "—"}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={{ color: "#78716c" }}>Subtotal</Text>
            <Text>{fmtCurrency(invoice.subtotal, invoice.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={{ color: "#78716c" }}>GST (10%)</Text>
            <Text>{fmtCurrency(invoice.tax_total, invoice.currency)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>Total</Text>
            <Text style={styles.grandValue}>{fmtCurrency(invoice.total, invoice.currency)}</Text>
          </View>
        </View>

        {invoice.notes && (
          <View style={styles.notes}><Text>{invoice.notes}</Text></View>
        )}

        {(tenant.bank_name || tenant.bank_bsb || tenant.bank_account_number || tenant.bank_account_name) && (
          <View style={styles.bankBand}>
            <Text style={styles.bankLabel}>Payment Details</Text>
            <View style={styles.bankRow}>
              {tenant.bank_name && (
                <View style={styles.bankCol}>
                  <Text style={styles.bankFieldLabel}>Bank</Text>
                  <Text style={styles.bankFieldValue}>{tenant.bank_name}</Text>
                </View>
              )}
              {tenant.bank_account_name && (
                <View style={styles.bankCol}>
                  <Text style={styles.bankFieldLabel}>Account Name</Text>
                  <Text style={styles.bankFieldValue}>{tenant.bank_account_name}</Text>
                </View>
              )}
              {tenant.bank_bsb && (
                <View style={styles.bankCol}>
                  <Text style={styles.bankFieldLabel}>BSB</Text>
                  <Text style={styles.bankFieldValue}>{tenant.bank_bsb}</Text>
                </View>
              )}
              {tenant.bank_account_number && (
                <View style={styles.bankCol}>
                  <Text style={styles.bankFieldLabel}>Account Number</Text>
                  <Text style={styles.bankFieldValue}>{tenant.bank_account_number}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>
            {tenant.name}{tenant.abn ? ` · ABN ${tenant.abn}` : ""}
            {tenantAddr.length > 0 ? ` · ${tenantAddr.join(", ")}` : ""}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
