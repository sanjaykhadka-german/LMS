"use client";

/**
 * Pick-type cards — the entry point for adding a new product.
 *
 * Five cards (one is a recommended highlight, one opens an inline picker):
 *   • Resold item                — buy and resell, no production
 *   • 1-step recipe              — combine ingredients, sell
 *   • Multi-step recipe          — multiple production stages
 *   • Clone an existing item     — fastest way to create a variant
 *
 * Each card routes to the appropriate next step. The simple cases just hand
 * the user to `/items/new?archetype=X` so the existing ItemForm pre-selects
 * sensible defaults. The Clone card opens an inline picker.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackButton } from "@/components/back-button";

type Item = { id: string; code: string; name: string; item_type: string; is_active: boolean };

type Archetype = "resold" | "raw" | "1step" | "multistep" | "clone";

type CardDef = {
  archetype: Archetype;
  icon: string;
  title: string;
  blurb: string;
  tag: string;
  recommended?: boolean;
};

const CARDS: CardDef[] = [
  {
    archetype: "resold",
    icon: "📦",
    title: "Resold item",
    blurb: "You buy this from a supplier and sell it as-is. No production happens here.",
    tag: "Single item",
  },
  {
    archetype: "raw",
    icon: "🌾",
    title: "Raw material or packaging",
    blurb: "Something you buy and use as input — ingredients, packaging, cleaning supplies. Multi-supplier ready.",
    tag: "Buy + use as input",
  },
  {
    archetype: "1step",
    icon: "🥣",
    title: "1-step recipe",
    blurb: "Combine ingredients in one go and sell the result. No intermediate stages.",
    tag: "Recipe + product",
  },
  {
    archetype: "multistep",
    icon: "🔗",
    title: "Multi-step recipe",
    blurb: "You make something, then do more work to it (cook, fill, slice, pack…) before selling.",
    tag: "Recommended for most products",
    recommended: true,
  },
  {
    archetype: "clone",
    icon: "📋",
    title: "Clone an existing item",
    blurb: "Start from a product you already have and only edit the differences. Fastest path.",
    tag: "Copy & modify",
  },
];

export default function PickTypeCards({ items }: { items: Item[] }) {
  const router = useRouter();
  const [openClone, setOpenClone] = useState(false);
  const [search, setSearch]       = useState("");
  const [pickedId, setPickedId]   = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!openClone) return [] as Item[];
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 50);  // show first 50 by default
    return items
      .filter(i =>
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [items, search, openClone]);

  function pickCard(arch: Archetype) {
    if (arch === "clone") {
      setOpenClone(true);
      return;
    }
    // Recipe archetypes go through the guided wizard.
    // Resold items still go to the classic form (single-shot, supplier-led).
    if (arch === "1step" || arch === "multistep" || arch === "raw") {
      router.push(`/items/new/wizard?archetype=${arch}`);
    } else {
      router.push(`/items/new?archetype=${arch}`);
    }
  }

  function confirmClone() {
    if (!pickedId) return;
    router.push(`/items/new?duplicate_from=${pickedId}`);
  }

  return (
    <div style={{ maxWidth: "880px" }}>
      <BackButton href="/items" label="Item Master" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Add a new product</h1>
          <p className="page-subtitle">
            Pick the shape that fits your product. You can always change it later — and
            you'll never be asked about <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>WIP</span>{" "}
            / <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>WIPF</span>{" "}
            / <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>WIPP</span> /{" "}
            <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>Finished Good</span>{" "}
            unless you go looking for it.
          </p>
        </div>
        <Link href="/items/new" className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
          Skip — open classic form
        </Link>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "0.875rem",
        marginTop: "1rem",
      }}>
        {CARDS.map(c => (
          <button
            key={c.archetype}
            type="button"
            onClick={() => pickCard(c.archetype)}
            className="pick-card"
            style={{
              textAlign: "left",
              background: c.recommended
                ? "linear-gradient(180deg, #fef2f2 0%, #ffffff 50%)"
                : "#ffffff",
              border: c.recommended ? "1px solid #b91c1c" : "1px solid #e7e5e4",
              borderRadius: "0.625rem",
              padding: "1.125rem",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "transform 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
              if (!c.recommended) (e.currentTarget as HTMLElement).style.borderColor = "#78716c";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.transform = "none";
              if (!c.recommended) (e.currentTarget as HTMLElement).style.borderColor = "#e7e5e4";
            }}
          >
            <span style={{ fontSize: "1.625rem", display: "block", marginBottom: "0.625rem" }}>
              {c.icon}
            </span>
            <h3 style={{ margin: "0 0 0.4rem", fontSize: "1rem", fontWeight: 600 }}>{c.title}</h3>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "#57534e", lineHeight: 1.5 }}>
              {c.blurb}
            </p>
            <span style={{
              display: "inline-block",
              marginTop: "0.875rem",
              padding: "0.15rem 0.5rem",
              background: c.recommended ? "#b91c1c" : "#ece8e2",
              color: c.recommended ? "#ffffff" : "#57534e",
              borderRadius: "0.25rem",
              fontSize: "0.6875rem",
              fontWeight: 500,
            }}>{c.tag}</span>
          </button>
        ))}
      </div>

      <div style={{
        marginTop: "2rem",
        padding: "0.875rem 1rem",
        background: "#fafaf9",
        border: "1px solid #e7e5e4",
        borderRadius: "0.5rem",
        fontSize: "0.8125rem",
        color: "#57534e",
      }}>
        <strong style={{ color: "#1c1917" }}>What about the technical jargon?</strong>{" "}
        Tracey decides item types automatically based on how you describe your process.
        You'll never need to pick between WIP / WIPF / WIPP / Finished Good unless you
        switch to the classic form.
      </div>

      {/* ─── Clone picker overlay ───────────────────────────── */}
      {openClone && (
        <div
          onClick={() => setOpenClone(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 80,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "3rem 1rem",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              background: "white",
              borderRadius: "0.75rem",
              boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            <div style={{
              padding: "1rem 1.25rem",
              borderBottom: "1px solid #e7e5e4",
              background: "#1c1917", color: "white",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                  Clone an existing item
                </h2>
                <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", opacity: 0.85 }}>
                  Pick the source — it pre-fills the New Item form. You'll set a new code.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenClone(false)}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  color: "white",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.625rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >×</button>
            </div>

            <div style={{ padding: "1rem 1.25rem" }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by code or name…"
                autoFocus
                style={{
                  width: "100%",
                  padding: "0.625rem 0.75rem",
                  border: "1px solid #cfc9bf",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                  marginBottom: "0.75rem",
                }}
              />

              <div style={{
                maxHeight: "320px", overflowY: "auto",
                border: "1px solid #e7e5e4", borderRadius: "0.375rem",
              }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "1.5rem", textAlign: "center", color: "#a8a29e", fontSize: "0.8125rem" }}>
                    {search.trim() ? "No items match — try a different search." : "Start typing to search."}
                  </div>
                ) : (
                  filtered.map(it => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setPickedId(it.id)}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "0.5rem 0.75rem",
                        border: "none",
                        borderBottom: "1px solid #f5f5f4",
                        background: pickedId === it.id ? "#fef2f2" : "transparent",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        fontFamily: "inherit",
                        fontSize: "0.8125rem",
                        opacity: it.is_active ? 1 : 0.55,
                      }}
                    >
                      <span style={{
                        fontFamily: "monospace", fontSize: "0.7rem",
                        color: "#78716c", flexShrink: 0, minWidth: "100px",
                      }}>
                        {it.code}
                      </span>
                      <span style={{ flex: 1, color: "#1c1917" }}>{it.name}</span>
                      <span style={{
                        fontSize: "0.6875rem", color: "#a8a29e", textTransform: "uppercase",
                        letterSpacing: "0.04em", flexShrink: 0,
                      }}>
                        {it.item_type.replace("_", " ")}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div style={{
              padding: "0.75rem 1.25rem",
              borderTop: "1px solid #e7e5e4",
              background: "#fafaf9",
              display: "flex", gap: "0.5rem", justifyContent: "flex-end",
            }}>
              <button
                type="button"
                onClick={() => setOpenClone(false)}
                className="btn-secondary"
              >Cancel</button>
              <button
                type="button"
                onClick={confirmClone}
                disabled={!pickedId}
                className="btn-primary"
                style={{ opacity: pickedId ? 1 : 0.5 }}
              >Clone &amp; open New Item form →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
