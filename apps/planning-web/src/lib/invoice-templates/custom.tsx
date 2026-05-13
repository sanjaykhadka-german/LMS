import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type {
  PositionedBlock,
  TemplateProps,
  TemplateLine,
  TemplateInvoice,
  TemplateTenant,
  TemplateCustomer,
  TemplateOrder,
  ColumnId,
} from "./types";
import { DEFAULT_COLUMN_LABEL, DEFAULT_META_LABEL } from "./types";
import { defaultCustomLayout } from "./default-custom-layout";
import { fmtAddress, fmtCurrency, fmtDate, fmtLot, fmtQty } from "./format";

export function CustomTemplate({ invoice, tenant, customer, order, lines, customTemplate }: TemplateProps) {
  const layout = customTemplate ?? defaultCustomLayout;

  return (
    <Document>
      <Page size="A4" style={{ fontFamily: "Helvetica", color: "#1c1917" }}>
        {layout.blocks.map(block => (
          <View
            key={block.id}
            style={{
              position: "absolute",
              left: block.x,
              top: block.y,
              width: block.width,
              height: block.height,
            }}
          >
            <BlockRenderer
              block={block}
              invoice={invoice}
              tenant={tenant}
              customer={customer}
              order={order}
              lines={lines}
            />
          </View>
        ))}
      </Page>
    </Document>
  );
}

type BlockRendererProps = {
  block: PositionedBlock;
  invoice: TemplateInvoice;
  tenant: TemplateTenant;
  customer: TemplateCustomer | null;
  order: TemplateOrder | null;
  lines: TemplateLine[];
};

function BlockRenderer({ block, invoice, tenant, customer, order, lines }: BlockRendererProps) {
  switch (block.type) {
    case "text":           return <TextBlock block={block} ctx={{ invoice, tenant, customer, order }} />;
    case "logo":           return <LogoBlock tenant={tenant} />;
    case "company-info":   return <CompanyInfoBlock block={block} tenant={tenant} />;
    case "customer-info":  return <CustomerInfoBlock block={block} customer={customer} />;
    case "invoice-meta":   return <InvoiceMetaBlock block={block} invoice={invoice} order={order} />;
    case "line-items-table": return <LineItemsTable block={block} lines={lines} invoice={invoice} tenant={tenant} />;
    case "totals":         return <TotalsBlock block={block} invoice={invoice} tenant={tenant} />;
    case "notes":          return <NotesBlock block={block} invoice={invoice} />;
    case "bank-details":   return <BankDetailsBlock block={block} tenant={tenant} />;
    case "qr-code":        return <QrBlock invoice={invoice} />;
    case "divider":        return <DividerBlock block={block} />;
  }
}

// ── Text block with variable substitution ───────────────────────────────────

function TextBlock({
  block,
  ctx,
}: {
  block: Extract<PositionedBlock, { type: "text" }>;
  ctx: { invoice: TemplateInvoice; tenant: TemplateTenant; customer: TemplateCustomer | null; order: TemplateOrder | null };
}) {
  const resolved = substituteVariables(block.text, ctx);
  return (
    <Text
      style={{
        fontSize: block.fontSize,
        fontWeight: block.fontWeight,
        color: block.color,
        textAlign: block.align,
      }}
    >
      {resolved}
    </Text>
  );
}

// Substitutes {{path.to.field}} from invoice/tenant/customer/order. Unknown
// paths render as the literal placeholder so the user notices.
function substituteVariables(
  text: string,
  ctx: { invoice: TemplateInvoice; tenant: TemplateTenant; customer: TemplateCustomer | null; order: TemplateOrder | null },
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return `{{${path}}}`;
      }
    }
    if (cur == null) return "";
    if (typeof cur === "object") return `{{${path}}}`;
    return String(cur);
  });
}

// ── Logo ────────────────────────────────────────────────────────────────────

function LogoBlock({ tenant }: { tenant: TemplateTenant }) {
  if (!tenant.logo_data_url) return null;
  return <Image src={tenant.logo_data_url} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

// ── Company info ────────────────────────────────────────────────────────────

function CompanyInfoBlock({
  block,
  tenant,
}: {
  block: Extract<PositionedBlock, { type: "company-info" }>;
  tenant: TemplateTenant;
}) {
  const addr = fmtAddress({
    line1: tenant.billing_address_line1,
    line2: tenant.billing_address_line2,
    city: tenant.billing_city,
    state: tenant.billing_state,
    postcode: tenant.billing_postcode,
    country: tenant.billing_country,
  });
  const fs = block.fontSize;
  return (
    <View>
      <Text style={{ fontSize: fs + 3, fontWeight: "bold", marginBottom: 2 }}>{tenant.name}</Text>
      {tenant.abn && <Text style={{ fontSize: fs }}>ABN {tenant.abn}</Text>}
      {addr.map((l, i) => <Text key={i} style={{ fontSize: fs, color: "#57534e" }}>{l}</Text>)}
      {tenant.company_phone && <Text style={{ fontSize: fs, color: "#57534e" }}>{tenant.company_phone}</Text>}
      {tenant.company_email && <Text style={{ fontSize: fs, color: "#57534e" }}>{tenant.company_email}</Text>}
    </View>
  );
}

// ── Customer info ───────────────────────────────────────────────────────────

function CustomerInfoBlock({
  block,
  customer,
}: {
  block: Extract<PositionedBlock, { type: "customer-info" }>;
  customer: TemplateCustomer | null;
}) {
  const fs = block.fontSize;
  if (!customer) {
    return (
      <View>
        <Text style={{ fontSize: fs - 1, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, fontWeight: "bold" }}>Bill To</Text>
        <Text style={{ fontSize: fs, color: "#a8a29e" }}>—</Text>
      </View>
    );
  }
  const addr = fmtAddress({
    line1: customer.billing_address_line1,
    line2: customer.billing_address_line2,
    city: customer.billing_city,
    state: customer.billing_state,
    postcode: customer.billing_postcode,
    country: customer.billing_country,
  });
  return (
    <View>
      <Text style={{ fontSize: fs - 1, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, fontWeight: "bold" }}>Bill To</Text>
      <Text style={{ fontSize: fs + 1, fontWeight: "bold", marginBottom: 2 }}>{customer.name}</Text>
      {customer.abn && <Text style={{ fontSize: fs, color: "#57534e" }}>ABN {customer.abn}</Text>}
      {addr.map((l, i) => <Text key={i} style={{ fontSize: fs, color: "#57534e" }}>{l}</Text>)}
      {customer.email && <Text style={{ fontSize: fs, color: "#57534e" }}>{customer.email}</Text>}
      {customer.phone && <Text style={{ fontSize: fs, color: "#57534e" }}>{customer.phone}</Text>}
    </View>
  );
}

// ── Invoice meta (key-value rows) ───────────────────────────────────────────

function InvoiceMetaBlock({
  block,
  invoice,
  order,
}: {
  block: Extract<PositionedBlock, { type: "invoice-meta" }>;
  invoice: TemplateInvoice;
  order: TemplateOrder | null;
}) {
  const fs = block.fontSize;
  return (
    <View>
      {block.fields.map(field => (
        <View key={field} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
          <Text style={{ fontSize: fs, color: "#78716c" }}>{DEFAULT_META_LABEL[field]}</Text>
          <Text style={{ fontSize: fs, fontWeight: "bold" }}>{metaValue(field, invoice, order)}</Text>
        </View>
      ))}
    </View>
  );
}

function metaValue(field: string, invoice: TemplateInvoice, order: TemplateOrder | null): string {
  switch (field) {
    case "invoice_number":     return invoice.invoice_number;
    case "invoice_date":       return fmtDate(invoice.invoice_date);
    case "due_date":           return fmtDate(invoice.due_date);
    case "order_number":       return order?.order_number ?? "—";
    case "customer_po_number": return order?.customer_po_number ?? "—";
    case "currency":           return invoice.currency;
    default:                   return "—";
  }
}

// ── Line items table ────────────────────────────────────────────────────────

function LineItemsTable({
  block,
  lines,
  invoice,
  tenant,
}: {
  block: Extract<PositionedBlock, { type: "line-items-table" }>;
  lines: TemplateLine[];
  invoice: TemplateInvoice;
  tenant: TemplateTenant;
}) {
  const fs = block.fontSize;
  const headerBg = block.headerColor || tenant.brand_color;
  const cols = block.columns.length > 0 ? block.columns : [];
  if (cols.length === 0) return null;

  // Equal-weight columns. Item columns get a 2× weight so they don't crush.
  const weightFor = (id: ColumnId) => (id === "item_name" || id === "lots" ? 2 : 1);
  const totalWeight = cols.reduce((s, c) => s + weightFor(c.id), 0);

  const styles = StyleSheet.create({
    th: {
      flexDirection: "row",
      backgroundColor: headerBg,
      padding: 5,
    },
    thText: {
      fontSize: fs - 1,
      fontWeight: "bold",
      color: "#ffffff",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    tr: {
      flexDirection: "row",
      padding: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e7e5e4",
    },
    cellText: { fontSize: fs, color: "#1c1917" },
  });

  return (
    <View wrap>
      <View style={styles.th} fixed>
        {cols.map(col => (
          <Text
            key={col.id}
            style={[
              styles.thText,
              { width: `${(weightFor(col.id) / totalWeight) * 100}%`, textAlign: alignFor(col.id) },
            ]}
          >
            {col.label || DEFAULT_COLUMN_LABEL[col.id]}
          </Text>
        ))}
      </View>

      {lines.length === 0 ? (
        <View style={styles.tr}>
          <Text style={{ fontSize: fs, color: "#a8a29e", width: "100%", textAlign: "center" }}>
            No line items.
          </Text>
        </View>
      ) : (
        lines.map(line => (
          <View key={line.line_number} style={styles.tr} wrap={false}>
            {cols.map(col => (
              <View
                key={col.id}
                style={{ width: `${(weightFor(col.id) / totalWeight) * 100}%` }}
              >
                <CellContent col={col.id} line={line} currency={invoice.currency} fontSize={fs} />
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

function alignFor(id: ColumnId): "left" | "right" | "center" {
  if (id === "unit_price" || id === "line_total" || id === "qty_units" || id === "qty_kg") return "right";
  return "left";
}

function CellContent({
  col, line, currency, fontSize,
}: {
  col: ColumnId; line: TemplateLine; currency: string; fontSize: number;
}) {
  const align = alignFor(col);
  const style = { fontSize, color: "#1c1917" as const, textAlign: align };
  switch (col) {
    case "item_code":  return <Text style={style}>{line.item_code ?? "—"}</Text>;
    case "item_name":  return <Text style={style}>{line.item_name ?? "—"}</Text>;
    case "qty_units":  return <Text style={style}>{line.qty_units ?? "—"}</Text>;
    case "qty_kg":     return <Text style={style}>{line.qty_kg != null ? `${line.qty_kg.toFixed(2)} kg` : "—"}</Text>;
    case "unit_price": return <Text style={style}>{line.unit_price != null ? fmtCurrency(line.unit_price, currency) : "—"}</Text>;
    case "line_total": return <Text style={[style, { fontWeight: "bold" }]}>{line.line_total != null ? fmtCurrency(line.line_total, currency) : "—"}</Text>;
    case "lots": {
      const parts = line.lots.map(fmtLot).filter(Boolean);
      return <Text style={style}>{parts.length ? parts.join("  ·  ") : (fmtQty(line.qty_units, line.qty_kg))}</Text>;
    }
  }
}

// ── Totals ──────────────────────────────────────────────────────────────────

function TotalsBlock({
  block,
  invoice,
  tenant,
}: {
  block: Extract<PositionedBlock, { type: "totals" }>;
  invoice: TemplateInvoice;
  tenant: TemplateTenant;
}) {
  const fs = block.fontSize;
  return (
    <View>
      {block.showSubtotal && (
        <Row label="Subtotal" value={fmtCurrency(invoice.subtotal, invoice.currency)} fs={fs} />
      )}
      {block.showTax && (
        <Row label="GST (10%)" value={fmtCurrency(invoice.tax_total, invoice.currency)} fs={fs} />
      )}
      {block.showTotal && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingTop: 5,
            marginTop: 4,
            borderTopWidth: 2,
            borderTopColor: tenant.brand_color,
          }}
        >
          <Text style={{ fontSize: fs + 2, fontWeight: "bold" }}>Total</Text>
          <Text style={{ fontSize: fs + 2, fontWeight: "bold", color: tenant.brand_color }}>
            {fmtCurrency(invoice.total, invoice.currency)}
          </Text>
        </View>
      )}
    </View>
  );
}

function Row({ label, value, fs }: { label: string; value: string; fs: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
      <Text style={{ fontSize: fs, color: "#78716c" }}>{label}</Text>
      <Text style={{ fontSize: fs }}>{value}</Text>
    </View>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────

function NotesBlock({
  block,
  invoice,
}: {
  block: Extract<PositionedBlock, { type: "notes" }>;
  invoice: TemplateInvoice;
}) {
  if (!invoice.notes) return null;
  return (
    <View style={{ padding: 6, backgroundColor: "#fafaf9" }}>
      <Text style={{ fontSize: block.fontSize - 1, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, fontWeight: "bold" }}>
        Notes
      </Text>
      <Text style={{ fontSize: block.fontSize, color: "#57534e" }}>{invoice.notes}</Text>
    </View>
  );
}

// ── Bank details ────────────────────────────────────────────────────────────

function BankDetailsBlock({
  block,
  tenant,
}: {
  block: Extract<PositionedBlock, { type: "bank-details" }>;
  tenant: TemplateTenant;
}) {
  const has = tenant.bank_name || tenant.bank_bsb || tenant.bank_account_number || tenant.bank_account_name;
  if (!has) return null;
  const fs = block.fontSize;
  return (
    <View
      style={{
        padding: 8,
        borderWidth: 1,
        borderColor: tenant.brand_color,
      }}
    >
      <Text style={{ fontSize: fs - 1, fontWeight: "bold", color: tenant.brand_color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
        Payment Details
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {tenant.bank_name && <Field label="Bank" value={tenant.bank_name} fs={fs} />}
        {tenant.bank_account_name && <Field label="Account Name" value={tenant.bank_account_name} fs={fs} />}
        {tenant.bank_bsb && <Field label="BSB" value={tenant.bank_bsb} fs={fs} />}
        {tenant.bank_account_number && <Field label="Account Number" value={tenant.bank_account_number} fs={fs} />}
      </View>
    </View>
  );
}

function Field({ label, value, fs }: { label: string; value: string; fs: number }) {
  return (
    <View style={{ width: "50%", marginBottom: 3 }}>
      <Text style={{ fontSize: fs - 1, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ fontSize: fs, fontWeight: "bold" }}>{value}</Text>
    </View>
  );
}

// ── QR ──────────────────────────────────────────────────────────────────────

function QrBlock({ invoice }: { invoice: TemplateInvoice }) {
  if (!invoice.qr_data_url) return null;
  return <Image src={invoice.qr_data_url} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

// ── Divider ─────────────────────────────────────────────────────────────────

function DividerBlock({ block }: { block: Extract<PositionedBlock, { type: "divider" }> }) {
  return (
    <View
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: block.color,
      }}
    />
  );
}
