"use client";

import Link from "next/link";

/**
 * Family Context Strip — renders related items as faded mini-cards around
 * the cost-summary-card on /items/[id]. Two flavours:
 *
 *   • "lineage"  — ancestor chain (parent → grandparent → ...).
 *   • "consumers" — FG/WIP items whose active BOM uses THIS item, i.e.
 *                   where the money flows TO.
 *
 * Each card is intentionally compact and faded — they're context for the
 * current item's cost summary, not the headline. Click to navigate.
 */

const TYPE_TINT: Record<string, { bg: string; fg: string }> = {
  finished_good: { bg: "#dcfce7", fg: "#166534" },
  wip:           { bg: "#fef3c7", fg: "#854d0e" },
  wipf:          { bg: "#fef3c7", fg: "#854d0e" },
  wipp:          { bg: "#fef3c7", fg: "#854d0e" },
  raw_material:  { bg: "#fef3c7", fg: "#92400e" },
  packaging:     { bg: "#e0e7ff", fg: "#3730a3" },
};

const TYPE_LABEL: Record<string, string> = {
  finished_good: "FG",
  wip:           "WIP",
  wipf:          "WIPF",
  wipp:          "WIPP",
  raw_material:  "RM",
  packaging:     "PKG",
};

export type FamilyItem = {
  id: string;
  code: string;
  name: string;
  item_type: string;
  unit: string | null;
  cogs: number | null;
};

function fmtAud(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function MiniCard({ item, faded = true }: { item: FamilyItem; faded?: boolean }) {
  const tint = TYPE_TINT[item.item_type] ?? { bg: "#f5f5f4", fg: "#57534e" };
  const typeLabel = TYPE_LABEL[item.item_type] ?? item.item_type;
  return (
    <Link
      href={`/items/${item.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        background: "#fff",
        border: "1px solid #e7e5e4",
        borderRadius: "0.5rem",
        padding: "0.5rem 0.625rem",
        minWidth: "150px",
        opacity: faded ? 0.75 : 1,
        transition: "opacity 0.15s, border-color 0.15s, box-shadow 0.15s",
        color: "#1c1917",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.borderColor = "#c4b5a8";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.opacity = faded ? "0.75" : "1";
        e.currentTarget.style.borderColor = "#e7e5e4";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.2rem" }}>
        <span style={{
          fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.04em",
          background: tint.bg, color: tint.fg,
          borderRadius: "0.25rem", padding: "0.1rem 0.3rem",
        }}>{typeLabel}</span>
        <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#78716c" }}>{item.code}</span>
      </div>
      <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#292524", lineHeight: 1.25, marginBottom: "0.25rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {item.name}
      </div>
      <div style={{ fontSize: "0.7rem", color: "#78716c", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>COGS</span>
        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#1c1917" }}>
          {fmtAud(item.cogs)}{item.unit ? <span style={{ color: "#a8a29e", fontWeight: 400 }}>/{item.unit}</span> : null}
        </span>
      </div>
    </Link>
  );
}

export default function FamilyContextStrip({
  variant, label, hint, items,
}: {
  variant: "lineage" | "consumers";
  label: string;
  hint?: string;
  items: FamilyItem[];
}) {
  if (items.length === 0) return null;
  const accent = variant === "lineage" ? "#a8a29e" : "#78716c";
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.375rem" }}>
        <span style={{
          fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: accent,
        }}>{label}</span>
        {hint && (
          <span style={{ fontSize: "0.7rem", color: "#a8a29e", fontStyle: "italic" }}>{hint}</span>
        )}
        <span style={{ fontSize: "0.65rem", color: "#a8a29e" }}>
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div style={{
        display: "flex", gap: "0.5rem", flexWrap: "wrap",
        paddingBottom: "0.25rem",
      }}>
        {items.map(item => <MiniCard key={item.id} item={item} />)}
      </div>
    </div>
  );
}
   