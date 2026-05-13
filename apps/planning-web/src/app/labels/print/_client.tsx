"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";

export default function LabelPrintClient() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const name = params.get("name") ?? "";
  const sub  = params.get("sub")  ?? "";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (!code || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, code, {
      // 800px is plenty for an 80mm-on-print canvas; @media print scales it down crisply.
      width: 800,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    }).then(() => setQrError(null))
      .catch((err: Error) => setQrError(err.message));
  }, [code]);

  if (!code) {
    return (
      <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1 style={{ margin: 0 }}>Missing barcode</h1>
        <p>Open this page with a <code>?code=...</code> query param.</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { margin: 0; padding: 0; background: #fff; }
          .no-print { display: none !important; }
          .label-page {
            width: 210mm; height: 297mm;
            box-shadow: none !important; border: none !important;
            page-break-after: always;
          }
        }
        @media screen {
          html, body { background: #f5f5f4; }
        }
      `}</style>

      <div style={{
        minHeight: "100vh",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "2rem 1rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}>
        {/* Print toolbar (hidden when printing) */}
        <div className="no-print" style={{
          display: "flex", gap: "0.5rem", marginBottom: "1.25rem", alignItems: "center",
        }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "1px solid #1c1917",
              background: "#1c1917", color: "#fff", fontWeight: 600, cursor: "pointer",
            }}
          >
            Print label
          </button>
          <button
            onClick={() => window.close()}
            style={{
              padding: "0.5rem 1rem", borderRadius: "0.5rem", border: "1px solid #d4d4d4",
              background: "#fff", color: "#1c1917", cursor: "pointer",
            }}
          >
            Close
          </button>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#78716c" }}>
            Print on plain A4. The browser&apos;s &quot;Fit to page&quot; will scale this nicely if you cut it down or use sticker labels.
          </span>
        </div>

        {qrError && (
          <div className="no-print" style={{ color: "#dc2626", marginBottom: "1rem", fontSize: "0.875rem" }}>
            QR error: {qrError}
          </div>
        )}

        {/* The full A4 page */}
        <div
          className="label-page"
          style={{
            width: "210mm",
            height: "297mm",
            background: "#fff",
            border: "1px dashed #d4d4d4",
            boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20mm 18mm",
            boxSizing: "border-box",
          }}
        >
          {/* Top: Name */}
          <div style={{
            fontSize: "20mm",
            fontWeight: 800,
            color: "#1c1917",
            lineHeight: 1.1,
            textAlign: "center",
            wordBreak: "break-word",
            marginBottom: "8mm",
          }}>
            {name || "—"}
          </div>

          {/* Subtitle (department / room) */}
          {sub && (
            <div style={{
              fontSize: "8mm",
              fontWeight: 500,
              color: "#57534e",
              lineHeight: 1.2,
              textAlign: "center",
              marginBottom: "10mm",
              wordBreak: "break-word",
            }}>
              {sub}
            </div>
          )}

          {/* Big QR */}
          <canvas
            ref={canvasRef}
            style={{ width: "120mm", height: "120mm", marginBottom: "10mm" }}
          />

          {/* Code in monospace, large */}
          <div style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "16mm",
            fontWeight: 700,
            color: "#1c1917",
            letterSpacing: "0.08em",
            textAlign: "center",
          }}>
            {code}
          </div>
        </div>
      </div>
    </>
  );
}
