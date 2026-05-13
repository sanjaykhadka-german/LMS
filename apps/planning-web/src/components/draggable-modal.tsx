"use client";

/**
 * Reusable draggable modal — click and hold the header to slide it anywhere
 * on screen. Backdrop click closes, but only BEFORE the user has dragged
 * (after dragging we assume they want to keep it open while looking at the
 * page behind it, so click-outside is disabled).
 *
 * Usage:
 *   <DraggableModal title="…" onClose={…} accent="#1e3a8a">
 *     …body…
 *   </DraggableModal>
 *
 * Designed to slot into existing modal markup with minimal disruption — pass
 * the title, accent colour, and an onClose; everything else is styled like
 * the modals already in the app. Footer prop optional.
 */

import { useState, useRef, useEffect, useCallback } from "react";

export type DraggableModalProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Header background colour. Defaults to dark grey. */
  accent?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Max width in px. Real width is min(width, 100vw - margin). */
  width?: number;
  /** Extra style for the inner card. */
  cardStyle?: React.CSSProperties;
  /** When true, a flex-column body fills available height — use for tall
   *  content like grids. Defaults to false (auto-height). */
  flexBody?: boolean;
};

export function DraggableModal({
  title, subtitle, accent = "#1c1917",
  onClose, children, footer, width = 700, cardStyle, flexBody = false,
}: DraggableModalProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // Resize state — drag the bottom-right grip to set explicit size.
  // Tino May 2026: browser resize:both hidden by .card border-radius, so
  // we draw our own grip and track size manually.
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; baseW: number; baseH: number } | null>(null);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    resizeState.current = {
      startX: e.clientX, startY: e.clientY,
      baseW: size?.w ?? rect.width, baseH: size?.h ?? rect.height,
    };
    document.body.style.userSelect = "none";
  }, [size]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizeState.current) return;
      const dx = e.clientX - resizeState.current.startX;
      const dy = e.clientY - resizeState.current.startY;
      const w = Math.max(320, Math.min(window.innerWidth - 16, resizeState.current.baseW + dx));
      const h = Math.max(240, Math.min(window.innerHeight - 16, resizeState.current.baseH + dy));
      setSize({ w, h });
    }
    function onUp() {
      if (!resizeState.current) return;
      resizeState.current = null;
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    e.preventDefault();
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      baseX: pos?.x ?? rect.left, baseY: pos?.y ?? rect.top,
    };
    document.body.style.userSelect = "none";
  }, [pos]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      const nx = dragState.current.baseX + dx;
      const ny = dragState.current.baseY + dy;
      const maxX = window.innerWidth - 40;
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.max(-width + 80, Math.min(maxX, nx)),
        y: Math.max(0, Math.min(maxY, ny)),
      });
    }
    function onUp() {
      dragState.current = null;
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  // Esc closes — keyboard expectation in any decent modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isDragged = pos !== null;

  return (
    <div
      // Close on mousedown directly on the backdrop, not on click. Tino May
      // 2026 — the click-based close fired even when the user's mousedown
      // started on the resize handle (inside the card) and the mouseup
      // landed on the backdrop after dragging the corner outward, because
      // a click event fires on the common ancestor of mousedown+mouseup.
      // Switching to onMouseDown with target===currentTarget means only a
      // mousedown that lands directly on the backdrop counts — drags that
      // start inside the card never trigger close.
      onMouseDown={isDragged ? undefined : (e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed", inset: 0,
        background: isDragged ? "transparent" : "rgba(0,0,0,0.45)",
        zIndex: 80,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "1.5rem 1rem",
        pointerEvents: isDragged ? "none" : "auto",
        overflow: "auto",
      }}
    >
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        className="card"
        style={{
          // Width: explicit size override > flex/min(width,100%)
          width: size ? `${size.w}px` : `min(${width}px, 100%)`,
          height: size ? `${size.h}px` : undefined,
          // Viewport caps. Once dragged, anchor the cap to pos so the
          // bottom edge stays on screen (this was the "scrolling dies after
          // dragging" bug — modal extended past viewport bottom).
          maxWidth: pos ? `calc(100vw - ${Math.max(8, pos.x + 16)}px)` : "calc(100vw - 1rem)",
          maxHeight: pos ? `calc(100vh - ${Math.max(8, pos.y + 16)}px)` : "calc(100vh - 1.5rem)",
          minWidth: 320,
          minHeight: 240,
          overflow: "hidden", // body scrolls inside; corners stay rounded
          position: "relative", // anchor for the absolutely-placed resize grip
          padding: 0, background: "#fff",
          display: "flex", flexDirection: "column",
          boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
          pointerEvents: "auto",
          ...(pos
            ? { position: "fixed", left: pos.x, top: pos.y, margin: 0 }
            : {}),
          ...cardStyle,
        }}
      >
        <div
          onMouseDown={onMouseDown}
          style={{
            padding: "0.75rem 1.25rem",
            borderBottom: "1px solid #e7e5e4",
            background: accent, color: "#fff",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            cursor: "move",
            userSelect: "none",
            flexShrink: 0,
          }}
          title="Drag to move"
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h2>
            {subtitle && (
              <div style={{ fontSize: "0.75rem", opacity: 0.85, marginTop: "0.2rem" }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: "0.375rem", padding: "0.25rem 0.625rem", cursor: "pointer", fontSize: "0.875rem", flexShrink: 0, marginLeft: "0.5rem" }}
          >×</button>
        </div>
        <div style={{
          padding: "1rem 1.25rem",
          flex: 1, minHeight: 0, overflow: "auto",
          display: "flex", flexDirection: "column",
          // flexBody prop is now a no-op — every body scrolls inside the
          // viewport-capped card. Kept on the type for API back-compat.
        }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", justifyContent: "flex-end", background: "#fafaf9", flexShrink: 0 }}>
            {footer}
          </div>
        )}
        {/* Custom resize grip — three diagonal grey lines in the bottom-right
            corner. Browser resize:both hidden by .card border-radius. */}
        <div
          onMouseDown={onResizeMouseDown}
          title="Drag to resize"
          style={{
            position: "absolute",
            bottom: 2,
            right: 2,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            background: "linear-gradient(135deg, transparent 0 35%, #a8a29e 35% 45%, transparent 45% 55%, #a8a29e 55% 65%, transparent 65% 75%, #a8a29e 75% 85%, transparent 85% 100%)",
            borderBottomRightRadius: "0.65rem",
            opacity: 0.85,
            zIndex: 2,
          }}
        />
      </div>
    </div>
  );
}
