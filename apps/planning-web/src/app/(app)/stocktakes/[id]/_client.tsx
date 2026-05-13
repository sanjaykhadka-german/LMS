"use client";

import { useState, useCallback, useMemo, useEffect, useRef, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import StocktakeBulkIO from "./_components/stocktake-bulk-io";

// ── Shared types ─────────────────────────────────────────────────────────────
type LocationLite = {
  id: string;
  name: string;
  code: string | null;
  room: {
    id: string;
    name: string;
    department: { id: string; name: string } | null;
  } | null;
};

type Item = {
  id: string;
  code: string;
  name: string;
  unit: string;
  item_type: string;
  current_stock: number;
  min_stock: number;
  max_stock: number;
  procurement_type: string;
  is_active: boolean;
  default_location?: LocationLite | null;
};

type StocktakeLine = {
  id: string;
  item_id: string;
  system_qty: number;
  counted_qty: number | null;
  variance: number | null;
  notes: string | null;
  batch?: string | null;
  ubd?: string | null;
  entry_source?: string | null;
  counted_at?: string | null;
  counted_by?: string | null;
  counter?: { id: string; full_name: string | null } | null;
  location?: LocationLite | null;
  location_id?: string | null;
  item: Item | null;
};

type Stocktake = {
  id: string;
  reference: string | null;
  status: string;
  notes: string | null;
  stocktake_type?: string;
  week_commencing?: string | null;
};

type RoomLite = {
  id: string; name: string; code: string | null; barcode: string | null;
  department_id: string;
  department: { id: string; name: string } | null;
};

type LocationFull = LocationLite & {
  barcode: string | null;
  room_id: string;
  require_batch: boolean | null;
  require_ubd: boolean | null;
};

const TYPE_LABEL: Record<string, string> = {
  raw_material: "Raw Material",
  wip: "WIP",
  fg: "Finished Good",
  mixed: "Mixed",
};

// Sticky-stack offsets
const STICKY_TOP_BAR = 0;
const STICKY_TOP_BAR_HEIGHT = 56;
const STICKY_FILTERS_TOP = STICKY_TOP_BAR + STICKY_TOP_BAR_HEIGHT;
const STICKY_FILTERS_HEIGHT = 200; // taller — three pickers + filters
const STICKY_THEAD_TOP = STICKY_FILTERS_TOP + STICKY_FILTERS_HEIGHT;

// ── Reusable typeahead-with-scan combobox ─────────────────────────────────
// Always-visible input + dropdown. The Scan button clears the field and
// focuses it for scanner input — the same lookup logic handles both manual
// typing and scanner Enter.
function Combobox({
  value, onSelect, options, placeholder, scanLabel = "Scan",
  clearAfterSelect = false, autoFocus = false,
  width = "100%",
}: {
  value: string;
  onSelect: (id: string) => void;
  options: { id: string; label: string; sub?: string; searchableText: string }[];
  placeholder: string;
  scanLabel?: string;
  clearAfterSelect?: boolean;
  autoFocus?: boolean;
  width?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  // Keep the displayed text in sync with the externally-selected value when not editing.
  useEffect(() => {
    if (open) return;
    const sel = options.find(o => o.id === value);
    setText(sel?.label ?? "");
  }, [value, options, open]);

  const trimmed = text.trim().toLowerCase();
  const filtered = trimmed
    ? options.filter(o => o.searchableText.toLowerCase().includes(trimmed))
    : options.slice(0, 50);

  function commit(id: string) {
    onSelect(id);
    if (clearAfterSelect) {
      setText("");
    } else {
      const sel = options.find(o => o.id === id);
      setText(sel?.label ?? "");
    }
    setOpen(false);
    setHi(0);
  }

  function focusForScan() {
    setText(""); setOpen(true); setHi(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div style={{ position: "relative", display: "flex", gap: "0.375rem", alignItems: "center", width }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          onChange={e => { setText(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp")   { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              const pick = filtered[hi] ?? filtered[0];
              if (pick) commit(pick.id);
            }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "0.45rem 0.7rem",
            border: "1px solid #d4d0cc",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "inherit",
            background: "#fff",
          }}
        />
        {open && filtered.length > 0 && (
          <ul style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 40,
            maxHeight: "260px", overflowY: "auto",
            margin: 0, padding: "0.25rem", listStyle: "none",
          }}>
            {filtered.map((o, i) => (
              <li
                key={o.id}
                onMouseDown={e => { e.preventDefault(); commit(o.id); }}
                onMouseEnter={() => setHi(i)}
                style={{
                  padding: "0.4rem 0.625rem", borderRadius: "0.375rem",
                  background: hi === i ? "#fef2f2" : "transparent",
                  color: hi === i ? "#b91c1c" : "#1c1917",
                  fontSize: "0.875rem", cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 500 }}>{o.label}</div>
                {o.sub && <div style={{ fontSize: "0.75rem", color: hi === i ? "#dc2626" : "#78716c" }}>{o.sub}</div>}
              </li>
            ))}
          </ul>
        )}
        {open && filtered.length === 0 && trimmed && (
          <ul style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.5rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)", zIndex: 40,
            margin: 0, padding: "0.5rem 0.75rem", listStyle: "none",
            fontSize: "0.8125rem", color: "#a8a29e", fontStyle: "italic",
          }}>
            <li>No matches for "{text}"</li>
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={focusForScan}
        title="Click and then scan a barcode — the input clears and focuses for the scanner."
        style={{
          padding: "0.45rem 0.75rem", borderRadius: "0.375rem",
          background: "#1c1917", color: "#fff", border: "none",
          fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: "0.35rem",
          whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "0.95em" }}>📷</span>
        {scanLabel}
      </button>
    </div>
  );
}

export default function StocktakeClient({
  stocktake,
  initialLines,
  allItems,
  canSeeAudit = false,
  purchasableCodes = [],
  itemBarcodes,
  rooms,
  locations,
  tenantCompliance,
  tenantId,
}: {
  stocktake: Stocktake;
  initialLines: StocktakeLine[];
  allItems: Item[];
  canSeeAudit?: boolean;
  purchasableCodes?: string[];
  itemBarcodes: { item_id: string; barcode_value: string }[];
  rooms: RoomLite[];
  locations: LocationFull[];
  tenantCompliance: { require_batch: boolean; require_ubd: boolean };
  tenantId: string | null;
}) {
  const tenantIdState = tenantId;
  const supabase = createClient();
  const router = useRouter();
  const isSubmitted = stocktake.status === "submitted";
  const scrollKey = `stocktake.${stocktake.id}.scrollY`;
  const scanInputRef = useRef<HTMLInputElement>(null);

  // ── Lookup maps ─────────────────────────────────────────────────────────
  const itemById = useMemo(() => {
    const m: Record<string, Item> = {};
    for (const it of allItems) m[it.id] = it;
    return m;
  }, [allItems]);

  const roomByBarcode = useMemo(() => {
    const m: Record<string, RoomLite> = {};
    for (const r of rooms) if (r.barcode) m[r.barcode.toUpperCase()] = r;
    return m;
  }, [rooms]);

  const locationByBarcode = useMemo(() => {
    const m: Record<string, LocationFull> = {};
    for (const l of locations) if (l.barcode) m[l.barcode.toUpperCase()] = l;
    return m;
  }, [locations]);

  const itemByBarcode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of itemBarcodes) m[b.barcode_value.toUpperCase()] = b.item_id;
    return m;
  }, [itemBarcodes]);

  // ── State ────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<StocktakeLine[]>(initialLines);
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of initialLines) m[l.id] = l.counted_qty != null ? String(l.counted_qty) : "";
    return m;
  });
  const [lineNotes, setLineNotes] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of initialLines) m[l.id] = l.notes ?? "";
    return m;
  });
  const [lineBatch, setLineBatch] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of initialLines) m[l.id] = l.batch ?? "";
    return m;
  });
  const [lineUbd, setLineUbd] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of initialLines) m[l.id] = l.ubd ?? "";
    return m;
  });

  const [stNotes, setStNotes] = useState(stocktake.notes ?? "");

  // Picker filters
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [filterRoomId, setFilterRoomId] = useState<string>("");

  // Bulk select on the picker
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);

  // Scan workflow
  const [scanInput, setScanInput] = useState("");
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Restore scroll on mount, save before leaving
  useEffect(() => {
    const stored = sessionStorage.getItem(scrollKey);
    if (stored) {
      const y = Number(stored);
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [scrollKey]);

  const navigateToItem = useCallback((itemId: string) => {
    sessionStorage.setItem(scrollKey, String(window.scrollY));
    router.push(`/items/${itemId}?fromStocktake=${stocktake.id}`);
  }, [scrollKey, router, stocktake.id]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const activeRoom = activeRoomId ? rooms.find(r => r.id === activeRoomId) ?? null : null;
  const activeLocation = activeLocationId ? locations.find(l => l.id === activeLocationId) ?? null : null;

  const itemIdsWithLines = useMemo(() => new Set(lines.map(l => l.item_id)), [lines]);

  // Compliance for the active location (or tenant-level if no location chosen)
  const activeRequireBatch = activeLocation?.require_batch ?? tenantCompliance.require_batch;
  const activeRequireUbd   = activeLocation?.require_ubd   ?? tenantCompliance.require_ubd;

  // ── Combobox option lists ───────────────────────────────────────────────
  const roomOptions = useMemo(() => rooms.map(r => ({
    id: r.id,
    label: r.name + (r.code ? `  ·  ${r.code}` : ""),
    sub: [r.department?.name, r.barcode ?? null].filter(Boolean).join(" · ") || undefined,
    searchableText: [r.name, r.code ?? "", r.barcode ?? "", r.department?.name ?? ""].join(" "),
  })), [rooms]);

  const locationOptions = useMemo(() => locations
    .filter(l => !activeRoomId || l.room_id === activeRoomId)
    .map(l => ({
      id: l.id,
      label: l.name + (l.code ? `  ·  ${l.code}` : ""),
      sub: [l.room?.name, l.barcode ?? null].filter(Boolean).join(" · ") || undefined,
      searchableText: [l.name, l.code ?? "", l.barcode ?? "", l.room?.name ?? ""].join(" "),
    })), [locations, activeRoomId]);

  const itemOptions = useMemo(() => {
    const barcodesByItem: Record<string, string[]> = {};
    for (const b of itemBarcodes) (barcodesByItem[b.item_id] ??= []).push(b.barcode_value);
    return allItems.filter(it => it.is_active || includeInactive).map(it => ({
      id: it.id,
      label: `${it.code}  ·  ${it.name}`,
      sub: `${it.item_type} · ${it.unit}` + (barcodesByItem[it.id]?.length ? ` · ${barcodesByItem[it.id].length} barcode(s)` : ""),
      searchableText: [it.code, it.name, ...(barcodesByItem[it.id] ?? [])].join(" "),
    }));
  }, [allItems, includeInactive, itemBarcodes]);

  // ── Scan parsing (legacy unified field — kept for back-compat) ──────────
  /** Returns the kind + payload of a scanned barcode. */
  function classifyScan(raw: string): { kind: "room" | "location" | "item" | "unknown"; data: any } {
    const v = raw.trim().toUpperCase();
    if (!v) return { kind: "unknown", data: null };
    if (roomByBarcode[v]) return { kind: "room", data: roomByBarcode[v] };
    if (locationByBarcode[v]) return { kind: "location", data: locationByBarcode[v] };
    // Item barcode — could be tenant-allocated GS1, supplier code, or anything in item_barcodes
    if (itemByBarcode[v]) return { kind: "item", data: itemByBarcode[v] };
    // Fallback: try matching by item code (some workflows scan item code as barcode)
    const codeHit = allItems.find(it => it.code.toUpperCase() === v);
    if (codeHit) return { kind: "item", data: codeHit.id };
    return { kind: "unknown", data: null };
  }

  async function processScan() {
    const value = scanInput.trim();
    if (!value) return;
    const result = classifyScan(value);
    if (result.kind === "room") {
      const room = result.data as RoomLite;
      setActiveRoomId(room.id);
      // If active location is no longer in this room, clear it
      if (activeLocation && activeLocation.room_id !== room.id) setActiveLocationId(null);
      setScanMessage({ kind: "info", text: `Scanning into Room: ${room.name}${room.department?.name ? " · " + room.department.name : ""}` });
    } else if (result.kind === "location") {
      const loc = result.data as LocationFull;
      setActiveLocationId(loc.id);
      setActiveRoomId(loc.room_id);
      setScanMessage({ kind: "info", text: `Scanning into Location: ${loc.name}${loc.room?.name ? " · " + loc.room.name : ""}` });
    } else if (result.kind === "item") {
      const itemId = result.data as string;
      const item = itemById[itemId];
      if (!item) {
        setScanMessage({ kind: "err", text: `Unknown item id ${itemId}` });
      } else {
        openEntryModal(item, "scan");
      }
    } else {
      setScanMessage({ kind: "err", text: `Unknown barcode "${value}". Not a room, location, or known item.` });
    }
    setScanInput("");
    // Re-focus scan input for next scan
    requestAnimationFrame(() => scanInputRef.current?.focus());
  }

  // ── Picker handlers (used by Combobox onSelect) ────────────────────────
  function handlePickRoom(roomId: string) {
    setActiveRoomId(roomId || null);
    if (!roomId) { setActiveLocationId(null); return; }
    const r = rooms.find(x => x.id === roomId);
    if (activeLocation && activeLocation.room_id !== roomId) setActiveLocationId(null);
    if (r) setScanMessage({ kind: "info", text: `Active Room: ${r.name}${r.department?.name ? " · " + r.department.name : ""}` });
  }

  function handlePickLocation(locId: string) {
    setActiveLocationId(locId || null);
    if (!locId) return;
    const l = locations.find(x => x.id === locId);
    if (l) {
      setActiveRoomId(l.room_id);
      setScanMessage({ kind: "info", text: `Active Location: ${l.name}${l.room?.name ? " · " + l.room.name : ""}` });
    }
  }

  async function handlePickItem(itemId: string) {
    if (!itemId) return;
    const it = itemById[itemId];
    if (!it) {
      setScanMessage({ kind: "err", text: `Unknown item id ${itemId}` });
      return;
    }
    openEntryModal(it, "scan");
  }

  // ── Entry modal (single-add path) ──────────────────────────────────────
  type PendingEntry = {
    item: Item;
    source: "scan" | "pick" | "manual";
    qty: string;
    batch: string;
    ubd: string;
    locationId: string;
    notes: string;
  };
  const [pendingEntry, setPendingEntry] = useState<PendingEntry | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  function openEntryModal(item: Item, source: "scan" | "pick" | "manual") {
    const locId = activeLocationId ?? item.default_location?.id ?? "";
    setPendingEntry({
      item, source,
      qty: source === "scan" ? "1" : "",
      batch: "",
      ubd: "",
      locationId: locId,
      notes: "",
    });
  }

  function cancelEntry() {
    setPendingEntry(null);
    setError(null);
  }

  async function confirmEntry() {
    if (!pendingEntry) return;
    const { item, source, qty, batch, ubd, locationId, notes } = pendingEntry;
    // Compliance check against the chosen location
    const loc = locations.find(l => l.id === locationId);
    const reqBatch = loc?.require_batch ?? tenantCompliance.require_batch;
    const reqUbd   = loc?.require_ubd   ?? tenantCompliance.require_ubd;
    if (reqBatch && !batch.trim()) { setError("Batch is required for this location."); return; }
    if (reqUbd   && !ubd.trim())   { setError("Use-by date is required for this location."); return; }
    if (qty === "" || isNaN(parseFloat(qty))) { setError("Enter a quantity."); return; }
    setSavingEntry(true); setError(null);
    const line = await insertLine(item, {
      source,
      qty: parseFloat(qty),
      batch: batch.trim() || null,
      ubd: ubd.trim() || null,
      locationId: locationId || null,
      notes: notes.trim() || null,
    });
    setSavingEntry(false);
    if (line) {
      setScanMessage({ kind: "ok", text: `+${qty} ${item.unit ?? ""} ${item.name}${loc ? " @ " + loc.name : ""}` });
      setPendingEntry(null);
    }
  }

  // ── Line CRUD ────────────────────────────────────────────────────────────
  async function insertLine(item: Item, opts: {
    source: "scan" | "pick" | "manual";
    qty?: number | null;
    batch?: string | null;
    ubd?: string | null;
    locationId?: string | null;
    notes?: string | null;
  }): Promise<StocktakeLine | null> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    const locId = opts.locationId ?? activeLocationId ?? item.default_location?.id ?? null;
    const insert = {
      tenant_id: profile!.tenant_id,
      stocktake_id: stocktake.id,
      item_id: item.id,
      system_qty: item.current_stock ?? 0,
      counted_qty: opts.qty ?? null,
      location_id: locId,
      batch: opts.batch ?? null,
      ubd:   opts.ubd   ?? null,
      notes: opts.notes ?? null,
      entry_source: opts.source,
    };
    const { data: newLine, error: err } = await supabase
      .from("stocktake_lines")
      .insert(insert)
      .select("*, item:item_id(id, code, name, unit, item_type, current_stock), counter:counted_by(id, full_name), location:location_id(id, name, code, room:room_id(id, name, department:department_id(id, name)))")
      .single();
    if (err) { setError(err.message); return null; }
    const line = newLine as unknown as StocktakeLine;
    setLines(prev => [...prev, line]);
    setCounts(prev => ({ ...prev, [line.id]: line.counted_qty != null ? String(line.counted_qty) : "" }));
    setLineNotes(prev => ({ ...prev, [line.id]: line.notes ?? "" }));
    setLineBatch(prev => ({ ...prev, [line.id]: line.batch ?? "" }));
    setLineUbd(prev => ({ ...prev, [line.id]: line.ubd ?? "" }));
    return line;
  }

  async function addSelected() {
    // Bulk add: silent — no modal per item (would be tedious for 20+ items).
    // Operators can fill batch/UBD inline on each line afterwards.
    const ids = [...selectedToAdd];
    if (ids.length === 0) return;
    for (const id of ids) {
      const it = itemById[id];
      if (it) await insertLine(it, { source: "pick" });
    }
    setSelectedToAdd(new Set());
    setLastSelectedIdx(null);
  }

  async function removeLine(lineId: string) {
    if (!confirm("Delete this entry?")) return;
    await supabase.from("stocktake_lines").delete().eq("id", lineId);
    setLines(prev => prev.filter(l => l.id !== lineId));
  }

  const saveLine = useCallback(async (lineId: string) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const countedQty = counts[lineId] !== "" ? parseFloat(counts[lineId] ?? "") : null;
    await supabase.from("stocktake_lines").update({
      counted_qty: countedQty,
      notes: lineNotes[lineId] || null,
      batch: lineBatch[lineId] || null,
      ubd:   lineUbd[lineId]   || null,
    }).eq("id", lineId);
    setLastSavedAt(new Date());
  }, [lines, counts, lineNotes, lineBatch, lineUbd, supabase]);

  async function saveAllNow() {
    setSaving(true); setError(null);
    try {
      for (const line of lines) {
        const countedQty = counts[line.id] !== "" ? parseFloat(counts[line.id] ?? "") : null;
        await supabase.from("stocktake_lines").update({
          counted_qty: countedQty,
          notes: lineNotes[line.id] || null,
          batch: lineBatch[line.id] || null,
          ubd:   lineUbd[line.id]   || null,
        }).eq("id", line.id);
      }
      await supabase.from("stocktakes").update({ notes: stNotes || null }).eq("id", stocktake.id);
      setLastSavedAt(new Date());
    } catch (e) { setError(String(e)); }
    setSaving(false);
  }

  async function saveAndSubmit() {
    if (!confirm("Submit this stocktake? This will update current stock levels for every counted item and cannot be undone.")) return;
    setSubmitting(true); setError(null);
    try {
      // Persist all lines first
      for (const line of lines) {
        const countedQty = counts[line.id] !== "" ? parseFloat(counts[line.id] ?? "") : null;
        await supabase.from("stocktake_lines").update({
          counted_qty: countedQty,
          notes: lineNotes[line.id] || null,
          batch: lineBatch[line.id] || null,
          ubd:   lineUbd[line.id]   || null,
        }).eq("id", line.id);
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();

      // Aggregate per item — sum across multiple lines
      const perItem: Record<string, { totalCounted: number; anyCounted: boolean; system: number }> = {};
      for (const line of lines) {
        const counted = counts[line.id] !== "" ? parseFloat(counts[line.id] ?? "") : null;
        const it = itemById[line.item_id];
        if (!it) continue;
        const entry = perItem[line.item_id] ??= { totalCounted: 0, anyCounted: false, system: it.current_stock ?? 0 };
        if (counted != null) {
          entry.totalCounted += counted;
          entry.anyCounted = true;
        }
      }

      for (const [itemId, agg] of Object.entries(perItem)) {
        if (!agg.anyCounted) continue; // skip items with no counts
        const variance = agg.totalCounted - agg.system;
        await supabase.from("items").update({ current_stock: agg.totalCounted }).eq("id", itemId);
        if (variance !== 0) {
          const txItem = itemById[itemId];
          await supabase.from("inventory_transactions").insert({
            tenant_id: profile!.tenant_id, item_id: itemId,
            tx_type: "adjustment", quantity: variance,
            unit: txItem?.unit ?? "kg",
            notes: `Stocktake adjustment (${stocktake.reference ?? stocktake.id})`,
            created_by: user!.id,
          });
        }
      }
      await supabase.from("stocktakes").update({
        status: "submitted", submitted_at: new Date().toISOString(),
        notes: stNotes || null,
      }).eq("id", stocktake.id);
      sessionStorage.removeItem(scrollKey);
      router.push("/stocktakes"); router.refresh();
    } catch (err) {
      setError(String(err)); setSubmitting(false);
    }
  }

  async function saveNotes() {
    setSaving(true);
    await supabase.from("stocktakes").update({ notes: stNotes || null }).eq("id", stocktake.id);
    setLastSavedAt(new Date());
    setSaving(false);
  }

  // ── Picker ──────────────────────────────────────────────────────────────
  const typeMatches = useCallback((it: Item) => {
    if (showAllTypes) return true;
    if (!stocktake.stocktake_type || stocktake.stocktake_type === "mixed") return true;
    if (stocktake.stocktake_type === "raw_material") {
      return purchasableCodes.length > 0
        ? purchasableCodes.includes(it.item_type)
        : ["raw_material", "packaging", "consumable"].includes(it.item_type);
    }
    if (stocktake.stocktake_type === "wip") return ["wip", "fill"].includes(it.item_type);
    if (stocktake.stocktake_type === "fg")  return it.item_type === "finished_good";
    return true;
  }, [showAllTypes, stocktake.stocktake_type, purchasableCodes]);

  const pickerItems = useMemo(() => allItems.filter(it => {
    if (!includeInactive && !it.is_active) return false;
    if (!typeMatches(it)) return false;
    if (filterRoomId) {
      const roomId = it.default_location?.room?.id;
      if (roomId !== filterRoomId) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return it.code.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
    }
    return true;
  }), [allItems, includeInactive, typeMatches, filterRoomId, search]);

  // Shift-click range select
  function handlePickerCheckbox(item: Item, idx: number, ev: React.ChangeEvent<HTMLInputElement> | React.MouseEvent) {
    const isShift = "shiftKey" in ev && ev.shiftKey;
    if (isShift && lastSelectedIdx != null) {
      const start = Math.min(lastSelectedIdx, idx);
      const end   = Math.max(lastSelectedIdx, idx);
      setSelectedToAdd(prev => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const it = pickerItems[i];
          if (it) next.add(it.id);
        }
        return next;
      });
    } else {
      setSelectedToAdd(prev => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
    }
    setLastSelectedIdx(idx);
  }

  // ── Display helpers ─────────────────────────────────────────────────────
  // Group lines by item code for display (sorted)
  const linesGrouped = useMemo(() => {
    const sorted = [...lines].sort((a, b) => {
      const ca = a.item?.code ?? "";
      const cb = b.item?.code ?? "";
      if (ca === cb) return new Date(a.counted_at ?? 0).getTime() - new Date(b.counted_at ?? 0).getTime();
      return ca.localeCompare(cb);
    });
    const groups: { item: Item; lines: StocktakeLine[]; totalCounted: number }[] = [];
    let current: typeof groups[number] | null = null;
    for (const l of sorted) {
      if (!current || current.item.id !== l.item_id) {
        const it = itemById[l.item_id] ?? (l.item as Item) ?? null;
        if (!it) continue;
        current = { item: it, lines: [], totalCounted: 0 };
        groups.push(current);
      }
      current.lines.push(l);
      const c = counts[l.id];
      const num = c !== "" && c != null ? parseFloat(c) : null;
      if (num != null) current.totalCounted += num;
    }
    return groups;
  }, [lines, counts, itemById]);

  const totalLines = lines.length;
  const completedLines = lines.filter(l => counts[l.id] !== "" && counts[l.id] != null).length;

  function varColor(v: number) {
    if (v > 0) return "#15803d";
    if (v < 0) return "#dc2626";
    return "#292524";
  }

  // Hover-tooltip room cell
  function RoomCell({ loc }: { loc: LocationLite | null }) {
    const [hover, setHover] = useState(false);
    if (!loc?.room) return <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>—</span>;
    return (
      <span
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: "relative", display: "inline-block", fontSize: "0.8125rem", color: "#1c1917" }}
      >
        {loc.room.name}
        {hover && loc.room.department && (
          <span style={{
            position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 30,
            background: "#1c1917", color: "#fafaf9", padding: "0.25rem 0.5rem",
            borderRadius: "0.25rem", fontSize: "0.75rem", whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
          }}>
            {loc.room.department.name}
          </span>
        )}
      </span>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Sticky top bar (Save / Commit) */}
      {!isSubmitted && (
        <div style={{
          position: "sticky", top: STICKY_TOP_BAR, zIndex: 22,
          background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e7e5e4",
          padding: "0.625rem 0.875rem",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap",
          minHeight: STICKY_TOP_BAR_HEIGHT, boxSizing: "border-box",
        }}>
          <div style={{ fontSize: "0.8125rem", color: "#57534e" }}>
            <strong>{totalLines}</strong> entries · <strong>{completedLines}</strong> counted · <strong>{linesGrouped.length}</strong> distinct items
            {lastSavedAt && (
              <span style={{ marginLeft: "0.75rem", color: "#15803d" }}>
                ✓ Saved {lastSavedAt.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={saveAllNow} disabled={saving} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={saveAndSubmit} disabled={submitting} className="btn-primary" style={{ fontSize: "0.8125rem" }}>
              {submitting ? "Committing…" : `Commit Stocktake (${completedLines})`}
            </button>
          </div>
        </div>
      )}

      {/* Sticky scan + filters */}
      {!isSubmitted && (
        <div style={{
          position: "sticky", top: STICKY_FILTERS_TOP, zIndex: 21,
          background: "#fff", borderBottom: "1px solid #e7e5e4",
          padding: "0.625rem 0.875rem",
          display: "flex", flexDirection: "column", gap: "0.5rem",
          minHeight: STICKY_FILTERS_HEIGHT, boxSizing: "border-box",
        }}>
          {/* Row 1 — three typeahead pickers, each with a Scan button */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.625rem", alignItems: "start" }}>
            <div>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.2rem" }}>
                Room {activeRoom && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#1e3a8a" }}>· {activeRoom.name}</span>}
              </label>
              <Combobox
                value={activeRoomId ?? ""}
                onSelect={handlePickRoom}
                options={roomOptions}
                placeholder="Type room name / code / barcode"
                scanLabel="Scan"
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.2rem" }}>
                Location {activeLocation && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "#14532d" }}>· {activeLocation.name}</span>}
              </label>
              <Combobox
                value={activeLocationId ?? ""}
                onSelect={handlePickLocation}
                options={locationOptions}
                placeholder={activeRoomId ? "Locations in this room…" : "Type location name / code / barcode"}
                scanLabel="Scan"
              />
            </div>
            <div>
              <label style={{ fontSize: "0.7rem", fontWeight: 600, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.2rem" }}>
                Add item
                {(activeRequireBatch || activeRequireUbd) && (
                  <span title={`Required for this ${activeLocation ? "location" : "tenant"}`} style={{
                    marginLeft: "0.4rem", padding: "0.1rem 0.4rem", borderRadius: "9999px",
                    fontSize: "0.65rem", fontWeight: 700,
                    background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
                    textTransform: "none", letterSpacing: 0,
                  }}>
                    ⚠ Need {[activeRequireBatch && "Batch", activeRequireUbd && "UBD"].filter(Boolean).join(" + ")}
                  </span>
                )}
              </label>
              <Combobox
                value=""
                onSelect={handlePickItem}
                options={itemOptions}
                placeholder="Type item code / name / barcode"
                scanLabel="Scan"
                clearAfterSelect
              />
            </div>
          </div>

          {/* Scan feedback */}
          {scanMessage && (
            <div style={{
              fontSize: "0.8125rem",
              color: scanMessage.kind === "err" ? "#991b1b" : scanMessage.kind === "ok" ? "#166534" : "#1e3a8a",
              background: scanMessage.kind === "err" ? "#fef2f2" : scanMessage.kind === "ok" ? "#f0fdf4" : "#eff6ff",
              border: `1px solid ${scanMessage.kind === "err" ? "#fca5a5" : scanMessage.kind === "ok" ? "#bbf7d0" : "#bfdbfe"}`,
              padding: "0.3rem 0.6rem", borderRadius: "0.375rem",
            }}>
              {scanMessage.text}
            </div>
          )}

          {/* Row 2: search + scope toggles */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.8125rem", color: "#57534e" }}>
            <input
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter picker by code or name…"
              style={{ flex: 1, minWidth: "220px", maxWidth: "360px" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", cursor: "pointer" }}>
              <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
              Inactive
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", cursor: "pointer" }}>
              <input type="checkbox" checked={showAllTypes} onChange={e => setShowAllTypes(e.target.checked)} />
              All types (override: {TYPE_LABEL[stocktake.stocktake_type ?? "mixed"] ?? "Mixed"})
            </label>
            {rooms.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                Room:&nbsp;
                <select value={filterRoomId} onChange={e => setFilterRoomId(e.target.value)} className="form-select"
                  style={{ display: "inline-block", width: "auto", padding: "0.2rem 0.5rem", fontSize: "0.8125rem" }}
                >
                  <option value="">All</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>{r.name}{r.department?.name ? ` — ${r.department.name}` : ""}</option>
                  ))}
                </select>
              </label>
            )}
            {selectedToAdd.size > 0 && (
              <button onClick={addSelected} className="btn-primary" style={{ fontSize: "0.8125rem", marginLeft: "auto" }}>
                + Add {selectedToAdd.size} as new entries
              </button>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      {!isSubmitted && (
        <div className="card" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">Stocktake Notes</label>
              <input className="form-input" value={stNotes} onChange={e => setStNotes(e.target.value)} placeholder="e.g. End of week count, supervisor: John" />
            </div>
            <button onClick={saveNotes} className="btn-secondary" disabled={saving} style={{ whiteSpace: "nowrap" }}>
              {saving ? "Saving…" : "Save Notes"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* COUNT SHEET — tree view, lines grouped by item */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            Count Sheet
            <span style={{ fontWeight: 400, color: "#78716c", marginLeft: "0.75rem", fontSize: "0.875rem" }}>
              {completedLines} / {totalLines} entries counted · {linesGrouped.length} distinct items
            </span>
          </h2>
          {!isSubmitted && (
            <StocktakeBulkIO
              stocktakeId={stocktake.id}
              stocktakeReference={stocktake.reference}
              tenantId={tenantIdState}
              items={allItems as any}
              lines={lines as any}
              locations={locations as any}
              inScopePredicate={(it) => (includeInactive || it.is_active) && typeMatches(it as Item)}
              onImported={() => router.refresh()}
            />
          )}
        </div>
        <table className="data-table">
          {/* Sticky header — Chromium/Safari ignore position:sticky on
              <thead>; it has to be on the <th> cells themselves. Tino
              May 7 2026 reported the count-sheet header wasn't pinning. */}
          <thead>
            <tr>
              <th style={{ width: "32px", position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}></th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Code</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Item / Entry</th>
              <th style={{ width: "60px", position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Unit</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Room</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Location</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Batch</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>UBD</th>
              <th style={{ textAlign: "right", position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Counted</th>
              <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Notes</th>
              {canSeeAudit && <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Counted at</th>}
              {canSeeAudit && <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}>Counted by</th>}
              {!isSubmitted && <th style={{ position: "sticky", top: STICKY_THEAD_TOP, zIndex: 10, background: "#fff" }}></th>}
            </tr>
          </thead>
          <tbody>
            {linesGrouped.length === 0 && (
              <tr>
                <td colSpan={(isSubmitted ? 10 : 11) + (canSeeAudit ? 2 : 0)} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
                  No entries yet. Scan a Room/Location, then scan items — or use the picker below.
                </td>
              </tr>
            )}
            {linesGrouped.map(group => {
              const item = group.item;
              const sys  = item.current_stock ?? 0;
              const variance = group.totalCounted - sys;
              return (
                <Fragment key={`grp-${item.id}`}>
                  {/* Item header row */}
                  <tr style={{ background: "#fafaf9", borderTop: "2px solid #e7e5e4" }}>
                    <td></td>
                    <td style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.8125rem", color: "#1c1917" }}>{item.code}</td>
                    <td colSpan={8 + (canSeeAudit ? 2 : 0)}>
                      <button
                        onClick={() => navigateToItem(item.id)}
                        title="Open item details"
                        style={{
                          background: "none", border: "none", padding: 0, textAlign: "left",
                          cursor: "pointer", color: "#0369a1", fontWeight: 600,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                        onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
                      >
                        {item.name}
                      </button>
                      <span style={{ marginLeft: "0.625rem", fontSize: "0.75rem", color: "#78716c" }}>
                        {item.item_type} · {item.unit} · System {sys.toFixed(2)} · Total counted {group.totalCounted.toFixed(2)}
                        <span style={{ marginLeft: "0.5rem", fontWeight: 600, color: varColor(variance) }}>
                          ({variance > 0 ? "+" : ""}{variance.toFixed(2)})
                        </span>
                        <span style={{ marginLeft: "0.625rem", color: "#a8a29e" }}>{group.lines.length} entr{group.lines.length !== 1 ? "ies" : "y"}</span>
                      </span>
                    </td>
                    {!isSubmitted && (
                      <td>
                        <button
                          onClick={() => openEntryModal(item, "manual")}
                          className="btn-secondary"
                          style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
                          title="Add another entry for this item"
                        >+ Entry</button>
                      </td>
                    )}
                  </tr>
                  {/* Entry rows */}
                  {group.lines.map(line => {
                    const countVal = counts[line.id] ?? "";
                    const sourceLabel = line.entry_source === "scan" ? "📷" : line.entry_source === "pick" ? "☑" : line.entry_source === "import" ? "↗" : "✎";
                    return (
                      <tr key={line.id}>
                        <td style={{ textAlign: "center", color: "#a8a29e", fontSize: "0.875rem" }} title={line.entry_source ?? "manual"}>
                          {sourceLabel}
                        </td>
                        <td style={{ paddingLeft: "1.5rem", color: "#a8a29e", fontSize: "0.7rem" }}>↳</td>
                        <td style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                          Entry
                        </td>
                        <td style={{
                          fontSize: "0.7rem", fontWeight: 700, color: "#57534e",
                          textTransform: "uppercase", letterSpacing: "0.04em",
                        }}>
                          {item.unit ?? "—"}
                        </td>
                        <td><RoomCell loc={line.location ?? null} /></td>
                        <td style={{ fontSize: "0.8125rem", color: "#1c1917" }}>{line.location?.name ?? <span style={{ color: "#a8a29e" }}>—</span>}</td>
                        <td>
                          {!isSubmitted ? (
                            <input
                              className="form-input"
                              value={lineBatch[line.id] ?? ""}
                              onChange={e => setLineBatch(prev => ({ ...prev, [line.id]: e.target.value }))}
                              onBlur={() => saveLine(line.id)}
                              placeholder={(line.location && (locations.find(l => l.id === line.location?.id)?.require_batch ?? tenantCompliance.require_batch)) ? "required" : "optional"}
                              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.4rem", maxWidth: "120px", fontFamily: "ui-monospace, monospace" }}
                            />
                          ) : (
                            <span style={{ fontSize: "0.8125rem", fontFamily: "ui-monospace, monospace" }}>{line.batch ?? "—"}</span>
                          )}
                        </td>
                        <td>
                          {!isSubmitted ? (
                            <input
                              type="date"
                              className="form-input"
                              value={lineUbd[line.id] ?? ""}
                              onChange={e => setLineUbd(prev => ({ ...prev, [line.id]: e.target.value }))}
                              onBlur={() => saveLine(line.id)}
                              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.4rem", maxWidth: "150px" }}
                            />
                          ) : (
                            <span style={{ fontSize: "0.8125rem" }}>{line.ubd ?? "—"}</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {!isSubmitted ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                              <input
                                type="number" min="0" step="0.001"
                                value={countVal}
                                onChange={e => setCounts(prev => ({ ...prev, [line.id]: e.target.value }))}
                                onBlur={() => saveLine(line.id)}
                                placeholder="0.000"
                                style={{
                                  width: "100px", textAlign: "right", fontFamily: "monospace",
                                  padding: "0.3rem 0.5rem", border: "1px solid #e7e5e4",
                                  borderRadius: "0.375rem", fontSize: "0.875rem",
                                  background: countVal !== "" ? "#f0fdf4" : "#fff",
                                }}
                              />
                              <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {item.unit ?? ""}
                              </span>
                            </span>
                          ) : (
                            <span style={{ fontFamily: "monospace" }}>
                              {line.counted_qty != null ? line.counted_qty.toFixed(2) : "—"}
                              {line.counted_qty != null && item.unit && (
                                <span style={{ marginLeft: "0.3rem", fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase" }}>{item.unit}</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td>
                          {!isSubmitted ? (
                            <input
                              className="form-input"
                              value={lineNotes[line.id] ?? ""}
                              onChange={e => setLineNotes(prev => ({ ...prev, [line.id]: e.target.value }))}
                              onBlur={() => saveLine(line.id)}
                              placeholder="Optional"
                              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.4rem" }}
                            />
                          ) : (
                            <span style={{ fontSize: "0.8125rem", color: "#78716c" }}>{line.notes ?? "—"}</span>
                          )}
                        </td>
                        {canSeeAudit && (
                          <td style={{ fontSize: "0.75rem", color: "#78716c", whiteSpace: "nowrap" }}>
                            {line.counted_at ? new Date(line.counted_at).toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                        )}
                        {canSeeAudit && (
                          <td style={{ fontSize: "0.75rem", color: "#78716c", whiteSpace: "nowrap" }}>
                            {line.counter?.full_name ?? "—"}
                          </td>
                        )}
                        {!isSubmitted && (
                          <td>
                            <button
                              onClick={() => removeLine(line.id)}
                              style={{
                                fontSize: "0.7rem", padding: "0.2rem 0.45rem",
                                border: "1px solid #e7e5e4", borderRadius: "0.375rem",
                                background: "#fff", color: "#78716c", cursor: "pointer",
                              }}
                              title="Delete this entry"
                            >Delete</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PICKER — collapsed by default; expand with the toggle below */}
      {!isSubmitted && !pickerOpen && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
          <button
            onClick={() => setPickerOpen(true)}
            className="btn-secondary"
            style={{ fontSize: "0.8125rem", padding: "0.5rem 1rem" }}
          >
            ▾ Show item picker ({pickerItems.length} item{pickerItems.length !== 1 ? "s" : ""})
          </button>
        </div>
      )}
      {!isSubmitted && pickerOpen && (
        <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Item picker</h2>
              <p style={{ margin: "0.125rem 0 0", fontSize: "0.75rem", color: "#78716c" }}>
                Tick to bulk-add — hold <strong>Shift</strong> and click another row to select a range. Click <em>+ Add</em> for a single entry (opens the confirm modal).
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#78716c" }}>{pickerItems.length} match filters</span>
              <button onClick={() => setPickerOpen(false)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>
                ▴ Hide
              </button>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "32px" }}></th>
                <th>Code</th>
                <th>Item</th>
                <th>Default location</th>
                <th style={{ textAlign: "right" }}>System</th>
                <th>In stocktake</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pickerItems.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "1.5rem", textAlign: "center", color: "#78716c" }}>
                    No items match these filters.
                  </td>
                </tr>
              )}
              {pickerItems.map((it, idx) => {
                const inStocktake = itemIdsWithLines.has(it.id);
                const lineCount = lines.filter(l => l.item_id === it.id).length;
                return (
                  <tr key={it.id} style={{ opacity: it.is_active ? 1 : 0.55 }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedToAdd.has(it.id)}
                        onChange={() => { /* handled in onClick to capture shift state */ }}
                        onClick={(ev) => handlePickerCheckbox(it, idx, ev)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.8125rem", color: "#78716c" }}>
                      {it.code}
                      {!it.is_active && (
                        <span style={{ marginLeft: "0.375rem", fontSize: "0.625rem", padding: "0.05rem 0.3rem", background: "#f5f5f4", border: "1px solid #d6d3d1", borderRadius: "9999px", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{it.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#a8a29e" }}>{it.item_type} · {it.unit}</div>
                    </td>
                    <td style={{ fontSize: "0.8125rem", color: "#57534e" }}>
                      {it.default_location?.name
                        ? `${it.default_location.room?.name ?? ""}${it.default_location.room ? " · " : ""}${it.default_location.name}`
                        : <span style={{ color: "#a8a29e" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "monospace", color: "#78716c" }}>{(it.current_stock ?? 0).toFixed(2)}</td>
                    <td>
                      {inStocktake ? (
                        <span className="badge badge-green" style={{ fontSize: "0.625rem" }}>{lineCount} entr{lineCount !== 1 ? "ies" : "y"}</span>
                      ) : (
                        <span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>—</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => openEntryModal(it, "pick")} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }}>+ Add</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isSubmitted && lines.length > 0 && (
        <div className="card" style={{ background: "#fafaf9" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: "#1c1917" }}>Ready to commit?</p>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#78716c" }}>
                On commit, counts are <strong>summed across entries per item</strong>, and current stock is updated to that total.
                Items with no counted entry are skipped.
              </p>
            </div>
            <button onClick={saveAndSubmit} disabled={submitting} className="btn-primary" style={{ whiteSpace: "nowrap" }}>
              {submitting ? "Committing…" : `Commit Stocktake (${completedLines} entries)`}
            </button>
          </div>
        </div>
      )}

      {isSubmitted && (
        <div className="card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <p style={{ margin: 0, color: "#166534", fontWeight: 600 }}>
            ✓ Stocktake submitted — stock levels have been updated.
          </p>
        </div>
      )}

      {/* ── Entry Modal — pops on every single add ───────────────────────── */}
      {pendingEntry && (() => {
        const it = pendingEntry.item;
        const locsForItem = locations.filter(l => !pendingEntry.locationId || l.id === pendingEntry.locationId || activeRoomId == null || l.room_id === activeRoomId);
        const allLocs = locations; // full list for room-agnostic override
        const chosenLoc = locations.find(l => l.id === pendingEntry.locationId) ?? null;
        const reqBatch = chosenLoc?.require_batch ?? tenantCompliance.require_batch;
        const reqUbd   = chosenLoc?.require_ubd   ?? tenantCompliance.require_ubd;
        const sourceLabel = pendingEntry.source === "scan" ? "Scanned" : pendingEntry.source === "pick" ? "Picked" : "Manual";
        return (
          <div
            // No backdrop close — operators were losing entered batch/UBD/qty.
            // Use × in the header, Cancel button, or Esc (handled per-input).
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "1rem",
            }}
          >
            <div
              style={{
                background: "#fff", borderRadius: "0.75rem",
                width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto",
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              }}
            >
              {/* Header */}
              <div style={{ padding: "1.125rem 1.25rem 0.875rem", borderBottom: "1px solid #e7e5e4" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {sourceLabel} entry · confirm
                    </div>
                    <h3 style={{ margin: "0.2rem 0 0", fontSize: "1.0625rem", fontWeight: 700, color: "#1c1917" }}>
                      <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.5rem" }}>{it.code}</span>
                      {it.name}
                    </h3>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.15rem" }}>
                      {it.item_type} · unit {it.unit} · system {(it.current_stock ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <button onClick={cancelEntry} title="Close" style={{ background: "none", border: "none", fontSize: "1.5rem", color: "#a8a29e", cursor: "pointer", lineHeight: 1, padding: "0.25rem 0.5rem" }}>×</button>
                </div>
              </div>

              {/* Form */}
              <div style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* Qty + unit (autofocus) */}
                <div>
                  <label className="form-label">
                    {it.unit && it.unit !== "ea" ? `Quantity (${it.unit})` : "Quantity"} <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="number" min="0" step="0.001"
                    autoFocus
                    value={pendingEntry.qty}
                    onChange={e => setPendingEntry({ ...pendingEntry, qty: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === "Enter") { e.preventDefault(); confirmEntry(); }
                      else if (e.key === "Escape") { cancelEntry(); }
                    }}
                    placeholder="0.000"
                    className="form-input"
                    style={{ fontSize: "1.125rem", fontFamily: "monospace", padding: "0.5rem 0.75rem", fontWeight: 600 }}
                  />
                </div>

                {/* Location (with optional override) */}
                <div>
                  <label className="form-label">
                    Location {chosenLoc?.room?.name && <span style={{ fontWeight: 400, color: "#78716c" }}>· {chosenLoc.room.name}{chosenLoc.room.department?.name ? " · " + chosenLoc.room.department.name : ""}</span>}
                  </label>
                  <select
                    value={pendingEntry.locationId}
                    onChange={e => setPendingEntry({ ...pendingEntry, locationId: e.target.value })}
                    className="form-select"
                  >
                    <option value="">— None —</option>
                    {allLocs.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.code ?? l.name} · {l.name}{l.room?.name ? ` (${l.room.name})` : ""}
                      </option>
                    ))}
                  </select>
                  {locsForItem.length === 0 && activeRoomId && (
                    <p style={{ fontSize: "0.7rem", color: "#92400e", marginTop: "0.2rem" }}>
                      No locations exist in the active room — pick from any location above or set up locations in Settings.
                    </p>
                  )}
                </div>

                {/* Batch + UBD on one row */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label className="form-label">
                      Batch {reqBatch && <span style={{ color: "#dc2626" }}>*</span>}
                    </label>
                    <input
                      value={pendingEntry.batch}
                      onChange={e => setPendingEntry({ ...pendingEntry, batch: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmEntry(); } else if (e.key === "Escape") { cancelEntry(); } }}
                      placeholder={reqBatch ? "required" : "optional"}
                      className="form-input"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                  <div>
                    <label className="form-label">
                      Use-by date {reqUbd && <span style={{ color: "#dc2626" }}>*</span>}
                    </label>
                    <input
                      type="date"
                      value={pendingEntry.ubd}
                      onChange={e => setPendingEntry({ ...pendingEntry, ubd: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmEntry(); } else if (e.key === "Escape") { cancelEntry(); } }}
                      className="form-input"
                    />
                  </div>
                </div>

                {/* Notes (optional) */}
                <div>
                  <label className="form-label">Notes</label>
                  <input
                    value={pendingEntry.notes}
                    onChange={e => setPendingEntry({ ...pendingEntry, notes: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmEntry(); } else if (e.key === "Escape") { cancelEntry(); } }}
                    placeholder="Optional"
                    className="form-input"
                  />
                </div>

                {error && (
                  <div style={{
                    padding: "0.5rem 0.75rem",
                    background: "#fef2f2", border: "1px solid #fca5a5",
                    borderRadius: "0.375rem", color: "#991b1b", fontSize: "0.8125rem",
                  }}>
                    {error}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{
                padding: "0.875rem 1.25rem", borderTop: "1px solid #e7e5e4",
                display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "space-between",
                background: "#fafaf9", borderBottomLeftRadius: "0.75rem", borderBottomRightRadius: "0.75rem",
              }}>
                <span style={{ fontSize: "0.7rem", color: "#a8a29e" }}>
                  Press <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #d4d4d4", borderRadius: "0.25rem", fontSize: "0.7rem" }}>Enter</kbd> to save · <kbd style={{ padding: "0.05rem 0.3rem", border: "1px solid #d4d4d4", borderRadius: "0.25rem", fontSize: "0.7rem" }}>Esc</kbd> to cancel
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={cancelEntry} className="btn-secondary" disabled={savingEntry}>Cancel</button>
                  <button onClick={confirmEntry} className="btn-primary" disabled={savingEntry}>
                    {savingEntry ? "Saving…" : "Save entry"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
