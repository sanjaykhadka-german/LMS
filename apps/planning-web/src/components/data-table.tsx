"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditableConfig {
  type: "text" | "number" | "select" | "multiselect";
  /** DB column to read/write if different from the display key (e.g. item_category_id vs item_category) */
  editKey?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface ColumnDef<T = Record<string, unknown>> {
  key: string;
  label: string;
  width?: number;        // default pixel width
  minWidth?: number;     // minimum during resize (default 80)
  sortable?: boolean;    // default true
  hideable?: boolean;    // default true (false = always visible)
  defaultHidden?: boolean; // start hidden in column picker (user can show it)
  render?: (value: unknown, row: T) => React.ReactNode;
  editable?: EditableConfig;
  /** Optional footer renderer. When ANY visible column has a footer,
   *  DataTable emits a <tfoot> row with each cell calling its column's
   *  footer (or empty if absent). Use for sums / averages / counts. */
  footer?: (rows: T[]) => React.ReactNode;
}

interface DataTableProps<T extends { id: string }> {
  columns: ColumnDef<T>[];
  data: T[];
  href?: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyHref?: string;
  emptyLabel?: string;
  /** Provide to enable Edit Grid mode. Return an error string or null on success. */
  onBulkSave?: (changes: { id: string; fields: Record<string, unknown> }[]) => Promise<string | null>;
  /** When true: removes the internal overflow-x wrapper so the parent can be the scroll container, and makes <th> sticky at top:0 */
  stickyHeader?: boolean;
  /** Pixel offset to push sticky toolbar + headers below a parent's own sticky bar. */
  stickyHeaderOffset?: number;
  /** Persist column visibility + widths to localStorage under this key.
   *  Different tables get different keys (e.g. "items.v1", "stocktake.v1").
   *  When omitted, the table behaves as before — hidden cols reset to
   *  defaultHidden on every mount.
   *
   *  A "Reset to default" button appears in the column-toggle popover when
   *  this is set, so the user can wipe their saved layout. */
  storageKey?: string;
  /** Per-row style overrides — merged ON TOP of the table's default zebra +
   *  hover styles. Used for row-level highlighting like "this item's
   *  standard cost is below the cheapest supplier price → faded red".
   *  Returning {} or undefined leaves the default styling intact. */
  rowStyle?: (row: T) => React.CSSProperties | undefined;
}

type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getValue(row: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce((obj: unknown, k) => {
    if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[k];
    return undefined;
  }, row);
}

function sortRows<T extends Record<string, unknown>>(
  data: T[], key: string, dir: SortDir
): T[] {
  return [...data].sort((a, b) => {
    const av = getValue(a, key);
    const bv = getValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── GridMultiSelect — checkbox dropdown for multi-value fields (e.g. allergens) ─

interface GridMultiSelectProps {
  value: string[];
  options: { value: string; label: string }[];
  onChange: (value: string[]) => void;
  onNavigate: (e: React.KeyboardEvent) => void;
  isChanged: boolean;
  "data-edit-row": number;
  "data-edit-col": number;
}

function GridMultiSelect({
  value, options, onChange, onNavigate, isChanged,
  "data-edit-row": dataRow,
  "data-edit-col": dataCol,
}: GridMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const displayText = value.length === 0
    ? <span style={{ color: "#a8a29e" }}>None</span>
    : <span>{value.map(v => {
        const label = options.find(o => o.value === v)?.label ?? v.replace(/^[A-Z]+_/, "");
        return (
          <span key={v} style={{
            display: "inline-block", background: "#fef9c3", border: "1px solid #fde047",
            borderRadius: "0.25rem", padding: "0 0.3rem", fontSize: "0.6875rem",
            marginRight: "0.2rem", color: "#92400e",
          }}>{label}</span>
        );
      })}</span>;

  function toggle(optValue: string) {
    onChange(value.includes(optValue) ? value.filter(v => v !== optValue) : [...value, optValue]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setHighlighted(0); return; }
      setHighlighted(h => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setHighlighted(0); return; }
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === " ") {
      e.preventDefault();
      if (open) toggle(options[highlighted]?.value ?? "");
      else { setOpen(true); setHighlighted(0); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open) setOpen(false); // Enter closes; Tab/Enter-again navigates
      else onNavigate(e);
    } else if (e.key === "Tab") {
      setOpen(false);
      onNavigate(e);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
        data-edit-row={dataRow}
        data-edit-col={dataCol}
        onKeyDown={handleKeyDown}
        onClick={() => open ? setOpen(false) : (setOpen(true), setHighlighted(0))}
        onFocus={e => {
          e.currentTarget.style.borderColor = "#b91c1c";
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(185,28,28,0.18)";
        }}
        onBlur={e => {
          if (containerRef.current?.contains(e.relatedTarget as Node)) return;
          e.currentTarget.style.borderColor = isChanged ? "#fbbf24" : "#e7e5e4";
          e.currentTarget.style.boxShadow = "none";
          setOpen(false);
        }}
        style={{
          width: "100%", minHeight: "1.875rem", padding: "0.1875rem 0.5rem",
          border: `1px solid ${isChanged ? "#fbbf24" : "#e7e5e4"}`,
          borderRadius: "0.25rem", fontSize: "0.8125rem",
          background: isChanged ? "#fefce8" : "#fff",
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: "0.375rem",
          userSelect: "none", outline: "none", fontFamily: "inherit",
          transition: "border-color 0.1s, box-shadow 0.1s", boxSizing: "border-box",
          flexWrap: "wrap",
        }}
      >
        <span style={{ flex: 1 }}>{displayText}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {open && (
        <ul
          ref={listRef}
          style={{
            position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #e7e5e4",
            borderRadius: "0.5rem", boxShadow: "0 8px 24px rgba(0,0,0,0.13)",
            zIndex: 200, maxHeight: "220px", overflowY: "auto",
            margin: 0, padding: "0.25rem", listStyle: "none",
          }}
        >
          <li style={{ padding: "0.3125rem 0.625rem", fontSize: "0.6875rem", color: "#a8a29e", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Space to toggle · Enter to confirm
          </li>
          {options.map((opt, idx) => {
            const checked = value.includes(opt.value);
            const isHl = highlighted === idx;
            return (
              <li
                key={opt.value}
                onMouseDown={e => { e.preventDefault(); toggle(opt.value); }}
                onMouseEnter={() => setHighlighted(idx)}
                style={{
                  padding: "0.4375rem 0.625rem", borderRadius: "0.375rem",
                  fontSize: "0.8125rem", cursor: "pointer",
                  background: isHl ? "#fef2f2" : "transparent",
                  color: isHl ? "#b91c1c" : "#1c1917",
                  display: "flex", alignItems: "center", gap: "0.5rem",
                }}
              >
                <span style={{
                  width: "14px", height: "14px", border: `2px solid ${checked ? "#b91c1c" : "#d4d0cc"}`,
                  borderRadius: "3px", background: checked ? "#b91c1c" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transition: "background 0.1s, border-color 0.1s",
                }}>
                  {checked && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </span>
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── GridSelect — custom dropdown for edit-grid select cells ──────────────────

interface GridSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Called when Tab or (Enter while closed) should hand off to the grid navigator */
  onNavigate: (e: React.KeyboardEvent) => void;
  isChanged: boolean;
  "data-edit-row": number;
  "data-edit-col": number;
}

function GridSelect({
  value, options, onChange, onNavigate, isChanged,
  "data-edit-row": dataRow,
  "data-edit-col": dataCol,
}: GridSelectProps) {
  const [open, setOpen]           = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [search, setSearch]       = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef    = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLUListElement>(null);

  // Include blank "—" option at top
  const allOptions = [{ value: "", label: "—" }, ...options];
  const currentLabel = allOptions.find(o => o.value === value)?.label ?? "—";

  // Filter by search — keep the clear option only when no search term
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : allOptions;

  function openDropdown() {
    const idx = allOptions.findIndex(o => o.value === value);
    setHighlighted(Math.max(0, idx));
    setSearch("");
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function confirm(newVal: string) {
    onChange(newVal);
    setOpen(false);
    setSearch("");
    // Return keyboard focus to the trigger so grid nav still works
    setTimeout(() => {
      const trigger = containerRef.current?.querySelector<HTMLElement>("[data-grid-trigger]");
      trigger?.focus();
    }, 0);
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openDropdown();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open) onNavigate(e);
    } else if (e.key === "Tab") {
      setOpen(false);
      setSearch("");
      onNavigate(e);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) confirm(opt.value);
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    } else if (e.key === "Tab") {
      setOpen(false);
      setSearch("");
      onNavigate(e);
    }
  }

  // Reset highlight when search changes
  useEffect(() => { setHighlighted(0); }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <div
        data-grid-trigger
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
        data-edit-row={dataRow}
        data-edit-col={dataCol}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => open ? (setOpen(false), setSearch("")) : openDropdown()}
        onFocus={e => {
          e.currentTarget.style.borderColor = "#b91c1c";
          e.currentTarget.style.boxShadow = "0 0 0 2px rgba(185,28,28,0.18)";
        }}
        onBlur={e => {
          if (containerRef.current?.contains(e.relatedTarget as Node)) return;
          e.currentTarget.style.borderColor = isChanged ? "#fbbf24" : "#e7e5e4";
          e.currentTarget.style.boxShadow = "none";
          setOpen(false);
          setSearch("");
        }}
        style={{
          width: "100%", padding: "0.3125rem 0.5rem",
          border: `1px solid ${isChanged ? "#fbbf24" : "#e7e5e4"}`,
          borderRadius: "0.25rem", fontSize: "0.8125rem",
          background: isChanged ? "#fefce8" : "#fff",
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: "0.375rem",
          userSelect: "none", outline: "none", fontFamily: "inherit",
          transition: "border-color 0.1s, box-shadow 0.1s", boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: value ? "#1c1917" : "#a8a29e" }}>
          {currentLabel}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, minWidth: "200px",
          background: "#fff", border: "1px solid #e7e5e4",
          borderRadius: "0.5rem", boxShadow: "0 8px 24px rgba(0,0,0,0.13)",
          zIndex: 200, overflow: "hidden",
        }}>
          {/* Search box */}
          <div style={{ padding: "0.375rem", borderBottom: "1px solid #f5f5f4" }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Type to filter…"
              style={{
                width: "100%", padding: "0.25rem 0.5rem",
                border: "1px solid #e7e5e4", borderRadius: "0.25rem",
                fontSize: "0.75rem", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "#b91c1c"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(185,28,28,0.15)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "#e7e5e4"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </div>
          <ul
            ref={listRef}
            style={{
              maxHeight: "200px", overflowY: "auto",
              margin: 0, padding: "0.25rem", listStyle: "none",
            }}
          >
            {filtered.length === 0 && (
              <li style={{ padding: "0.5rem 0.75rem", fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>No matches</li>
            )}
            {filtered.map((opt, idx) => {
              const isHighlighted = highlighted === idx;
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value || "__empty__"}
                  onMouseDown={e => { e.preventDefault(); confirm(opt.value); }}
                  onMouseEnter={() => setHighlighted(idx)}
                  style={{
                    padding: "0.4375rem 0.625rem", borderRadius: "0.375rem",
                    fontSize: "0.8125rem", cursor: "pointer",
                    background: isHighlighted ? "#fef2f2" : "transparent",
                    color: isHighlighted ? "#b91c1c" : opt.value === "" ? "#a8a29e" : "#1c1917",
                    fontWeight: isSelected && opt.value !== "" ? 600 : 400,
                    display: "flex", alignItems: "center", gap: "0.5rem",
                  }}
                >
                  <span style={{ width: "12px", flexShrink: 0 }}>
                    {isSelected && opt.value !== "" && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                  {opt.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTable<T extends { id: string } & Record<string, unknown>>({
  columns,
  data,
  href,
  onRowClick,
  emptyMessage = "No records found.",
  emptyHref,
  emptyLabel = "Create one →",
  onBulkSave,
  // Default-on as of 2026-05-10 — sticky column headers everywhere.
  // Pass stickyHeader={false} explicitly to opt out (rare).
  stickyHeader = true,
  stickyHeaderOffset = 0,
  storageKey,
  rowStyle,
}: DataTableProps<T>) {
  const router = useRouter();

  // Sort state
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Persistence helpers ──────────────────────────────────────────────────
  // localStorage keys are namespaced under the table's storageKey (when set).
  // Hidden cols are stored as a sorted array of keys; widths as a Record.
  // Anything that fails to read/parse silently falls back to defaults — the
  // user's saved layout never breaks the table.
  const HIDDEN_LS_KEY = storageKey ? `dt.${storageKey}.hidden` : null;
  const WIDTHS_LS_KEY = storageKey ? `dt.${storageKey}.widths` : null;
  const defaultHiddenSet = () => new Set(columns.filter(c => c.defaultHidden).map(c => c.key));

  // Column widths — load from LS if available, fall back to column.width defaults
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    columns.forEach(c => { if (c.width) init[c.key] = c.width; });
    if (WIDTHS_LS_KEY && typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(WIDTHS_LS_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as Record<string, number>;
          for (const [k, v] of Object.entries(stored)) {
            if (typeof v === "number" && v > 0) init[k] = v;
          }
        }
      } catch { /* ignore — fall back to defaults */ }
    }
    return init;
  });

  // Hidden columns — load from LS if available, fall back to column.defaultHidden
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (HIDDEN_LS_KEY && typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(HIDDEN_LS_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          if (Array.isArray(arr)) return new Set(arr);
        }
      } catch { /* ignore */ }
    }
    return defaultHiddenSet();
  });

  // Persist hidden cols on every change (cheap — small payload, low frequency)
  useEffect(() => {
    if (!HIDDEN_LS_KEY || typeof window === "undefined") return;
    try { window.localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify([...hiddenCols].sort())); }
    catch { /* quota / disabled — ignore */ }
  }, [hiddenCols, HIDDEN_LS_KEY]);

  // Persist col widths
  useEffect(() => {
    if (!WIDTHS_LS_KEY || typeof window === "undefined") return;
    try { window.localStorage.setItem(WIDTHS_LS_KEY, JSON.stringify(colWidths)); }
    catch { /* ignore */ }
  }, [colWidths, WIDTHS_LS_KEY]);

  // Reset both layouts back to the column-defs defaults
  function resetLayout() {
    setHiddenCols(defaultHiddenSet());
    const init: Record<string, number> = {};
    columns.forEach(c => { if (c.width) init[c.key] = c.width; });
    setColWidths(init);
    if (HIDDEN_LS_KEY && typeof window !== "undefined") {
      try { window.localStorage.removeItem(HIDDEN_LS_KEY); } catch { /* ignore */ }
    }
    if (WIDTHS_LS_KEY && typeof window !== "undefined") {
      try { window.localStorage.removeItem(WIDTHS_LS_KEY); } catch { /* ignore */ }
    }
  }

  const [showColMenu, setShowColMenu] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // ── Edit mode ──────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  // Map<rowId, { [editKey]: newValue }>
  const [edits, setEdits] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function updateEdit(rowId: string, editKey: string, value: unknown) {
    setEdits(prev => {
      const next = new Map(prev);
      next.set(rowId, { ...(next.get(rowId) ?? {}), [editKey]: value });
      return next;
    });
  }

  function exitEditMode() {
    setEditMode(false);
    setEdits(new Map());
    setSaveError(null);
  }

  async function handleBulkSave() {
    if (!onBulkSave) return;
    setBulkSaving(true);
    setSaveError(null);
    const changes = Array.from(edits.entries())
      .filter(([, fields]) => Object.keys(fields).length > 0)
      .map(([id, fields]) => ({ id, fields }));
    const err = await onBulkSave(changes);
    setBulkSaving(false);
    if (err) {
      setSaveError(err);
    } else {
      setEditMode(false);
      setEdits(new Map());
      router.refresh();
    }
  }

  const changedCount = edits.size;

  // ── Keyboard navigation in edit mode ───────────────────────────────────────
  // Focus a specific [rowIndex, editColIndex] cell using data attributes.
  function focusEditCell(rowIdx: number, editColIdx: number) {
    const el = document.querySelector<HTMLElement>(
      `[data-edit-row="${rowIdx}"][data-edit-col="${editColIdx}"]`
    );
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIdx: number,
    editColIdx: number,
    totalEditCols: number,
    totalRows: number,
  ) {
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        // Previous editable cell
        let nc = editColIdx - 1, nr = rowIdx;
        if (nc < 0) { nc = totalEditCols - 1; nr -= 1; }
        if (nr >= 0) focusEditCell(nr, nc);
      } else {
        // Next editable cell
        let nc = editColIdx + 1, nr = rowIdx;
        if (nc >= totalEditCols) { nc = 0; nr += 1; }
        if (nr < totalRows) focusEditCell(nr, nc);
      }
    } else if (e.key === "Enter") {
      e.preventDefault(); // stops selects from toggling their dropdown
      // Move down to same column, next row
      if (rowIdx + 1 < totalRows) focusEditCell(rowIdx + 1, editColIdx);
    } else if (e.key === "Escape") {
      (e.target as HTMLElement).blur();
    }
  }

  // ── Column menu close on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!showColMenu) return;
    const handler = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColMenu]);

  // Sort handler
  const handleSort = (key: string, sortable = true) => {
    if (!sortable || editMode) return;
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Column resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      // Find the th this handle belongs to so we can read its actual rendered
      // width. Without this, columns that have never been resized fall back
      // to 150px on drag-start and "snap" from their auto-sized width down to
      // 150 — which makes resize feel broken even though it's working. Reading
      // getBoundingClientRect gives us the real on-screen width to drag from.
      let thEl: HTMLElement | null = e.currentTarget as HTMLElement;
      while (thEl && thEl.tagName !== "TH") thEl = thEl.parentElement;
      const renderedW = thEl ? Math.round(thEl.getBoundingClientRect().width) : 150;
      const startX = e.clientX;
      const startW = colWidths[colKey] ?? renderedW;
      const minW = columns.find(c => c.key === colKey)?.minWidth ?? 80;
      // Lock the body cursor for the whole drag so it stays as col-resize even
      // when the pointer drifts off the 10px handle. Restored on mouseup.
      const prevBodyCursor = document.body.style.cursor;
      document.body.style.cursor = "col-resize";
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(minW, startW + (ev.clientX - startX));
        setColWidths(prev => ({ ...prev, [colKey]: newW }));
      };
      const onUp = () => {
        document.body.style.cursor = prevBodyCursor;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths, columns]
  );

  // Row click
  const handleRowClick = (row: T) => {
    if (editMode) return; // disable navigation in edit mode
    if (onRowClick) { onRowClick(row); return; }
    if (href) { router.push(href(row)); }
  };

  const isClickable = !editMode && !!(href || onRowClick);

  // Apply sort
  const sorted = sortKey ? sortRows(data, sortKey, sortDir) : data;

  // Visible columns
  const visibleCols = columns.filter(c => !hiddenCols.has(c.key));
  const hideableCols = columns.filter(c => c.hideable !== false);
  const hasEditableCols = columns.some(c => c.editable);

  // Editable columns in visible order — used for keyboard navigation indices
  const visibleEditableCols = visibleCols.filter(c => c.editable);
  // Map column key → its edit-col index (for data attrs + navigation)
  const editColIndexMap = new Map(visibleEditableCols.map((c, i) => [c.key, i]));

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!data.length) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#78716c" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>📭</div>
        <p style={{ margin: 0, fontSize: "0.9375rem" }}>
          {emptyMessage}{" "}
          {emptyHref && (
            <Link href={emptyHref} style={{ color: "#b91c1c", fontWeight: "600" }}>
              {emptyLabel}
            </Link>
          )}
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative" }}>
      {/* Toolbar — sticks to the top of the scroll container alongside the
          column headers when the table runs in sticky-header mode, so the
          operator never loses the "Edit Grid" / "Save changes" / Columns
          controls while scrolling rows. Solid background prevents rows
          showing through. zIndex 4 keeps it above the sticky <th>'s
          (which use 3). */}
      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center",
        gap: "0.5rem", padding: "0.5rem 1rem",
        borderBottom: editMode ? "2px solid #b91c1c" : "1px solid #e7e5e4",
        background: editMode ? "#fff9f9" : "#fff",
        transition: "background 0.2s, border-color 0.2s",
        flexWrap: "wrap",
        position: stickyHeader ? "sticky" : undefined,
        top: stickyHeader ? stickyHeaderOffset : undefined,
        zIndex: stickyHeader ? 4 : undefined,
      }}>
        {/* Left side: mode label + change status */}
        {editMode ? (
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
            <span style={{ fontSize: "0.8125rem", color: "#b91c1c", fontWeight: 600, whiteSpace: "nowrap" }}>
              ✏ Edit mode
            </span>
            {changedCount > 0 && (
              <span style={{
                fontSize: "0.75rem", color: "#b45309", fontWeight: 600,
                background: "#fef9c3", border: "1px solid #fde047",
                borderRadius: "1rem", padding: "0.125rem 0.625rem", whiteSpace: "nowrap",
              }}>
                {changedCount} row{changedCount > 1 ? "s" : ""} changed
              </span>
            )}
            {saveError && (
              <span style={{ fontSize: "0.8125rem", color: "#b91c1c", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⚠ {saveError}
              </span>
            )}
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}

        {/* Edit Grid toggle (normal mode) or save controls (edit mode) */}
        {onBulkSave && hasEditableCols && !editMode && (
          <button
            onClick={() => setEditMode(true)}
            style={{
              display: "flex", alignItems: "center", gap: "0.375rem",
              background: "none",
              border: "1px solid #e7e5e4",
              borderRadius: "0.375rem",
              padding: "0.375rem 0.75rem", fontSize: "0.8125rem",
              color: "#78716c",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit Grid
          </button>
        )}

        {editMode && (
          <>
            {changedCount > 0 && (
              <button
                onClick={() => { setEdits(new Map()); setSaveError(null); }}
                disabled={bulkSaving}
                style={{
                  padding: "0.375rem 0.75rem", borderRadius: "0.375rem",
                  border: "1px solid #e7e5e4", background: "#fff",
                  color: "#78716c", fontSize: "0.8125rem", cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
                onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
              >
                Undo all
              </button>
            )}
            <button
              onClick={handleBulkSave}
              disabled={bulkSaving || changedCount === 0}
              style={{
                padding: "0.375rem 0.875rem", borderRadius: "0.375rem",
                border: "none",
                background: changedCount > 0 ? "#b91c1c" : "#e7e5e4",
                color: changedCount > 0 ? "#fff" : "#a8a29e",
                fontSize: "0.8125rem", fontWeight: 600,
                cursor: changedCount > 0 ? "pointer" : "not-allowed",
                opacity: bulkSaving ? 0.7 : 1,
                transition: "background 0.15s",
              }}
            >
              {bulkSaving ? "Saving…" : changedCount > 0 ? `Save ${changedCount} change${changedCount > 1 ? "s" : ""}` : "No changes"}
            </button>
            <button
              onClick={exitEditMode}
              style={{
                padding: "0.375rem 0.625rem", borderRadius: "0.375rem",
                border: "1px solid #e7e5e4", background: "#fff",
                color: "#78716c", fontSize: "0.8125rem", cursor: "pointer",
                lineHeight: 1, transition: "background 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
              title="Exit edit mode"
            >
              ✕
            </button>
          </>
        )}

        {/* Columns toggle */}
        {hideableCols.length > 0 && (
          <div style={{ position: "relative" }} ref={colMenuRef}>
            <button
              onClick={() => setShowColMenu(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: "0.375rem",
                background: showColMenu ? "#f5f5f4" : "none",
                border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                padding: "0.375rem 0.75rem", fontSize: "0.8125rem",
                color: "#78716c", cursor: "pointer", transition: "background 0.15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
              </svg>
              Columns {hiddenCols.size > 0 && `(${hiddenCols.size} hidden)`}
            </button>

            {showColMenu && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)",
                background: "#fff", border: "1px solid #e7e5e4",
                borderRadius: "0.625rem", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                zIndex: 50, minWidth: "180px", padding: "0.375rem",
              }}>
                <div style={{ padding: "0.375rem 0.75rem 0.5rem", fontSize: "0.6875rem", fontWeight: "600", color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Toggle Columns
                </div>
                <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                  {hideableCols.map(col => (
                    <label
                      key={col.key}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.625rem",
                        padding: "0.5rem 0.75rem", cursor: "pointer",
                        borderRadius: "0.375rem", fontSize: "0.875rem", color: "#1c1917",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenCols.has(col.key)}
                        onChange={() =>
                          setHiddenCols(prev => {
                            const next = new Set(prev);
                            next.has(col.key) ? next.delete(col.key) : next.add(col.key);
                            return next;
                          })
                        }
                        style={{ accentColor: "#b91c1c", width: "14px", height: "14px" }}
                      />
                      {col.label}
                      {col.editable && (
                        <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "#a8a29e" }}>editable</span>
                      )}
                    </label>
                  ))}
                </div>

                {/* Reset link — only meaningful when persistence is on */}
                {storageKey && (
                  <div style={{ borderTop: "1px solid #f0efee", marginTop: "0.375rem", paddingTop: "0.375rem" }}>
                    <button
                      type="button"
                      onClick={() => { resetLayout(); setShowColMenu(false); }}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "0.5rem 0.75rem", border: "none", background: "none",
                        fontSize: "0.75rem", color: "#78716c", cursor: "pointer",
                        borderRadius: "0.375rem",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      title="Wipe your saved column layout and revert to the app defaults"
                    >
                      ↺ Reset to default view
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div style={stickyHeader ? {} : { overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              {visibleCols.map(col => {
                const isSorted = sortKey === col.key;
                const canSort = col.sortable !== false && !editMode;
                const w = colWidths[col.key];

                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key, col.sortable !== false)}
                    style={{
                      position: stickyHeader ? "sticky" : "relative",
                      // The toolbar above us is itself sticky at top:0 with zIndex 4.
                      // If we also stick at top:0 the toolbar paints OVER the column
                      // headers (we're zIndex 3) and the operator just sees a blank
                      // strip where the header should be. Stick below the toolbar
                      // height (~2.75rem covers padding + button) so both stay visible.
                      top: stickyHeader ? `calc(2.75rem + ${stickyHeaderOffset}px)` : undefined,
                      zIndex: stickyHeader ? 3 : undefined,
                      textAlign: "left",
                      padding: "0.625rem 1.125rem 0.625rem 1rem",
                      fontWeight: 600,
                      color: isSorted ? "#b91c1c" : "#78716c",
                      background: "#f5f5f4",
                      borderBottom: "2px solid " + (isSorted ? "#b91c1c" : "#e7e5e4"),
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      // table-layout: auto treats `width` on a th as a HINT —
                      // long cell content can still expand the column. Setting
                      // min/max identically pins the width hard so resizes are
                      // honoured exactly across both view and edit modes.
                      width:    w ? `${w}px` : undefined,
                      minWidth: w ? `${w}px` : undefined,
                      maxWidth: w ? `${w}px` : undefined,
                      whiteSpace: "nowrap",
                      userSelect: "none",
                      cursor: canSort ? "pointer" : "default",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                      {col.label}
                      {col.editable && editMode && (
                        <span style={{ fontSize: "0.5625rem", color: "#b91c1c", fontWeight: 400, letterSpacing: 0 }}>✏</span>
                      )}
                      {canSort && (
                        <span style={{
                          fontSize: "0.6875rem", lineHeight: 1,
                          color: isSorted ? "#b91c1c" : "#d4d0cc",
                          transition: "color 0.15s",
                        }}>
                          {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      )}
                    </span>

                    {/* Resize handle — wider hit area with an always-visible
                        divider so users can see column boundaries (and learn
                        they're draggable). Hover thickens + tints red. */}
                    <div
                      onMouseDown={e => handleResizeStart(e, col.key)}
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => {
                        // Double-click resets this column's width to default.
                        e.stopPropagation();
                        setColWidths(prev => {
                          const next = { ...prev };
                          delete next[col.key];
                          return next;
                        });
                      }}
                      title="Drag to resize · double-click to reset"
                      style={{
                        position: "absolute", right: 0, top: 0, bottom: 0,
                        width: "10px", cursor: "col-resize",
                        background: "transparent",
                        display: "flex", justifyContent: "center", alignItems: "stretch",
                      }}
                      onMouseEnter={e => {
                        const bar = e.currentTarget.firstElementChild as HTMLElement | null;
                        if (bar) { bar.style.background = "#b91c1c"; bar.style.width = "3px"; }
                      }}
                      onMouseLeave={e => {
                        const bar = e.currentTarget.firstElementChild as HTMLElement | null;
                        if (bar) { bar.style.background = "#d6d3d1"; bar.style.width = "1px"; }
                      }}
                    >
                      <div style={{
                        width: "1px", background: "#d6d3d1",
                        marginTop: "0.4rem", marginBottom: "0.4rem",
                        transition: "background 0.12s, width 0.12s",
                      }} />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sorted.map((row, i) => {
              const rowChanged = edits.has(row.id);
              // Per-row caller-supplied style overrides (e.g. items grid
              // paints below-cheapest rows with a faded red background).
              // Applied UNDER changed-row yellow so dirty edits still show
              // through. Hover handler below also respects it so we don't
              // wipe the red on mouse-over.
              const customStyle = rowStyle ? rowStyle(row) : undefined;
              const customBg = customStyle?.background as string | undefined;
              const defaultBg = rowChanged
                ? "#fefce8"
                : customBg ?? (i % 2 === 0 ? "#fff" : "#fafaf9");
              return (
                <tr
                  key={row.id}
                  onClick={() => isClickable && handleRowClick(row)}
                  style={{
                    cursor: isClickable ? "pointer" : "default",
                    background: defaultBg,
                    transition: "background 0.1s",
                    outline: rowChanged ? "1px solid #fde047" : "none",
                    outlineOffset: "-1px",
                    ...customStyle,
                    // ensure changed-row yellow always wins over a custom bg
                    ...(rowChanged ? { background: "#fefce8" } : {}),
                  }}
                  onMouseEnter={e => {
                    if (editMode) return;
                    (e.currentTarget as HTMLTableRowElement).style.background = isClickable ? "#fef2f2" : "#f5f5f4";
                  }}
                  onMouseLeave={e => {
                    if (editMode) return;
                    (e.currentTarget as HTMLTableRowElement).style.background = defaultBg;
                  }}
                >
                  {visibleCols.map(col => {
                    // ── Editable cell ──────────────────────────────────────
                    if (editMode && col.editable) {
                      const editKey = col.editable.editKey ?? col.key;
                      const rowEdits = edits.get(row.id) ?? {};
                      const currentVal = editKey in rowEdits ? rowEdits[editKey] : getValue(row, editKey);
                      const isChanged = editKey in rowEdits;
                      const editColIdx = editColIndexMap.get(col.key) ?? 0;
                      const totalEditCols = visibleEditableCols.length;

                      // Visual hierarchy in edit mode (Tino's note: faded
                      // placeholders made it hard to spot real values):
                      //   - Changed   → yellow tint, bold border (existing)
                      //   - Populated → strong white card with bold dark text
                      //                 + a subtle accent border so the eye
                      //                 finds it across rows
                      //   - Empty     → very subdued: light grey-tan tint, no
                      //                 border, faint text (the placeholder
                      //                 still hints, but it doesn't compete)
                      const isPopulated = currentVal != null && currentVal !== "" &&
                                          !(Array.isArray(currentVal) && currentVal.length === 0);
                      const inputBase: React.CSSProperties = {
                        width: "100%",
                        padding: "0.3125rem 0.5rem",
                        border: "1px solid " + (
                          isChanged   ? "#fbbf24" :
                          isPopulated ? "#cbd5e1" :
                                        "transparent"
                        ),
                        borderRadius: "0.25rem",
                        fontSize: "0.8125rem",
                        fontWeight: isPopulated && !isChanged ? 600 : 400,
                        color: isChanged   ? "#92400e" :
                               isPopulated ? "#1c1917" :
                                             "#a8a29e",
                        background: isChanged   ? "#fefce8" :
                                    isPopulated ? "#fff" :
                                                  "#f7f5f2",
                        outline: "none",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                        transition: "border-color 0.1s, background 0.1s, box-shadow 0.1s",
                      };

                      const focusStyle = (el: HTMLElement) => {
                        el.style.borderColor = "#b91c1c";
                        el.style.boxShadow = "0 0 0 2px rgba(185,28,28,0.18)";
                        el.style.background = "#fff";
                      };
                      const blurStyle = (el: HTMLElement, changed: boolean) => {
                        const populated = el instanceof HTMLInputElement && el.value !== "";
                        el.style.borderColor = changed   ? "#fbbf24" :
                                               populated ? "#cbd5e1" :
                                                           "transparent";
                        el.style.boxShadow = "none";
                        el.style.background = changed   ? "#fefce8" :
                                              populated ? "#fff" :
                                                          "#f7f5f2";
                      };

                      return (
                        <td
                          key={col.key}
                          onClick={e => e.stopPropagation()}
                          style={{
                            padding: "0.3125rem 0.5rem",
                            borderBottom: "1px solid #f0efee",
                            verticalAlign: "middle",
                          }}
                        >
                          {col.editable.type === "multiselect" ? (
                            <GridMultiSelect
                              data-edit-row={i}
                              data-edit-col={editColIdx}
                              value={Array.isArray(currentVal) ? currentVal as string[] : []}
                              options={col.editable.options ?? []}
                              onChange={v => updateEdit(row.id, editKey, v)}
                              onNavigate={e => handleCellKeyDown(
                                e as React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
                                i, editColIdx, totalEditCols, sorted.length
                              )}
                              isChanged={isChanged}
                            />
                          ) : col.editable.type === "select" ? (
                            <GridSelect
                              data-edit-row={i}
                              data-edit-col={editColIdx}
                              value={String(currentVal ?? "")}
                              options={col.editable.options ?? []}
                              onChange={v => updateEdit(row.id, editKey, v)}
                              onNavigate={e => handleCellKeyDown(
                                e as React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
                                i, editColIdx, totalEditCols, sorted.length
                              )}
                              isChanged={isChanged}
                            />
                          ) : (
                            <input
                              data-edit-row={i}
                              data-edit-col={editColIdx}
                              type={col.editable.type === "number" ? "number" : "text"}
                              value={String(currentVal ?? "")}
                              placeholder={col.editable.placeholder}
                              onChange={e => updateEdit(row.id, editKey, e.target.value)}
                              onKeyDown={e => handleCellKeyDown(e, i, editColIdx, totalEditCols, sorted.length)}
                              onFocus={e => focusStyle(e.currentTarget)}
                              onBlur={e => blurStyle(e.currentTarget, isChanged)}
                              style={inputBase}
                            />
                          )}
                        </td>
                      );

                    }

                    // ── Read-only cell ─────────────────────────────────────
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: editMode ? "0.4375rem 0.75rem" : "0.875rem 1rem",
                          borderBottom: "1px solid #f0efee",
                          color: "#292524",
                          verticalAlign: "middle",
                          opacity: editMode && !col.editable ? 0.5 : 1,
                          // Match the th's width pin so a long item name (e.g.
                          // a 6-word product description) doesn't force the
                          // column to expand past the operator's resize value.
                          // Long text wraps inside the cell instead.
                          maxWidth: colWidths[col.key] ? `${colWidths[col.key]}px` : undefined,
                          overflowWrap: "break-word",
                        }}
                      >
                        {col.render
                          ? col.render(getValue(row, col.key), row)
                          : (() => {
                              const v = getValue(row, col.key);
                              return v == null || v === "" ? (
                                <span style={{ color: "#a8a29e" }}>—</span>
                              ) : (
                                String(v)
                              );
                            })()}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {visibleCols.some(c => c.footer) && (
            <tfoot>
              <tr>
                {visibleCols.map(col => {
                  const w = colWidths[col.key];
                  return (
                    <td
                      key={col.key}
                      style={{
                        padding: "0.55rem 1rem",
                        background: "#fafaf9",
                        borderTop: "2px solid #d6d3d1",
                        fontWeight: 700,
                        color: "#1c1917",
                        fontSize: "0.85rem",
                        textAlign: "left",
                        position: stickyHeader ? "sticky" : undefined,
                        // Stick to the bottom of the table's scroll container
                        // when sticky-header mode is on, so the totals stay
                        // visible while scrolling rows.
                        bottom: stickyHeader ? 0 : undefined,
                        zIndex: stickyHeader ? 2 : undefined,
                        width:    w ? `${w}px` : undefined,
                        minWidth: w ? `${w}px` : undefined,
                        maxWidth: w ? `${w}px` : undefined,
                      }}
                    >
                      {col.footer ? col.footer(sorted) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>

        {/* Row count */}
        <div style={{ padding: "0.625rem 1rem", borderTop: "1px solid #f0efee", fontSize: "0.8125rem", color: "#a8a29e" }}>
          {sorted.length} {sorted.length === 1 ? "record" : "records"}
        </div>
      </div>
    </div>
  );
}
