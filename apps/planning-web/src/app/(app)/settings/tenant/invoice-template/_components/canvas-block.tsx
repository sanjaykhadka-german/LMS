"use client";

import {
  DEFAULT_COLUMN_LABEL,
  DEFAULT_META_LABEL,
  type PositionedBlock,
} from "@/lib/invoice-templates/types";

// HTML/CSS preview of each block on the canvas. Mirrors the dispatch in
// custom.tsx but uses placeholder content so the user can see the layout
// without needing real invoice data. Sizes are in pt scaled to px.
export default function CanvasBlock({
  block, brandColor, scale,
}: {
  block: PositionedBlock; brandColor: string; scale: number;
}) {
  switch (block.type) {
    case "text":
      return (
        <div
          style={{
            fontSize: block.fontSize * scale,
            fontWeight: block.fontWeight,
            color: block.color,
            textAlign: block.align,
            lineHeight: 1.2,
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {block.text}
        </div>
      );

    case "logo":
      return (
        <div style={ghostStyle("Logo", brandColor)}>Logo</div>
      );

    case "qr-code":
      return (
        <div style={{
          ...ghostStyle("", brandColor),
          backgroundImage: "linear-gradient(45deg, #1c1917 25%, transparent 25%, transparent 75%, #1c1917 75%), linear-gradient(45deg, #1c1917 25%, transparent 25%, transparent 75%, #1c1917 75%)",
          backgroundSize: "10px 10px",
          backgroundPosition: "0 0, 5px 5px",
          opacity: 0.5,
        }}>
          QR
        </div>
      );

    case "company-info": {
      const fs = block.fontSize * scale;
      return (
        <div style={{ fontSize: fs, lineHeight: 1.25 }}>
          <div style={{ fontSize: fs + 3 * scale, fontWeight: "bold", marginBottom: 2 }}>Your Company Pty Ltd</div>
          <div>ABN 12 345 678 901</div>
          <div style={{ color: "#57534e" }}>123 Sample St</div>
          <div style={{ color: "#57534e" }}>Sydney NSW 2000</div>
          <div style={{ color: "#57534e" }}>info@example.com</div>
        </div>
      );
    }

    case "customer-info": {
      const fs = block.fontSize * scale;
      return (
        <div style={{ fontSize: fs, lineHeight: 1.25 }}>
          <div style={{ fontSize: fs - scale, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Bill To</div>
          <div style={{ fontWeight: "bold", marginBottom: 2 }}>Acme Pty Ltd</div>
          <div style={{ color: "#57534e" }}>ABN 98 765 432 100</div>
          <div style={{ color: "#57534e" }}>456 Buyer Rd</div>
          <div style={{ color: "#57534e" }}>Melbourne VIC 3000</div>
        </div>
      );
    }

    case "invoice-meta": {
      const fs = block.fontSize * scale;
      const placeholders: Record<string, string> = {
        invoice_number: "INV-01001",
        invoice_date: "1 May 2026",
        due_date: "31 May 2026",
        order_number: "SO-1042",
        customer_po_number: "PO-9981",
        currency: "AUD",
      };
      return (
        <div style={{ fontSize: fs, lineHeight: 1.3 }}>
          {block.fields.map(f => (
            <div key={f} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ color: "#78716c" }}>{DEFAULT_META_LABEL[f]}</span>
              <span style={{ fontWeight: 600 }}>{placeholders[f]}</span>
            </div>
          ))}
        </div>
      );
    }

    case "line-items-table": {
      const fs = block.fontSize * scale;
      const headerBg = block.headerColor || brandColor;
      const cols = block.columns;
      const rows = [
        { item_code: "A-100", item_name: "Beef brisket",   qty_units: "12", qty_kg: "24.50 kg", unit_price: "AUD 18.00", line_total: "AUD 216.00", lots: "Batch 12345" },
        { item_code: "B-220", item_name: "Pork shoulder",  qty_units: "8",  qty_kg: "16.20 kg", unit_price: "AUD 14.00", line_total: "AUD 112.00", lots: "Batch 67890" },
        { item_code: "C-301", item_name: "Lamb leg",       qty_units: "5",  qty_kg: "10.10 kg", unit_price: "AUD 22.00", line_total: "AUD 110.00", lots: "Batch 24680" },
      ];
      return (
        <div style={{ fontSize: fs, width: "100%", height: "100%", overflow: "hidden" }}>
          <div style={{ display: "flex", background: headerBg, color: "#fff", padding: "3px 4px", fontWeight: 700, fontSize: fs * 0.9, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {cols.map(c => (
              <div key={c.id} style={{ flex: c.id === "item_name" || c.id === "lots" ? 2 : 1, textAlign: alignFor(c.id) }}>
                {c.label || DEFAULT_COLUMN_LABEL[c.id]}
              </div>
            ))}
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", padding: "3px 4px", borderBottom: "0.5px solid #e7e5e4" }}>
              {cols.map(c => (
                <div key={c.id} style={{ flex: c.id === "item_name" || c.id === "lots" ? 2 : 1, textAlign: alignFor(c.id) }}>
                  {(r as Record<string, string>)[c.id] ?? "—"}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    case "totals": {
      const fs = block.fontSize * scale;
      return (
        <div style={{ fontSize: fs, lineHeight: 1.4 }}>
          {block.showSubtotal && (
            <Row label="Subtotal" value="AUD 438.00" fs={fs} />
          )}
          {block.showTax && (
            <Row label="GST (10%)" value="AUD 43.80" fs={fs} />
          )}
          {block.showTotal && (
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 4, marginTop: 3, borderTop: `2px solid ${brandColor}`, fontWeight: 700, fontSize: fs + 2 * scale }}>
              <span>Total</span>
              <span style={{ color: brandColor }}>AUD 481.80</span>
            </div>
          )}
        </div>
      );
    }

    case "notes": {
      const fs = block.fontSize * scale;
      return (
        <div style={{ fontSize: fs, padding: 4, background: "#fafaf9" }}>
          <div style={{ fontSize: fs - scale, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>Notes</div>
          <div style={{ color: "#57534e" }}>Thank you for your business.</div>
        </div>
      );
    }

    case "bank-details": {
      const fs = block.fontSize * scale;
      return (
        <div style={{ fontSize: fs, padding: 4, border: `1px solid ${brandColor}` }}>
          <div style={{ fontSize: fs - scale, color: brandColor, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, marginBottom: 3 }}>Payment Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Field label="Bank" value="Commonwealth" fs={fs} />
            <Field label="Account" value="Your Co Pty Ltd" fs={fs} />
            <Field label="BSB" value="062-000" fs={fs} />
            <Field label="Number" value="1234 5678" fs={fs} />
          </div>
        </div>
      );
    }

    case "divider":
      return <div style={{ width: "100%", height: "100%", background: block.color }} />;
  }
}

function Row({ label, value, fs }: { label: string; value: string; fs: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#78716c", fontSize: fs }}>{label}</span>
      <span style={{ fontSize: fs }}>{value}</span>
    </div>
  );
}

function Field({ label, value, fs }: { label: string; value: string; fs: number }) {
  return (
    <div>
      <div style={{ fontSize: fs - 1, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: fs, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function alignFor(id: string): "left" | "right" {
  if (id === "unit_price" || id === "line_total" || id === "qty_units" || id === "qty_kg") return "right";
  return "left";
}

function ghostStyle(_label: string, brandColor: string): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    background: "#fafaf9",
    border: `1px dashed ${brandColor}`,
    borderRadius: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6875rem",
    color: "#78716c",
    textTransform: "uppercase",
    letterSpacing: 1,
  };
}
