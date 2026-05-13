export type InvoiceTemplateId = "classic" | "modern" | "custom";

export const TEMPLATE_IDS: InvoiceTemplateId[] = ["classic", "modern", "custom"];

export type TemplateLot = {
  batch_number: string | null;
  use_by_date: string | null;
  qty_dispatched: number | null;
  dispatch_uom: string | null;
};

export type TemplateLine = {
  line_number: number;
  item_name: string | null;
  item_code: string | null;
  qty_units: number | null;
  qty_kg: number | null;
  unit_price: number | null;
  line_total: number | null;
  lots: TemplateLot[];
};

export type TemplateInvoice = {
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number | null;
  tax_total: number | null;
  total: number | null;
  notes: string | null;
  qr_data_url: string | null;
};

export type TemplateTenant = {
  name: string;
  abn: string | null;
  company_phone: string | null;
  company_email: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
  logo_data_url: string | null;
  brand_color: string;
  bank_name: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
};

export type TemplateCustomer = {
  name: string;
  abn: string | null;
  email: string | null;
  phone: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postcode: string | null;
  billing_country: string | null;
  delivery_is_same_as_billing: boolean;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postcode: string | null;
};

export type TemplateOrder = {
  order_number: string | null;
  customer_po_number: string | null;
};

// ── Custom template (free-canvas) ────────────────────────────────────────────

export type ColumnId =
  | "item_code"
  | "item_name"
  | "qty_units"
  | "qty_kg"
  | "unit_price"
  | "line_total"
  | "lots";

export const ALL_COLUMN_IDS: ColumnId[] = [
  "item_code", "item_name", "qty_units", "qty_kg", "unit_price", "line_total", "lots",
];

export const DEFAULT_COLUMN_LABEL: Record<ColumnId, string> = {
  item_code:   "Code",
  item_name:   "Item",
  qty_units:   "Qty (units)",
  qty_kg:      "Qty (kg)",
  unit_price:  "Unit Price",
  line_total:  "Line Total",
  lots:        "Batch / Lot",
};

export type MetaFieldId =
  | "invoice_number"
  | "invoice_date"
  | "due_date"
  | "order_number"
  | "customer_po_number"
  | "currency";

export const ALL_META_FIELD_IDS: MetaFieldId[] = [
  "invoice_number", "invoice_date", "due_date", "order_number", "customer_po_number", "currency",
];

export const DEFAULT_META_LABEL: Record<MetaFieldId, string> = {
  invoice_number:     "Invoice #",
  invoice_date:       "Invoice Date",
  due_date:           "Due Date",
  order_number:       "Order #",
  customer_po_number: "Customer PO",
  currency:           "Currency",
};

export type Block =
  | {
      type: "text";
      text: string;
      fontSize: number;
      fontWeight: "normal" | "bold";
      align: "left" | "center" | "right";
      color: string;
    }
  | { type: "logo" }
  | { type: "company-info"; fontSize: number }
  | { type: "customer-info"; fontSize: number }
  | { type: "invoice-meta"; fontSize: number; fields: MetaFieldId[] }
  | {
      type: "line-items-table";
      fontSize: number;
      headerColor: string; // hex; empty string = use brand_color
      columns: Array<{ id: ColumnId; label?: string }>;
    }
  | {
      type: "totals";
      fontSize: number;
      showSubtotal: boolean;
      showTax: boolean;
      showTotal: boolean;
    }
  | { type: "notes"; fontSize: number }
  | { type: "bank-details"; fontSize: number }
  | { type: "qr-code" }
  | { type: "divider"; color: string };

export type BlockType = Block["type"];

export type PositionedBlock = Block & {
  id: string;
  x: number;       // pt
  y: number;       // pt
  width: number;   // pt
  height: number;  // pt
  zIndex: number;
};

export type CustomTemplate = {
  version: 1;
  page: { format: "A4"; padding: number };
  blocks: PositionedBlock[];
};

// A4 in PDF points
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export type TemplateProps = {
  invoice: TemplateInvoice;
  tenant: TemplateTenant;
  customer: TemplateCustomer | null;
  order: TemplateOrder | null;
  lines: TemplateLine[];
  customTemplate: CustomTemplate | null;
};

export const TEMPLATE_LABELS: Record<InvoiceTemplateId, string> = {
  classic: "Classic",
  modern: "Modern",
  custom: "Custom",
};

export const TEMPLATE_DESCRIPTIONS: Record<InvoiceTemplateId, string> = {
  classic: "Bordered table layout with branded header band.",
  modern: "Bold typography with prominent total card.",
  custom: "Drag-and-drop builder — design your own invoice.",
};
