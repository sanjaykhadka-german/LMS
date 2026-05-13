"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { SearchableSelect } from "@/components/searchable-select";
import {
  ITEM_TYPE_LABELS, PRODUCTION_METHOD_LABELS,
  type ItemType, type ItemTypeRow, type ProductionMethod, type WeightMode, type Item,
} from "@/lib/types";
import { TENANT_FULL_FETCH } from "@/lib/limits";

type AllergenDef = { code: string; name: string; regulatory_standard: string };
type Department = { id: string; name: string; code: string };
// Machines carry their room + department so the Item Master form can
// auto-fill those fields when the operator picks a machine. The links live
// on `machines.room_id` / `machines.department_id` and are resolved to
// names via Supabase joins in the page component.
type Machine = {
  id: string;
  name: string;
  code: string | null;
  room?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
};
type ItemCategory = { id: string; name: string; color: string | null };
type ItemSubcategory = { id: string; category_id: string; name: string };

interface Props {
  mode: "create" | "edit";
  initial?: Partial<Item>;
  /** When the form was opened via "Duplicate" on an existing item, this is
   *  the source item's "code — name" for display in a banner at the top.
   *  Null when creating from scratch. */
  duplicateSourceLabel?: string | null;
  allergenDefs?: AllergenDef[];
  departments?: Department[];
  machines?: Machine[];
  categories?: ItemCategory[];
  subcategories?: ItemSubcategory[];
  itemTypes?: ItemTypeRow[];
  /** Active units of measure from /settings/units-of-measure. Drives the
   *  Stock Unit + Batch Unit dropdowns so codes stay consistent across
   *  the system. Keeping this optional means existing call sites that
   *  don't (yet) pass it fall back to the previous free-text inputs. */
  uoms?: { code: string; name: string; category: string }[];
}

type FormState = {
  code: string; name: string; description: string;
  item_type: ItemType; parent_item_id: string;
  item_category_id: string;
  item_subcategory_id: string;
  production_method: string; department: string;
  machine: string; room: string; priority: string;
  unit: string; default_batch_size: string; batch_unit: string;
  weight_mode: WeightMode; target_weight_g: string; tare_weight_g: string;
  fill_weight_g: string; process_loss_pct: string;
  tolerance_over_g: string; tolerance_under_g: string;
  units_per_inner: string; units_per_outer: string; inner_per_outer: string;
  outers_per_pallet: string; units_per_pallet: string; giveaway_pct: string;
  /** Per-item loss buffers — pricing pads on top of COGS. NULL/empty → tenant
   *  default applies. Tino May 2026: production losses are per-product, not
   *  per-tenant; see mig 133. */
  production_loss_pct: string;
  cooking_loss_pct: string;
  packing_loss_pct: string;
  open_pack_pct: string;
  sell_price_per_inner: string; sell_price_per_kg: string;
  allergens: string[];
  min_stock: string; max_stock: string; is_make_to_order: boolean;
  spec_storage_temp: string; spec_shelf_life: string; spec_notes: string;
  spec_origin: string; spec_fat_content: string; spec_protein: string;
  spec_moisture: string; spec_ph: string; spec_water_activity: string;
  spec_micro: string; supplier: string; supplier_code: string;
  spec_weight_per_unit: string; spec_packaging: string; spec_labelling: string;
  min_shelf_life_days: string;
  is_rte: boolean;
  /** Tino May 2026: spec NIP suppresses serves per pack / serving size for
   *  whole-muscle products (hams, chorizo logs) where the per-serving
   *  breakdown is meaningless. Default false → show servings normally. */
  nip_large_item: boolean;
  ingredients_statement: string;
  is_active: boolean;
  procurement_type: 'purchase' | 'produce';
  // Packaging materials (text[])
  packaging_materials: string;   // comma-separated in form, parsed to array on save
  // Micro panel (structured)
  micro_tpc: string; micro_ecoli: string; micro_coliforms: string;
  micro_salmonella: string; micro_listeria: string; micro_s_aureus: string;
  micro_yeast_mould: string; micro_sulphite_clostridia: string;
  micro_reference: string;
  // Tax & accounting
  purchase_tax_code_id: string; sales_tax_code_id: string;
  purchase_account_code: string; sales_account_code: string;
  // Purchase UOM
  purchase_uom: string; purchase_uom_qty: string;
  purchase_uom_type: string; purchase_unit_price: string;
  purchase_currency: string;
  // Nutrition (per 100g + serving size)
  nut_energy_kj: string; nut_energy_kcal: string;
  nut_protein_g: string; nut_fat_total_g: string; nut_fat_saturated_g: string;
  nut_fat_trans_g: string; nut_carbs_total_g: string; nut_carbs_sugars_g: string;
  nut_fibre_g: string; nut_sodium_mg: string;
  nut_per_serving_g: string; nut_notes: string;
};

const DEFAULTS: FormState = {
  code: "", name: "", description: "", item_type: "raw_material", parent_item_id: "",
  item_category_id: "", item_subcategory_id: "",
  production_method: "", department: "", machine: "", room: "", priority: "5",
  unit: "kg", default_batch_size: "", batch_unit: "kg",
  weight_mode: "random", target_weight_g: "", tare_weight_g: "",
  fill_weight_g: "", process_loss_pct: "",
  tolerance_over_g: "", tolerance_under_g: "",
  units_per_inner: "", units_per_outer: "", inner_per_outer: "",
  outers_per_pallet: "", units_per_pallet: "", giveaway_pct: "",
  production_loss_pct: "", cooking_loss_pct: "", packing_loss_pct: "", open_pack_pct: "",
  sell_price_per_inner: "", sell_price_per_kg: "",
  allergens: [],
  min_stock: "0", max_stock: "0", is_make_to_order: false,
  spec_storage_temp: "", spec_shelf_life: "", spec_notes: "",
  spec_origin: "", spec_fat_content: "", spec_protein: "",
  spec_moisture: "", spec_ph: "", spec_water_activity: "",
  spec_micro: "", supplier: "", supplier_code: "",
  spec_weight_per_unit: "", spec_packaging: "", spec_labelling: "",
  min_shelf_life_days: "",
  is_rte: false, nip_large_item: false, ingredients_statement: "",
  is_active: true, procurement_type: "purchase",
  packaging_materials: "",
  micro_tpc: "", micro_ecoli: "", micro_coliforms: "",
  micro_salmonella: "", micro_listeria: "", micro_s_aureus: "",
  micro_yeast_mould: "", micro_sulphite_clostridia: "",
  micro_reference: "",
  purchase_tax_code_id: "", sales_tax_code_id: "",
  purchase_account_code: "", sales_account_code: "",
  purchase_uom: "", purchase_uom_qty: "",
  purchase_uom_type: "fixed", purchase_unit_price: "",
  purchase_currency: "AUD",
  nut_energy_kj: "", nut_energy_kcal: "",
  nut_protein_g: "", nut_fat_total_g: "", nut_fat_saturated_g: "",
  nut_fat_trans_g: "", nut_carbs_total_g: "", nut_carbs_sugars_g: "",
  nut_fibre_g: "", nut_sodium_mg: "",
  nut_per_serving_g: "", nut_notes: "",
};

// Standard micro tests rendered as a table.
const MICRO_TESTS: { key: keyof FormState; label: string; ph: string }[] = [
  { key: "micro_tpc",                 label: "Total Plate Count (TPC)",        ph: "e.g. <100,000 cfu/g" },
  { key: "micro_ecoli",               label: "E. coli",                        ph: "e.g. <10 cfu/g" },
  { key: "micro_coliforms",           label: "Coliforms",                      ph: "e.g. <100 cfu/g" },
  { key: "micro_salmonella",          label: "Salmonella",                     ph: "Not detected in 25 g" },
  { key: "micro_listeria",            label: "Listeria monocytogenes",         ph: "Not detected in 25 g" },
  { key: "micro_s_aureus",            label: "Staphylococcus aureus",          ph: "e.g. <100 cfu/g" },
  { key: "micro_yeast_mould",         label: "Yeasts & moulds",                ph: "e.g. <1,000 cfu/g" },
  { key: "micro_sulphite_clostridia", label: "Sulphite-reducing clostridia",   ph: "e.g. <30 cfu/g" },
];

// Nutrition rows rendered as an NIP-style table.
const NUTRITION_ROWS: { key: keyof FormState; label: string; unit: string; bold?: boolean }[] = [
  { key: "nut_protein_g",       label: "Protein",                   unit: "g",  bold: true },
  { key: "nut_fat_total_g",     label: "Fat — total",               unit: "g",  bold: true },
  { key: "nut_fat_saturated_g", label: "      Saturated",           unit: "g" },
  { key: "nut_fat_trans_g",     label: "      Trans",               unit: "g" },
  { key: "nut_carbs_total_g",   label: "Carbohydrate — total",      unit: "g",  bold: true },
  { key: "nut_carbs_sugars_g",  label: "      Sugars",              unit: "g" },
  { key: "nut_fibre_g",         label: "Dietary fibre",             unit: "g",  bold: true },
  { key: "nut_sodium_mg",       label: "Sodium",                    unit: "mg", bold: true },
];

export default function ItemForm({ mode, initial, duplicateSourceLabel = null, allergenDefs = [], departments = [], machines = [], categories = [], subcategories = [], itemTypes = [], uoms = [] }: Props) {
  const router = useRouter();
  const supabase = createClient();
  // Filling-attribute fields (fill / loss / target) display to 2 decimals so
  // sub-gram precision survives a roundtrip — e.g. an 8.25% loss isn't snapped
  // to "8" or "8.3" by the input. The fields below get formatted on load and
  // by the onBlur derivation handlers.
  const TWO_DECIMAL_FIELDS = new Set([
    "fill_weight_g", "target_weight_g", "process_loss_pct",
  ]);
  const sanitizedInitial = initial
    ? Object.fromEntries(
        Object.entries(initial).map(([k, v]) => {
          if (v === null) return [k, (DEFAULTS as Record<string, unknown>)[k] ?? ""];
          if (k === "packaging_materials" && Array.isArray(v)) return [k, (v as string[]).join(", ")];
          if (TWO_DECIMAL_FIELDS.has(k) && (typeof v === "number" || (typeof v === "string" && v !== ""))) {
            const n = typeof v === "number" ? v : parseFloat(v);
            if (Number.isFinite(n)) return [k, n.toFixed(2)];
          }
          return [k, v];
        })
      )
    : {};
  const [form, setForm] = useState<FormState>({ ...DEFAULTS, ...sanitizedInitial } as FormState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentItems, setParentItems] = useState<{ id: string; code: string; name: string; item_type: string }[]>([]);
  // Phase 9.3 v2: locally-added register rows from the dropdowns'
  // inline "+ New…" modal. These are kept alongside the props-passed lists
  // so the new option stays visible without forcing a full router.refresh().
  const [addedDepartments, setAddedDepartments] = useState<{ id: string; name: string; code: string }[]>([]);
  const [addedCategories,  setAddedCategories]  = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [addedSubcategories, setAddedSubcategories] = useState<{ id: string; category_id: string; name: string }[]>([]);
  const [addedItemTypes,   setAddedItemTypes]   = useState<{ code: string; name: string; is_active: boolean; sort_order: number }[]>([]);
  const [addedUoms,        setAddedUoms]        = useState<{ code: string; name: string; category: string }[]>([]);
  // Combined option lists used by the dropdowns below.
  const departmentOptions = [
    ...departments.map(d => ({ value: d.name, label: d.name })),
    ...addedDepartments.map(d => ({ value: d.name, label: d.name })),
  ];
  const categoryOptions = [
    ...categories.map(c => ({ value: c.id, label: c.name })),
    ...addedCategories.map(c => ({ value: c.id, label: c.name })),
  ];
  const allSubcategories = [...subcategories, ...addedSubcategories];
  const itemTypeOptions = (itemTypes.length > 0 || addedItemTypes.length > 0)
    ? [...itemTypes, ...addedItemTypes]
        .filter(t => t.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(t => ({ value: t.code, label: t.name }))
    : Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }));
  const allUoms = [...uoms, ...addedUoms];
  const [taxCodes, setTaxCodes] = useState<{ id: string; name: string; rate_pct: number; applies_to: string }[]>([]);

  // Inherited values from the parent chain (v_items_inherited_attrs view).
  // Used as ghost-text placeholders on filling/packing inputs so the user
  // sees what would be applied if they leave the field blank. Only populated
  // in edit mode for items that have a parent.
  type InheritedAttrs = {
    fill_weight_g?: number | null;
    target_weight_g?: number | null;
    process_loss_pct?: number | null;
    units_per_inner?: number | null;
    inner_per_outer?: number | null;
    outers_per_pallet?: number | null;
    tare_weight_g?: number | null;
    tolerance_over_g?: number | null;
    tolerance_under_g?: number | null;
  };
  const [inheritedAttrs, setInheritedAttrs] = useState<InheritedAttrs>({});
  useEffect(() => {
    const itemId = (initial as { id?: string } | undefined)?.id;
    if (!itemId) return;
    supabase
      .from("v_items_inherited_attrs")
      .select("inherited_fill_weight_g, inherited_target_weight_g, inherited_process_loss_pct, inherited_units_per_inner, inherited_inner_per_outer, inherited_outers_per_pallet, inherited_tare_weight_g, inherited_tolerance_over_g, inherited_tolerance_under_g")
      .eq("id", itemId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        // Only surface inherited values that AREN'T this item's OWN values
        // — otherwise we'd show the same number twice (the input shows it
        // already and the placeholder would echo it). The view returns the
        // closest-non-null walk INCLUDING the item itself, so we strip out
        // the item's own values here.
        type InhRow = Record<string, number | null>;
        const row = data as unknown as InhRow;
        const own = (initial ?? {}) as Record<string, unknown>;
        const stripIfOwn = (key: string, ownKey = key.replace("inherited_", "")) => {
          if (own[ownKey] != null && own[ownKey] !== "") return null;
          return row[key];
        };
        setInheritedAttrs({
          fill_weight_g:     stripIfOwn("inherited_fill_weight_g"),
          target_weight_g:   stripIfOwn("inherited_target_weight_g"),
          process_loss_pct:  stripIfOwn("inherited_process_loss_pct"),
          units_per_inner:   stripIfOwn("inherited_units_per_inner"),
          inner_per_outer:   stripIfOwn("inherited_inner_per_outer"),
          outers_per_pallet: stripIfOwn("inherited_outers_per_pallet"),
          tare_weight_g:     stripIfOwn("inherited_tare_weight_g"),
          tolerance_over_g:  stripIfOwn("inherited_tolerance_over_g"),
          tolerance_under_g: stripIfOwn("inherited_tolerance_under_g"),
        });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(initial as { id?: string } | undefined)?.id]);

  // Role gate (server enforces is_manager_or_above via RLS — surface that to user)
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setCanEdit(false); return; }
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", user.id).single();
      const role = profile?.role ?? null;
      setUserRole(role);
      setCanEdit(["super_admin", "admin", "manager", "planner"].includes(role ?? ""));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Code availability check
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [codeTakenBy, setCodeTakenBy] = useState<string | null>(null);
  const [suggestingCode, setSuggestingCode] = useState(false);

  useEffect(() => {
    const code = form.code.trim().toUpperCase();
    if (!code || (mode === "edit" && code === (initial?.code ?? "").toUpperCase())) {
      setCodeStatus("idle"); return;
    }
    setCodeStatus("checking");
    const timeout = setTimeout(async () => {
      let query = supabase.from("items").select("id, name").eq("code", code);
      if (mode === "edit" && (initial as { id?: string })?.id) {
        query = query.neq("id", (initial as { id: string }).id);
      }
      const { data } = await query.maybeSingle();
      if (data) { setCodeStatus("taken"); setCodeTakenBy((data as { name: string }).name); }
      else { setCodeStatus("available"); setCodeTakenBy(null); }
    }, 350);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.code]);

  async function suggestNextCode() {
    setSuggestingCode(true);
    const { data } = await supabase.from("items").select("code").eq("item_type", form.item_type).order("code");
    const codes: string[] = (data ?? []).map((r: { code: string }) => r.code);
    const numericCodes = codes.map(c => parseInt(c, 10)).filter(n => !isNaN(n));
    if (numericCodes.length > 0) { set("code", String(Math.max(...numericCodes) + 1)); setSuggestingCode(false); return; }
    const prefixPattern = /^([A-Z]+[-_]?)(\d+)$/i;
    const prefixCodes = codes.filter(c => prefixPattern.test(c));
    if (prefixCodes.length > 0) {
      const prefixes = prefixCodes.map(c => c.match(prefixPattern)![1]);
      const prefix = prefixes.sort((a, b) => prefixes.filter(p => p === b).length - prefixes.filter(p => p === a).length)[0];
      const nums = prefixCodes.filter(c => c.startsWith(prefix)).map(c => parseInt(c.replace(prefix, ""), 10)).filter(n => !isNaN(n));
      const nextNum = Math.max(...nums) + 1;
      const sampleLen = String(Math.max(...nums)).length;
      const padded = String(nextNum).padStart(sampleLen, "0");
      set("code", `${prefix}${padded}`); setSuggestingCode(false); return;
    }
    setSuggestingCode(false); setCodeStatus("idle");
    alert(`No code pattern detected for ${form.item_type} items yet. Enter the first code manually.`);
  }

  useEffect(() => {
    // Parent options: every active item in the tenant, sorted alphabetically
    // by code so when the user types "1004" the matches group together
    // naturally regardless of item_type. We deliberately don't filter by
    // item_type — tenants invent their own types (like WIPF, Premix, etc.)
    // and a hardcoded list silently hides them.
    //
    // IMPORTANT: explicit limit. Supabase silently caps reads at 1000 rows
    // by default, which meant W-prefix items (which sort after every numeric
    // code) fell off the end of the list — and items whose parent was a
    // W-item displayed as "No parent" even though the linkage was intact in
    // the DB. Saved data wasn't lost, but the operator had no way to see it.
    // TENANT_FULL_FETCH (100k) keeps headroom while staying within Supabase's
    // upper bound; if a tenant ever blows past that we'll need pagination.
    //
    // Belt-and-braces: if the current item already has a parent set (edit
    // mode), explicitly fetch that parent in a parallel query and merge it
    // in — so even if a future limit cap removes the parent from the page
    // window, the saved value still renders correctly in the dropdown.
    const fetchAll = supabase.from("items").select("id, code, name, item_type")
      .eq("is_active", true).order("code").limit(TENANT_FULL_FETCH);
    const currentParentId = initial?.parent_item_id ?? null;
    const fetchParent = currentParentId
      ? supabase.from("items").select("id, code, name, item_type").eq("id", currentParentId).maybeSingle()
      : Promise.resolve({ data: null });
    Promise.all([fetchAll, fetchParent]).then(([allRes, parentRes]) => {
      const list = allRes.data ?? [];
      const parent = parentRes.data;
      if (parent && !list.some(i => i.id === parent.id)) list.unshift(parent);
      setParentItems(list);
    });
    supabase.from("tax_codes").select("id, name, rate_pct, applies_to")
      .eq("is_active", true).order("name")
      .then(({ data }) => setTaxCodes(data ?? []));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }));
  }
  function toggleAllergen(a: string) {
    setForm(f => ({ ...f, allergens: f.allergens.includes(a) ? f.allergens.filter(x => x !== a) : [...f.allergens, a] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);

    let tenantId: string | null = null;
    if (mode === "create") {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Not signed in"); setSaving(false); return; }
      const { data: profile } = await supabase.from("profiles").select("tenant_id").eq("id", user.id).single();
      tenantId = profile?.tenant_id ?? null;
      if (!tenantId) { setError("No tenant linked to your profile"); setSaving(false); return; }
    }

    // Parse packaging materials (comma OR newline separated)
    const packagingMaterials = form.packaging_materials
      .split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);

    const payload = {
      ...(mode === "create" && tenantId ? { tenant_id: tenantId } : {}),
      code: form.code.trim(), name: form.name.trim(),
      description: form.description || null,
      item_type: form.item_type, parent_item_id: form.parent_item_id || null,
      production_method: (form.production_method as ProductionMethod) || null,
      item_category_id: form.item_category_id || null,
      item_subcategory_id: form.item_subcategory_id || null,
      department: form.department || null, machine: form.machine || null, room: form.room || null,
      priority: parseFloat(form.priority) || 5,
      unit: form.unit || "kg",
      default_batch_size: form.default_batch_size ? parseFloat(form.default_batch_size) : null,
      batch_unit: form.batch_unit || "kg",
      weight_mode: form.weight_mode,
      target_weight_g: form.target_weight_g ? parseFloat(form.target_weight_g) : null,
      fill_weight_g:   form.fill_weight_g   ? parseFloat(form.fill_weight_g)   : null,
      process_loss_pct: form.process_loss_pct ? parseFloat(form.process_loss_pct) : null,
      tare_weight_g: form.tare_weight_g ? parseFloat(form.tare_weight_g) : null,
      tolerance_over_g: form.tolerance_over_g ? parseFloat(form.tolerance_over_g) : null,
      tolerance_under_g: form.tolerance_under_g ? parseFloat(form.tolerance_under_g) : null,
      units_per_inner: form.units_per_inner ? parseInt(form.units_per_inner) : null,
      inner_per_outer: form.inner_per_outer ? parseInt(form.inner_per_outer) : null,
      outers_per_pallet: form.outers_per_pallet ? parseInt(form.outers_per_pallet) : null,
      // units_per_outer + units_per_pallet INTENTIONALLY OMITTED — DB trigger
      // (migration 060) recomputes them from the leaves above on every write.
      giveaway_pct: form.giveaway_pct ? parseFloat(form.giveaway_pct) : null,
      production_loss_pct: form.production_loss_pct ? parseFloat(form.production_loss_pct) : null,
      cooking_loss_pct:    form.cooking_loss_pct    ? parseFloat(form.cooking_loss_pct)    : null,
      packing_loss_pct:    form.packing_loss_pct    ? parseFloat(form.packing_loss_pct)    : null,
      open_pack_pct:       form.open_pack_pct       ? parseFloat(form.open_pack_pct)       : null,
      allergens: form.allergens,
      min_stock: parseFloat(form.min_stock) || 0,
      max_stock: parseFloat(form.max_stock) || 0,
      is_make_to_order: form.is_make_to_order,
      is_active: form.is_active,
      procurement_type: form.procurement_type,
      spec_storage_temp: form.spec_storage_temp || null,
      spec_shelf_life: form.spec_shelf_life || null,
      spec_notes: form.spec_notes || null,
      spec_origin: form.spec_origin || null,
      spec_fat_content: form.spec_fat_content || null,
      spec_protein: form.spec_protein || null,
      spec_moisture: form.spec_moisture || null,
      spec_ph: form.spec_ph || null,
      spec_water_activity: form.spec_water_activity || null,
      spec_micro: form.spec_micro || null,
      supplier: form.supplier || null,
      supplier_code: form.supplier_code || null,
      spec_weight_per_unit: form.spec_weight_per_unit || null,
      spec_packaging: form.spec_packaging || null,
      spec_labelling: form.spec_labelling || null,
      purchase_tax_code_id: form.purchase_tax_code_id || null,
      sales_tax_code_id: form.sales_tax_code_id || null,
      purchase_account_code: form.purchase_account_code || null,
      sales_account_code: form.sales_account_code || null,
      purchase_uom: form.purchase_uom || null,
      purchase_uom_qty: form.purchase_uom_qty ? parseFloat(form.purchase_uom_qty) : null,
      purchase_uom_type: form.purchase_uom_type || null,
      purchase_unit_price: form.purchase_unit_price ? parseFloat(form.purchase_unit_price) : null,
      purchase_currency: form.purchase_currency || "AUD",
      nut_energy_kj:        form.nut_energy_kj        ? parseFloat(form.nut_energy_kj)        : null,
      nut_energy_kcal:      form.nut_energy_kcal      ? parseFloat(form.nut_energy_kcal)      : null,
      nut_protein_g:        form.nut_protein_g        ? parseFloat(form.nut_protein_g)        : null,
      nut_fat_total_g:      form.nut_fat_total_g      ? parseFloat(form.nut_fat_total_g)      : null,
      nut_fat_saturated_g:  form.nut_fat_saturated_g  ? parseFloat(form.nut_fat_saturated_g)  : null,
      nut_fat_trans_g:      form.nut_fat_trans_g      ? parseFloat(form.nut_fat_trans_g)      : null,
      nut_carbs_total_g:    form.nut_carbs_total_g    ? parseFloat(form.nut_carbs_total_g)    : null,
      nut_carbs_sugars_g:   form.nut_carbs_sugars_g   ? parseFloat(form.nut_carbs_sugars_g)   : null,
      nut_fibre_g:          form.nut_fibre_g          ? parseFloat(form.nut_fibre_g)          : null,
      nut_sodium_mg:        form.nut_sodium_mg        ? parseFloat(form.nut_sodium_mg)        : null,
      nut_per_serving_g:    form.nut_per_serving_g    ? parseFloat(form.nut_per_serving_g)    : null,
      nut_notes:            form.nut_notes || null,
      sell_price_per_inner: form.sell_price_per_inner ? parseFloat(form.sell_price_per_inner) : null,
      sell_price_per_kg:    form.sell_price_per_kg    ? parseFloat(form.sell_price_per_kg)    : null,
      min_shelf_life_days:  form.min_shelf_life_days ? parseInt(form.min_shelf_life_days) : null,
      is_rte:               form.is_rte,
      nip_large_item:       form.nip_large_item,
      ingredients_statement: form.ingredients_statement || null,
      // Structured micro panel
      micro_tpc:                 form.micro_tpc                 || null,
      micro_ecoli:               form.micro_ecoli               || null,
      micro_coliforms:           form.micro_coliforms           || null,
      micro_salmonella:          form.micro_salmonella          || null,
      micro_listeria:            form.micro_listeria            || null,
      micro_s_aureus:            form.micro_s_aureus            || null,
      micro_yeast_mould:         form.micro_yeast_mould         || null,
      micro_sulphite_clostridia: form.micro_sulphite_clostridia || null,
      micro_reference:           form.micro_reference           || null,
      // Packaging materials
      packaging_materials: packagingMaterials.length > 0 ? packagingMaterials : null,
    };

    const { data, error: err } = mode === "create"
      ? await supabase.from("items").insert(payload).select().single()
      : await supabase.from("items").update(payload).eq("id", (initial as Item).id).select().single();
    if (err) { setError(err.message); setSaving(false); return; }
    router.push(`/items/${data.id}`);
  }

  const inp = (field: keyof FormState, placeholder = "") => ({
    className: "form-input",
    value: (form[field] ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(field, e.target.value as FormState[typeof field]),
    placeholder,
  });

  /** Build a placeholder string for an input that has an inherited value
   *  available. Format: "↑ 100.00" (with arrow prefix to signal inheritance).
   *  Falls back to the plain hint when no inheritance applies. */
  function inheritedHint(field: keyof InheritedAttrs, fallback: string): string {
    const v = inheritedAttrs[field];
    if (v == null) return fallback;
    return `↑ ${Number(v).toFixed(2)}`;
  }

  /** Clear all filling-attribute fields so the item reverts to inherited
   *  values from its parent chain. */
  const useParentFilling = () => {
    setForm(f => ({ ...f, fill_weight_g: "", target_weight_g: "", process_loss_pct: "" }));
  };
  /** Clear all packing-attribute fields so the item reverts to inherited
   *  values from its parent chain. */
  const useParentPacking = () => {
    setForm(f => ({
      ...f,
      tare_weight_g: "", tolerance_over_g: "", tolerance_under_g: "",
      units_per_inner: "", inner_per_outer: "", outers_per_pallet: "",
    }));
  };
  // True when the parent chain has any value for the section's fields, so
  // the "Use parent's values" button is meaningful.
  const hasInheritedFilling = inheritedAttrs.fill_weight_g != null
    || inheritedAttrs.target_weight_g != null
    || inheritedAttrs.process_loss_pct != null;
  const hasInheritedPacking = inheritedAttrs.units_per_inner != null
    || inheritedAttrs.inner_per_outer != null
    || inheritedAttrs.outers_per_pallet != null
    || inheritedAttrs.tare_weight_g != null;

  const currentItemType = itemTypes.find(t => t.code === form.item_type);
  const showRM  = currentItemType ? currentItemType.is_purchasable && !currentItemType.is_sellable : ["raw_material","packaging","consumable"].includes(form.item_type);
  const showWIP = currentItemType ? currentItemType.can_have_bom && !currentItemType.is_sellable     : ["wip","fill"].includes(form.item_type);
  const showFG  = currentItemType ? currentItemType.is_sellable                                      : form.item_type === "finished_good";
  const showFixedWeight = showFG && form.weight_mode === "fixed";
  const showSpec = showRM || showFG || showWIP;

  // ── Section visibility for Fill / Packing attributes ─────────────────────
  // Per Tino: don't bind section visibility purely to item_type (which can be
  // wrong / changed mid-life). Use a hybrid rule:
  //   - Default by type (WIPF/Fill → fill section; Finished Good → packing section)
  //   - PLUS: if the item already has data in the section's fields, keep
  //     showing it so legacy/imported records don't lose their values silently
  //   - PLUS: an "Override sections" toggle below lets the operator force-show
  //     either section regardless of type
  // This matches the user mental model: "this item happens to need fill data
  // AND packing data" without forcing them to lie about its type.
  const isWIPFType = ["wipf", "fill"].includes(form.item_type);
  const fillSectionAutoShow =
    isWIPFType ||
    !!form.fill_weight_g || !!form.process_loss_pct;
  const packingSectionAutoShow =
    showFG ||
    !!form.target_weight_g || !!form.tare_weight_g ||
    !!form.units_per_inner || !!form.inner_per_outer ||
    !!form.outers_per_pallet;
  const [forceShowFill, setForceShowFill] = useState(false);
  const [forceShowPacking, setForceShowPacking] = useState(false);
  const showFillAttrs    = fillSectionAutoShow || forceShowFill;
  const showPackingAttrs = packingSectionAutoShow || forceShowPacking;

  // Per-serve calc helper for NIP rendering
  const serving = parseFloat(form.nut_per_serving_g) || null;
  const perServe = (per100Str: string) => {
    const v = parseFloat(per100Str);
    if (isNaN(v) || serving == null) return "";
    return ((v * serving) / 100).toFixed(1);
  };
  const perServeEnergy = (kjStr: string, kcalStr: string) => {
    if (serving == null) return { kj: "", kcal: "" };
    const kj   = parseFloat(kjStr);
    const kcal = parseFloat(kcalStr);
    return {
      kj:   isNaN(kj)   ? "" : Math.round((kj   * serving) / 100).toString(),
      kcal: isNaN(kcal) ? "" : Math.round((kcal * serving) / 100).toString(),
    };
  };
  const eServe = perServeEnergy(form.nut_energy_kj, form.nut_energy_kcal);

  return (
    <div style={{ maxWidth: "880px" }}>
      <BackButton href={mode === "edit" && initial?.id ? `/items/${initial.id}` : "/items"} label="Item Master" />
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {mode === "create"
              ? (duplicateSourceLabel ? "Duplicate Item" : "New Item")
              : `Edit ${initial?.name}`}
          </h1>
          <p className="page-subtitle">
            {mode === "create"
              ? (duplicateSourceLabel
                  ? "Review the copied details, fill in the new code, and save."
                  : "Add a raw material, WIP, fill code, or finished good to the item master")
              : "Update item details and specification"}
          </p>
        </div>
      </div>

      {/* Duplicate banner — only when arrived via /items/new?duplicate_from=…
          Tells the operator which item we copied from + what's blank by
          design so they don't search for missing fields that aren't a bug. */}
      {duplicateSourceLabel && (
        <div style={{
          marginBottom: "1rem", padding: "0.75rem 1rem",
          background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: "0.5rem",
          color: "#1e3a8a", fontSize: "0.8125rem",
          display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "1rem" }}>📋</span>
          <span>
            Duplicating from <strong>{duplicateSourceLabel}</strong>.
            Item code and current stock have been blanked — fill in the new code before saving.
            BOMs, suppliers, barcodes and product specs are <strong>not</strong> copied; re-link them on the new item if you need them.
          </span>
        </div>
      )}

      {canEdit === false && (
        <div style={{
          marginBottom: "1rem", padding: "0.875rem 1rem",
          background: "#fef9c3", border: "1px solid #fde047", borderRadius: "0.5rem",
          color: "#854d0e", fontSize: "0.875rem",
        }}>
          <strong>You don&apos;t have permission to {mode === "create" ? "create" : "edit"} items.</strong>{" "}
          Your role is <code style={{ background: "#fff", padding: "0.05rem 0.3rem", borderRadius: "0.2rem" }}>{userRole ?? "unknown"}</code>.
          Items can only be {mode === "create" ? "created" : "modified"} by users with role <em>planner</em>, <em>manager</em>, <em>admin</em>, or <em>super_admin</em>.
          Ask an admin to upgrade your role in <a href="/settings/users" style={{ color: "#854d0e", fontWeight: 600 }}>Settings &rarr; Users</a>.
        </div>
      )}

      <form id="item-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* ════════════════════════════════════════════════════════════
             1. CORE INFORMATION  (identification + basic spec)
        ════════════════════════════════════════════════════════════ */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Core Information</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Item Code *</label>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <input className="form-input" value={form.code}
                  onChange={e => set("code", e.target.value.toUpperCase())}
                  placeholder="e.g. 2015 or RM-001" required
                  style={{ flex: 1, textTransform: "uppercase", fontFamily: "monospace" }}
                />
                <button type="button" onClick={suggestNextCode} disabled={suggestingCode} className="btn-secondary"
                  title={`Suggest the next available code for ${currentItemType?.name ?? ITEM_TYPE_LABELS[form.item_type] ?? form.item_type} items`}
                  style={{ padding: "0.5rem 0.625rem", fontSize: "0.75rem", whiteSpace: "nowrap", flexShrink: 0 }}
                >{suggestingCode ? "…" : "Next free →"}</button>
              </div>
              {form.code.trim() && codeStatus !== "idle" && (
                <div style={{ marginTop: "0.3rem", fontSize: "0.75rem" }}>
                  {codeStatus === "checking" && <span style={{ color: "#78716c" }}>Checking availability…</span>}
                  {codeStatus === "available" && <span style={{ color: "#15803d", fontWeight: 500 }}>✓ Available</span>}
                  {codeStatus === "taken"     && <span style={{ color: "#dc2626", fontWeight: 500 }}>✗ Already used by &ldquo;{codeTakenBy}&rdquo;</span>}
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Name *</label>
              <input {...inp("name", "e.g. Chorizo - WIP")} required />
            </div>
            <div>
              <label className="form-label">Item Type *</label>
              <SearchableSelect allowClear={false} value={form.item_type} onChange={v => set("item_type", v)}
                options={itemTypeOptions}
                addNew={{
                  table: "item_types",
                  labelField: "name",
                  codeField: "code",
                  dialogTitle: "New item type",
                  extras: { is_active: true, sort_order: 999 },
                  onCreated: (id, label, code) => {
                    if (!code) return;
                    setAddedItemTypes(prev => [...prev, { code, name: label, is_active: true, sort_order: 999 }]);
                    set("item_type", code);
                  },
                }}
              />
            </div>
            <div>
              <label className="form-label">Description</label>
              <input {...inp("description", "Optional description")} />
            </div>

            {!showRM && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="form-label">Parent Item (BOM hierarchy)</label>
                <SearchableSelect value={form.parent_item_id} onChange={v => set("parent_item_id", v)}
                  placeholder="— No parent (top level) —"
                  options={parentItems.map(p => ({ value: p.id, label: `${p.code} — ${p.name} (${p.item_type})` }))}
                />
              </div>
            )}

            {/* Active toggle */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Item Status</label>
              <button type="button" onClick={() => set("is_active", !form.is_active)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.625rem",
                  padding: "0.5rem 0.875rem", borderRadius: "0.5rem",
                  border: form.is_active ? "1px solid #16a34a" : "1px solid #d1d5db",
                  background: form.is_active ? "#f0fdf4" : "#fafaf9",
                  cursor: "pointer", fontSize: "0.875rem", fontWeight: 600,
                  color: form.is_active ? "#15803d" : "#6b7280", transition: "all 0.15s",
                }}>
                <span style={{ display: "inline-block", width: "2.25rem", height: "1.25rem", borderRadius: "9999px",
                  background: form.is_active ? "#16a34a" : "#d1d5db", position: "relative", flexShrink: 0,
                  transition: "background 0.15s" }}>
                  <span style={{ position: "absolute", top: "0.125rem",
                    left: form.is_active ? "1.125rem" : "0.125rem",
                    width: "1rem", height: "1rem", borderRadius: "9999px",
                    background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.15s" }} />
                </span>
                {form.is_active ? "Active — visible in BOMs and ordering" : "Inactive — hidden from BOMs and purchasing"}
              </button>
            </div>

            {/* Weight-mode toggle. Originally FG-only — loosened so raw
                materials and packaging that have a known per-unit weight
                (e.g. tubed casings, labels by sheet, bottles) can also
                be marked Fixed and use target_weight_g for piece↔kg
                conversion in the demand-entry modal's pack hierarchy. */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Weight Mode</label>
              <button type="button" onClick={() => set("weight_mode", form.weight_mode === "fixed" ? "random" : "fixed")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.625rem",
                  padding: "0.5rem 0.875rem", borderRadius: "0.5rem",
                  border: form.weight_mode === "fixed" ? "1px solid #1d4ed8" : "1px solid #ca8a04",
                  background: form.weight_mode === "fixed" ? "#eff6ff" : "#fefce8",
                  cursor: "pointer", fontSize: "0.875rem", fontWeight: 600,
                  color: form.weight_mode === "fixed" ? "#1e40af" : "#854d0e", transition: "all 0.15s",
                }}>
                <span style={{ display: "inline-block", width: "2.25rem", height: "1.25rem", borderRadius: "9999px",
                  background: form.weight_mode === "fixed" ? "#1d4ed8" : "#ca8a04",
                  position: "relative", flexShrink: 0, transition: "background 0.15s" }}>
                  <span style={{ position: "absolute", top: "0.125rem",
                    left: form.weight_mode === "fixed" ? "1.125rem" : "0.125rem",
                    width: "1rem", height: "1rem", borderRadius: "9999px",
                    background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.15s" }} />
                </span>
                {form.weight_mode === "fixed"
                  ? "Fixed Weight — every unit the same weight (e.g. 500 g retail pack, 50 g casing) — enables piece counts"
                  : "Random Weight — each unit weighed individually (e.g. whole hams, bulk meat) — sold by kg"}
              </button>
              {!showFG && (
                <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#78716c" }}>
                  For non-FG items: pick <strong>Fixed</strong> only when each unit has a known weight (so demand-planning can convert pieces ↔ kg). Leave <strong>Random</strong> if you simply track this item by its stock unit.
                </div>
              )}
            </div>

            {/* Product Specification fields (moved from separate section) */}
            {showSpec && (
              <>
                <div style={{ gridColumn: "1 / -1", borderTop: "1px dashed #e7e5e4", paddingTop: "0.875rem", marginTop: "0.5rem" }}>
                  <h3 style={{ fontSize: "0.875rem", fontWeight: 600, margin: "0 0 0.625rem", color: "#57534e" }}>Product Specification</h3>
                </div>
                {[
                  ["spec_origin",         "Origin / Source",      "e.g. Australian pork"],
                  ["spec_storage_temp",   "Storage Temperature",  "e.g. 0–4°C"],
                  ["spec_fat_content",    "Fat Content",          "e.g. 20–30%"],
                  ["spec_protein",        "Protein",              "e.g. ≥18%"],
                  ["spec_moisture",       "Moisture",             "e.g. ≤70%"],
                  ["spec_ph",             "pH",                   "e.g. 5.6–6.2"],
                  ["spec_water_activity", "Water Activity (Aw)",  "e.g. ≤0.97"],
                  ...(showRM ? [["supplier", "Supplier", "Supplier name"], ["supplier_code", "Supplier Code", "Supplier's product code"]] : []),
                ].map(([field, label, ph]) => (
                  <div key={field}>
                    <label className="form-label">{label}</label>
                    <input {...inp(field as keyof FormState, ph)} />
                  </div>
                ))}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label className="form-label">Specification notes</label>
                  <textarea {...inp("spec_notes", "Additional specification notes…")} className="form-input" rows={2} style={{ resize: "vertical" }} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
             2. PRODUCTION INFORMATION
        ════════════════════════════════════════════════════════════ */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Production Information</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Production Method</label>
              <SearchableSelect value={form.production_method} onChange={v => set("production_method", v)}
                placeholder="— Not applicable —"
                options={(Object.entries(PRODUCTION_METHOD_LABELS) as [ProductionMethod, string][]).map(([v, l]) => ({ value: v, label: l }))}
              />
            </div>
            <div>
              <label className="form-label">Department</label>
              <SearchableSelect value={form.department} onChange={v => set("department", v)} placeholder="— Select dept —"
                options={departmentOptions}
                addNew={{
                  table: "departments",
                  labelField: "name",
                  codeField: "code",
                  dialogTitle: "New department",
                  extras: { is_active: true },
                  onCreated: (id, label, code) => {
                    setAddedDepartments(prev => [...prev, { id, name: label, code: code ?? "" }]);
                    set("department", label);
                  },
                }}
              />
            </div>
            <div>
              <label className="form-label">Category</label>
              <SearchableSelect value={form.item_category_id}
                onChange={v => { set("item_category_id", v); set("item_subcategory_id", ""); }}
                placeholder="— No category —"
                options={categoryOptions}
                addNew={{
                  table: "item_categories",
                  labelField: "name",
                  dialogTitle: "New category",
                  onCreated: (id, label) => {
                    setAddedCategories(prev => [...prev, { id, name: label, color: null }]);
                    set("item_category_id", id);
                    set("item_subcategory_id", "");
                  },
                }}
              />
            </div>
            <div>
              <label className="form-label">Sub Category</label>
              {(() => {
                const filteredSubs = allSubcategories.filter(s => s.category_id === form.item_category_id);
                if (!form.item_category_id) return <div style={{ padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", fontSize: "0.8125rem", color: "#a8a29e" }}>Select a category first</div>;
                return (
                  <SearchableSelect
                    value={form.item_subcategory_id}
                    onChange={v => set("item_subcategory_id", v)}
                    placeholder="— No sub category —"
                    options={filteredSubs.map(s => ({ value: s.id, label: s.name }))}
                    addNew={{
                      table: "item_subcategories",
                      labelField: "name",
                      dialogTitle: "New sub-category",
                      extras: { category_id: form.item_category_id },
                      onCreated: (id, label) => {
                        setAddedSubcategories(prev => [...prev, { id, category_id: form.item_category_id, name: label }]);
                        set("item_subcategory_id", id);
                      },
                    }}
                  />
                );
              })()}
            </div>
            <div>
              <label className="form-label">Machine</label>
              {machines.length > 0 ? (
                <SearchableSelect
                  value={form.machine}
                  onChange={v => {
                    set("machine", v);
                    // Auto-fill Room + Department from the picked machine's
                    // links. The operator can still manually override either
                    // field after — the auto-fill is a starting point, not a
                    // lock. Clearing the machine leaves room/dept untouched
                    // (they might have been set manually before any machine
                    // was assigned).
                    const picked = machines.find(m => m.name === v);
                    if (picked) {
                      if (picked.room?.name) set("room", picked.room.name);
                      if (picked.department?.name) set("department", picked.department.name);
                    }
                  }}
                  placeholder="— Not assigned —"
                  options={machines.map(m => ({ value: m.name, label: m.code ? `${m.code} — ${m.name}` : m.name }))}
                />
              ) : <input {...inp("machine", "e.g. LRG Mixer")} />}
              <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                Picking a machine pre-fills Room + Department from the machine&apos;s settings — you can override either.
              </div>
            </div>
            <div>
              <label className="form-label">Room</label>
              <input {...inp("room", "e.g. Cutter Room")} />
            </div>
            <div>
              <label className="form-label">Stock / Consume UOM</label>
              <SearchableSelect
                value={form.unit}
                onChange={v => set("unit", v)}
                placeholder="— Select unit —"
                options={allUoms.map(u => ({ value: u.code, label: `${u.code} — ${u.name}` }))}
                allowClear={false}
                addNew={{
                  table: "uoms",
                  labelField: "name",
                  codeField: "code",
                  dialogTitle: "New unit of measure",
                  extras: { category: "other", is_active: true },
                  onCreated: (id, label, code) => {
                    if (!code) return;
                    setAddedUoms(prev => [...prev, { code, name: label, category: "other" }]);
                    set("unit", code);
                  },
                }}
              />
              <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                How stock is held + how BOMs consume it.
              </div>
            </div>
            <div><label className="form-label">Priority (1=high, 10=low)</label><input {...inp("priority")} type="number" min="1" max="10" /></div>
            <div><label className="form-label">Default Batch Size</label><input {...inp("default_batch_size", "e.g. 750")} type="number" min="0" step="0.001" /></div>
            <div>
              <label className="form-label">Batch Unit</label>
              <SearchableSelect
                value={form.batch_unit}
                onChange={v => set("batch_unit", v)}
                placeholder="— Select unit —"
                options={allUoms.map(u => ({ value: u.code, label: `${u.code} — ${u.name}` }))}
                addNew={{
                  table: "uoms",
                  labelField: "name",
                  codeField: "code",
                  dialogTitle: "New unit of measure",
                  extras: { category: "other", is_active: true },
                  onCreated: (id, label, code) => {
                    if (!code) return;
                    setAddedUoms(prev => [...prev, { code, name: label, category: "other" }]);
                    set("batch_unit", code);
                  },
                }}
              />
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
             3. STOCK MANAGEMENT
        ════════════════════════════════════════════════════════════ */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 1rem" }}>Stock Management</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <div><label className="form-label">Min Stock Level</label><input {...inp("min_stock")} type="number" min="0" step="0.001" /></div>
            <div><label className="form-label">Max Stock Level</label><input {...inp("max_stock")} type="number" min="0" step="0.001" /></div>
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: "0.125rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                <input type="checkbox" checked={form.is_make_to_order} onChange={e => set("is_make_to_order", e.target.checked)} />
                Made to Order (no stock replenishment)
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Procurement Type</label>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
                {([["purchase", "Purchase (buy from supplier)"], ["produce", "Produce (make in-house)"]] as const).map(([v, label]) => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                    <input type="radio" name="procurement_type" value={v} checked={form.procurement_type === v} onChange={() => set("procurement_type", v)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
             4a. FILLING ATTRIBUTES — fill weight + process loss
                  Visible when item is WIPF/Fill OR has fill data populated,
                  OR the operator has force-shown via the override toggle.
        ════════════════════════════════════════════════════════════ */}
        {showFillAttrs && (
          <div className="card" style={{ borderLeft: "3px solid #2563eb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem", gap: "0.5rem", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>🔵 Filling Attributes</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                {hasInheritedFilling && (
                  <button
                    type="button"
                    onClick={useParentFilling}
                    className="btn-secondary"
                    style={{ fontSize: "0.7rem", padding: "0.25rem 0.55rem" }}
                    title="Clear all filling fields so this item inherits values from its parent in the family tree"
                  >↑ Use parent&apos;s values</button>
                )}
                <span style={{ fontSize: "0.7rem", color: "#78716c" }}>
                  {fillSectionAutoShow ? `Auto-shown (${isWIPFType ? "item type" : "data present"})` : "Manually shown"}
                </span>
              </div>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
              How much we put in per piece at the filling station, and the typical loss between fill and finished pack
              (cooking, breakage, machinery waste). Enter any 2 — the third auto-calculates. Leave blank to inherit from parent (shown as ↑ in the placeholder).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
              {/* ─── 3-way derivation: fill ↔ loss ↔ target ──────────────────
                  When the operator finishes editing ANY one of these three,
                  the other two are kept in sync via a single rule:
                    target_per_piece = fill × (1 − loss/100)
                    target_per_inner = target_per_piece × units_per_inner
                  Whichever field they just edited is treated as the new
                  source-of-truth; we re-derive whichever of the OTHER two has
                  the most natural dependency:
                    • edit fill   → if loss known, recompute target; else if target known, recompute loss
                    • edit loss   → if fill known, recompute target; else if target known, recompute fill
                    • edit target → if fill known, recompute loss;   else if loss   known, recompute fill
                  No more "all three filled → nothing happens"; editing always
                  produces a consistent set of values. */}
              <div>
                <label className="form-label">Fill Weight (g) per Piece</label>
                <input
                  {...inp("fill_weight_g", inheritedHint("fill_weight_g", "e.g. 110.00"))}
                  type="number" min="0" step="0.01"
                  onBlur={() => {
                    // Normalize whatever the user typed to 2 decimals on blur.
                    const raw = parseFloat(form.fill_weight_g);
                    if (Number.isFinite(raw)) {
                      const fixed = raw.toFixed(2);
                      if (fixed !== form.fill_weight_g) setForm(f => ({ ...f, fill_weight_g: fixed }));
                    }
                    // target_weight_g is PER PIECE — same scale as fill_weight_g.
                    // No upi conversion needed in any direction.
                    const fill   = parseFloat(form.fill_weight_g);
                    const loss   = parseFloat(form.process_loss_pct);
                    const target = parseFloat(form.target_weight_g);
                    if (isNaN(fill) || fill <= 0) return;
                    if (!isNaN(loss)) {
                      // recompute target from fill + loss
                      const computed = Math.max(0, fill * (1 - loss / 100));
                      setForm(f => ({ ...f, target_weight_g: computed.toFixed(2) }));
                    } else if (!isNaN(target)) {
                      // recompute loss from fill + target (both per-piece)
                      const computed = Math.max(0, ((fill - target) / fill) * 100);
                      setForm(f => ({ ...f, process_loss_pct: computed.toFixed(2) }));
                    }
                  }}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Grams put in per piece, before cooking/processing</div>
              </div>
              <div>
                <label className="form-label">Process Loss (%)</label>
                <input
                  {...inp("process_loss_pct", inheritedHint("process_loss_pct", "e.g. 9.00"))}
                  type="number" min="0" max="100" step="0.01"
                  onBlur={() => {
                    const raw = parseFloat(form.process_loss_pct);
                    if (Number.isFinite(raw)) {
                      const fixed = raw.toFixed(2);
                      if (fixed !== form.process_loss_pct) setForm(f => ({ ...f, process_loss_pct: fixed }));
                    }
                    // Per-piece math: target = fill × (1 − loss/100). No upi.
                    const fill   = parseFloat(form.fill_weight_g);
                    const loss   = parseFloat(form.process_loss_pct);
                    const target = parseFloat(form.target_weight_g);
                    if (isNaN(loss) || loss < 0 || loss >= 100) return;
                    if (!isNaN(fill) && fill > 0) {
                      const computed = Math.max(0, fill * (1 - loss / 100));
                      setForm(f => ({ ...f, target_weight_g: computed.toFixed(2) }));
                    } else if (!isNaN(target)) {
                      const computed = target / (1 - loss / 100);
                      setForm(f => ({ ...f, fill_weight_g: computed.toFixed(2) }));
                    }
                  }}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Cook + breakage + machinery waste, as % of fill</div>
              </div>
              <div>
                <label className="form-label">Target Weight (g) per Piece</label>
                <input
                  {...inp("target_weight_g", inheritedHint("target_weight_g", "e.g. 56.00"))}
                  type="number" min="0" step="0.01"
                  onBlur={() => {
                    const raw = parseFloat(form.target_weight_g);
                    if (Number.isFinite(raw)) {
                      const fixed = raw.toFixed(2);
                      if (fixed !== form.target_weight_g) setForm(f => ({ ...f, target_weight_g: fixed }));
                    }
                    // target_weight_g is the FINISHED weight of ONE PIECE.
                    // Same scale as fill_weight_g — no upi conversion.
                    const fill   = parseFloat(form.fill_weight_g);
                    const loss   = parseFloat(form.process_loss_pct);
                    const target = parseFloat(form.target_weight_g);
                    if (isNaN(target) || target <= 0) return;
                    if (!isNaN(fill) && fill > 0) {
                      const computed = Math.max(0, ((fill - target) / fill) * 100);
                      setForm(f => ({ ...f, process_loss_pct: computed.toFixed(2) }));
                    } else if (!isNaN(loss) && loss < 100) {
                      const computed = target / (1 - loss / 100);
                      setForm(f => ({ ...f, fill_weight_g: computed.toFixed(2) }));
                    }
                  }}
                />
                <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>
                  Finished weight of ONE piece (after process). For a 56g frankfurter enter 56. For a 100g chorizo enter 100. Per-inner weight is auto-derived as <strong>target × pieces per inner</strong>.
                </div>
                {/* Derived per-piece target — useful for multi-piece packs so
                    the operator can sanity-check that the pieces × per-piece
                    weight matches the per-inner number they entered. */}
                {(() => {
                  const target = parseFloat(form.target_weight_g);
                  const upi    = parseFloat(form.units_per_inner);
                  if (!Number.isFinite(target) || target <= 0) return null;
                  const effUpi = Number.isFinite(upi) && upi > 1 ? upi : null;
                  if (!effUpi) return null;  // when 1 piece per inner, per-piece == per-inner; no need to repeat
                  const perPiece = target / effUpi;
                  return (
                    <div style={{
                      marginTop: "0.4rem", padding: "0.3rem 0.55rem",
                      background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "0.375rem",
                      fontSize: "0.75rem", color: "#075985",
                    }}>
                      = <strong style={{ fontFamily: "monospace" }}>{perPiece.toFixed(2)} g</strong> per piece
                      <span style={{ color: "#0369a1", marginLeft: "0.4rem" }}>
                        ({target.toFixed(2)} ÷ {effUpi} pcs)
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
            {/* ─── Derived preview — turn the three numbers into plain words.
                 This is the "what does this mean for the system" answer
                 (Tino May 2026 — the BOM data overhaul). Visible the moment
                 fill OR target is populated; nudges the operator if anything
                 critical is missing. */}
            {(() => {
              const fill   = parseFloat(form.fill_weight_g);
              const target = parseFloat(form.target_weight_g);
              const loss   = parseFloat(form.process_loss_pct);
              const hasFill   = Number.isFinite(fill)   && fill   > 0;
              const hasTarget = Number.isFinite(target) && target > 0;
              const hasLoss   = Number.isFinite(loss)   && loss   >= 0;
              if (!hasFill && !hasTarget) return null;
              const unitsPerKg = hasTarget ? 1000 / target : null;
              const yieldPct   = (hasFill && hasTarget && fill > 0) ? (target / fill) * 100 : null;
              return (
                <div style={{
                  marginTop: "1rem", padding: "0.75rem 0.875rem",
                  background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "0.5rem",
                  fontSize: "0.8125rem", color: "#075985",
                }}>
                  <div style={{ fontWeight: 700, marginBottom: "0.4rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    What this means
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.5rem 1.25rem", lineHeight: 1.5 }}>
                    {hasTarget && (
                      <div>
                        <strong style={{ fontFamily: "monospace" }}>{target.toLocaleString("en-AU")} g</strong>
                        <span style={{ color: "#0369a1" }}> — one finished unit</span>
                      </div>
                    )}
                    {hasFill && (
                      <div>
                        <strong style={{ fontFamily: "monospace" }}>{fill.toLocaleString("en-AU")} g</strong>
                        <span style={{ color: "#0369a1" }}> — filled per unit before cook</span>
                      </div>
                    )}
                    {hasLoss && (
                      <div>
                        <strong style={{ fontFamily: "monospace" }}>{loss.toFixed(1)}%</strong>
                        <span style={{ color: "#0369a1" }}> — process loss</span>
                      </div>
                    )}
                    {yieldPct != null && (
                      <div>
                        <strong style={{ fontFamily: "monospace" }}>{yieldPct.toFixed(1)}%</strong>
                        <span style={{ color: "#0369a1" }}> — cook yield (target ÷ fill)</span>
                      </div>
                    )}
                    {unitsPerKg != null && (
                      <div>
                        <strong style={{ fontFamily: "monospace" }}>{unitsPerKg.toFixed(unitsPerKg < 1 ? 4 : 2)}</strong>
                        <span style={{ color: "#0369a1" }}> — units per kg of finished</span>
                      </div>
                    )}
                  </div>
                  {(hasFill || hasTarget) && (
                    <div style={{
                      marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px dashed #bae6fd",
                      fontSize: "0.75rem", color: "#0c4a6e",
                    }}>
                      <strong>BOM packaging lines</strong> on this item can now reference{" "}
                      <code style={{ background: "#e0f2fe", padding: "0 0.3rem", borderRadius: 3, fontSize: "0.7rem" }}>per unit</code>
                      {" "}so you can enter e.g. <em>&quot;2 clips per 1 unit&quot;</em> instead of having to calculate clips per kg.
                    </div>
                  )}
                </div>
            )})()}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
             4a-bis. COST / PRICING LOSSES — per-item buffers
                  Pricing pads added on top of COGS in the cost-sheet
                  pricing buildup. Each field left blank inherits the
                  tenant default from /costings/pricing. Tino May 2026.
        ════════════════════════════════════════════════════════════ */}
        <div className="card" style={{ borderLeft: "3px solid #7e22ce" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.25rem" }}>🟣 Cost / Pricing Losses</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Pricing buffers added on top of COGS to reach the minimum sell price.
            Blank = inherit the tenant default from <a href="/costings/pricing" style={{ color: "#b91c1c" }}>/costings/pricing</a>.
            <em style={{ color: "#a8a29e" }}> Cooking loss here is a safety pad on top of the BOM&apos;s yield_factor — not a substitute for it.</em>
            <em style={{ color: "#a8a29e" }}> Giveaway sits on the Packing Attributes panel below.</em>
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
            <div>
              <label className="form-label">Production loss (%)</label>
              <input
                {...inp("production_loss_pct", "leave blank to inherit")}
                type="number" min="0" max="99.99" step="0.01"
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Machine waste, staff drops, spillage</div>
            </div>
            <div>
              <label className="form-label">Cooking loss buffer (%)</label>
              <input
                {...inp("cooking_loss_pct", "leave blank to inherit")}
                type="number" min="0" max="99.99" step="0.01"
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Extra safety pad on TOP of BOM yield_factor</div>
            </div>
            <div>
              <label className="form-label">Packing loss (%)</label>
              <input
                {...inp("packing_loss_pct", "leave blank to inherit")}
                type="number" min="0" max="99.99" step="0.01"
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Breakage / damage at packing</div>
            </div>
            <div>
              <label className="form-label">Open packs (%)</label>
              <input
                {...inp("open_pack_pct", "leave blank to inherit")}
                type="number" min="0" max="99.99" step="0.01"
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.25rem" }}>Samples / opened / rejected packs</div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════
             4b. PACKAGING — sizes + materials + shelf life
                  Visible when item is FG OR has pack data populated.
        ════════════════════════════════════════════════════════════ */}
        {showPackingAttrs && (
        <div className="card" style={{ borderLeft: "3px solid #16a34a" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem", gap: "0.5rem", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>🟢 Packing Attributes</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              {hasInheritedPacking && (
                <button
                  type="button"
                  onClick={useParentPacking}
                  className="btn-secondary"
                  style={{ fontSize: "0.7rem", padding: "0.25rem 0.55rem" }}
                  title="Clear all packing fields so this item inherits values from its parent in the family tree"
                >↑ Use parent&apos;s values</button>
              )}
              <span style={{ fontSize: "0.7rem", color: "#78716c" }}>
                {packingSectionAutoShow ? `Auto-shown (${showFG ? "item type" : "data present"})` : "Manually shown"}
              </span>
            </div>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Pack sizes, packaging materials, and shelf life. Pallet config (TI/HI, dimensions) lives in <a href="/settings/pallet-configs" style={{ color: "#b91c1c" }}>Settings → Pallet Configs</a>.
          </p>

          {/* Pack hierarchy */}
          <div style={{ display: "grid", gridTemplateColumns: showFixedWeight ? "repeat(3, 1fr)" : "repeat(3, 1fr)", gap: "1rem" }}>
            {showFixedWeight && (
              <>
                <div>
                  <label className="form-label">Tare / Packaging Weight (g)</label>
                  <input {...inp("tare_weight_g", inheritedHint("tare_weight_g", "e.g. 25"))} type="number" min="0" step="1" />
                </div>
                <div>
                  <label className="form-label">Tolerance Over (g)</label>
                  <input {...inp("tolerance_over_g", inheritedHint("tolerance_over_g", "e.g. 15"))} type="number" min="0" step="1" />
                </div>
                <div>
                  <label className="form-label">Tolerance Under (g)</label>
                  <input {...inp("tolerance_under_g", inheritedHint("tolerance_under_g", "e.g. 0"))} type="number" min="0" step="1" />
                </div>
              </>
            )}
            {/* ── Pack hierarchy LEAVES (operator-entered) ── */}
            <div>
              <label className="form-label">Pieces per Inner</label>
              <input
                {...inp("units_per_inner", inheritedHint("units_per_inner", "e.g. 4"))}
                type="number" min="1" step="1"
              />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                Individual pieces in one inner pack/tray.
                {(() => {
                  const target = parseFloat(form.target_weight_g) || (inheritedAttrs.target_weight_g ?? 0);
                  const upi = parseFloat(form.units_per_inner);
                  if (target > 0 && upi > 0) {
                    const perInner = target * upi;
                    return <> Inner weight: <strong style={{ color: "#1c1917" }}>{perInner.toFixed(2)} g</strong> ({target} g × {upi} pcs)</>;
                  }
                  return null;
                })()}
              </div>
            </div>
            <div>
              <label className="form-label">Inners per Outer</label>
              <input {...inp("inner_per_outer", inheritedHint("inner_per_outer", "e.g. 6"))} type="number" min="1" step="1" />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>Inner trays in one outer carton</div>
            </div>
            <div>
              <label className="form-label">Outers per Pallet</label>
              <input {...inp("outers_per_pallet", inheritedHint("outers_per_pallet", "e.g. 90"))} type="number" min="1" step="1" />
              <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>Outer cartons stacked on one pallet</div>
            </div>

            {/* ── Pack hierarchy DERIVED (read-only — DB trigger fills them) ── */}
            {(() => {
              const upi = parseInt(form.units_per_inner) || 0;
              const ipo = parseInt(form.inner_per_outer) || 0;
              const opp = parseInt(form.outers_per_pallet) || 0;
              const tw  = parseFloat(form.target_weight_g) || 0;
              const ppo = upi && ipo ? upi * ipo : null;
              const ppp = ppo && opp ? ppo * opp : null;
              const cellStyle: React.CSSProperties = {
                background: "#f7f5f2", border: "1px dashed #d6d3d1",
                padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
                fontFamily: "monospace", fontSize: "0.875rem",
                color: ppo ? "#1c1917" : "#a8a29e", fontWeight: ppo ? 600 : 400,
              };
              return (
                <>
                  <div>
                    <label className="form-label" style={{ color: "#78716c" }}>Pieces per Outer (auto)</label>
                    <div style={cellStyle}>
                      {ppo != null ? ppo.toLocaleString("en-AU") : "—"}
                      {ppo != null && tw > 0 && (
                        <span style={{ color: "#a8a29e", fontWeight: 400, marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                          ≈ {((ppo * tw) / 1000).toFixed(2)} kg/outer
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>= Pieces/Inner × Inners/Outer</div>
                  </div>
                  <div>
                    <label className="form-label" style={{ color: "#78716c" }}>Pieces per Pallet (auto)</label>
                    <div style={cellStyle}>
                      {ppp != null ? ppp.toLocaleString("en-AU") : "—"}
                      {ppp != null && tw > 0 && (
                        <span style={{ color: "#a8a29e", fontWeight: 400, marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                          ≈ {((ppp * tw) / 1000).toFixed(1)} kg/pallet
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>= Pieces/Outer × Outers/Pallet</div>
                  </div>
                </>
              );
            })()}

            {/* ── Giveaway as a percentage of target weight ── */}
            <div>
              <label className="form-label">Giveaway %</label>
              <input {...inp("giveaway_pct")} type="number" min="0" max="100" step="0.01" placeholder="e.g. 2.0" />
              {(() => {
                const pct = parseFloat(form.giveaway_pct);
                const tw  = parseFloat(form.target_weight_g);
                const grams = !isNaN(pct) && !isNaN(tw) ? (tw * pct) / 100 : null;
                return (
                  <div style={{ fontSize: "0.7rem", color: "#a8a29e", marginTop: "0.2rem" }}>
                    Typical overshoot as % of target — comparable across products
                    {grams != null && grams > 0 && <> · ≈ {grams.toFixed(1)} g per piece</>}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Packaging materials */}
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label">Packaging Materials Used</label>
            <textarea {...inp("packaging_materials", "One per line, or comma separated. e.g.\nPVDC vacuum bag\nWhite card carton\nRetail label")}
              className="form-input" rows={3} style={{ resize: "vertical" }} />
            <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
              List all packaging materials this product uses. Saved as an array — printed on the GB spec / PIF.
            </p>
          </div>

          {/* Shelf life */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            <div>
              <label className="form-label">Shelf Life (from manufacture)</label>
              <input {...inp("spec_shelf_life", "e.g. 21 days")} />
            </div>
            <div>
              <label className="form-label">Min Shelf Life on Dispatch (days)</label>
              <input {...inp("min_shelf_life_days", "e.g. 14")} type="number" min="0" step="1" />
            </div>
          </div>
        </div>
        )}

        {/* ── Section override toggles ──
            Last-resort escape hatch when the auto-detect above is wrong for an
            unusual item (e.g. a WIP that we also sell raw, or a packing-only
            consumable that doesn't fit the type heuristic). */}
        {!fillSectionAutoShow && !forceShowFill && (
          <button type="button" onClick={() => setForceShowFill(true)}
            style={{ background: "none", border: "1px dashed #93c5fd", color: "#1e40af",
              padding: "0.4rem 0.75rem", borderRadius: "0.375rem", fontSize: "0.75rem",
              cursor: "pointer", marginTop: "-0.5rem" }}>
            + Add Filling Attributes section
          </button>
        )}
        {!packingSectionAutoShow && !forceShowPacking && (
          <button type="button" onClick={() => setForceShowPacking(true)}
            style={{ background: "none", border: "1px dashed #86efac", color: "#166534",
              padding: "0.4rem 0.75rem", borderRadius: "0.375rem", fontSize: "0.75rem",
              cursor: "pointer", marginTop: "-0.5rem" }}>
            + Add Packing Attributes section
          </button>
        )}

        {/* ════════════════════════════════════════════════════════════
             5. SELLING PRICE  (FG only)
        ════════════════════════════════════════════════════════════ */}
        {showFG && (
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Selling Price</h2>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
              {form.weight_mode === "fixed" ? "Price per inner pack." : "Price per kg — invoiced on actual dispatched weight."}
            </p>
            {form.weight_mode === "fixed" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                <div>
                  <label className="form-label">Price per Inner (AUD) *</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", pointerEvents: "none" }}>$</span>
                    <input {...inp("sell_price_per_inner", "e.g. 4.50")} type="number" min="0" step="0.01" style={{ paddingLeft: "1.375rem" }} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Calculated $/kg</label>
                  <div style={{ padding: "0.5rem 0.75rem", background: "#f5f5f4", borderRadius: "0.375rem", border: "1px solid var(--border)", fontSize: "0.875rem", color: "#57534e", minHeight: "2.25rem", display: "flex", alignItems: "center" }}>
                    {(() => {
                      const price = parseFloat(form.sell_price_per_inner);
                      const upi = parseInt(form.units_per_inner);
                      const wg  = parseFloat(form.target_weight_g);
                      if (price > 0 && upi > 0 && wg > 0) return `$${(price / ((upi * wg) / 1000)).toFixed(2)}/kg`;
                      return <span style={{ color: "#a8a29e" }}>Set price + weight above</span>;
                    })()}
                  </div>
                </div>
                <div>
                  <label className="form-label">Carton price (calculated)</label>
                  <div style={{ padding: "0.5rem 0.75rem", background: "#f5f5f4", borderRadius: "0.375rem", border: "1px solid var(--border)", fontSize: "0.875rem", color: "#57534e", minHeight: "2.25rem", display: "flex", alignItems: "center" }}>
                    {(() => {
                      const price = parseFloat(form.sell_price_per_inner);
                      const ipc = parseInt(form.inner_per_outer);
                      if (price > 0 && ipc > 0) return `$${(price * ipc).toFixed(2)}/carton`;
                      return <span style={{ color: "#a8a29e" }}>Set price + carton qty above</span>;
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label className="form-label">Price per kg (AUD) *</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#78716c", pointerEvents: "none" }}>$</span>
                    <input {...inp("sell_price_per_kg", "e.g. 12.50")} type="number" min="0" step="0.01" style={{ paddingLeft: "1.375rem" }} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Est. carton value (calc)</label>
                  <div style={{ padding: "0.5rem 0.75rem", background: "#f5f5f4", borderRadius: "0.375rem", border: "1px solid var(--border)", fontSize: "0.875rem", color: "#57534e", minHeight: "2.25rem", display: "flex", alignItems: "center" }}>
                    {(() => {
                      const ppk = parseFloat(form.sell_price_per_kg);
                      const ipc = parseInt(form.inner_per_outer);
                      const upi = parseInt(form.units_per_inner);
                      const wg  = parseFloat(form.target_weight_g);
                      if (ppk > 0 && ipc > 0 && upi > 0 && wg > 0) {
                        const kg = (ipc * upi * wg) / 1000;
                        return `~$${(ppk * kg).toFixed(2)}/carton (${kg.toFixed(1)} kg avg)`;
                      }
                      return <span style={{ color: "#a8a29e" }}>Set price + avg weights above</span>;
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
             6. NUTRITION INFORMATION PANEL  (NIP-style table)
                 + Ingredients statement + Allergen statement + RTE
        ════════════════════════════════════════════════════════════ */}
        {(showFG || showWIP) && (
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Nutrition Information Panel</h2>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
              Average values per 100 g. Per-serve column auto-calculates from the serving size.
            </p>

            {/* Serving size */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label className="form-label">Serving size (g)</label>
                <input {...inp("nut_per_serving_g", "e.g. 100")} type="number" min="0" step="0.1" />
              </div>
              <div style={{ display: "flex", paddingBottom: "0.125rem", flexDirection: "column", alignItems: "flex-start", gap: "0.375rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                  <input type="checkbox" checked={form.is_rte} onChange={e => set("is_rte", e.target.checked)} />
                  <strong>Ready to Eat (RTE)</strong>
                </label>
                {/* Large item — suppresses NIP serves-per-pack / serving-size
                    on the spec for whole-muscle products. Tino May 2026. */}
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}
                  title="Tick for whole-muscle / random-weight products like hams or chorizo logs. The spec NIP will show per-100g only — no Per Serving column."
                >
                  <input type="checkbox" checked={form.nip_large_item} onChange={e => set("nip_large_item", e.target.checked)} />
                  <span>Large item (no per-serving on NIP)</span>
                </label>
              </div>
            </div>

            {/* NIP table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", marginBottom: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1c1917" }}>
                  <th style={{ textAlign: "left",  padding: "0.5rem 0.625rem", fontWeight: 600, color: "#1c1917" }}>Description</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.625rem", fontWeight: 600, color: "#1c1917", width: "180px" }}>Per Serve {serving != null ? `(${serving} g)` : ""}</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.625rem", fontWeight: 600, color: "#1c1917", width: "180px" }}>Per 100 g</th>
                </tr>
              </thead>
              <tbody>
                {/* Energy row (special: kJ/kcal pair) */}
                <tr style={{ borderBottom: "1px solid #f5f5f4", background: "#fafaf9" }}>
                  <td style={{ padding: "0.4rem 0.625rem", fontWeight: 700 }}>Energy</td>
                  <td style={{ padding: "0.4rem 0.625rem", textAlign: "right", color: "#78716c", fontFamily: "monospace" }}>
                    {eServe.kj || "—"} kJ / {eServe.kcal || "—"} kcal
                  </td>
                  <td style={{ padding: "0.4rem 0.625rem" }}>
                    <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", justifyContent: "flex-end" }}>
                      <input {...inp("nut_energy_kj", "kJ")} type="number" min="0" step="1" style={{ width: "70px", textAlign: "right" }} />
                      <span style={{ color: "#78716c", fontSize: "0.7rem" }}>kJ</span>
                      <input {...inp("nut_energy_kcal", "kcal")} type="number" min="0" step="1" style={{ width: "60px", textAlign: "right" }} />
                      <span style={{ color: "#78716c", fontSize: "0.7rem" }}>kcal</span>
                    </div>
                  </td>
                </tr>
                {NUTRITION_ROWS.map(row => {
                  const v = form[row.key] as string;
                  return (
                    <tr key={row.key} style={{ borderBottom: "1px solid #f5f5f4" }}>
                      <td style={{ padding: "0.4rem 0.625rem", fontWeight: row.bold ? 600 : 400, color: "#292524" }}>{row.label}</td>
                      <td style={{ padding: "0.4rem 0.625rem", textAlign: "right", color: "#78716c", fontFamily: "monospace" }}>
                        {perServe(v) ? `${perServe(v)} ${row.unit}` : "—"}
                      </td>
                      <td style={{ padding: "0.4rem 0.625rem" }}>
                        <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", justifyContent: "flex-end" }}>
                          <input
                            className="form-input"
                            type="number" min="0" step="0.01"
                            value={v}
                            onChange={e => set(row.key, e.target.value as FormState[typeof row.key])}
                            placeholder="0.0"
                            style={{ width: "90px", textAlign: "right" }}
                          />
                          <span style={{ color: "#78716c", fontSize: "0.7rem", minWidth: "1.5rem" }}>{row.unit}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginBottom: "0.875rem" }}>
              <label className="form-label">Nutrition notes</label>
              <input {...inp("nut_notes", "e.g. Values from laboratory analysis, Jan 2025")} />
            </div>

            {/* Ingredients statement */}
            <div style={{ marginBottom: "0.875rem" }}>
              <label className="form-label">Ingredients Statement (label-ready)</label>
              <textarea {...inp("ingredients_statement", "e.g. Pork (95%), water, salt, spices, dextrose, sodium nitrite. Contains: WHEAT, SOY.")}
                className="form-input" rows={3} style={{ resize: "vertical" }} />
              <p style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                Listed in descending order by weight. Allergens in CAPITALS. Include % declarations where required.
              </p>
            </div>

            {/* Label classification card moved out of the Nutrition Panel
                — that panel is FG/WIP-only, so raw materials weren't seeing
                it. The dedicated card below renders for raw / packaging /
                consumable items where this data actually lives. */}

            {/* Allergen statement */}
            <div>
              <label className="form-label">Allergen Statement</label>
              {allergenDefs.length === 0 ? (
                <p style={{ fontSize: "0.875rem", color: "#78716c", margin: 0 }}>
                  No allergen standards configured. Set up allergens in Settings &rarr; Allergens.
                </p>
              ) : (() => {
                const grouped = allergenDefs.reduce<Record<string, AllergenDef[]>>((acc, a) => { (acc[a.regulatory_standard] = acc[a.regulatory_standard] ?? []).push(a); return acc; }, {});
                const standards = Object.keys(grouped);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {standards.map(std => (
                      <div key={std}>
                        {standards.length > 1 && (
                          <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
                            {std}
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                          {grouped[std].map(a => (
                            <label key={a.code} title={a.name} style={{
                              display: "flex", alignItems: "center", gap: "0.375rem",
                              padding: "0.3125rem 0.625rem",
                              background: form.allergens.includes(a.code) ? "#fef2f2" : "#fafaf9",
                              border: `1px solid ${form.allergens.includes(a.code) ? "#fca5a5" : "#e7e5e4"}`,
                              borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem",
                            }}>
                              <input type="checkbox" checked={form.allergens.includes(a.code)} onChange={() => toggleAllergen(a.code)} style={{ display: "none" }} />
                              <span style={{ color: form.allergens.includes(a.code) ? "#991b1b" : "#78716c", fontWeight: form.allergens.includes(a.code) ? 600 : 400 }}>
                                {form.allergens.includes(a.code) ? "✓ " : ""}{a.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
             7. MICROBIOLOGICAL REQUIREMENTS  (table)
        ════════════════════════════════════════════════════════════ */}
        {showSpec && (
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Microbiological Requirements</h2>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
              Set the limit per test. Leave blank if not applicable.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1c1917" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.625rem", fontWeight: 600, color: "#1c1917" }}>Test</th>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.625rem", fontWeight: 600, color: "#1c1917" }}>Limit</th>
                </tr>
              </thead>
              <tbody>
                {MICRO_TESTS.map(t => (
                  <tr key={t.key} style={{ borderBottom: "1px solid #f5f5f4" }}>
                    <td style={{ padding: "0.45rem 0.625rem", color: "#1c1917" }}>{t.label}</td>
                    <td style={{ padding: "0.35rem 0.625rem" }}>
                      <input {...inp(t.key, t.ph)} style={{ fontFamily: "monospace" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: "0.75rem" }}>
              <label className="form-label">Reference standard</label>
              <input {...inp("micro_reference", "e.g. FSANZ Standard 1.6.1, customer specification XYZ")} />
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
             8. TAX & ACCOUNTING
        ════════════════════════════════════════════════════════════ */}
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Tax &amp; Accounting</h2>
          <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
            Tax codes for purchases/sales. Accounting codes are used for Xero / MYOB / QuickBooks exports.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label className="form-label">Purchase Tax Code</label>
              <select className="form-select" value={form.purchase_tax_code_id} onChange={e => set("purchase_tax_code_id", e.target.value)}>
                <option value="">— None / Not set —</option>
                {taxCodes.filter(t => t.applies_to === "purchase" || t.applies_to === "both").map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.rate_pct}%)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Sales Tax Code</label>
              <select className="form-select" value={form.sales_tax_code_id} onChange={e => set("sales_tax_code_id", e.target.value)}>
                <option value="">— None / Not set —</option>
                {taxCodes.filter(t => t.applies_to === "sales" || t.applies_to === "both").map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.rate_pct}%)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Purchase Account Code</label>
              <input {...inp("purchase_account_code", "e.g. 300")} style={{ fontFamily: "monospace" }} />
            </div>
            <div>
              <label className="form-label">Sales Account Code</label>
              <input {...inp("sales_account_code", "e.g. 200")} style={{ fontFamily: "monospace" }} />
            </div>
          </div>
        </div>

        {/* Old Label Classification card removed — flat columns couldn't
            represent compound inputs like Opti Form ACE S61 (4 sub-
            ingredients across 2 classes). Phase 3H.3 ships a proper
            sub-grid editor on top of the new item_ingredient_components
            table (mig 098). Tino May 2026. */}

        {/* Purchase UOM (RM / packaging / consumable) */}
        {(showRM || form.item_type === "packaging" || form.item_type === "consumable") && (
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: "600", margin: "0 0 0.25rem" }}>Purchase UOM</h2>
            <p style={{ fontSize: "0.8125rem", color: "#78716c", margin: "0 0 1rem" }}>
              How you buy this item - e.g. you buy pork in 30 kg bins but stock it in kg.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <label className="form-label">Purchase Unit</label>
                {uoms.length > 0 ? (
                  <SearchableSelect
                    value={form.purchase_uom}
                    onChange={v => set("purchase_uom", v)}
                    placeholder="-- Select unit --"
                    options={uoms.map(u => ({ value: u.code, label: `${u.code} - ${u.name}` }))}
                  />
                ) : <input {...inp("purchase_uom", "e.g. bin, bag, carton")} />}
              </div>
              <div>
                <label className="form-label">Qty per Purchase Unit</label>
                <input {...inp("purchase_uom_qty", "e.g. 30")} type="number" min="0" step="0.001" />
                {form.purchase_uom && form.purchase_uom_qty && form.unit && (
                  <div style={{ fontSize: "0.7rem", color: "#78716c", marginTop: "0.25rem" }}>
                    1 {form.purchase_uom} = {form.purchase_uom_qty} {form.unit}
                  </div>
                )}
              </div>
              <div>
                <label className="form-label">Qty Type</label>
                <select className="form-select" value={form.purchase_uom_type} onChange={e => set("purchase_uom_type", e.target.value)}>
                  <option value="fixed">Fixed - exact qty every time</option>
                  <option value="average">Average - weighed at receipt</option>
                </select>
              </div>
              <div><label className="form-label">Unit Price (per purchase unit)</label><input {...inp("purchase_unit_price", "e.g. 89.50")} type="number" min="0" step="0.01" /></div>
              <div><label className="form-label">Purchase Currency</label><input {...inp("purchase_currency", "AUD")} style={{ fontFamily: "monospace" }} /></div>
            </div>
          </div>
        )}

        {/* Spacer so the fixed footer doesn't cover the last card */}
        <div style={{ paddingBottom: "5rem" }} />
      </form>
      {/* Fixed footer */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid #e7e5e4",
        padding: "0.75rem 1.25rem",
        display: "flex", justifyContent: "flex-end", gap: "0.625rem",
        zIndex: 30,
      }}>
        <Link href="/items" className="btn-secondary">Cancel</Link>
        <button
          type="submit"
          form="item-form"
          className="btn-primary"
          disabled={saving || codeStatus === "taken" || canEdit === false}
        >
          {saving ? "Saving..." : mode === "create" ? "Create Item" : "Save Changes"}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", color: "#991b1b", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
