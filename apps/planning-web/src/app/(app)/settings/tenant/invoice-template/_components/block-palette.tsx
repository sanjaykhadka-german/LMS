"use client";

import type { BlockType } from "@/lib/invoice-templates/types";

const BLOCKS: Array<{ type: BlockType; label: string; description: string }> = [
  { type: "text",             label: "Text",            description: "Free text. Use {{invoice.invoice_number}}, {{tenant.name}}, etc." },
  { type: "logo",             label: "Logo",            description: "Tenant logo (uploaded in branding)." },
  { type: "company-info",     label: "Company info",    description: "Your name, ABN, address, contact." },
  { type: "customer-info",    label: "Customer (Bill to)", description: "Customer name, ABN, address." },
  { type: "invoice-meta",     label: "Invoice details", description: "Invoice #, dates, PO, etc." },
  { type: "line-items-table", label: "Line items table", description: "Pick which columns to show." },
  { type: "totals",           label: "Totals",          description: "Subtotal, GST, total." },
  { type: "notes",            label: "Notes",           description: "Invoice notes." },
  { type: "bank-details",     label: "Bank details",    description: "Payment band." },
  { type: "qr-code",          label: "QR code",         description: "Auto-generated from invoice number." },
  { type: "divider",          label: "Divider",         description: "Horizontal line." },
];

export default function BlockPalette({ onAdd }: { onAdd: (type: BlockType) => void }) {
  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e7e5e4",
      borderRadius: "0.5rem",
      padding: "0.625rem",
      position: "sticky",
      top: "0.5rem",
    }}>
      <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.8, color: "#78716c", fontWeight: 700, marginBottom: "0.5rem" }}>
        Add blocks
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {BLOCKS.map(b => (
          <button
            key={b.type}
            type="button"
            onClick={() => onAdd(b.type)}
            title={b.description}
            style={{
              textAlign: "left",
              fontSize: "0.8125rem",
              padding: "0.4rem 0.5rem",
              border: "1px solid #e7e5e4",
              borderRadius: "0.375rem",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600 }}>+ {b.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
