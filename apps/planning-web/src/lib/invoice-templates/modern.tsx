import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { TemplateProps } from "./types";
import { fmtAddress, fmtCurrency, fmtDate, fmtLot, fmtQty } from "./format";

export function ModernTemplate({ invoice, tenant, customer, order, lines }: TemplateProps) {
  const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
    accentBar: {
      position: "absolute", top: 0, left: 0, bottom: 0, width: 6,
      backgroundColor: tenant.brand_color,
    },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
    brand: { flexDirection: "row", alignItems: "center", gap: 12 },
    logo: { width: 48, height: 48, objectFit: "contain" },
    companyName: { fontSize: 16, fontWeight: "bold", letterSpacing: -0.4 },
    companyMeta: { fontSize: 8, color: "#64748b", marginTop: 1 },
    titleBlock: { alignItems: "flex-end" },
    title: {
      fontSize: 28, fontWeight: "bold", letterSpacing: -1,
      color: tenant.brand_color, lineHeight: 1,
    },
    subtitle: { fontSize: 10, color: "#475569", marginTop: 4 },
    qrCode:   { width: 60, height: 60, marginTop: 8 },
    parties: { flexDirection: "row", gap: 32, marginBottom: 24 },
    party: { flex: 1 },
    partyLabel: {
      fontSize: 7, color: "#94a3b8", textTransform: "uppercase",
      letterSpacing: 1.2, marginBottom: 6, fontWeight: "bold",
    },
    partyName: { fontSize: 12, fontWeight: "bold", marginBottom: 2 },
    partyText: { fontSize: 9, color: "#475569", marginBottom: 1, lineHeight: 1.4 },
    metaGrid: { flexDirection: "row", gap: 12, marginBottom: 20 },
    metaCard: {
      flex: 1, padding: 10, borderRadius: 4,
      backgroundColor: "#f8fafc", borderLeftWidth: 3, borderLeftColor: tenant.brand_color,
    },
    metaCardLabel: { fontSize: 7, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 },
    metaCardValue: { fontSize: 11, fontWeight: "bold", marginTop: 2, color: "#0f172a" },
    table: { marginBottom: 16 },
    th: {
      flexDirection: "row", paddingVertical: 8,
      borderBottomWidth: 2, borderBottomColor: "#0f172a",
      fontSize: 8, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 0.6,
    },
    tr: {
      flexDirection: "row", paddingVertical: 8,
      borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
    },
    cNum:    { width: "6%", color: "#94a3b8" },
    cItem:   { width: "44%" },
    cQty:    { width: "16%" },
    cPrice:  { width: "16%", textAlign: "right" },
    cTotal:  { width: "18%", textAlign: "right" },
    itemName: { fontSize: 10, fontWeight: "bold" },
    itemCode: { fontSize: 7, color: "#94a3b8", marginTop: 1 },
    itemLot:  { fontSize: 7, color: "#475569", marginTop: 2 },
    totalsWrapper: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
    totalsCard: {
      width: 240, padding: 14, borderRadius: 6,
      backgroundColor: tenant.brand_color, color: "#ffffff",
    },
    totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6, fontSize: 10, opacity: 0.9 },
    grandTotal: {
      flexDirection: "row", justifyContent: "space-between",
      paddingTop: 8, marginTop: 4,
      borderTopWidth: 0.5, borderTopColor: "#ffffff",
      fontSize: 16, fontWeight: "bold",
    },
    notes: { marginTop: 20, padding: 12, backgroundColor: "#f1f5f9", borderRadius: 4, fontSize: 9, color: "#475569" },
    bankBand: {
      marginTop: 20, padding: 14, borderRadius: 6,
      backgroundColor: "#f8fafc", borderLeftWidth: 3, borderLeftColor: tenant.brand_color,
    },
    bankLabel: {
      fontSize: 7, color: tenant.brand_color, textTransform: "uppercase",
      letterSpacing: 1.2, fontWeight: "bold", marginBottom: 8,
    },
    bankRow: { flexDirection: "row", flexWrap: "wrap" },
    bankCol: { width: "50%", marginBottom: 6 },
    bankFieldLabel: { fontSize: 7, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6 },
    bankFieldValue: { fontSize: 10, fontWeight: "bold", color: "#0f172a", marginTop: 2 },
    footer: {
      position: "absolute", bottom: 24, left: 40, right: 40,
      textAlign: "center", fontSize: 7, color: "#94a3b8",
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
        <View style={styles.accentBar} fixed />

        <View style={styles.header}>
          <View style={styles.brand}>
            {tenant.logo_data_url && <Image src={tenant.logo_data_url} style={styles.logo} />}
            <View>
              <Text style={styles.companyName}>{tenant.name}</Text>
              {tenant.abn && <Text style={styles.companyMeta}>ABN {tenant.abn}</Text>}
              {tenant.company_email && <Text style={styles.companyMeta}>{tenant.company_email}</Text>}
            </View>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Invoice</Text>
            <Text style={styles.subtitle}>{invoice.invoice_number}</Text>
            {invoice.qr_data_url && <Image src={invoice.qr_data_url} style={styles.qrCode} />}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Invoice To</Text>
            {customer ? (
              <>
                <Text style={styles.partyName}>{customer.name}</Text>
                {customer.abn && <Text style={styles.partyText}>ABN {customer.abn}</Text>}
                {custAddr.map((l, i) => <Text key={i} style={styles.partyText}>{l}</Text>)}
                {customer.email && <Text style={styles.partyText}>{customer.email}</Text>}
              </>
            ) : <Text style={styles.partyText}>—</Text>}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Deliver To</Text>
            {customer ? (
              customer.delivery_is_same_as_billing ? (
                <Text style={styles.partyText}>Same as Invoice To</Text>
              ) : (
                <>
                  <Text style={styles.partyName}>{customer.name}</Text>
                  {deliverAddr.map((l, i) => <Text key={i} style={styles.partyText}>{l}</Text>)}
                </>
              )
            ) : <Text style={styles.partyText}>—</Text>}
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCard}>
            <Text style={styles.metaCardLabel}>Issued</Text>
            <Text style={styles.metaCardValue}>{fmtDate(invoice.invoice_date)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaCardLabel}>Due</Text>
            <Text style={styles.metaCardValue}>{fmtDate(invoice.due_date)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaCardLabel}>Order</Text>
            <Text style={styles.metaCardValue}>{order?.order_number ?? "—"}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaCardLabel}>Customer Order No</Text>
            <Text style={styles.metaCardValue}>{order?.customer_po_number ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cNum}>#</Text>
            <Text style={styles.cItem}>Description</Text>
            <Text style={styles.cQty}>Qty</Text>
            <Text style={styles.cPrice}>Rate</Text>
            <Text style={styles.cTotal}>Amount</Text>
          </View>
          {lines.length === 0 ? (
            <View style={styles.tr}>
              <Text style={{ width: "100%", textAlign: "center", color: "#94a3b8" }}>
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

        <View style={styles.totalsWrapper}>
          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text>Subtotal</Text>
              <Text>{fmtCurrency(invoice.subtotal, invoice.currency)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>GST (10%)</Text>
              <Text>{fmtCurrency(invoice.tax_total, invoice.currency)}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>Total {invoice.currency}</Text>
              <Text>{fmtCurrency(invoice.total, invoice.currency)}</Text>
            </View>
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
          <Text>Please email remittance payments & invoice numbers to info@germanbutchery.com.au.</Text>
        </View>
      </Page>
    </Document>
  );
}
