/**
 * CountryMark — small "Made in <country>" badge with a fill bar showing the
 * local-ingredient share. Custom SVG so we don't infringe on the
 * Australian Made trademark (no kangaroo / no green-triangle outline) but
 * still convey the same compliance information at a glance.
 *
 * Phase 3H.5 v3 (Tino May 8 2026): replaces the emoji-based icon Tino
 * called out as not usable on customer-facing PDFs.
 *
 * The badge shows:
 *   - "MADE IN <country>" header (block caps)
 *   - A horizontal fill bar — green portion = localPct, grey portion = imported
 *   - "<rounded>% local ingredients" subtext
 *
 * If localPct is null/0 the bar shows fully grey and the subtext flips to
 * "Imported ingredients" so the badge still renders cleanly for products
 * that aren't predominantly local.
 *
 * Pure presentational — no client hooks, safe to use inside React Server
 * Components and the spec PDF preview.
 */
export function CountryMark({
  country,
  adjective,
  localPct,
  size = "md",
}: {
  country: string | null;
  adjective?: string | null;
  localPct: number;
  size?: "sm" | "md" | "lg";
}) {
  const safeCountry = (country ?? "—").toUpperCase();
  const adj = adjective ?? country ?? "local";
  const pct = Math.max(0, Math.min(100, localPct));
  const dims = {
    sm: { w: 130, h: 64, headerFs: 9,  pctFs: 16, subFs: 7,  pad: 6 },
    md: { w: 168, h: 84, headerFs: 11, pctFs: 22, subFs: 9,  pad: 8 },
    lg: { w: 220, h: 110, headerFs: 14, pctFs: 28, subFs: 11, pad: 10 },
  }[size];

  return (
    <div style={{
      display: "inline-flex",
      flexDirection: "column",
      width: `${dims.w}px`,
      border: "2px solid #15803d",
      borderRadius: "0.5rem",
      padding: `${dims.pad}px`,
      background: "#fff",
      fontFamily: "Helvetica, Arial, sans-serif",
      boxSizing: "border-box",
      pageBreakInside: "avoid",
    }}>
      {/* Header */}
      <div style={{
        fontSize: `${dims.headerFs}px`,
        fontWeight: 800,
        letterSpacing: "0.08em",
        color: "#15803d",
        textAlign: "center",
        marginBottom: "0.25rem",
      }}>
        MADE IN {safeCountry}
      </div>

      {/* Big % */}
      <div style={{
        fontSize: `${dims.pctFs}px`,
        fontWeight: 800,
        textAlign: "center",
        color: "#1c1917",
        lineHeight: 1.05,
      }}>
        {pct.toFixed(1)}%
      </div>

      {/* Bar */}
      <div style={{
        marginTop: "0.4rem",
        height: "10px",
        background: "#e5e7eb",
        borderRadius: "5px",
        overflow: "hidden",
        border: "1px solid #d1d5db",
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: "linear-gradient(90deg, #16a34a 0%, #22c55e 100%)",
          transition: "width 0.4s ease",
        }} />
      </div>

      {/* Subtext */}
      <div style={{
        marginTop: "0.35rem",
        fontSize: `${dims.subFs}px`,
        color: "#57534e",
        textAlign: "center",
        lineHeight: 1.3,
      }}>
        {pct > 0
          ? <>{adj} ingredients</>
          : <>Imported ingredients</>}
      </div>
    </div>
  );
}
