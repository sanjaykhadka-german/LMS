"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * Inline barcode chip: a small but crisp QR thumbnail + the monospace code.
 * Hover shows a 200x200 preview popover so the operator can scan from the screen
 * without opening the full Label print page.
 *
 * Quality notes:
 * - We render the canvas at 4x device pixels and pin CSS to the display size,
 *   so QR modules stay sharp (≈3 px/module visible) instead of being blurred
 *   by browser downscaling.
 * - Solid white background; ECC level H so the code stays readable even at
 *   small sizes / on lower-quality printers.
 *
 * Usage:
 *   <BarcodeChip code="RM-WZ7KWU" />
 *   <BarcodeChip code="RM-WZ7KWU" size={32} />
 */
export function BarcodeChip({
  code,
  size = 28,
  showCode = true,
}: {
  code: string | null | undefined;
  /** Display size of the QR thumbnail in pixels. Defaults to 28 — small enough
   *  to live inline in a table row without dominating it. Click to enlarge. */
  size?: number;
  showCode?: boolean;
}) {
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const popoverRef = useRef<HTMLCanvasElement>(null);
  // Click-toggle popover. Hover used to be sufficient but it doesn't work on
  // touch screens, and people kept asking how to scan from a tablet. Now: tap
  // (or click) the chip → popover; tap again or click outside → closes.
  const [open, setOpen] = useState(false);

  // Render thumbnail at 4x density for crisp pixels
  useEffect(() => {
    if (!code || !thumbRef.current) return;
    QRCode.toCanvas(thumbRef.current, code, {
      width: size * 4,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {});
  }, [code, size]);

  // Render the larger preview (260x260) when the popover is open. Slightly
  // bigger than before so it scans cleanly from a phone camera held a foot
  // or so away.
  useEffect(() => {
    if (!open || !code || !popoverRef.current) return;
    QRCode.toCanvas(popoverRef.current, code, {
      width: 260, margin: 1, errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {});
  }, [open, code]);

  // Click-outside closes the popover.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-barcode-chip]")) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!code) {
    return <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>—</span>;
  }

  return (
    <span
      data-barcode-chip
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.5rem",
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={open ? "Click to close" : "Click to enlarge QR"}
        style={{
          padding: 0, border: "1px solid #e7e5e4", background: "#fff",
          borderRadius: "3px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <canvas
          ref={thumbRef}
          width={size * 4}
          height={size * 4}
          style={{
            width: `${size}px`, height: `${size}px`,
            display: "block",
            imageRendering: "pixelated",
            background: "#fff",
            borderRadius: "2px",
          }}
        />
      </button>
      {showCode && (
        <span style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.8125rem", color: "#1c1917", letterSpacing: "0.02em",
          fontWeight: 500,
        }}>
          {code}
        </span>
      )}
      {open && (
        <span style={{
          position: "absolute", left: 0, top: `${size + 8}px`,
          zIndex: 50,
          background: "#fff", border: "1px solid #e7e5e4",
          borderRadius: "0.5rem", boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          padding: "0.75rem",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem",
        }}>
          <canvas ref={popoverRef} width={260} height={260} style={{ width: "260px", height: "260px", imageRendering: "pixelated" }} />
          <span style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.875rem", fontWeight: 600, color: "#1c1917",
          }}>
            {code}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              fontSize: "0.75rem", color: "#78716c", background: "none",
              border: "none", cursor: "pointer", padding: "0.2rem 0.4rem",
            }}
          >Close</button>
        </span>
      )}
    </span>
  );
}
