"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import type { Item, ItemType } from "@/lib/types";
import { ITEM_TYPE_LABELS } from "@/lib/types";
import { TENANT_FULL_FETCH } from "@/lib/limits";
import { useUnitsOfMeasure } from "@/lib/hooks/use-reference-data";

// ── Quick-create item modal ───────────────────────────────────────────────────

interface QuickCreateModalProps {
  prefill?: string;        // name the user already typed
  onCreated: (item: Pick<Item, "id" | "code" | "name" | "item_type" | "unit">) => void;
  onClose: () => void;
}

const QUICK_ITEM_TYPES: ItemType[] = ["raw_material", "wip", "fill", "finished_good", "packaging"];

// Hardcoded fallback used only while units_of_measure is loading. Once the
// register fetch resolves, every UOM dropdown in this file pulls from the
// /settings/units-of-measure register instead.
const FALLBACK_UNITS = ["kg", "g", "L", "mL", "ea", "pack"];

function QuickCreateModal({ prefill = "", onCreated, onClose }: QuickCreateModalProps) {
  const supabase = createClient();
  const { data: uoms = [] } = useUnitsOfMeasure();
  const unitOptions = uoms.length > 0 ? uoms.map(u => u.code) : FALLBACK_UNITS;
  const [name, setName] = useState(prefill);
  const [code, setCode] = useState("");
  const [itemType, setItemType] = useState<ItemType>("raw_material");
  const [unit, setUnit] = useState("kg");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Code availability
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [codeTakenBy, setCodeTakenBy] = useState<string | null>(null);
  const [suggestingCode, setSuggestingCode] = useState(false);

  useEffect(() => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setCodeStatus("idle"); return; }
    setCodeStatus("checking");
    const timeout = setTimeout(async () => {
      const { data } = await supabase.from("items").select("id, name").eq("code", trimmed).maybeSingle();
      if (data) { setCodeStatus("taken"); setCodeTakenBy((data as { name: string }).name); }
      else { setCodeStatus("available"); setCodeTakenBy(null); }
    }, 350);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function suggestNextCode() {
    setSuggestingCode(true);
    const { data } = await supabase.from("items").select("code").eq("item_type", itemType).order("code");
    const codes: string[] = (data ?? []).map((r: { code: string }) => r.code);
    const numericCodes = codes.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
    if (numericCodes.length > 0) {
      setCode(String(Math.max(...numericCodes) + 1));
      setSuggestingCode(false);
      return;
    }
    const prefixPattern = /^([A-Z]+[-_]?)(\d+)$/i;
    const prefixCodes = codes.filter(c => prefixPattern.test(c));
    if (prefixCodes.length > 0) {
      const prefixes = prefixCodes.map(c => c.match(prefixPattern)![1]);
      const prefix = prefixes.sort((a, b) =>
        prefixes.filter(p => p === b).length - prefixes.filter(p => p === a).length
      )[0];
      const nums = prefixCodes.filter(c => c.startsWith(prefix)).map(c => parseInt(c.replace(prefix, ""), 10)).filter(n => !isNaN(n));
      const nextNum = Math.max(...nums) + 1;
      setCode(`${prefix}${String(nextNum).padStart(String(Math.max(...nums)).length, "0")}`);
      setSuggestingCode(false);
      return;
    }
    setSuggestingCode(false);
    setCodeStatus("idle");
  }

  async function handleCreate() {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!code.trim()) { setError("Code is required"); return; }
    setSaving(true);
    setError(null);

    // Fetch the current user's tenant_id — required by RLS on items table
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not authenticated"); setSaving(false); return; }

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      setError("Could not determine your tenant. Please refresh and try again.");
      setSaving(false);
      return;
    }

    const { data, error: err } = await supabase
      .from("items")
      .insert({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        item_type: itemType,
        unit,
        is_active: true,
        tenant_id: profile.tenant_id,
      })
      .select("id, code, name, item_type, unit")
      .single();

    if (err || !data) {
      setError(err?.message ?? "Failed to create item");
      setSaving(false);
      return;
    }
    onCreated(data as Pick<Item, "id" | "code" | "name" | "item_type" | "unit">);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ background: "#fff", borderRadius: "0.75rem", padding: "1.5rem", width: "min(480px, 95vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: "700", color: "#1c1917" }}>Quick-create Item</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: "#78716c", lineHeight: 1 }}>×</button>
        </div>

        {error && (
          <div style={{ marginBottom: "1rem", padding: "0.625rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pork Shoulder" autoFocus />
          </div>
          <div>
            <label className="form-label">Code *</label>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              <input
                className="form-input"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. RM-001"
                style={{ flex: 1, textTransform: "uppercase", fontFamily: "monospace" }}
              />
              <button
                type="button"
                onClick={suggestNextCode}
                disabled={suggestingCode}
                className="btn-secondary"
                title="Suggest the next available code for this item type"
                style={{ padding: "0.4rem 0.5rem", fontSize: "0.75rem", whiteSpace: "nowrap", flexShrink: 0 }}
              >
                {suggestingCode ? "…" : "Next →"}
              </button>
            </div>
            {code.trim() && codeStatus !== "idle" && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.75rem" }}>
                {codeStatus === "checking" && <span style={{ color: "#78716c" }}>Checking…</span>}
                {codeStatus === "available" && <span style={{ color: "#15803d", fontWeight: 500 }}>✓ Available</span>}
                {codeStatus === "taken" && <span style={{ color: "#dc2626", fontWeight: 500 }}>✗ Used by &ldquo;{codeTakenBy}&rdquo;</span>}
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label className="form-label">Type</label>
              <select className="form-select" value={itemType} onChange={e => setItemType(e.target.value as ItemType)}>
                {QUICK_ITEM_TYPES.map(t => (
                  <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Unit (UOM)</label>
              <select className="form-select" value={unit} onChange={e => setUnit(e.target.value)}>
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.625rem", marginTop: "1.25rem" }}>
          <button onClick={handleCreate} disabled={saving} className="btn-primary" style={{ flex: 1 }}>
            {saving ? "Creating…" : "Create Item"}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "#a8a29e" }}>
          You can fill in full details on the Item Master page later.
        </p>
      </div>
    </div>
  );
}

interface BomLine {
  id?: string;
  component_item_id: string;
  qty_per_batch: string;
  unit: string;
  percentage: string;
  grind_size: string;
  comment: string;
  sort_order: number;
  basis: string;
  /** Mig 122: the M denominator. "1 cartridge per 8000 inners" → M = 8000.
   *  Default "1" so legacy lines display sensibly until re-edited. */
  consume_per_qty: string;
  _key: number;
}

interface Props {
  mode: "create" | "edit";
  bomId?: string;
  defaultItemId?: string; // pre-selected item when coming from /items/[id]
  initialApprovedAt?: string | null; // passed from server page for approve toggle
  onSaved?: () => void; // called after successful save (for modal mode)
  onCancel?: () => void; // called when Cancel is clicked (for modal mode)
}

export default function BomForm({ mode, bomId, defaultItemId, initialApprovedAt, onSaved, onCancel }: Props) {
  const router = useRouter();
  const supabase = createClient();
  // Pull the live UOM register so every unit dropdown in this form follows
  // /settings/units-of-measure. Falls back to the hardcoded short list while
  // the fetch is in flight so the form is still usable.
  const { data: uoms = [] } = useUnitsOfMeasure();
  const unitOptions = uoms.length > 0 ? uoms.map(u => u.code) : FALLBACK_UNITS;

  const [items, setItems] = useState<(Pick<Item, "id" | "code" | "name" | "item_type" | "unit"> & { consumed_in_weight?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineKey, setLineKey] = useState(1000);

  // Header fields
  const [itemId, setItemId] = useState(defaultItemId ?? "");
  const [version, setVersion] = useState(1);
  const [refBatchSize, setRefBatchSize] = useState("");
  const [refBatchUnit, setRefBatchUnit] = useState("kg");
  const [yieldFactor, setYieldFactor] = useState("100");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(initialApprovedAt ?? null);

  // Ingredient lines
  const [lines, setLines] = useState<BomLine[]>([]);

  // Component items fetched via BOM join — used as fallback for inactive items
  // that won't appear in the active-only `items` list but are already on the BOM.
  const [bomComponentItems, setBomComponentItems] = useState<
    Record<string, { id: string; code: string; name: string; item_type: string; unit: string; consumed_in_weight?: boolean }>
  >({});

  // Search state for item selector
  const [itemSearch, setItemSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState<Record<number, string>>({});

  // Server-side search results per ingredient row
  // (replaces filtering the in-memory items array — works for any catalogue size)
  const [componentResults, setComponentResults] = useState<
    Record<number, Pick<Item, "id" | "code" | "name" | "item_type" | "unit">[]>
  >({});
  const [componentSearching, setComponentSearching] = useState<Record<number, boolean>>({});
  const componentSearchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Server-side search results for the header item selector
  const [headerResults, setHeaderResults] = useState<Pick<Item, "id" | "code" | "name" | "item_type" | "unit">[]>([]);
  const [headerSearching, setHeaderSearching] = useState(false);
  const headerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anchor position for each component dropdown — captured via getBoundingClientRect()
  // so the dropdown can use position:fixed and float above the modal scroll container.
  const [dropdownAnchor, setDropdownAnchor] = useState<
    Record<number, { top: number; left: number; width: number }>
  >({});

  function captureAnchor(key: number, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setDropdownAnchor(prev => ({ ...prev, [key]: { top: r.bottom + 2, left: r.left, width: r.width } }));
  }

  // Debounced server-side search for ingredient component rows
  function triggerComponentSearch(key: number, query: string) {
    clearTimeout(componentSearchTimers.current[key]);
    if (!query) {
      setComponentResults(prev => { const n = { ...prev }; delete n[key]; return n; });
      setComponentSearching(prev => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    setComponentSearching(prev => ({ ...prev, [key]: true }));
    componentSearchTimers.current[key] = setTimeout(async () => {
      const { data } = await supabase
        .from("items")
        .select("id, code, name, item_type, unit, consumed_in_weight")
        .eq("is_active", true)
        .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
        .order("code")
        .limit(20);
      setComponentResults(prev => ({ ...prev, [key]: data ?? [] }));
      setComponentSearching(prev => { const n = { ...prev }; delete n[key]; return n; });
    }, 250);
  }

  // Debounced server-side search for the BOM header item selector
  function triggerHeaderSearch(query: string) {
    if (headerSearchTimer.current) clearTimeout(headerSearchTimer.current);
    if (!query) {
      setHeaderResults([]);
      setHeaderSearching(false);
      return;
    }
    setHeaderSearching(true);
    headerSearchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("items")
        .select("id, code, name, item_type, unit, consumed_in_weight")
        .eq("is_active", true)
        .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
        .order("code")
        .limit(20);
      setHeaderResults(data ?? []);
      setHeaderSearching(false);
    }, 250);
  }

  // Close all open dropdowns when the table scrolls (anchors become stale)
  useEffect(() => {
    const box = document.getElementById("bom-table-scroll");
    if (!box) return;
    const close = () => setComponentSearch({});
    box.addEventListener("scroll", close, { passive: true });
    return () => box.removeEventListener("scroll", close);
  }, []);

  // Quick-create modal
  const [quickCreate, setQuickCreate] = useState<{
    prefill: string;
    target: "header" | number; // "header" = main item, number = line._key
  } | null>(null);

  // Keyboard highlight index for dropdowns (-1 = none, 0 = Create button, 1+ = items)
  const [headerHighlight, setHeaderHighlight] = useState(-1);
  const [componentHighlight, setComponentHighlight] = useState<Record<number, number>>({});

  const loadItems = useCallback(async () => {
    // In edit mode we only need to load the specific item for the header display.
    // Component row searches are now done server-side (triggerComponentSearch).
    // In create mode with a defaultItemId, load just that one item.
    if (!defaultItemId) { setItems([]); return; }
    const { data } = await supabase
      .from("items")
      .select("id, code, name, item_type, unit, consumed_in_weight")
      .eq("id", defaultItemId)
      .limit(1);
    setItems(data ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultItemId]);

  const loadBom = useCallback(async () => {
    if (!bomId) return;
    const { data: bom } = await supabase
      .from("bom_headers")
      .select("*, item:item_id(id, code, name, item_type, unit), lines:bom_lines(*, component_item:component_item_id(id, code, name, item_type, unit, consumed_in_weight))")
      .eq("id", bomId)
      .single();

    if (bom) {
      setItemId(bom.item_id);
      setVersion(bom.version);
      setRefBatchSize(String(bom.reference_batch_size));
      setRefBatchUnit(bom.reference_batch_unit);
      setYieldFactor(String(Math.round(bom.yield_factor * 100)));
      setNotes(bom.notes ?? "");
      setIsActive(bom.is_active);
      setApprovedAt(bom.approved_at ?? null);

      // Populate items with the BOM's own item so selectedItem works for the header display
      if (bom.item) {
        setItems([bom.item as Pick<Item, "id" | "code" | "name" | "item_type" | "unit">]);
      }

      if (bom.lines) {
        const loadedLines = (bom.lines as {
          id: string;
          component_item_id: string;
          component_item: { id: string; code: string; name: string; unit: string; consumed_in_weight?: boolean; item_type?: string } | null;
          qty_per_batch: number;
          unit: string;
          percentage: number | null;
          grind_size: string | null;
          comment: string | null;
          sort_order: number;
          basis: string | null;
          consume_per_qty: number | null;
        }[])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((l, i) => ({
            id: l.id,
            component_item_id: l.component_item_id,
            qty_per_batch: String(l.qty_per_batch),
            unit: l.unit,
            percentage: l.percentage != null ? String(l.percentage) : "",
            grind_size: l.grind_size ?? "",
            comment: l.comment ?? "",
            sort_order: l.sort_order,
            basis: l.basis ?? "",
            consume_per_qty: l.consume_per_qty != null ? String(l.consume_per_qty) : "1",
            _key: i,
          }));
        setLines(loadedLines);
        setLineKey(loadedLines.length + 100);

        // Build a map of component items from the BOM join so inactive items
        // (not returned by the active-only loadItems query) still display correctly.
        // consumed_in_weight is included so the recipe-vs-packaging classifier
        // (isRecipeLine in totalQty math) reads the right flag for each line.
        const compMap: Record<string, { id: string; code: string; name: string; item_type: string; unit: string; consumed_in_weight?: boolean }> = {};
        for (const l of bom.lines) {
          if (l.component_item) {
            compMap[l.component_item.id] = {
              id:        l.component_item.id,
              code:      l.component_item.code,
              name:      l.component_item.name,
              item_type: l.component_item.item_type ?? "",
              unit:      l.component_item.unit,
              consumed_in_weight: l.component_item.consumed_in_weight,
            };
          }
        }
        setBomComponentItems(compMap);

        // Do NOT pre-populate componentSearch — the input displays compItem fallback
        // when componentSearch[key] is undefined. Populating it would open all dropdowns
        // immediately and search for the combined "code — name" string (no matches).
      }
    }
  }, [bomId]);

  useEffect(() => {
    Promise.all([loadItems(), loadBom()]).then(() => setLoading(false));
  }, [loadItems, loadBom]);

  // Auto-suggest next version when item changes
  useEffect(() => {
    if (mode !== "create" || !itemId) return;
    supabase
      .from("bom_headers")
      .select("version")
      .eq("item_id", itemId)
      .order("version", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        setVersion(data && data.length > 0 ? data[0].version + 1 : 1);
      });
  }, [itemId, mode]);

  // Ref to the tbody so we can scroll the last row into view after adding
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const addLine = () => {
    const newKey = lineKey + 1;
    setLineKey(newKey);
    setLines(prev => [...prev, {
      component_item_id: "",
      qty_per_batch: "",
      unit: "kg",
      percentage: "",
      grind_size: "",
      comment: "",
      sort_order: prev.length,
      basis: "",
      consume_per_qty: "1",
      _key: newKey,
    }]);
    // Scroll the table container to the bottom, then focus the new row's input
    setTimeout(() => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      // Scroll the table's own scroll container to the very bottom
      const scrollBox = document.getElementById("bom-table-scroll");
      if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
      // Focus the component search input in the new row
      const lastRow = tbody.lastElementChild as HTMLElement | null;
      const input = lastRow?.querySelector<HTMLInputElement>("[data-component-search]");
      input?.focus();
    }, 50);
  };

  const removeLine = (key: number) => {
    setLines(prev => prev.filter(l => l._key !== key));
  };

  const updateLine = (key: number, field: keyof Omit<BomLine, "_key">, value: string | number) => {
    setLines(prev => prev.map(l => l._key === key ? { ...l, [field]: value } : l));
  };
  // Focus the qty input for a given line key after component selection
  function focusQty(key: number) {
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-qty-key="${key}"]`);
      if (el) { el.focus(); el.select(); }
    }, 0);
  }

  // Hidden file input ref for CSV import
  const importRef = useRef<HTMLInputElement>(null);

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const header = ["component_code", "component_name", "qty_per_batch", "unit", "percentage", "grind_size", "comment"];
    const rows = lines.map(l => {
      // Look up component from the BOM join data (bomComponentItems always has all loaded lines)
      const comp = bomComponentItems[l.component_item_id];
      return [
        comp?.code ?? "",
        comp?.name ?? "",
        l.qty_per_batch,
        l.unit,
        l.percentage,
        l.grind_size,
        l.comment,
      ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Use the BOM item's code for the filename (available from items[0] set in loadBom)
    const itemName = items[0]?.code ?? "bom";
    a.download = `${itemName}_ingredients.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── CSV template download ─────────────────────────────────────────────────
  function downloadTemplate() {
    const csv = [
      "component_code,component_name,qty_per_batch,unit,percentage,grind_size,comment",
      '"RM-001","Pork Shoulder","500","kg","","",""',
      '"RM-002","Salt","10","kg","2","",""',
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bom_ingredients_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── CSV import ────────────────────────────────────────────────────────────
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const text = ev.target?.result as string;
      const [headerLine, ...dataLines] = text.trim().split(/\r?\n/);
      const cols = headerLine.split(",").map(c => c.trim().replace(/^"|"$/g, "").toLowerCase());
      const codeIdx    = cols.indexOf("component_code");
      const nameIdx    = cols.indexOf("component_name");
      const qtyIdx     = cols.indexOf("qty_per_batch");
      const unitIdx    = cols.indexOf("unit");
      const pctIdx     = cols.indexOf("percentage");
      const grindIdx   = cols.indexOf("grind_size");
      const commentIdx = cols.indexOf("comment");

      // Collect all codes and names to do a single bulk DB lookup
      const csvRows: Array<{
        code: string; name: string; qty: string; unit: string;
        pct: string; grind: string; comment: string;
      }> = [];

      for (const rawLine of dataLines) {
        if (!rawLine.trim()) continue;
        const fields = rawLine.match(/("([^"]|"")*"|[^,]*)/g)?.map(f =>
          f.replace(/^"|"$/g, "").replace(/""/g, '"')
        ) ?? [];
        csvRows.push({
          code:    codeIdx    >= 0 ? fields[codeIdx]?.trim()    ?? "" : "",
          name:    nameIdx    >= 0 ? fields[nameIdx]?.trim()    ?? "" : "",
          qty:     qtyIdx     >= 0 ? fields[qtyIdx]?.trim()     ?? "" : "",
          unit:    unitIdx    >= 0 ? fields[unitIdx]?.trim()    ?? "kg" : "kg",
          pct:     pctIdx     >= 0 ? fields[pctIdx]?.trim()     ?? "" : "",
          grind:   grindIdx   >= 0 ? fields[grindIdx]?.trim()   ?? "" : "",
          comment: commentIdx >= 0 ? fields[commentIdx]?.trim() ?? "" : "",
        });
      }

      // Fetch matching items from DB in one query
      const csvCodes = csvRows.map(r => r.code).filter(Boolean);
      const csvNames = csvRows.map(r => r.name).filter(Boolean);
      let fetchedItems: Pick<Item, "id" | "code" | "name" | "item_type" | "unit">[] = [];
      if (csvCodes.length > 0 || csvNames.length > 0) {
        const { data } = await supabase
          .from("items")
          .select("id, code, name, item_type, unit")
          .eq("is_active", true)
          .or([
            csvCodes.length ? `code.in.(${csvCodes.map(c => `"${c}"`).join(",")})` : null,
            csvNames.length ? `name.in.(${csvNames.map(n => `"${n}"`).join(",")})` : null,
          ].filter(Boolean).join(","))
          .limit(TENANT_FULL_FETCH);
        fetchedItems = data ?? [];
      }

      let nextKey = lineKey;
      let sortIdx = 0;
      const newLines: BomLine[] = csvRows.map(row => {
        const comp =
          (row.code && fetchedItems.find(i => i.code.toLowerCase() === row.code.toLowerCase())) ||
          (row.name && fetchedItems.find(i => i.name.toLowerCase() === row.name.toLowerCase())) ||
          null;
        // Cache matched items so they show up in display
        if (comp) setBomComponentItems(prev => ({ ...prev, [comp.id]: comp }));
        nextKey += 1;
        return {
          component_item_id: comp?.id ?? "",
          qty_per_batch: row.qty,
          unit: comp?.unit ?? row.unit,
          percentage: row.pct,
          grind_size: row.grind,
          comment: row.comment,
          sort_order: sortIdx++,
          basis: "",
          _key: nextKey,
        } as BomLine;
      });

      setLineKey(nextKey);
      setLines(prev => [...prev, ...newLines]);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  }

  const handleSave = async () => {
    if (!itemId) { setError("Please select an item"); return; }
    // Reference batch size is now INDICATOR-ONLY (not used by MRP / no logic).
    // Don't block save if empty — just default to 100 so the DB column stays valid.
    const yf = Number(yieldFactor) / 100;
    if (isNaN(yf) || yf <= 0 || yf > 1.5) { setError("Yield factor should be between 1% and 150%"); return; }

    for (const line of lines) {
      if (!line.component_item_id) { setError("All ingredient lines must have a component selected"); return; }
      if (!line.qty_per_batch || isNaN(Number(line.qty_per_batch))) { setError("All ingredient lines need a quantity"); return; }
      // Non-weight components MUST declare a basis so MRP knows how to scale
      // them (per piece / per inner / per outer / per pallet / per kg).
      // Without it MRP can't tell whether "40" means 40 per pack, 40 per kg,
      // 40 per 1000 kg, etc. — and the legacy fallback gives nonsense numbers.
      if (!isRecipeLine(line) && !line.basis) {
        const comp = items.find(i => i.id === line.component_item_id) ?? bomComponentItems[line.component_item_id];
        const compName = comp ? `${comp.code} — ${comp.name}` : "this component";
        setError(`Pick a Basis for "${compName}". Packaging / casings / consumables need to know what unit of the parent the qty applies to (per piece / per inner / per outer / per pallet / per kg).`);
        return;
      }
    }

    // No recipe-sum check needed — MRP normalizes recipe lines to 100% per
    // BOM (migration 065), so the user can enter values in any consistent unit.

    setSaving(true);
    setError(null);

    try {
      // Fetch tenant_id — required by RLS on bom_headers
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      if (!profile?.tenant_id) throw new Error("Could not determine tenant. Please refresh and try again.");
      const tenantId = profile.tenant_id;

      if (mode === "create") {
        // Activation policy (Tino May 2026):
        //   • First BOM for an item is ALWAYS auto-active — operator
        //     shouldn't have to remember to tick the box. Without this,
        //     the BOM walk on the spec sheet finds nothing and the spec
        //     looks empty (we hit this exactly with 1020.1 / 1003 / etc.
        //     where every BOM was saved as a draft).
        //   • Subsequent versions: if the operator ticks Active, prompt
        //     a confirm + deactivate the previous active. If they don't
        //     tick it, save as a draft and leave the current active alone.
        const { count: existingCount } = await supabase
          .from("bom_headers")
          .select("id", { count: "exact", head: true })
          .eq("item_id", itemId);
        let willBeActive = isActive;
        if ((existingCount ?? 0) === 0) {
          willBeActive = true;
        } else if (isActive) {
          const ok = confirm(
            `Make this version the active BOM for the item? The currently active version will be switched off.`
          );
          if (!ok) {
            willBeActive = false;
            setIsActive(false);
          } else {
            await supabase
              .from("bom_headers")
              .update({ is_active: false })
              .eq("item_id", itemId)
              .eq("is_active", true);
          }
        }

        const { data: header, error: headerErr } = await supabase
          .from("bom_headers")
          .insert({
            item_id: itemId,
            version,
            reference_batch_size: refBatchSize && !isNaN(Number(refBatchSize)) ? Number(refBatchSize) : 100,
            reference_batch_unit: refBatchUnit,
            yield_factor: yf,
            notes: notes || null,
            is_active: willBeActive,
            tenant_id: tenantId,
          })
          .select("id")
          .single();

        if (headerErr || !header) throw new Error(headerErr?.message ?? "Failed to create BOM");

        if (lines.length > 0) {
          // bom_lines has no tenant_id column — RLS checks via parent bom_headers
          const lineInserts = lines.map((l, i) => ({
            bom_header_id: header.id,
            component_item_id: l.component_item_id,
            qty_per_batch: Number(l.qty_per_batch),
            unit: l.unit,
            percentage: l.percentage ? Number(l.percentage) : null,
            grind_size: l.grind_size || null,
            comment: l.comment || null,
            sort_order: i,
            basis: l.basis || null,
            consume_per_qty: l.percentage ? 1 : (Number(l.consume_per_qty) || 1),
          }));
          const { error: lineErr } = await supabase.from("bom_lines").insert(lineInserts);
          if (lineErr) throw new Error(lineErr.message);
        }

        router.push(`/bom/${header.id}`);
      } else {
        // Edit mode: if the operator ticked Active and there's a different
        // active version for this same item, confirm + flip it off so we
        // never end up with two active BOMs for one item. Tino May 2026.
        let willBeActive = isActive;
        if (isActive) {
          const { data: otherActive } = await supabase
            .from("bom_headers")
            .select("id, version")
            .eq("item_id", itemId)
            .eq("is_active", true)
            .neq("id", bomId!);
          if (otherActive && otherActive.length > 0) {
            const ok = confirm(
              `Make this version the active BOM? Version ${otherActive[0].version} is currently active and will be switched off.`
            );
            if (!ok) {
              willBeActive = false;
              setIsActive(false);
            } else {
              await supabase
                .from("bom_headers")
                .update({ is_active: false })
                .eq("item_id", itemId)
                .eq("is_active", true)
                .neq("id", bomId!);
            }
          }
        }

        const { error: headerErr } = await supabase
          .from("bom_headers")
          .update({
            reference_batch_size: refBatchSize && !isNaN(Number(refBatchSize)) ? Number(refBatchSize) : 100,
            reference_batch_unit: refBatchUnit,
            yield_factor: yf,
            notes: notes || null,
            is_active: willBeActive,
          })
          .eq("id", bomId!);
        if (headerErr) throw new Error(headerErr.message);

        // Delete existing lines and re-insert (simplest approach)
        await supabase.from("bom_lines").delete().eq("bom_header_id", bomId!);

        if (lines.length > 0) {
          // bom_lines has no tenant_id column — RLS checks via parent bom_headers
          const lineInserts = lines.map((l, i) => ({
            bom_header_id: bomId!,
            component_item_id: l.component_item_id,
            qty_per_batch: Number(l.qty_per_batch),
            unit: l.unit,
            percentage: l.percentage ? Number(l.percentage) : null,
            grind_size: l.grind_size || null,
            comment: l.comment || null,
            sort_order: i,
            basis: l.basis || null,
            consume_per_qty: l.percentage ? 1 : (Number(l.consume_per_qty) || 1),
          }));
          const { error: lineErr } = await supabase.from("bom_lines").insert(lineInserts);
          if (lineErr) throw new Error(lineErr.message);
        }

        setSaving(false);
        if (onSaved) {
          onSaved();
        } else {
          router.refresh();
          router.push(`/bom/${bomId}`);
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!bomId) return;
    setSaving(true);
    const newApprovedAt = approvedAt ? null : new Date().toISOString();
    const { error: e } = await supabase
      .from("bom_headers")
      .update({ approved_at: newApprovedAt })
      .eq("id", bomId!);
    if (e) { setError(e.message); setSaving(false); return; }
    setApprovedAt(newApprovedAt);
    router.refresh();
    setSaving(false);
  };

  // Header item dropdown uses server-side search results
  const filteredItems = headerResults;

  // Component row dropdown uses per-row server-side search results
  const getComponentOptions = (key: number) => componentResults[key] ?? [];

  // ── Recipe-line accounting ──
  // Per Tino's rule: only RECIPE lines (component.consumed_in_weight = true) count
  // toward the 100% total. Packaging/casing/consumable lines (consumed_in_weight = false)
  // use their own basis (per_piece/inner/outer/pallet/kg) and never affect the recipe sum.
  //
  // For each line we look up the component to decide which side it lives on.
  // Falls back to "include in recipe" when the component isn't yet selected so a
  // half-entered new line still contributes to the live total preview.
  function isRecipeLine(line: BomLine): boolean {
    if (!line.component_item_id) return true;
    const comp = items.find(i => i.id === line.component_item_id) ?? bomComponentItems[line.component_item_id];
    return !comp || (comp as { consumed_in_weight?: boolean }).consumed_in_weight !== false;
  }

  const recipeLines = lines.filter(isRecipeLine);
  // Sum of qty_per_batch across recipe lines only. After migration 065 the
  // MRP NORMALIZES this sum to 100% per BOM, so the user can enter values in
  // any consistent unit (kg-per-batch, percentages, parts-of-100) and each
  // line's actual share comes out right. This sum is informational only —
  // we no longer enforce a 100% rule because there's no need to.
  const totalQty = recipeLines.reduce((s, l) => s + (Number(l.qty_per_batch) || 0), 0);
  const recipeHasContent = recipeLines.some(l => Number(l.qty_per_batch) > 0);

  if (loading) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "#78716c" }}>Loading…</div>;
  }

  const selectedItem = items.find(i => i.id === itemId);

  return (
    <div>
      {error && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Header card */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>BOM Header</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

          {/* Item selector */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Item (Product / Recipe) *</label>
            {mode === "edit" && selectedItem ? (
              <div style={{ padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#292524" }}>
                <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.5rem" }}>{selectedItem.code}</span>
                {selectedItem.name}
              </div>
            ) : (
              <>
                <input
                  className="form-input"
                  placeholder="Type to search items…"
                  value={itemSearch || (selectedItem ? `${selectedItem.code} — ${selectedItem.name}` : "")}
                  onChange={e => {
                    setItemSearch(e.target.value);
                    setHeaderHighlight(-1);
                    if (!e.target.value) setItemId("");
                    triggerHeaderSearch(e.target.value);
                  }}
                  onKeyDown={e => {
                    if (!itemSearch) return;
                    const total = 1 + filteredItems.length; // 0=Create, 1..n=items
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHeaderHighlight(h => Math.min(h + 1, total - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHeaderHighlight(h => Math.max(h - 1, 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (headerHighlight === 0) {
                        setQuickCreate({ prefill: itemSearch, target: "header" });
                      } else if (headerHighlight > 0) {
                        const item = filteredItems[headerHighlight - 1];
                        if (item) { setItemId(item.id); setItemSearch(""); setHeaderHighlight(-1); }
                      } else if (filteredItems.length === 1) {
                        // Enter with no highlight but exactly one result → auto-select it
                        setItemId(filteredItems[0].id); setItemSearch(""); setHeaderHighlight(-1);
                      }
                    } else if (e.key === "Escape") {
                      setItemSearch(""); setHeaderHighlight(-1);
                    }
                  }}
                  style={{ marginBottom: "0.375rem" }}
                />
                {itemSearch && (
                  <div style={{ border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: "white", maxHeight: "240px", overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.1)" }}>
                    {/* ── Create new — always first, like AppSheet ── */}
                    <button
                      type="button"
                      onClick={() => setQuickCreate({ prefill: itemSearch, target: "header" })}
                      onMouseEnter={() => setHeaderHighlight(0)}
                      onMouseLeave={() => setHeaderHighlight(-1)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.5rem",
                        width: "100%", textAlign: "left",
                        padding: "0.625rem 0.875rem",
                        border: "none", borderBottom: "1px solid #e7e5e4",
                        background: headerHighlight === 0 ? "#fee2e2" : "#fef2f2",
                        cursor: "pointer",
                        fontSize: "0.875rem", color: "#b91c1c", fontWeight: 700,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      {headerSearching ? "Searching…" : filteredItems.length === 0 ? `Create "${itemSearch}"` : `New item…`}
                    </button>
                    {/* ── Matching items ── */}
                    {headerSearching ? (
                      <div style={{ padding: "0.625rem 0.875rem", color: "#a8a29e", fontSize: "0.875rem", fontStyle: "italic" }}>
                        Searching…
                      </div>
                    ) : filteredItems.length === 0 ? (
                      <div style={{ padding: "0.625rem 0.875rem", color: "#a8a29e", fontSize: "0.875rem", fontStyle: "italic" }}>
                        No existing items match &ldquo;{itemSearch}&rdquo;
                      </div>
                    ) : filteredItems.map((i, idx) => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => { setItemId(i.id); setItemSearch(""); setHeaderHighlight(-1); }}
                        onMouseEnter={() => setHeaderHighlight(idx + 1)}
                        onMouseLeave={() => setHeaderHighlight(-1)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem 0.875rem", border: "none", background: headerHighlight === idx + 1 ? "#fafaf9" : "none", cursor: "pointer", fontSize: "0.875rem", borderBottom: "1px solid #f5f5f4" }}
                      >
                        <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.5rem" }}>{i.code}</span>
                        {i.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="form-label">Version</label>
            <input
              className="form-input"
              type="number"
              min="1"
              value={version}
              onChange={e => setVersion(Number(e.target.value))}
              disabled={mode === "edit"}
            />
          </div>

          <div>
            <label className="form-label">Reference Batch Size *</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                className="form-input"
                type="number"
                step="0.01"
                placeholder="e.g. 900"
                value={refBatchSize}
                onChange={e => setRefBatchSize(e.target.value)}
                style={{ flex: 1 }}
              />
              <select
                className="form-select"
                value={refBatchUnit}
                onChange={e => setRefBatchUnit(e.target.value)}
                style={{ width: "80px" }}
              >
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Yield Factor (%)</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                className="form-input"
                type="number"
                step="0.1"
                min="1"
                max="150"
                placeholder="e.g. 85"
                value={yieldFactor}
                onChange={e => setYieldFactor(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#78716c", fontSize: "0.8125rem", whiteSpace: "nowrap" }}>% yield</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.25rem" }}>
              Input needed = batch ÷ {Number(yieldFactor) > 0 ? (Number(yieldFactor) / 100).toFixed(2) : "?"} — accounts for cooking / processing loss
            </div>
          </div>

          <div>
            <label className="form-label">Active Version</label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.625rem" }}>
              <input
                type="checkbox"
                id="is_active"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                style={{ width: "1rem", height: "1rem", cursor: "pointer" }}
              />
              <label htmlFor="is_active" style={{ fontSize: "0.875rem", color: "#292524", cursor: "pointer" }}>
                Mark as active BOM for this item
              </label>
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Any production notes or version comments…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>
        </div>
      </div>

      {/* Ingredient lines */}
      <div className="card" style={{ padding: 0, marginBottom: "1.5rem" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: 0 }}>Ingredients / Components</h2>
            {recipeHasContent && (
              // Recipe input total — informational only. MRP normalizes the
              // recipe lines to 100% automatically, so the user can enter
              // qty_per_batch values in whatever unit they like (kg-per-
              // batch, percentages, etc.) and the relative share comes out
              // right either way. Packaging/casings/consumables are excluded.
              <div style={{
                fontSize: "0.8125rem", marginTop: "0.35rem",
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.25rem 0.625rem", borderRadius: "0.375rem",
                background: "#eff6ff", color: "#1e40af",
                border: "1px solid #bfdbfe",
              }}
              title="Sum of qty_per_batch across weight ingredients. MRP normalizes this to 100% per BOM, so you can enter values in any consistent unit. Packaging / casing / consumable lines are excluded from this total."
              >
                <span>Recipe input: {totalQty.toLocaleString("en-AU", { maximumFractionDigits: 3 })}</span>
                <span style={{ fontWeight: 400, color: "#3b82f6" }}>· auto-normalised to 100% by MRP</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
            <button type="button" onClick={downloadTemplate} className="btn-secondary" style={{ fontSize: "0.75rem" }} title="Download blank CSV template">
              Template
            </button>
            <button type="button" onClick={() => importRef.current?.click()} className="btn-secondary" style={{ fontSize: "0.75rem" }} title="Import ingredients from CSV">
              Import CSV
            </button>
            <button type="button" onClick={exportCSV} className="btn-secondary" style={{ fontSize: "0.75rem" }} title="Export ingredients as CSV" disabled={lines.length === 0}>
              Export CSV
            </button>
            <input ref={importRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleImportFile} />
            <button type="button" onClick={addLine} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>
              + Add Ingredient
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#78716c", fontSize: "0.875rem" }}>
            No ingredients yet. Click &quot;Add Ingredient&quot; to start building the recipe.
          </div>
        ) : (
          /* Table wrapper — scrolls independently so the BOM header fields and
             Save/Cancel bar stay locked in place. Dropdowns use position:fixed
             so they're never clipped by this overflow container.

             Auto-recentre on focus: when an input in any ingredient row gets
             focus (Tab, click, or autofocus after Add Ingredient), we walk
             up every scrollable ancestor (the inner table scroll AND the
             modal/page scroll wrapping the form) and centre the focused row
             in each one. Earlier attempt only scrolled the inner container,
             which didn't help in modal mode because the modal/form scroll
             was the one actually clipping the row out of view. */
          <div
            id="bom-table-scroll"
            style={{
              overflowY: "auto",
              overflowX: "auto",
              maxHeight: "min(calc(100vh - 400px), 520px)",
              minHeight: "120px",
            }}
            onFocusCapture={e => {
              const target = e.target as HTMLElement;
              const row = target.closest("tr") as HTMLElement | null;
              if (!row) return;
              // Walk up every scrollable ancestor and centre the row inside it.
              // Manual math (instead of scrollIntoView) so we keep "smooth"
              // behaviour and avoid scrolling page/modal when the row is
              // already comfortably in their viewport.
              let el: HTMLElement | null = row.parentElement;
              const seen = new Set<HTMLElement>();
              while (el && !seen.has(el)) {
                seen.add(el);
                const cs = window.getComputedStyle(el);
                const overflowY = cs.overflowY;
                const isScrollable = (overflowY === "auto" || overflowY === "scroll")
                  && el.scrollHeight > el.clientHeight + 2;
                if (isScrollable) {
                  const rRect = row.getBoundingClientRect();
                  const sRect = el.getBoundingClientRect();
                  const rowTop    = rRect.top - sRect.top;
                  const rowBottom = rRect.bottom - sRect.top;
                  const margin    = sRect.height * 0.25;
                  // Only recentre when the row is in the bottom or top quarter
                  // of THIS scroller — keeps us from jittering on every keystroke
                  // when the row is already comfortably in the middle.
                  if (rowBottom > sRect.height - margin || rowTop < margin) {
                    const center = el.scrollTop + rowTop - (sRect.height / 2) + (rRect.height / 2);
                    el.scrollTo({ top: Math.max(0, center), behavior: "smooth" });
                  }
                }
                el = el.parentElement;
              }
            }}
          >
            <table className="data-table" style={{ fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "34%", minWidth: "320px" }}>Component</th>
                  <th style={{ width: "7%", minWidth: "70px" }} title="N — the operator number. &quot;1 cartridge per 8000 inners&quot; → 1.">Qty</th>
                  <th style={{ width: "10%", minWidth: "100px" }} title="Auto from the chosen component">Unit</th>
                  <th style={{ width: "4%", textAlign: "center", color: "#a8a29e", fontWeight: 400 }} title="Reading: N × Item per M scope">per</th>
                  <th style={{ width: "8%", minWidth: "80px" }} title="M — denominator. &quot;1 cartridge per 8000 inners&quot; → 8000. 1 for &quot;1 label per outer&quot;. For ingredients this is the % column.">M / %</th>
                  <th style={{ width: "11%", minWidth: "110px" }} title="What 1 unit of M counts. per kg of FG / per unit (log, sausage) / per inner / per outer / per pallet.">Scope</th>
                  <th style={{ width: "7%", minWidth: "70px" }}>Grind</th>
                  <th>Comment</th>
                  <th style={{ width: "40px" }}></th>
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {lines.map((line, index) => {
                  const compItem = items.find(i => i.id === line.component_item_id)
                    ?? bomComponentItems[line.component_item_id];
                  // Packaging / consumable lines render with the natural
                  // "N × item per M [scope]" cells. Recipe ingredients
                  // (consumed_in_weight=true OR no compItem yet) keep the
                  // legacy qty/unit/% cells.
                  const isPackagingLine = !!compItem && compItem.consumed_in_weight === false;
                  const calcPct = totalQty > 0 && Number(line.qty_per_batch) > 0
                    ? ((Number(line.qty_per_batch) / totalQty) * 100).toFixed(1)
                    : null;
                  return (
                    <tr key={line._key} style={{ verticalAlign: "top" }}>
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <div style={{ position: "relative" }}>
                          <input
                            className="form-input"
                            placeholder="Search component…"
                            data-component-search="true"
                            data-line-key={line._key}
                            value={componentSearch[line._key] ?? (compItem ? `${compItem.code} — ${compItem.name}` : "")}
                            onFocus={e => captureAnchor(line._key, e.currentTarget)}
                            onChange={e => {
                              captureAnchor(line._key, e.currentTarget);
                              const val = e.target.value;
                              setComponentSearch(prev => ({ ...prev, [line._key]: val }));
                              setComponentHighlight(prev => ({ ...prev, [line._key]: -1 }));
                              if (!val) updateLine(line._key, "component_item_id", "");
                              triggerComponentSearch(line._key, val);
                            }}
                            onKeyDown={e => {
                              const search = componentSearch[line._key];
                              if (!search) return;
                              const opts = getComponentOptions(line._key);
                              const total = 1 + opts.length; // 0=Create, 1..n=items
                              const cur = componentHighlight[line._key] ?? -1;
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setComponentHighlight(prev => ({ ...prev, [line._key]: Math.min(cur + 1, total - 1) }));
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setComponentHighlight(prev => ({ ...prev, [line._key]: Math.max(cur - 1, 0) }));
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (cur === 0) {
                                  setQuickCreate({ prefill: search, target: line._key });
                                } else if (cur > 0) {
                                  const item = opts[cur - 1];
                                  if (item) {
                                    updateLine(line._key, "component_item_id", item.id);
                                    updateLine(line._key, "unit", item.unit);
                                    setBomComponentItems(prev => ({ ...prev, [item.id]: item }));
                                    setComponentSearch(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    setComponentResults(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    setComponentHighlight(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    focusQty(line._key);
                                  }
                                } else if (opts.length === 1) {
                                  // Enter with no highlight + exactly one result → auto-select
                                  updateLine(line._key, "component_item_id", opts[0].id);
                                  updateLine(line._key, "unit", opts[0].unit);
                                  setBomComponentItems(prev => ({ ...prev, [opts[0].id]: opts[0] }));
                                  setComponentSearch(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                  setComponentResults(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                  focusQty(line._key);
                                }
                              } else if (e.key === "Escape") {
                                setComponentSearch(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                setComponentResults(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                setComponentHighlight(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                              }
                            }}
                            style={{ fontSize: "0.8125rem" }}
                          />
                          {componentSearch[line._key] && (
                            <div style={{
                              position: "fixed",
                              zIndex: 9999,
                              top: dropdownAnchor[line._key]?.top ?? 0,
                              left: dropdownAnchor[line._key]?.left ?? 0,
                              width: Math.max(dropdownAnchor[line._key]?.width ?? 0, 300),
                              maxWidth: "480px",
                              border: "1px solid #e7e5e4",
                              borderRadius: "0.5rem",
                              background: "white",
                              maxHeight: "260px",
                              overflowY: "auto",
                              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                            }}>
                              {/* ── Create new — always first ── */}
                              <button
                                type="button"
                                onClick={() => setQuickCreate({ prefill: componentSearch[line._key], target: line._key })}
                                onMouseEnter={() => setComponentHighlight(prev => ({ ...prev, [line._key]: 0 }))}
                                onMouseLeave={() => setComponentHighlight(prev => ({ ...prev, [line._key]: -1 }))}
                                style={{
                                  display: "flex", alignItems: "center", gap: "0.375rem",
                                  width: "100%", textAlign: "left",
                                  padding: "0.5rem 0.75rem",
                                  border: "none", borderBottom: "1px solid #e7e5e4",
                                  background: (componentHighlight[line._key] ?? -1) === 0 ? "#fee2e2" : "#fef2f2",
                                  cursor: "pointer",
                                  fontSize: "0.8125rem", color: "#b91c1c", fontWeight: 700,
                                }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                                {componentSearching[line._key]
                                  ? "Searching…"
                                  : getComponentOptions(line._key).length === 0
                                    ? `Create "${componentSearch[line._key]}"`
                                    : "New item…"}
                              </button>
                              {/* ── Matching items ── */}
                              {componentSearching[line._key] ? (
                                <div style={{ padding: "0.5rem 0.75rem", color: "#a8a29e", fontSize: "0.8125rem", fontStyle: "italic" }}>
                                  Searching…
                                </div>
                              ) : getComponentOptions(line._key).length === 0 ? (
                                <div style={{ padding: "0.5rem 0.75rem", color: "#a8a29e", fontSize: "0.8125rem", fontStyle: "italic" }}>
                                  No existing items match
                                </div>
                              ) : getComponentOptions(line._key).map((i, idx) => (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => {
                                    updateLine(line._key, "component_item_id", i.id);
                                    updateLine(line._key, "unit", i.unit);
                                    // Cache selected item so it shows in display + CSV export
                                    setBomComponentItems(prev => ({ ...prev, [i.id]: i }));
                                    setComponentSearch(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    setComponentResults(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    setComponentHighlight(prev => { const n = { ...prev }; delete n[line._key]; return n; });
                                    focusQty(line._key);
                                  }}
                                  onMouseEnter={() => setComponentHighlight(prev => ({ ...prev, [line._key]: idx + 1 }))}
                                  onMouseLeave={() => setComponentHighlight(prev => ({ ...prev, [line._key]: -1 }))}
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "0.375rem 0.75rem", border: "none", background: (componentHighlight[line._key] ?? -1) === idx + 1 ? "#fafaf9" : "none", cursor: "pointer", fontSize: "0.8125rem", borderBottom: "1px solid #f5f5f4" }}
                                >
                                  <span style={{ fontFamily: "monospace", color: "#78716c", marginRight: "0.375rem" }}>{i.code}</span>
                                  {i.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {line.component_item_id && !componentSearch[line._key] && compItem && (
                          <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{compItem.unit} · {(compItem.item_type ?? "").replace("_", " ")}</div>
                        )}
                      </td>
                      {/* Natural-language entry: "N × Item per M [scope]" for
                          packaging/consumable lines. Tino May 2026 — see
                          docs/bom-data-model.md. */}
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        {isPackagingLine ? (
                          <input
                            className="form-input"
                            type="number"
                            step="0.001"
                            placeholder="1"
                            data-qty-key={line._key}
                            value={(() => {
                              const rate = Number(line.qty_per_batch);
                              const M = Number(line.consume_per_qty) || 1;
                              if (!Number.isFinite(rate) || line.qty_per_batch === "") return line.qty_per_batch;
                              const N = rate * M;
                              return Number.isFinite(N) ? String(N) : line.qty_per_batch;
                            })()}
                            onChange={e => {
                              const N = e.target.value;
                              const M = Number(line.consume_per_qty) || 1;
                              const rate = N === "" ? "" : String((Number(N) || 0) / M);
                              updateLine(line._key, "qty_per_batch", rate);
                            }}
                            style={{ fontSize: "0.8125rem", textAlign: "right" }}
                            title="N — the operator number. &quot;1 cartridge per 8000 inners&quot; → 1."
                          />
                        ) : (
                          <input
                            className="form-input"
                            type="number"
                            step="0.001"
                            placeholder="0.000"
                            data-qty-key={line._key}
                            value={line.qty_per_batch}
                            onChange={e => updateLine(line._key, "qty_per_batch", e.target.value)}
                            style={{ fontSize: "0.8125rem" }}
                          />
                        )}
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        <select
                          className="form-select"
                          value={line.unit}
                          onChange={e => updateLine(line._key, "unit", e.target.value)}
                          style={{ fontSize: "0.8125rem" }}
                          disabled={isPackagingLine}
                          title={isPackagingLine ? "Auto from component's unit" : "Unit of measure"}
                        >
                          {!unitOptions.includes(line.unit) && line.unit && (
                            <option value={line.unit}>{line.unit} (legacy)</option>
                          )}
                          {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem", textAlign: "center", color: "#a8a29e", fontSize: "0.8125rem" }}>
                        {isPackagingLine ? "per" : <span style={{ color: "#e7e5e4" }}>—</span>}
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        {isPackagingLine ? (
                          <input
                            className="form-input"
                            type="number"
                            step="1"
                            placeholder="1"
                            value={line.consume_per_qty}
                            onChange={e => {
                              // Keep N constant when M changes — recompute the
                              // per-1-of-scope rate.
                              const newM = e.target.value;
                              const oldM = Number(line.consume_per_qty) || 1;
                              const N = (Number(line.qty_per_batch) || 0) * oldM;
                              const M = Number(newM) || 1;
                              updateLine(line._key, "consume_per_qty", newM);
                              updateLine(line._key, "qty_per_batch", newM === "" ? "" : String(N / M));
                            }}
                            style={{ fontSize: "0.8125rem", textAlign: "right" }}
                            title="M — denominator. &quot;1 cartridge per 8000 inners&quot; → 8000."
                          />
                        ) : (
                          <input
                            className="form-input"
                            type="number"
                            step="0.01"
                            placeholder={calcPct ?? "auto"}
                            value={line.percentage}
                            onChange={e => updateLine(line._key, "percentage", e.target.value)}
                            style={{ fontSize: "0.8125rem" }}
                            title="% of recipe"
                          />
                        )}
                        {!isPackagingLine && calcPct && !line.percentage && (
                          <div style={{ fontSize: "0.6875rem", color: "#a8a29e", marginTop: "0.125rem" }}>{calcPct}% calc</div>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        {isPackagingLine ? (
                          <select
                            className="form-select"
                            value={line.basis || ""}
                            onChange={e => updateLine(line._key, "basis", e.target.value)}
                            style={{ fontSize: "0.75rem" }}
                            title="What 1 unit of M counts"
                          >
                            <option value="">— pick —</option>
                            <option value="per_kg">kg of FG</option>
                            <option value="per_piece">unit (piece / log / sausage)</option>
                            <option value="per_inner">inner</option>
                            <option value="per_outer">outer</option>
                            <option value="per_pallet">pallet</option>
                          </select>
                        ) : (
                          <span style={{ color: "#a8a29e", fontSize: "0.7rem", fontStyle: "italic" }}>% of recipe</span>
                        )}
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        {isPackagingLine ? (
                          <span style={{ color: "#e7e5e4", fontSize: "0.75rem" }} title="Grind size is for ingredients only">—</span>
                        ) : (
                          <input
                            className="form-input"
                            placeholder="e.g. 8mm"
                            value={line.grind_size}
                            onChange={e => updateLine(line._key, "grind_size", e.target.value)}
                            style={{ fontSize: "0.8125rem" }}
                          />
                        )}
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem" }}>
                        <input
                          className="form-input"
                          placeholder="Optional note… (Tab → new line)"
                          value={line.comment}
                          onChange={e => updateLine(line._key, "comment", e.target.value)}
                          style={{ fontSize: "0.8125rem" }}
                          onKeyDown={e => {
                            // Tab on the last field → add a new ingredient line and focus its component input
                            if (e.key === "Tab" && !e.shiftKey) {
                              // Only intercept if this is the last line
                              if (index === lines.length - 1) {
                                e.preventDefault();
                                addLine();
                                // Wait for React to render the new row, then focus its component input
                                setTimeout(() => {
                                  requestAnimationFrame(() => {
                                    const inputs = document.querySelectorAll<HTMLInputElement>(
                                      "[data-component-search]"
                                    );
                                    if (inputs.length > 0) {
                                      inputs[inputs.length - 1].focus();
                                    }
                                  });
                                }, 50);
                              }
                            }
                          }}
                        />
                      </td>
                      <td style={{ padding: "0.5rem 0.375rem", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => removeLine(line._key)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: "1rem", padding: "0.125rem 0.25rem", lineHeight: 1 }}
                          title="Remove ingredient"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Actions — sticky so they're always visible at the bottom of the modal.
          The negative-margin trick + extended background covers any table-row
          bleed that sneaks under the sticky bar when the modal is short. */}
      <div style={{
        position: "sticky",
        bottom: 0,
        background: "#f8f7f5",
        padding: "1rem 0 1.25rem",
        marginTop: "0.5rem",
        marginLeft: "-1.5rem",
        marginRight: "-1.5rem",
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        borderTop: "1px solid #e7e5e4",
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        zIndex: 5,
        boxShadow: "0 -8px 16px -8px rgba(0,0,0,0.08)",
      }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Saving…" : mode === "create" ? "Create BOM" : "Save Changes"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={saving}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              fontWeight: 600,              fontSize: "0.875rem",
              cursor: "pointer",
              border: approvedAt ? "1px solid #166534" : "1px solid #16a34a",
              background: approvedAt ? "#f0fdf4" : "#16a34a",
              color: approvedAt ? "#166534" : "#fff",
            }}
          >
            {approvedAt ? "Approved - click to unapprove" : "Approve BOM"}
          </button>
        )}
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        ) : (
          <Link href={selectedItem ? `/items/${selectedItem.id}` : "/bom"} className="btn-secondary">Cancel</Link>
        )}
      </div>

      {/* Quick-create item modal */}
      {quickCreate && (
        <QuickCreateModal
          prefill={quickCreate.prefill}
          onClose={() => setQuickCreate(null)}
          onCreated={(newItem) => {
            setBomComponentItems(prev => ({ ...prev, [newItem.id]: newItem }));
            if (quickCreate.target === "header") {
              setItemId(newItem.id);
              setItemSearch("");
              setQuickCreate(null);
            } else {
              const targetKey = quickCreate.target as number;
              updateLine(targetKey, "component_item_id", newItem.id);
              updateLine(targetKey, "unit", newItem.unit);
              setComponentSearch(prev => {
                const n = { ...prev };
                delete n[targetKey];
                return n;
              });
              setQuickCreate(null);
              setTimeout(() => {
                const row = document.querySelector<HTMLInputElement>(
                  `[data-line-key="${targetKey}"]`
                )?.closest("tr");
                if (row) {
                  const qtyInput = row.querySelectorAll<HTMLInputElement>("input[type='number']")[0];
                  if (qtyInput) qtyInput.focus();
                }
              }, 50);
            }
          }}
        />
      )}
    </div>
  );
}
