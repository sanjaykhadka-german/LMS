"use client";

import { useRef, useState, useCallback } from "react";

export interface ExtractedLine {
  item_hint: string;
  qty: number | null;
  uom: string | null;
  unit_price: number | null;
  notes: string | null;
}

export interface ExtractedOrder {
  customer_hint: string | null;
  required_date: string | null;
  notes: string | null;
  lines: ExtractedLine[];
}

interface Props {
  onExtracted: (data: ExtractedOrder) => void;
}

export default function ImageImportZone({ onExtracted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracted, setExtracted] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file (PNG, JPG, WebP, GIF).");
      return;
    }

    setError(null);
    setLoading(true);
    setExtracted(false);
    setPreviewUrl(URL.createObjectURL(file));

    const fd = new FormData();
    fd.append("image", file);

    try {
      const res = await fetch("/api/orders/extract-from-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");

      setExtracted(true);
      onExtracted(data.extracted);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [onExtracted]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "#b91c1c" : extracted ? "#15803d" : "#d6d3d1"}`,
          borderRadius: "0.75rem",
          padding: "1.5rem 1rem",
          textAlign: "center",
          background: dragging ? "#fef2f2" : extracted ? "#f0fdf4" : "#fafaf9",
          cursor: loading ? "wait" : "pointer",
          transition: "all 0.15s",
          position: "relative",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onFileChange}
        />

        {loading ? (
          <div>
            <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>🔍</div>
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#44403c" }}>
              Reading order from image…
            </p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#78716c" }}>
              Claude is scanning for products, quantities, and dates
            </p>
          </div>
        ) : extracted ? (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {previewUrl && (
              <img src={previewUrl} alt="Order source" style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "0.375rem", border: "1px solid #d6d3d1", flexShrink: 0 }} />
            )}
            <div style={{ textAlign: "left" }}>
              <p style={{ margin: "0 0 0.125rem", fontSize: "0.875rem", fontWeight: 600, color: "#15803d" }}>
                ✓ Order extracted — review and confirm the lines below
              </p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#78716c" }}>
                Click to scan a different image
              </p>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>📸</div>
            <p style={{ margin: "0 0 0.25rem", fontSize: "0.875rem", fontWeight: 600, color: "#44403c" }}>
              Drop a screenshot here to auto-fill this order
            </p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#78716c" }}>
              Works with email screenshots, text/WhatsApp photos, or handwritten order notes
            </p>
          </div>
        )}
      </div>

      {error && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "#b91c1c" }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
