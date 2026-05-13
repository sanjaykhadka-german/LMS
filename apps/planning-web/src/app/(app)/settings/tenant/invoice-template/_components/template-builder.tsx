"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Rnd } from "react-rnd";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "@/components/back-button";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  ALL_COLUMN_IDS,
  type Block,
  type BlockType,
  type CustomTemplate,
  type PositionedBlock,
} from "@/lib/invoice-templates/types";
import { defaultCustomLayout } from "@/lib/invoice-templates/default-custom-layout";
import BlockPalette from "./block-palette";
import PropertiesPanel from "./properties-panel";
import CanvasBlock from "./canvas-block";

const SCALE = 0.7; // canvas display scale (0.7 of A4 in pt)

type Props = {
  tenantId: string;
  tenantName: string;
  brandColor: string;
  initialLayout: CustomTemplate;
  previewInvoiceId: string | null;
  previewInvoiceNumber: string | null;
};

export default function TemplateBuilder({
  tenantId, tenantName, brandColor, initialLayout, previewInvoiceId, previewInvoiceNumber,
}: Props) {
  const supabase = createClient();
  const [layout, setLayout] = useState<CustomTemplate>(initialLayout);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(
    () => layout.blocks.find(b => b.id === selectedId) ?? null,
    [layout.blocks, selectedId],
  );

  // Delete-key removes selected block.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeBlock(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function markDirty() { setDirty(true); setSaved(false); }

  function updateBlock(id: string, patch: Partial<PositionedBlock>) {
    setLayout(prev => ({
      ...prev,
      blocks: prev.blocks.map(b => (b.id === id ? ({ ...b, ...patch } as PositionedBlock) : b)),
    }));
    markDirty();
  }

  function removeBlock(id: string) {
    setLayout(prev => ({ ...prev, blocks: prev.blocks.filter(b => b.id !== id) }));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }

  function addBlock(type: BlockType) {
    const block = makeNewBlock(type, layout.blocks.length, brandColor);
    setLayout(prev => ({ ...prev, blocks: [...prev.blocks, block] }));
    setSelectedId(block.id);
    markDirty();
  }

  function resetToDefault() {
    if (!confirm("Reset to the default layout? Your current layout will be lost.")) return;
    setLayout(defaultCustomLayout);
    setSelectedId(null);
    markDirty();
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase
      .from("tenants")
      .update({ invoice_custom_template: layout })
      .eq("id", tenantId)
      .select("id");
    setSaving(false);
    if (err) {
      setError(err.message);
    } else {
      setSaved(true);
      setDirty(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <BackButton href="/settings/tenant" label="Tenant settings" />

      <div className="page-header" style={{ marginBottom: "1rem" }}>
        <div>
          <h1 className="page-title">Invoice Template Builder</h1>
          <p className="page-subtitle">
            {tenantName} — drag blocks anywhere on the page, resize, then save.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn-secondary" onClick={resetToDefault} disabled={saving}>
            Reset to default
          </button>
          {previewInvoiceId && (
            <a
              href={`/api/invoices/${previewInvoiceId}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ textDecoration: "none" }}
            >
              Preview PDF{previewInvoiceNumber ? ` (${previewInvoiceNumber})` : ""}
            </a>
          )}
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save layout" : "Saved"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ padding: "0.75rem", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "0.5rem", color: "#166534", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
          ✓ Layout saved. New invoices using the Custom template will render with this layout.
        </div>
      )}
      {!previewInvoiceId && (
        <div style={{ padding: "0.625rem 0.75rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "0.5rem", color: "#1e40af", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          Tip: create at least one invoice first to enable the live PDF preview.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 280px", gap: "0.75rem", alignItems: "start" }}>
        <BlockPalette onAdd={addBlock} />

        <div
          style={{
            background: "#f5f5f4",
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: "1px solid #e7e5e4",
            overflow: "auto",
          }}
          onClick={() => setSelectedId(null)}
        >
          <div
            style={{
              position: "relative",
              width: A4_WIDTH_PT * SCALE,
              height: A4_HEIGHT_PT * SCALE,
              margin: "0 auto",
              background: "#ffffff",
              boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              border: "1px solid #d6d3d1",
              overflow: "hidden",
            }}
            onClick={e => e.stopPropagation()}
          >
            {layout.blocks.map(block => {
              const isSelected = block.id === selectedId;
              return (
                <Rnd
                  key={block.id}
                  size={{ width: block.width * SCALE, height: block.height * SCALE }}
                  position={{ x: block.x * SCALE, y: block.y * SCALE }}
                  bounds="parent"
                  onDragStop={(_e, d) => {
                    updateBlock(block.id, { x: d.x / SCALE, y: d.y / SCALE });
                  }}
                  onResizeStop={(_e, _dir, ref, _delta, position) => {
                    updateBlock(block.id, {
                      width: parseFloat(ref.style.width) / SCALE,
                      height: parseFloat(ref.style.height) / SCALE,
                      x: position.x / SCALE,
                      y: position.y / SCALE,
                    });
                  }}
                  onMouseDown={() => setSelectedId(block.id)}
                  style={{
                    border: isSelected ? `2px solid ${brandColor}` : "1px dashed transparent",
                    background: isSelected ? "rgba(185, 28, 28, 0.03)" : "transparent",
                    boxSizing: "border-box",
                    zIndex: isSelected ? 1000 : block.zIndex,
                  }}
                  resizeHandleStyles={isSelected ? brandHandleStyles(brandColor) : hiddenHandleStyles()}
                >
                  <div style={{ width: "100%", height: "100%", overflow: "hidden", padding: 2 }}>
                    <CanvasBlock block={block} brandColor={brandColor} scale={SCALE} />
                  </div>
                </Rnd>
              );
            })}
          </div>
        </div>

        <PropertiesPanel
          selected={selected}
          onChange={patch => selected && updateBlock(selected.id, patch)}
          onDelete={() => selected && removeBlock(selected.id)}
        />
      </div>

      <div style={{ marginTop: "1rem", padding: "0.75rem 0.875rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", fontSize: "0.8125rem", color: "#57534e" }}>
        <strong>Tips.</strong> Click a block to select; drag to reposition; pull a corner to resize.
        Press <kbd style={kbdStyle}>Delete</kbd> to remove. The line-items table grows downward
        — leave room beneath it (or place it last) so a long invoice doesn&rsquo;t overlap other blocks.
        Once saved, this layout is used whenever an invoice is rendered with the <em>Custom</em> template.{" "}
        <Link href="/settings/tenant" style={{ color: brandColor }}>Back to tenant settings →</Link>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontFamily: "monospace", fontSize: "0.75rem",
  padding: "0.05rem 0.3rem", border: "1px solid #d6d3d1",
  borderBottomWidth: 2, borderRadius: 3, background: "#fff",
};

function brandHandleStyles(color: string): Record<string, React.CSSProperties> {
  const dot: React.CSSProperties = {
    width: 8, height: 8, background: "#fff", border: `1.5px solid ${color}`, borderRadius: 2,
  };
  return {
    top: { ...dot, top: -4, left: "50%", transform: "translateX(-50%)" },
    right: { ...dot, right: -4, top: "50%", transform: "translateY(-50%)" },
    bottom: { ...dot, bottom: -4, left: "50%", transform: "translateX(-50%)" },
    left: { ...dot, left: -4, top: "50%", transform: "translateY(-50%)" },
    topRight: { ...dot, top: -4, right: -4 },
    bottomRight: { ...dot, bottom: -4, right: -4 },
    bottomLeft: { ...dot, bottom: -4, left: -4 },
    topLeft: { ...dot, top: -4, left: -4 },
  };
}

function hiddenHandleStyles(): Record<string, React.CSSProperties> {
  return {
    top: { display: "none" }, right: { display: "none" }, bottom: { display: "none" }, left: { display: "none" },
    topRight: { display: "none" }, bottomRight: { display: "none" }, bottomLeft: { display: "none" }, topLeft: { display: "none" },
  };
}

function makeNewBlock(type: BlockType, index: number, brandColor: string): PositionedBlock {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `b-${Date.now()}-${index}`;

  const offset = (index % 8) * 12;
  const baseX = 60 + offset;
  const baseY = 60 + offset;

  const base = (b: Block, w: number, h: number): PositionedBlock => ({
    ...b, id, x: baseX, y: baseY, width: w, height: h, zIndex: index + 1,
  });

  switch (type) {
    case "text":
      return base({ type: "text", text: "Heading", fontSize: 14, fontWeight: "bold", align: "left", color: "#1c1917" }, 200, 30);
    case "logo":
      return base({ type: "logo" }, 90, 60);
    case "company-info":
      return base({ type: "company-info", fontSize: 9 }, 240, 80);
    case "customer-info":
      return base({ type: "customer-info", fontSize: 9 }, 280, 90);
    case "invoice-meta":
      return base({ type: "invoice-meta", fontSize: 9, fields: ["invoice_number", "invoice_date", "due_date"] }, 220, 70);
    case "line-items-table":
      return base(
        { type: "line-items-table", fontSize: 9, headerColor: "", columns: ALL_COLUMN_IDS.map(id => ({ id })) },
        A4_WIDTH_PT - 72,
        320,
      );
    case "totals":
      return base({ type: "totals", fontSize: 10, showSubtotal: true, showTax: true, showTotal: true }, 220, 80);
    case "notes":
      return base({ type: "notes", fontSize: 8 }, 280, 60);
    case "bank-details":
      return base({ type: "bank-details", fontSize: 8 }, 400, 60);
    case "qr-code":
      return base({ type: "qr-code" }, 70, 70);
    case "divider":
      return base({ type: "divider", color: brandColor }, 400, 1);
  }
}
