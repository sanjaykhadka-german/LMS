"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";

type Category = { id: string; name: string; description: string | null; color: string | null; sort_order: number | null; is_active: boolean };
type Subcat = { id: string; category_id: string | null; name: string; description: string | null; sort_order: number | null; is_active: boolean };
type ImportFlag = { name: string; reason: string; include: boolean };
type CatImportRow = { name: string; description?: string; color?: string; sort_order?: number };
type CatImportFlag = { row: CatImportRow; reason: string; include: boolean };

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function isSimilar(a: string, b: string): boolean {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al === bl) return true;
  if (al.includes(bl) || bl.includes(al)) return true;
  return levenshtein(al, bl) <= 2;
}

const COLORS = [
  "#ef4444","#b91c1c","#7f1d1d",
  "#f97316","#c2410c","#ea580c",
  "#f59e0b","#b45309","#ca8a04",
  "#22c55e","#15803d","#166534",
  "#14b8a6","#0d9488","#06b6d4",
  "#3b82f6","#0369a1","#1e40af",
  "#8b5cf6","#6d28d9","#a855f7",
  "#ec4899","#be185d","#f43f5e",
  "#6b7280","#374151","#1c1917",
];
const BLANK_CAT = { name: "", description: "", color: COLORS[0], sort_order: "", is_active: true };
const BLANK_SUB = { name: "", description: "", sort_order: "" };

const SCROLL_ZONE = 90;
const SCROLL_MAX  = 14;

export default function ItemCategoriesManager({
  initialCategories,
  initialSubcategories,
}: {
  initialCategories: Category[];
  initialSubcategories: Subcat[];
}) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const catFileRef = useRef<HTMLInputElement>(null);

  // ── Categories state ──────────────────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [catForm, setCatForm] = useState(BLANK_CAT);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  // ── Subcategories state ───────────────────────────────────────────────────
  const [subcats, setSubcats] = useState<Subcat[]>(initialSubcategories);
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [editSubId, setEditSubId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState(BLANK_SUB);
  const [subSaving, setSubSaving] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Subcat import state ───────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importFlags, setImportFlags] = useState<ImportFlag[]>([]);
  const [pendingImport, setPendingImport] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // ── Category import state ─────────────────────────────────────────────────
  const [catImporting, setCatImporting] = useState(false);
  const [catImportFlags, setCatImportFlags] = useState<CatImportFlag[]>([]);
  const [catPendingImport, setCatPendingImport] = useState<CatImportRow[]>([]);
  const [catImportError, setCatImportError] = useState<string | null>(null);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [draggingIds, setDraggingIds] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const scrollRAF = useRef<number | null>(null);
  const dragY = useRef<number>(0);

  // ── Tap-to-assign state ───────────────────────────────────────────────────
  const [assigningSubcatId, setAssigningSubcatId] = useState<string | null>(null);

  const setC = (k: string, v: unknown) => setCatForm(f => ({ ...f, [k]: v }));
  const setS = (k: string, v: unknown) => setSubForm(f => ({ ...f, [k]: v }));

  const getTenantId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: p } = await supabase.from("profiles").select("tenant_id").eq("id", user!.id).single();
    return p!.tenant_id as string;
  };

  // ── Edge-scroll RAF loop ──────────────────────────────────────────────────
  const startScrollLoop = () => {
    const tick = () => {
      const y = dragY.current;
      const vh = window.innerHeight;
      if (y < SCROLL_ZONE) {
        window.scrollBy({ top: -(SCROLL_MAX * (1 - y / SCROLL_ZONE)), behavior: "instant" });
      } else if (y > vh - SCROLL_ZONE) {
        window.scrollBy({ top: SCROLL_MAX * (1 - (vh - y) / SCROLL_ZONE), behavior: "instant" });
      }
      scrollRAF.current = requestAnimationFrame(tick);
    };
    scrollRAF.current = requestAnimationFrame(tick);
  };

  const stopScrollLoop = () => {
    if (scrollRAF.current !== null) { cancelAnimationFrame(scrollRAF.current); scrollRAF.current = null; }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setAssigningSubcatId(null);
  };

  const selectAll = () => {
    const unassigned = subcats.filter(s => s.category_id === null);
    setSelectedIds(new Set(unassigned.map(s => s.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Category CRUD ─────────────────────────────────────────────────────────
  const startEditCat = (c: Category) => {
    setEditCatId(c.id);
    setCatForm({ name: c.name, description: c.description ?? "", color: c.color ?? COLORS[0], sort_order: String(c.sort_order ?? ""), is_active: c.is_active });
    setCatError(null);
  };
  const cancelEditCat = () => { setEditCatId(null); setCatForm(BLANK_CAT); setCatError(null); };

  const handleSaveCat = async () => {
    if (!catForm.name.trim()) { setCatError("Name is required"); return; }
    setCatSaving(true); setCatError(null);
    const payload = {
      name: catForm.name.trim(),
      description: catForm.description.trim() || null,
      color: catForm.color || null,
      sort_order: catForm.sort_order !== "" ? Number(catForm.sort_order) : 0,
      is_active: catForm.is_active,
    };
    if (editCatId) {
      const { error: e } = await supabase.from("item_categories").update(payload).eq("id", editCatId);
      if (e) { setCatError(e.message); setCatSaving(false); return; }
      setCategories(prev => prev.map(c => c.id === editCatId ? { ...c, ...payload } : c));
      cancelEditCat();
    } else {
      const tenantId = await getTenantId();
      const { data, error: e } = await supabase.from("item_categories").insert({ ...payload, tenant_id: tenantId }).select("id, name, description, color, sort_order, is_active").single();
      if (e || !data) { setCatError(e?.message ?? "Failed"); setCatSaving(false); return; }
      setCategories(prev => [...prev, data as Category]);
      setCatForm(BLANK_CAT);
    }
    setCatSaving(false);
  };

  const handleToggleCat = async (c: Category) => {
    const { error: e } = await supabase.from("item_categories").update({ is_active: !c.is_active }).eq("id", c.id);
    if (!e) setCategories(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x));
  };

  // ── Subcategory CRUD ──────────────────────────────────────────────────────
  const startAddSub = (categoryId: string) => {
    setAddingSubFor(categoryId); setEditSubId(null);
    setSubForm(BLANK_SUB); setSubError(null);
    setExpandedCatId(categoryId);
  };

  const startEditSub = (s: Subcat) => {
    setEditSubId(s.id); setAddingSubFor(null);
    setSubForm({ name: s.name, description: s.description ?? "", sort_order: String(s.sort_order ?? "") });
    setSubError(null);
    if (s.category_id) setExpandedCatId(s.category_id);
  };

  const cancelSub = () => { setAddingSubFor(null); setEditSubId(null); setSubForm(BLANK_SUB); setSubError(null); };

  const handleSaveSub = async (categoryId: string | null) => {
    if (!subForm.name.trim()) { setSubError("Name is required"); return; }
    setSubSaving(true); setSubError(null);
    const payload = {
      name: subForm.name.trim(),
      description: subForm.description.trim() || null,
      sort_order: subForm.sort_order !== "" ? Number(subForm.sort_order) : 0,
    };
    if (editSubId) {
      const { error: e } = await supabase.from("item_subcategories").update(payload).eq("id", editSubId);
      if (e) { setSubError(e.message); setSubSaving(false); return; }
      setSubcats(prev => prev.map(s => s.id === editSubId ? { ...s, ...payload } : s));
      cancelSub();
    } else {
      const tenantId = await getTenantId();
      const { data, error: e } = await supabase
        .from("item_subcategories")
        .insert({ ...payload, category_id: categoryId, tenant_id: tenantId })
        .select("id, category_id, name, description, sort_order, is_active")
        .single();
      if (e || !data) { setSubError(e?.message ?? "Failed"); setSubSaving(false); return; }
      setSubcats(prev => [...prev, data as Subcat]);
      setSubForm(BLANK_SUB); setAddingSubFor(null);
    }
    setSubSaving(false);
  };

  const handleToggleSub = async (s: Subcat) => {
    const { error: e } = await supabase.from("item_subcategories").update({ is_active: !s.is_active }).eq("id", s.id);
    if (!e) setSubcats(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !s.is_active } : x));
  };

  // ── Batch assign (tap-to-assign + multi-select) ────────────────────────────
  const handleAssignSubcat = async (triggerSubcatId: string, categoryId: string) => {
    // If the trigger chip is selected, assign all selected chips together;
    // otherwise just assign the one that was tapped.
    const ids = selectedIds.has(triggerSubcatId)
      ? Array.from(selectedIds)
      : [triggerSubcatId];

    const { error: e } = await supabase
      .from("item_subcategories")
      .update({ category_id: categoryId })
      .in("id", ids);

    if (!e) {
      const idSet = new Set(ids);
      setSubcats(prev => prev.map(s => idSet.has(s.id) ? { ...s, category_id: categoryId } : s));
      setExpandedCatId(categoryId);
      setSelectedIds(new Set());
    }
    setAssigningSubcatId(null);
  };

  // Close assign picker when clicking outside
  useEffect(() => {
    if (!assigningSubcatId) return;
    const close = () => setAssigningSubcatId(null);
    window.addEventListener("click", close, { capture: true, once: true });
    return () => window.removeEventListener("click", close, { capture: true });
  }, [assigningSubcatId]);

  // ── Import subcategories ──────────────────────────────────────────────────
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportError(null);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
      const names: string[] = rows
        .map(r => String(r.name ?? r.Name ?? Object.values(r)[0] ?? "").trim())
        .filter(Boolean);

      if (names.length === 0) {
        setImportError("No names found. Make sure your file has a 'name' column.");
        setImporting(false);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }

      const existingNames = subcats.map(s => s.name);
      const clean: string[] = [];
      const flags: ImportFlag[] = [];
      for (const name of names) {
        const exactMatch = existingNames.find(n => n.toLowerCase() === name.toLowerCase());
        if (exactMatch) { flags.push({ name, reason: `Exact duplicate of "${exactMatch}"`, include: false }); continue; }
        const similar = existingNames.find(n => isSimilar(n, name) && n.toLowerCase() !== name.toLowerCase());
        if (similar) { flags.push({ name, reason: `Similar to existing subcategory "${similar}"`, include: true }); }
        else { clean.push(name); }
      }

      if (flags.length > 0) { setImportFlags(flags); setPendingImport(clean); }
      else { await doImport(clean, []); }
    } catch (err) {
      setImportError(String(err));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async (cleanNames: string[], confirmedFlags: ImportFlag[]) => {
    const toImport = [...cleanNames, ...confirmedFlags.filter(f => f.include).map(f => f.name)];
    if (toImport.length === 0) { setImportFlags([]); setPendingImport([]); return; }
    const tenantId = await getTenantId();
    const inserts = toImport.map(name => ({ name, category_id: null, tenant_id: tenantId, sort_order: 0, is_active: true }));
    const { data, error: e } = await supabase.from("item_subcategories").insert(inserts).select("id, category_id, name, description, sort_order, is_active");
    if (e) { setImportError(e.message); return; }
    setSubcats(prev => [...prev, ...(data as Subcat[])]);
    setImportFlags([]); setPendingImport([]);
  };

  // ── Import categories ─────────────────────────────────────────────────────
  const handleImportCatsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCatImporting(true); setCatImportError(null);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });

      const parsed: CatImportRow[] = rows
        .map(r => {
          const name = String(r.name ?? r.Name ?? Object.values(r)[0] ?? "").trim();
          if (!name) return null;
          const description = String(r.description ?? r.Description ?? "").trim() || undefined;
          const color = String(r.color ?? r.Color ?? r.colour ?? r.Colour ?? "").trim() || undefined;
          const sortRaw = r.sort_order ?? r["Sort Order"] ?? r.sort ?? "";
          const sort_order = sortRaw !== "" && !isNaN(Number(sortRaw)) ? Number(sortRaw) : undefined;
          return { name, description, color, sort_order } as CatImportRow;
        })
        .filter((r): r is CatImportRow => r !== null);

      if (parsed.length === 0) {
        setCatImportError("No names found. Make sure your file has a 'name' column.");
        setCatImporting(false);
        if (catFileRef.current) catFileRef.current.value = "";
        return;
      }

      const existingNames = categories.map(c => c.name);
      const clean: CatImportRow[] = [];
      const flags: CatImportFlag[] = [];
      for (const row of parsed) {
        const exactMatch = existingNames.find(n => n.toLowerCase() === row.name.toLowerCase());
        if (exactMatch) { flags.push({ row, reason: `Exact duplicate of "${exactMatch}"`, include: false }); continue; }
        const similar = existingNames.find(n => isSimilar(n, row.name) && n.toLowerCase() !== row.name.toLowerCase());
        if (similar) { flags.push({ row, reason: `Similar to existing category "${similar}"`, include: true }); }
        else { clean.push(row); }
      }

      if (flags.length > 0) { setCatImportFlags(flags); setCatPendingImport(clean); }
      else { await doImportCats(clean, []); }
    } catch (err) {
      setCatImportError(String(err));
    } finally {
      setCatImporting(false);
      if (catFileRef.current) catFileRef.current.value = "";
    }
  };

  const doImportCats = async (cleanRows: CatImportRow[], confirmedFlags: CatImportFlag[]) => {
    const toImport = [...cleanRows, ...confirmedFlags.filter(f => f.include).map(f => f.row)];
    if (toImport.length === 0) { setCatImportFlags([]); setCatPendingImport([]); return; }
    const tenantId = await getTenantId();
    const inserts = toImport.map((row, i) => ({
      name: row.name,
      description: row.description ?? null,
      color: row.color ?? COLORS[0],
      sort_order: row.sort_order ?? i,
      is_active: true,
      tenant_id: tenantId,
    }));
    const { data, error: e } = await supabase
      .from("item_categories")
      .insert(inserts)
      .select("id, name, description, color, sort_order, is_active");
    if (e) { setCatImportError(e.message); return; }
    setCategories(prev => [...prev, ...(data as Category[])]);
    setCatImportFlags([]); setCatPendingImport([]);
  };

  // ── Template downloads ────────────────────────────────────────────────────
  const downloadCatTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "description", "color", "sort_order"],
      ["Meat", "Fresh and cured meat products", "#ef4444", 1],
      ["Dairy", "Milk, cream and cheese products", "#3b82f6", 2],
      ["Packaging", "Bags, labels and wrapping materials", "#8b5cf6", 3],
    ]);
    ws["!cols"] = [{ wch: 24 }, { wch: 40 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Categories");
    XLSX.writeFile(wb, "categories_import_template.xlsx");
  };

  const downloadSubcatTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "description"],
      ["Beef", "All beef cuts and products"],
      ["Pork", "All pork cuts and products"],
      ["Smallgoods", "Salami, bacon and smallgoods"],
    ]);
    ws["!cols"] = [{ wch: 24 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Subcategories");
    XLSX.writeFile(wb, "subcategories_import_template.xlsx");
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (subcatId: string) => {
    // If dragging a selected chip → drag the whole selection; otherwise just this chip
    const ids = selectedIds.has(subcatId) ? new Set(selectedIds) : new Set([subcatId]);
    setDraggingIds(ids);
    startScrollLoop();
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    dragY.current = e.clientY;
    setDropTargetId(targetId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropTargetId(null);
    }
  };

  const handleDragEnd = () => {
    stopScrollLoop();
    setDraggingIds(new Set());
    setDropTargetId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetCategoryId: string | null) => {
    e.preventDefault();
    stopScrollLoop();
    setDropTargetId(null);
    if (draggingIds.size === 0) return;

    const ids = Array.from(draggingIds);
    const { error: e2 } = await supabase
      .from("item_subcategories")
      .update({ category_id: targetCategoryId })
      .in("id", ids);

    if (!e2) {
      const idSet = new Set(ids);
      setSubcats(prev => prev.map(s => idSet.has(s.id) ? { ...s, category_id: targetCategoryId } : s));
      if (targetCategoryId) setExpandedCatId(targetCategoryId);
      setSelectedIds(new Set()); // clear selection after move
    }
    setDraggingIds(new Set());
  };

  const unassignedSubcats = subcats.filter(s => s.category_id === null);
  const activeCategories = categories.filter(c => c.is_active);
  const selectionCount = selectedIds.size;
  const dropLabel = draggingIds.size > 1 ? `Drop ${draggingIds.size} subcategories here` : "Drop here";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem", alignItems: "start" }}>

      {/* Left column */}
      <div>
        {/* Categories card */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, flex: 1 }}>Categories ({categories.length})</h2>
            <button onClick={downloadCatTemplate} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>↓ Cat Template</button>
            <label style={{ cursor: "pointer", display: "inline-block" }}>
              <span className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer" }}>↑ Import Cats</span>
              <input ref={catFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportCatsFile} disabled={catImporting} style={{ display: "none" }} />
            </label>
            <button onClick={downloadSubcatTemplate} className="btn-secondary" style={{ fontSize: "0.8125rem" }}>↓ Subcat Template</button>
            <label style={{ cursor: "pointer", display: "inline-block" }}>
              <span className="btn-secondary" style={{ fontSize: "0.8125rem", cursor: "pointer" }}>↑ Import Subcats</span>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} disabled={importing} style={{ display: "none" }} />
            </label>
          </div>

          {catImporting && <div style={{ padding: "0.5rem 1.25rem", fontSize: "0.8125rem", color: "#78716c" }}>Reading file…</div>}
          {catImportError && <div style={{ padding: "0.5rem 1.25rem", fontSize: "0.8125rem", color: "#dc2626" }}>{catImportError}</div>}
          {importing && <div style={{ padding: "0.5rem 1.25rem", fontSize: "0.8125rem", color: "#78716c" }}>Reading file…</div>}
          {importError && <div style={{ padding: "0.5rem 1.25rem", fontSize: "0.8125rem", color: "#dc2626" }}>{importError}</div>}

          {categories.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>No categories yet. Add one →</div>
          ) : (
            <div>
              {categories.map(c => {
                const catSubcats = subcats.filter(s => s.category_id === c.id);
                const isExpanded = expandedCatId === c.id;
                const isDropTarget = dropTargetId === c.id;
                return (
                  <div key={c.id} style={{ borderBottom: "1px solid #f5f5f4" }}
                    onDragOver={e => handleDragOver(e, c.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, c.id)}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 1rem",
                      opacity: c.is_active ? 1 : 0.55,
                      background: isDropTarget ? "#f0fdf4" : "transparent",
                      outline: isDropTarget ? "2px dashed #86efac" : "none",
                      outlineOffset: "-2px", transition: "background 0.1s",
                    }}>
                      <button type="button" onClick={() => setExpandedCatId(isExpanded ? null : c.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#78716c", fontSize: "0.75rem", padding: "0.125rem 0.25rem", flexShrink: 0 }}>
                        {isExpanded ? "▾" : "▸"}
                      </button>
                      {c.color && <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: c.color, flexShrink: 0 }} />}
                      <span style={{ fontWeight: 600, flex: 1 }}>{c.name}</span>
                      {isDropTarget
                        ? <span style={{ fontSize: "0.75rem", color: "#15803d", fontStyle: "italic" }}>{dropLabel}</span>
                        : <span style={{ fontSize: "0.75rem", color: "#a8a29e" }}>{catSubcats.length} sub{catSubcats.length !== 1 ? "cats" : "cat"}</span>
                      }
                      <span className={`badge ${c.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.6875rem" }}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                      <button onClick={() => startEditCat(c)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>Edit</button>
                      <button onClick={() => handleToggleCat(c)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}>
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => startAddSub(c.id)} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "#15803d", borderColor: "#86efac" }}>
                        + Subcat
                      </button>
                    </div>

                    {isExpanded && (
                      <div style={{ background: "#fafaf9", borderTop: "1px solid #f5f5f4" }}>
                        {catSubcats.length === 0 && addingSubFor !== c.id && (
                          <div style={{ padding: "0.5rem 1rem 0.5rem 2.5rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
                            No subcategories yet — click "+ Subcat" or drag one here.
                          </div>
                        )}
                        {catSubcats.map(s => (
                          <div key={s.id}>
                            {editSubId === s.id ? (
                              <div style={{ padding: "0.5rem 1rem 0.5rem 2.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                                <input className="form-input" value={subForm.name} onChange={e => setS("name", e.target.value)} placeholder="Subcategory name" style={{ fontSize: "0.8125rem", flex: 1, minWidth: 150 }} />
                                <input className="form-input" value={subForm.description} onChange={e => setS("description", e.target.value)} placeholder="Description (optional)" style={{ fontSize: "0.8125rem", flex: 2, minWidth: 150 }} />
                                <button onClick={() => handleSaveSub(s.category_id)} disabled={subSaving} className="btn-primary" style={{ fontSize: "0.75rem" }}>Save</button>
                                <button onClick={cancelSub} className="btn-secondary" style={{ fontSize: "0.75rem" }}>Cancel</button>
                                {subError && <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>{subError}</span>}
                              </div>
                            ) : (
                              <div draggable onDragStart={() => handleDragStart(s.id)} onDragEnd={handleDragEnd}
                                style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 1rem 0.375rem 2.5rem", opacity: s.is_active ? 1 : 0.5, cursor: "grab" }}>
                                <span style={{ color: "#c4b5a8", fontSize: "0.875rem", userSelect: "none" }}>⠿</span>
                                <span style={{ fontSize: "0.8125rem", flex: 1, color: "#57534e" }}>— {s.name}</span>
                                {s.description && <span style={{ fontSize: "0.75rem", color: "#a8a29e" }}>{s.description}</span>}
                                <span className={`badge ${s.is_active ? "badge-green" : "badge-gray"}`} style={{ fontSize: "0.625rem" }}>
                                  {s.is_active ? "Active" : "Inactive"}
                                </span>
                                <button onClick={() => startEditSub(s)} className="btn-secondary" style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem" }}>Edit</button>
                                <button onClick={() => handleToggleSub(s)} className="btn-secondary" style={{ fontSize: "0.6875rem", padding: "0.125rem 0.375rem" }}>
                                  {s.is_active ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                        {addingSubFor === c.id && (
                          <div style={{ padding: "0.5rem 1rem 0.5rem 2.5rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            <input className="form-input" value={subForm.name} onChange={e => setS("name", e.target.value)} placeholder="Subcategory name *" style={{ fontSize: "0.8125rem", flex: 1, minWidth: 150 }} autoFocus />
                            <input className="form-input" value={subForm.description} onChange={e => setS("description", e.target.value)} placeholder="Description (optional)" style={{ fontSize: "0.8125rem", flex: 2, minWidth: 150 }} />
                            <button onClick={() => handleSaveSub(c.id)} disabled={subSaving} className="btn-primary" style={{ fontSize: "0.75rem" }}>{subSaving ? "Saving…" : "Add"}</button>
                            <button onClick={cancelSub} className="btn-secondary" style={{ fontSize: "0.75rem" }}>Cancel</button>
                            {subError && <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>{subError}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unassigned subcategories holding area */}
        <div className="card" style={{
          padding: 0, marginTop: "1rem",
          outline: dropTargetId === "__unassigned__" ? "2px dashed #f59e0b" : "none",
          outlineOffset: "-2px",
        }}
          onDragOver={e => handleDragOver(e, "__unassigned__")}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, null)}
        >
          <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid #e7e5e4", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, flex: 1 }}>
              Unassigned Subcategories
              {unassignedSubcats.length > 0 && (
                <span style={{ marginLeft: "0.5rem", background: "#fef3c7", color: "#92400e", borderRadius: "9999px", padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}>
                  {unassignedSubcats.length}
                </span>
              )}
            </h2>
            {/* Selection controls */}
            {unassignedSubcats.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {selectionCount > 0 ? (
                  <>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#0369a1", background: "#e0f2fe", borderRadius: "9999px", padding: "0.15rem 0.5rem" }}>
                      {selectionCount} selected
                    </span>
                    <button onClick={clearSelection} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#78716c", padding: 0 }}>
                      Clear
                    </button>
                  </>
                ) : (
                  <button onClick={selectAll} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: "#0369a1", padding: 0 }}>
                    Select all
                  </button>
                )}
              </div>
            )}
            {selectionCount === 0 && <span style={{ fontSize: "0.75rem", color: "#a8a29e" }}>Drag or tap → to assign</span>}
          </div>

          {unassignedSubcats.length === 0 ? (
            <div style={{ padding: "1.25rem", textAlign: "center", color: "#a8a29e", fontSize: "0.875rem" }}>
              {dropTargetId === "__unassigned__" ? "Drop here to unassign" : "No unassigned subcategories"}
            </div>
          ) : (
            <div style={{ padding: "0.75rem 1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {unassignedSubcats.map(s => {
                const isSelected = selectedIds.has(s.id);
                return (
                  <div key={s.id} style={{ position: "relative" }}>
                    {/* Chip */}
                    <div
                      draggable
                      onDragStart={() => handleDragStart(s.id)}
                      onDragEnd={handleDragEnd}
                      onClick={e => toggleSelect(s.id, e)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "0.375rem",
                        padding: "0.3rem 0.5rem 0.3rem 0.625rem", borderRadius: "9999px",
                        background: isSelected ? "#e0f2fe" : "#f5f5f4",
                        border: isSelected ? "1.5px solid #38bdf8" : "1px solid #e7e5e4",
                        fontSize: "0.8125rem", cursor: "pointer",
                        opacity: s.is_active ? 1 : 0.5, userSelect: "none",
                        transition: "background 0.1s, border-color 0.1s",
                      }}
                    >
                      {/* Checkmark when selected, drag handle when not */}
                      {isSelected
                        ? <span style={{ color: "#0369a1", fontSize: "0.75rem", fontWeight: 700 }}>✓</span>
                        : <span style={{ color: "#c4b5a8", fontSize: "0.75rem" }}>⠿</span>
                      }
                      <span style={{ color: isSelected ? "#0c4a6e" : "#374151" }}>{s.name}</span>
                      {/* Assign button */}
                      <button
                        onClick={e => { e.stopPropagation(); setAssigningSubcatId(assigningSubcatId === s.id ? null : s.id); }}
                        title={isSelected && selectionCount > 1 ? `Assign all ${selectionCount} selected` : "Assign to a category"}
                        style={{
                          background: isSelected ? "#bae6fd" : "#e7e5e4",
                          border: "none", borderRadius: "9999px",
                          cursor: "pointer", padding: "0.1rem 0.4rem",
                          fontSize: "0.7rem", fontWeight: 700,
                          color: isSelected ? "#0369a1" : "#57534e",
                          lineHeight: 1.4, marginLeft: "0.125rem",
                        }}
                      >
                        {isSelected && selectionCount > 1 ? `→ ${selectionCount}` : "→"}
                      </button>
                      <button onClick={e => { e.stopPropagation(); startEditSub(s); }} title="Edit"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#a8a29e", fontSize: "0.7rem", padding: "0 0.125rem", lineHeight: 1 }}>
                        ✎
                      </button>
                    </div>

                    {/* Category picker popover */}
                    {assigningSubcatId === s.id && (
                      <div onClick={e => e.stopPropagation()} style={{
                        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
                        background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.625rem",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "0.375rem",
                        minWidth: "200px",
                      }}>
                        <div style={{ padding: "0.25rem 0.5rem 0.375rem", fontSize: "0.6875rem", fontWeight: 600, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {isSelected && selectionCount > 1 ? `Assign ${selectionCount} subcategories to` : "Assign to category"}
                        </div>
                        {activeCategories.length === 0 && (
                          <div style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem", color: "#a8a29e" }}>No active categories</div>
                        )}
                        {activeCategories.map(c => (
                          <button key={c.id} onClick={() => handleAssignSubcat(s.id, c.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: "0.5rem", width: "100%",
                              padding: "0.5rem 0.625rem", borderRadius: "0.375rem", border: "none",
                              background: "transparent", cursor: "pointer", textAlign: "left",
                              fontSize: "0.875rem", color: "#1c1917",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            {c.color && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.color, flexShrink: 0, display: "inline-block" }} />}
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right column: category add/edit form */}
      <div className="card">
        <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 600 }}>{editCatId ? "Edit Category" : "Add Category"}</h2>
        {catError && (
          <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", fontSize: "0.875rem", color: "#991b1b" }}>
            {catError}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label className="form-label">Name *</label>
            <input className="form-input" value={catForm.name} onChange={e => setC("name", e.target.value)} placeholder="e.g. Ingredients" />
          </div>
          <div>
            <label className="form-label">Description</label>
            <textarea className="form-input" rows={2} value={catForm.description} onChange={e => setC("description", e.target.value)} placeholder="Optional…" style={{ resize: "vertical" }} />
          </div>
          <div>
            <label className="form-label">Colour</label>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.25rem", alignItems: "center" }}>
              {COLORS.map(col => (
                <button key={col} type="button" onClick={() => setC("color", col)} title={col} style={{
                  width: "22px", height: "22px", borderRadius: "50%", background: col, flexShrink: 0, cursor: "pointer",
                  border: catForm.color === col ? "3px solid #1c1917" : "2px solid transparent",
                  outline: catForm.color === col ? "2px solid white" : "none", outlineOffset: "-3px",
                }} />
              ))}
              <label title="Pick a custom colour" style={{
                position: "relative", overflow: "hidden", cursor: "pointer", flexShrink: 0,
                display: "inline-flex", alignItems: "center", gap: "0.3rem",
                padding: "0.2rem 0.6rem", borderRadius: "9999px",
                border: !COLORS.includes(catForm.color ?? "") ? "2px solid #1c1917" : "1px solid #d4d4d4",
                background: !COLORS.includes(catForm.color ?? "") ? catForm.color ?? "#fff" : "#f5f5f4",
                color: !COLORS.includes(catForm.color ?? "") ? "#fff" : "#374151",
                fontSize: "0.75rem", fontWeight: 500,
              }}>
                <span style={{ fontSize: "0.875rem" }}>🎨</span>
                More colours
                <input type="color" value={catForm.color ?? "#6b7280"} onChange={e => setC("color", e.target.value)}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
              </label>
            </div>
          </div>
          <div>
            <label className="form-label">Sort Order</label>
            <input className="form-input" type="number" min="0" value={catForm.sort_order} onChange={e => setC("sort_order", e.target.value)} placeholder="0" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" id="cat_active" checked={catForm.is_active} onChange={e => setC("is_active", e.target.checked)} style={{ width: "1rem", height: "1rem" }} />
            <label htmlFor="cat_active" style={{ fontSize: "0.875rem", cursor: "pointer" }}>Active</label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button onClick={handleSaveCat} disabled={catSaving} className="btn-primary" style={{ flex: 1 }}>
              {catSaving ? "Saving…" : editCatId ? "Save Changes" : "Add Category"}
            </button>
            {editCatId && <button onClick={cancelEditCat} className="btn-secondary">Cancel</button>}
          </div>
        </div>
      </div>

      {/* Category import confirmation modal */}
      {catImportFlags.length > 0 && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "min(520px, 90vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e7e5e4" }}>
              <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600 }}>Review Before Importing Categories</h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#78716c" }}>
                {catPendingImport.length} categor{catPendingImport.length !== 1 ? "ies" : "y"} ready to import.
                The items below may be duplicates or similar to existing categories — tick any you still want to include.
              </p>
            </div>
            <div style={{ overflowY: "auto", padding: "0.75rem 1.5rem", flex: 1 }}>
              {catImportFlags.map((flag, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem", padding: "0.625rem 0", borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}>
                  <input type="checkbox" checked={flag.include}
                    onChange={ev => setCatImportFlags(prev => prev.map((f, j) => j === i ? { ...f, include: ev.target.checked } : f))}
                    style={{ marginTop: "0.2rem", width: "1rem", height: "1rem", flexShrink: 0 }} />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {flag.row.color && <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: flag.row.color, flexShrink: 0, display: "inline-block" }} />}
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{flag.row.name}</span>
                    </div>
                    {flag.row.description && <div style={{ fontSize: "0.75rem", color: "#57534e", marginTop: "0.1rem" }}>{flag.row.description}</div>}
                    <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{flag.reason}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setCatImportFlags([]); setCatPendingImport([]); }} className="btn-secondary">Cancel</button>
              <button onClick={async () => { await doImportCats(catPendingImport, catImportFlags); }} className="btn-primary">
                Import {catPendingImport.length + catImportFlags.filter(f => f.include).length} categor
                {(catPendingImport.length + catImportFlags.filter(f => f.include).length) !== 1 ? "ies" : "y"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subcat import confirmation modal */}
      {importFlags.length > 0 && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "min(520px, 90vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e7e5e4" }}>
              <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 600 }}>Review Before Importing Subcategories</h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#78716c" }}>
                {pendingImport.length} subcategor{pendingImport.length !== 1 ? "ies" : "y"} ready to import.
                The items below may be duplicates or similar to existing subcategories — tick any you still want to include.
              </p>
            </div>
            <div style={{ overflowY: "auto", padding: "0.75rem 1.5rem", flex: 1 }}>
              {importFlags.map((flag, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem", padding: "0.625rem 0", borderBottom: "1px solid #f5f5f4", cursor: "pointer" }}>
                  <input type="checkbox" checked={flag.include}
                    onChange={ev => setImportFlags(prev => prev.map((f, j) => j === i ? { ...f, include: ev.target.checked } : f))}
                    style={{ marginTop: "0.2rem", width: "1rem", height: "1rem", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{flag.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#78716c", marginTop: "0.125rem" }}>{flag.reason}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid #e7e5e4", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => { setImportFlags([]); setPendingImport([]); }} className="btn-secondary">Cancel</button>
              <button onClick={async () => { await doImport(pendingImport, importFlags); }} className="btn-primary">
                Import {pendingImport.length + importFlags.filter(f => f.include).length} subcategor
                {(pendingImport.length + importFlags.filter(f => f.include).length) !== 1 ? "ies" : "y"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
