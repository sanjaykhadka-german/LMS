"use client";

import {
  ALL_COLUMN_IDS,
  ALL_META_FIELD_IDS,
  DEFAULT_COLUMN_LABEL,
  DEFAULT_META_LABEL,
  type ColumnId,
  type MetaFieldId,
  type PositionedBlock,
} from "@/lib/invoice-templates/types";

type Props = {
  selected: PositionedBlock | null;
  onChange: (patch: Partial<PositionedBlock>) => void;
  onDelete: () => void;
};

export default function PropertiesPanel({ selected, onChange, onDelete }: Props) {
  if (!selected) {
    return (
      <div style={panelStyle}>
        <div style={titleStyle}>Properties</div>
        <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: 0 }}>
          Select a block on the canvas to edit its properties.
        </p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>{labelFor(selected.type)}</div>

      <PositionFields block={selected} onChange={onChange} />

      <hr style={hrStyle} />

      <BlockSpecificFields block={selected} onChange={onChange} />

      <hr style={hrStyle} />

      <button
        type="button"
        onClick={onDelete}
        style={{
          fontSize: "0.8125rem",
          padding: "0.4rem 0.625rem",
          background: "#fff",
          border: "1px solid #fca5a5",
          borderRadius: "0.375rem",
          color: "#dc2626",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Delete block
      </button>
    </div>
  );
}

function PositionFields({ block, onChange }: { block: PositionedBlock; onChange: (p: Partial<PositionedBlock>) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
      <NumberField label="X (pt)" value={block.x} onChange={v => onChange({ x: v })} />
      <NumberField label="Y (pt)" value={block.y} onChange={v => onChange({ y: v })} />
      <NumberField label="Width" value={block.width} onChange={v => onChange({ width: v })} />
      <NumberField label="Height" value={block.height} onChange={v => onChange({ height: v })} />
    </div>
  );
}

function BlockSpecificFields({ block, onChange }: { block: PositionedBlock; onChange: (p: Partial<PositionedBlock>) => void }) {
  switch (block.type) {
    case "text":
      return (
        <>
          <Label>Text</Label>
          <textarea
            className="form-input"
            value={block.text}
            onChange={e => onChange({ text: e.target.value } as Partial<PositionedBlock>)}
            rows={3}
            style={{ fontSize: "0.8125rem", fontFamily: "inherit" }}
          />
          <div style={{ fontSize: "0.6875rem", color: "#78716c", margin: "0.25rem 0 0.5rem" }}>
            Variables: <code>{`{{invoice.invoice_number}}`}</code>, <code>{`{{tenant.name}}`}</code>, <code>{`{{customer.name}}`}</code>
          </div>
          <NumberField label="Font size" value={block.fontSize} onChange={v => onChange({ fontSize: v } as Partial<PositionedBlock>)} />
          <Label>Weight</Label>
          <select
            className="form-input"
            value={block.fontWeight}
            onChange={e => onChange({ fontWeight: e.target.value as "normal" | "bold" } as Partial<PositionedBlock>)}
            style={{ fontSize: "0.8125rem" }}
          >
            <option value="normal">Normal</option>
            <option value="bold">Bold</option>
          </select>
          <Label>Align</Label>
          <select
            className="form-input"
            value={block.align}
            onChange={e => onChange({ align: e.target.value as "left" | "center" | "right" } as Partial<PositionedBlock>)}
            style={{ fontSize: "0.8125rem" }}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <ColorField label="Colour" value={block.color} onChange={v => onChange({ color: v } as Partial<PositionedBlock>)} />
        </>
      );

    case "logo":
    case "qr-code":
      return (
        <p style={{ fontSize: "0.75rem", color: "#78716c", margin: 0 }}>
          {block.type === "logo"
            ? "Renders the logo uploaded in tenant branding."
            : "QR code is auto-generated from the invoice number."}
        </p>
      );

    case "company-info":
    case "customer-info":
    case "notes":
    case "bank-details":
      return (
        <NumberField label="Font size" value={block.fontSize} onChange={v => onChange({ fontSize: v } as Partial<PositionedBlock>)} />
      );

    case "invoice-meta":
      return (
        <>
          <NumberField label="Font size" value={block.fontSize} onChange={v => onChange({ fontSize: v } as Partial<PositionedBlock>)} />
          <Label>Fields shown</Label>
          <FieldList<MetaFieldId>
            all={ALL_META_FIELD_IDS}
            selected={block.fields}
            label={f => DEFAULT_META_LABEL[f]}
            onChange={fields => onChange({ fields } as Partial<PositionedBlock>)}
          />
        </>
      );

    case "line-items-table":
      return (
        <>
          <NumberField label="Font size" value={block.fontSize} onChange={v => onChange({ fontSize: v } as Partial<PositionedBlock>)} />
          <ColorField
            label="Header colour (blank = brand)"
            value={block.headerColor}
            onChange={v => onChange({ headerColor: v } as Partial<PositionedBlock>)}
            allowEmpty
          />
          <Label>Columns (drag-arrows to reorder, checkbox to show)</Label>
          <ColumnList
            columns={block.columns}
            onChange={columns => onChange({ columns } as Partial<PositionedBlock>)}
          />
        </>
      );

    case "totals":
      return (
        <>
          <NumberField label="Font size" value={block.fontSize} onChange={v => onChange({ fontSize: v } as Partial<PositionedBlock>)} />
          <CheckField label="Show subtotal" value={block.showSubtotal} onChange={v => onChange({ showSubtotal: v } as Partial<PositionedBlock>)} />
          <CheckField label="Show GST" value={block.showTax} onChange={v => onChange({ showTax: v } as Partial<PositionedBlock>)} />
          <CheckField label="Show total" value={block.showTotal} onChange={v => onChange({ showTotal: v } as Partial<PositionedBlock>)} />
        </>
      );

    case "divider":
      return (
        <ColorField label="Colour" value={block.color} onChange={v => onChange({ color: v } as Partial<PositionedBlock>)} />
      );
  }
}

// ── Column editor (show/hide + reorder + label override) ──────────────────

function ColumnList({
  columns,
  onChange,
}: {
  columns: Array<{ id: ColumnId; label?: string }>;
  onChange: (cols: Array<{ id: ColumnId; label?: string }>) => void;
}) {
  const presentIds = new Set(columns.map(c => c.id));

  function move(idx: number, delta: number) {
    const next = idx + delta;
    if (next < 0 || next >= columns.length) return;
    const copy = [...columns];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  }
  function remove(idx: number) {
    onChange(columns.filter((_, i) => i !== idx));
  }
  function add(id: ColumnId) {
    onChange([...columns, { id }]);
  }
  function setLabel(idx: number, label: string) {
    onChange(columns.map((c, i) => (i === idx ? { ...c, label: label || undefined } : c)));
  }

  const missing = ALL_COLUMN_IDS.filter(id => !presentIds.has(id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {columns.map((c, i) => (
        <div
          key={c.id}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto",
            gap: 4,
            alignItems: "center",
            padding: "0.25rem",
            background: "#fafaf9",
            border: "1px solid #e7e5e4",
            borderRadius: "0.25rem",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <button type="button" onClick={() => move(i, -1)} style={arrowBtn} aria-label="Move up">▲</button>
            <button type="button" onClick={() => move(i, +1)} style={arrowBtn} aria-label="Move down">▼</button>
          </div>
          <input
            className="form-input"
            placeholder={DEFAULT_COLUMN_LABEL[c.id]}
            value={c.label ?? ""}
            onChange={e => setLabel(i, e.target.value)}
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.35rem" }}
          />
          <span style={{ fontSize: "0.6875rem", color: "#78716c", padding: "0 0.25rem" }}>{c.id}</span>
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label="Remove column"
            style={{
              fontSize: "0.75rem", color: "#dc2626", background: "none",
              border: "1px solid #fca5a5", borderRadius: 3, padding: "0 0.4rem", cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      ))}
      {missing.length > 0 && (
        <div style={{ marginTop: "0.25rem" }}>
          <Label>Add column</Label>
          <select
            className="form-input"
            value=""
            onChange={e => {
              if (e.target.value) add(e.target.value as ColumnId);
            }}
            style={{ fontSize: "0.75rem" }}
          >
            <option value="">— pick a column —</option>
            {missing.map(id => (
              <option key={id} value={id}>{DEFAULT_COLUMN_LABEL[id]}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ── Field-list checkboxes ─────────────────────────────────────────────────

function FieldList<T extends string>({
  all, selected, label, onChange,
}: {
  all: T[];
  selected: T[];
  label: (id: T) => string;
  onChange: (next: T[]) => void;
}) {
  const set = new Set(selected);
  function toggle(id: T) {
    if (set.has(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  }
  function move(id: T, delta: number) {
    const idx = selected.indexOf(id);
    if (idx === -1) return;
    const next = idx + delta;
    if (next < 0 || next >= selected.length) return;
    const copy = [...selected];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      {all.map(id => {
        const isOn = set.has(id);
        return (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.75rem" }}>
            <input type="checkbox" checked={isOn} onChange={() => toggle(id)} />
            <span style={{ flex: 1 }}>{label(id)}</span>
            {isOn && (
              <>
                <button type="button" onClick={() => move(id, -1)} style={arrowBtn} aria-label="Move up">▲</button>
                <button type="button" onClick={() => move(id, +1)} style={arrowBtn} aria-label="Move down">▼</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Atomic field editors ──────────────────────────────────────────────────

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        className="form-input"
        value={Math.round(value * 10) / 10}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ fontSize: "0.8125rem", padding: "0.25rem 0.4rem" }}
      />
    </div>
  );
}

function ColorField({
  label, value, onChange, allowEmpty,
}: {
  label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="color"
          value={value || "#000000"}
          onChange={e => onChange(e.target.value)}
          style={{ width: 32, height: 28, padding: 0, border: "1px solid #e7e5e4", borderRadius: 3, cursor: "pointer", background: "transparent" }}
        />
        <input
          type="text"
          className="form-input"
          value={value}
          placeholder={allowEmpty ? "(brand)" : "#000000"}
          onChange={e => onChange(e.target.value)}
          style={{ fontSize: "0.75rem", fontFamily: "monospace", padding: "0.2rem 0.35rem" }}
        />
        {allowEmpty && value && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Clear"
            style={{ fontSize: "0.75rem", border: "1px solid #e7e5e4", borderRadius: 3, padding: "0 0.4rem", cursor: "pointer", background: "#fff" }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8125rem", padding: "0.2rem 0", cursor: "pointer" }}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.5, color: "#78716c", fontWeight: 600, marginTop: "0.4rem", marginBottom: "0.15rem" }}>
      {children}
    </div>
  );
}

// ── Misc ──────────────────────────────────────────────────────────────────

function labelFor(t: PositionedBlock["type"]): string {
  return ({
    "text": "Text",
    "logo": "Logo",
    "company-info": "Company info",
    "customer-info": "Customer (Bill to)",
    "invoice-meta": "Invoice details",
    "line-items-table": "Line items table",
    "totals": "Totals",
    "notes": "Notes",
    "bank-details": "Bank details",
    "qr-code": "QR code",
    "divider": "Divider",
  } as const)[t];
}

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7e5e4",
  borderRadius: "0.5rem",
  padding: "0.625rem",
  position: "sticky",
  top: "0.5rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: 0.8,
  color: "#78716c",
  fontWeight: 700,
  marginBottom: "0.5rem",
};

const hrStyle: React.CSSProperties = {
  border: "none", borderTop: "1px solid #e7e5e4", margin: "0.6rem 0",
};

const arrowBtn: React.CSSProperties = {
  fontSize: "0.5rem", padding: "0 0.25rem", lineHeight: 1.1,
  background: "#fff", border: "1px solid #e7e5e4", borderRadius: 2, cursor: "pointer",
};
