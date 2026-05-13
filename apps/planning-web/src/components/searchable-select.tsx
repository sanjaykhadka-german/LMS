"use client";

import { useState, useRef, useEffect, useId } from "react";
import { createClient } from "@/lib/supabase/client";

export interface SelectOption {
  value: string;
  label: string;
}

/** Phase 9.3 v2 (Tino May 8 2026): inline "+ New…" support. When a host
 *  supplies an `addNew` config, the dropdown gains a final "+ New…" row
 *  that opens a small modal — same UX as RegisterSelect — so the operator
 *  can add a new row to a tenant register without leaving the form. */
export type SearchableSelectAddNew = {
  /** DB table to insert into (e.g. "departments", "item_categories"). */
  table: string;
  /** Column on the row that stores the user-facing label. */
  labelField: string;
  /** Optional column that holds an internal code (e.g. "code"). When set,
   *  the modal asks for a code too and normalises to UPPERCASE. */
  codeField?: string;
  /** Modal heading (default "New record"). */
  dialogTitle?: string;
  /** Extra fields written into the insert (e.g. category_id, is_active). */
  extras?: Record<string, unknown>;
  /** Called after successful insert with the new row id (and optional code).
   *  Host should re-fetch its options list so the row appears next render. */
  onCreated?: (newId: string, label: string, code?: string) => void;
  /** Hide the "+ New…" option when the current user lacks permission. */
  hide?: boolean;
};

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Show a blank "—" option at top (default true) */
  allowClear?: boolean;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** When supplied, adds a "+ New…" inline row that opens an insert modal. */
  addNew?: SearchableSelectAddNew;
}

// Magic value for the "+ New…" sentinel option. Uses brackets so it never
// collides with a real UUID / slug coming from the host's options list.
const ADD_NEW_VALUE = "__searchable_add_new__";

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allowClear = true,
  className,
  style,
  disabled = false,
  addNew,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLUListElement>(null);
  const triggerId    = useId();

  const showAddNew = !!addNew && !addNew.hide;

  const baseOptions: SelectOption[] = allowClear
    ? [{ value: "", label: "—" }, ...options]
    : options;

  const baseWithAdd: SelectOption[] = showAddNew
    ? [...baseOptions, { value: ADD_NEW_VALUE, label: "+ New…" }]
    : baseOptions;

  const filtered = search.trim()
    ? baseWithAdd.filter(o =>
        o.value !== "" &&
        (o.value === ADD_NEW_VALUE || o.label.toLowerCase().includes(search.toLowerCase()))
      )
    : baseWithAdd;

  const currentLabel = baseWithAdd.find(o => o.value === value)?.label ?? "";

  function openAddModal() {
    setSearch("");
    setOpen(false);
    setAddLabel("");
    setAddCode("");
    setAddErr(null);
    setAddOpen(true);
  }

  async function createInlineRow() {
    if (!addNew) return;
    if (!addLabel.trim()) { setAddErr("Label is required."); return; }
    setAddSaving(true); setAddErr(null);
    const supabase = createClient();
    const extras = { ...(addNew.extras ?? {}) } as Record<string, unknown>;
    if (extras.tenant_id == null) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles").select("tenant_id").eq("id", user.id).single();
        if (profile && (profile as { tenant_id?: string }).tenant_id) {
          extras.tenant_id = (profile as { tenant_id: string }).tenant_id;
        }
      }
    }
    const payload: Record<string, unknown> = {
      ...extras,
      [addNew.labelField]: addLabel.trim(),
    };
    if (addNew.codeField) {
      payload[addNew.codeField] = addCode.trim().toUpperCase() || null;
    }
    const { data, error } = await supabase
      .from(addNew.table)
      .insert(payload)
      .select("id")
      .single();
    setAddSaving(false);
    if (error || !data) { setAddErr(error?.message ?? "Insert failed."); return; }
    const newId = (data as { id: string }).id;
    onChange(newId);
    addNew.onCreated?.(newId, addLabel.trim(), addNew.codeField ? addCode.trim().toUpperCase() : undefined);
    setAddOpen(false);
  }

  function openMenu(initialSearch = "") {
    if (disabled) return;
    setSearch(initialSearch);
    const idx = baseOptions.findIndex(o => o.value === value);
    setHighlighted(Math.max(0, idx));
    setOpen(true);
    setTimeout(() => {
      inputRef.current?.focus();
      // Place caret at end so user can keep typing
      if (inputRef.current && initialSearch) {
        inputRef.current.setSelectionRange(initialSearch.length, initialSearch.length);
      }
    }, 0);
  }

  function closeMenu() {
    setOpen(false);
    setSearch("");
  }

  function select(val: string) {
    if (val === ADD_NEW_VALUE) {
      openAddModal();
      return;
    }
    onChange(val);
    closeMenu();
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) select(opt.value);
    } else if (e.key === "Escape" || e.key === "Tab") {
      closeMenu();
    }
  }

  // Scroll highlighted into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlighted(0);
  }, [search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative", ...style }} className={className}>
      {/* Trigger — shows current value, click to open */}
      <button
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={e => {
          if (open) return;
          // Open on Enter/Space/ArrowDown/ArrowUp
          if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            openMenu();
            return;
          }
          // Open and start filtering when the user types a printable character
          // while the trigger is focused via tab.
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            openMenu(e.key);
          }
        }}
        style={{
          width: "100%",
          padding: "0.4375rem 0.75rem",
          background: disabled ? "#f5f5f4" : "#fff",
          border: "1px solid #d4d0cc",
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          color: value ? "#1c1917" : "#a8a29e",
          cursor: disabled ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          textAlign: "left",
          fontFamily: "inherit",
          transition: "border-color 0.15s, box-shadow 0.15s",
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={e => {
          if (!disabled) {
            e.currentTarget.style.borderColor = "#b91c1c";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(185,28,28,0.12)";
          }
        }}
        onBlur={e => {
          if (containerRef.current?.contains(e.relatedTarget as Node)) return;
          e.currentTarget.style.borderColor = "#d4d0cc";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {currentLabel || placeholder}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)", opacity: 0.5 }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          minWidth: "220px",
          background: "#fff",
          border: "1px solid #e7e5e4",
          borderRadius: "0.5rem",
          boxShadow: "0 8px 24px rgba(0,0,0,0.13)",
          zIndex: 300,
          overflow: "hidden",
        }}>
          {/* Search input */}
          <div style={{ padding: "0.5rem", borderBottom: "1px solid #f5f5f4" }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type to filter…"
              style={{
                width: "100%",
                padding: "0.3125rem 0.5rem",
                border: "1px solid #e7e5e4",
                borderRadius: "0.25rem",
                fontSize: "0.8125rem",
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = "#b91c1c";
                e.currentTarget.style.boxShadow = "0 0 0 2px rgba(185,28,28,0.15)";
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = "#e7e5e4";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Options */}
          <ul
            ref={listRef}
            style={{
              maxHeight: "220px",
              overflowY: "auto",
              margin: 0,
              padding: "0.25rem",
              listStyle: "none",
            }}
          >
            {filtered.length === 0 && (
              <li style={{ padding: "0.5rem 0.75rem", fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic" }}>
                No matches
              </li>
            )}
            {filtered.map((opt, idx) => {
              const isHl  = highlighted === idx;
              const isSel = opt.value === value;
              const isAdd = opt.value === ADD_NEW_VALUE;
              return (
                <li
                  key={opt.value || "__clear__"}
                  onMouseDown={e => { e.preventDefault(); select(opt.value); }}
                  onMouseEnter={() => setHighlighted(idx)}
                  style={{
                    padding: "0.4375rem 0.625rem",
                    borderRadius: "0.375rem",
                    fontSize: "0.8125rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    background: isHl ? "#fef2f2" : "transparent",
                    color: isHl ? "#b91c1c" : isAdd ? "#16a34a" : opt.value === "" ? "#a8a29e" : "#1c1917",
                    fontWeight: (isSel && opt.value !== "") || isAdd ? 600 : 400,
                    borderTop: isAdd ? "1px solid #f5f5f4" : undefined,
                    marginTop: isAdd ? "0.25rem" : undefined,
                  }}
                >
                  <span style={{ width: "12px", flexShrink: 0 }}>
                    {isSel && opt.value !== "" && !isAdd && (
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

      {addOpen && addNew && (
        <div
          className="no-print"
          style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => !addSaving && setAddOpen(false)}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "0.5rem", padding: "1.25rem", width: "min(380px, 92vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1c1917" }}>{addNew.dialogTitle ?? "New record"}</h2>
            <p style={{ margin: "0.25rem 0 0.875rem", fontSize: "0.8125rem", color: "#78716c" }}>
              Adds the row to the tenant register. You can still edit / deactivate it from the dedicated settings page later.
            </p>
            <label style={addLabelStyle}>Label *</label>
            <input
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              autoFocus
              style={{ width: "100%", padding: "0.4375rem 0.625rem", border: "1px solid #d4d0cc", borderRadius: "0.375rem", fontSize: "0.875rem", boxSizing: "border-box" }}
            />
            {addNew.codeField && (
              <>
                <label style={addLabelStyle}>Code (optional)</label>
                <input
                  value={addCode}
                  onChange={e => setAddCode(e.target.value.toUpperCase())}
                  style={{ width: "100%", padding: "0.4375rem 0.625rem", border: "1px solid #d4d0cc", borderRadius: "0.375rem", fontSize: "0.875rem", fontFamily: "monospace", textTransform: "uppercase", boxSizing: "border-box" }}
                />
              </>
            )}
            {addErr && <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem" }}>{addErr}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="button" onClick={() => setAddOpen(false)} disabled={addSaving} style={{ padding: "0.4375rem 0.875rem", border: "1px solid #d4d0cc", borderRadius: "0.375rem", background: "#fff", fontSize: "0.8125rem", cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={createInlineRow} disabled={addSaving} style={{ padding: "0.4375rem 0.875rem", border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff", borderRadius: "0.375rem", fontSize: "0.8125rem", cursor: addSaving ? "not-allowed" : "pointer", opacity: addSaving ? 0.6 : 1 }}>
                {addSaving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const addLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "#57534e",
  margin: "0.5rem 0 0.25rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
