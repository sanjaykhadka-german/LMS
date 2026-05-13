import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  ALL_COLUMN_IDS,
  type CustomTemplate,
  type PositionedBlock,
} from "./types";

// Page padding in pt (~12mm)
const PAD = 36;
const CONTENT_W = A4_WIDTH_PT - PAD * 2;

// Stable IDs for the seed layout. Real new blocks use crypto.randomUUID().
const seedId = (s: string) => `seed-${s}`;

const blocks: PositionedBlock[] = [
  // Logo top-left
  {
    id: seedId("logo"),
    type: "logo",
    x: PAD,
    y: PAD,
    width: 90,
    height: 60,
    zIndex: 1,
  },
  // Title top-right
  {
    id: seedId("title"),
    type: "text",
    text: "TAX INVOICE",
    fontSize: 22,
    fontWeight: "bold",
    align: "right",
    color: "#1c1917",
    x: A4_WIDTH_PT - PAD - 220,
    y: PAD + 4,
    width: 220,
    height: 30,
    zIndex: 1,
  },
  // Invoice meta
  {
    id: seedId("meta"),
    type: "invoice-meta",
    fontSize: 9,
    fields: ["invoice_number", "invoice_date", "due_date", "customer_po_number", "order_number"],
    x: A4_WIDTH_PT - PAD - 220,
    y: PAD + 38,
    width: 220,
    height: 80,
    zIndex: 1,
  },
  // Company info under logo
  {
    id: seedId("company"),
    type: "company-info",
    fontSize: 9,
    x: PAD,
    y: PAD + 70,
    width: 260,
    height: 80,
    zIndex: 1,
  },
  // Divider before customer
  {
    id: seedId("div1"),
    type: "divider",
    color: "#e7e5e4",
    x: PAD,
    y: PAD + 165,
    width: CONTENT_W,
    height: 1,
    zIndex: 1,
  },
  // Customer block
  {
    id: seedId("customer"),
    type: "customer-info",
    fontSize: 9,
    x: PAD,
    y: PAD + 175,
    width: 280,
    height: 90,
    zIndex: 1,
  },
  // QR code top-right under meta
  {
    id: seedId("qr"),
    type: "qr-code",
    x: A4_WIDTH_PT - PAD - 70,
    y: PAD + 175,
    width: 70,
    height: 70,
    zIndex: 1,
  },
  // Line items table
  {
    id: seedId("lines"),
    type: "line-items-table",
    fontSize: 9,
    headerColor: "",
    columns: ALL_COLUMN_IDS.map(id => ({ id })),
    x: PAD,
    y: PAD + 280,
    width: CONTENT_W,
    height: 320,
    zIndex: 1,
  },
  // Totals block bottom-right
  {
    id: seedId("totals"),
    type: "totals",
    fontSize: 10,
    showSubtotal: true,
    showTax: true,
    showTotal: true,
    x: A4_WIDTH_PT - PAD - 220,
    y: PAD + 610,
    width: 220,
    height: 80,
    zIndex: 1,
  },
  // Notes bottom-left
  {
    id: seedId("notes"),
    type: "notes",
    fontSize: 8,
    x: PAD,
    y: PAD + 610,
    width: 280,
    height: 60,
    zIndex: 1,
  },
  // Bank details footer band
  {
    id: seedId("bank"),
    type: "bank-details",
    fontSize: 8,
    x: PAD,
    y: A4_HEIGHT_PT - PAD - 70,
    width: CONTENT_W,
    height: 60,
    zIndex: 1,
  },
];

export const defaultCustomLayout: CustomTemplate = {
  version: 1,
  page: { format: "A4", padding: PAD },
  blocks,
};
