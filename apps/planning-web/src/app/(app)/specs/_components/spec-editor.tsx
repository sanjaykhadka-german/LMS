"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { draftProductSpec, sendProductSpec } from "../actions";
import { CountryMark } from "@/components/coo-country-mark";

// ─── Types ────────────────────────────────────────────────────────────────────

type Item = {
  id: string; code: string; name: string; item_type: string;
  department: string | null; unit: string | null;
  spec_storage_temp: string | null; spec_shelf_life: string | null;
  spec_notes: string | null; spec_origin: string | null;
  spec_fat_content: string | null; spec_protein: string | null;
  spec_moisture: string | null; spec_ph: string | null;
  spec_water_activity: string | null; spec_micro: string | null;
  spec_packaging: string | null; spec_labelling: string | null;
  nut_energy_kj: number | null; nut_energy_kcal: number | null;
  nut_protein_g: number | null; nut_fat_total_g: number | null;
  nut_fat_saturated_g: number | null; nut_fat_trans_g: number | null;
  nut_carbs_total_g: number | null; nut_carbs_sugars_g: number | null;
  nut_fibre_g: number | null; nut_sodium_mg: number | null;
  nut_per_serving_g: number | null; nut_notes: string | null;
  allergens: string[] | null;
  target_weight_g: number | null;
  units_per_inner: number | null; inner_per_outer: number | null; units_per_outer: number | null;
};

type Spec = {
  id: string; version: number; version_label: string; status: "draft" | "approved";
  approved_at: string | null; internal_notes: string | null;
  spec_storage_temp: string | null; spec_shelf_life: string | null;
  spec_notes: string | null; spec_origin: string | null;
  spec_fat_content: string | null; spec_protein: string | null;
  spec_moisture: string | null; spec_ph: string | null;
  spec_water_activity: string | null; spec_micro: string | null;
  spec_packaging: string | null; spec_labelling: string | null;
  nut_energy_kj: number | null; nut_energy_kcal: number | null;
  nut_protein_g: number | null; nut_fat_total_g: number | null;
  nut_fat_saturated_g: number | null; nut_fat_trans_g: number | null;
  nut_carbs_total_g: number | null; nut_carbs_sugars_g: number | null;
  nut_fibre_g: number | null; nut_sodium_mg: number | null;
  nut_per_serving_g: number | null; nut_notes: string | null;
  allergens: string[] | null;
  item: Item | null;
  approver: { id: string; full_name: string } | null;
  creator: { id: string; full_name: string } | null;
  sends: {
    id: string; document_type: string; sent_at: string; version_label: string;
    recipient_name: string | null; recipient_email: string | null; notes: string | null;
    customer: { id: string; name: string } | null;
    sender: { id: string; full_name: string } | null;
  }[];
};

type PalletConfig = {
  id: string; item_id: string;
  ti: number | null; hi: number | null; units_per_pallet: number | null;
  carton_length_mm: number | null; carton_width_mm: number | null; carton_height_mm: number | null;
  carton_gross_weight_kg: number | null; carton_net_weight_kg: number | null;
  pallet_type: string; pallet_length_mm: number | null; pallet_width_mm: number | null;
  stack_height_mm: number | null; total_pallet_weight_kg: number | null; notes: string | null;
};

type SpecImage = {
  id: string; image_type: "hero" | "packed" | "other";
  storage_path: string; public_url: string | null;
  caption: string | null; display_order: number;
};

interface Props {
  mode: "new" | "edit";
  spec: Spec | null;
  prefillItem: Item | null;
  nextVersion: number;
  palletConfig: PalletConfig | null;
  images: SpecImage[];
  userId: string;
  tenantId: string;
  userRole: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: number | null | undefined) { return v != null ? String(v) : ""; }

const ALLERGEN_OPTIONS = [
  "Gluten","Wheat","Rye","Barley","Oats","Milk","Eggs","Fish","Shellfish",
  "Tree Nuts","Peanuts","Soy","Sesame","Lupin","Molluscs","Mustard","Celery","Sulphites",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpecEditor({ mode, spec, prefillItem, nextVersion, palletConfig, images: initImages, userId, tenantId, userRole }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const canEdit = ["admin", "manager", "super_admin"].includes(userRole);
  const canApprove = ["admin", "super_admin"].includes(userRole);

  // ── Search state (item picker for new spec) ─────────────────────────────────
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState<Pick<Item, "id" | "code" | "name" | "item_type">[]>([]);
  const [itemSearching, setItemSearching] = useState(false);
  const itemSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(prefillItem);

  // ── Form fields ─────────────────────────────────────────────────────────────
  const init = spec;
  const item = selectedItem ?? prefillItem;

  function ef(specField: string | null, itemField: string | null) {
    return specField ?? itemField ?? "";
  }
  function nf(specField: number | null, itemField: number | null) {
    return specField != null ? String(specField) : itemField != null ? String(itemField) : "";
  }

  const [versionLabel, setVersionLabel] = useState(init?.version_label ?? `${nextVersion}.0`);
  const [internalNotes, setInternalNotes] = useState(init?.internal_notes ?? "");

  // Spec fields
  const [storageTemp, setStorageTemp] = useState(ef(init?.spec_storage_temp ?? null, item?.spec_storage_temp ?? null));
  // Storage class radio — Chilled / Frozen / Ambient. When set, the spec
  // sheet renders the canonical wording (<5°C / -18°C / Ambient). The
  // free-text storageTemp above is still the override path. Tino May 2026.
  const [storageClass, setStorageClass] = useState<string>(
    (init as { storage_class?: string | null })?.storage_class ?? ""
  );
  // Lab-tested toggle drives the NIP disclaimer on the spec sheet
  // (mig 095). Default false → "Theoretical values" prints.
  const [labTested, setLabTested] = useState<boolean>(
    !!(init as { nutrition_lab_tested?: boolean })?.nutrition_lab_tested
  );
  const [shelfLife, setShelfLife] = useState(ef(init?.spec_shelf_life ?? null, item?.spec_shelf_life ?? null));
  const [specNotes, setSpecNotes] = useState(ef(init?.spec_notes ?? null, item?.spec_notes ?? null));
  const [origin, setOrigin] = useState(ef(init?.spec_origin ?? null, item?.spec_origin ?? null));
  const [fatContent, setFatContent] = useState(ef(init?.spec_fat_content ?? null, item?.spec_fat_content ?? null));
  const [protein, setProtein] = useState(ef(init?.spec_protein ?? null, item?.spec_protein ?? null));
  const [moisture, setMoisture] = useState(ef(init?.spec_moisture ?? null, item?.spec_moisture ?? null));
  const [ph, setPh] = useState(ef(init?.spec_ph ?? null, item?.spec_ph ?? null));
  const [waterActivity, setWaterActivity] = useState(ef(init?.spec_water_activity ?? null, item?.spec_water_activity ?? null));
  const [micro, setMicro] = useState(ef(init?.spec_micro ?? null, item?.spec_micro ?? null));
  const [packaging, setPackaging] = useState(ef(init?.spec_packaging ?? null, item?.spec_packaging ?? null));
  const [labelling, setLabelling] = useState(ef(init?.spec_labelling ?? null, item?.spec_labelling ?? null));

  // Nutrition
  const [nutEnergyKj, setNutEnergyKj] = useState(nf(init?.nut_energy_kj ?? null, item?.nut_energy_kj ?? null));
  const [nutEnergyKcal, setNutEnergyKcal] = useState(nf(init?.nut_energy_kcal ?? null, item?.nut_energy_kcal ?? null));
  const [nutProtein, setNutProtein] = useState(nf(init?.nut_protein_g ?? null, item?.nut_protein_g ?? null));
  const [nutFatTotal, setNutFatTotal] = useState(nf(init?.nut_fat_total_g ?? null, item?.nut_fat_total_g ?? null));
  const [nutFatSat, setNutFatSat] = useState(nf(init?.nut_fat_saturated_g ?? null, item?.nut_fat_saturated_g ?? null));
  const [nutFatTrans, setNutFatTrans] = useState(nf(init?.nut_fat_trans_g ?? null, item?.nut_fat_trans_g ?? null));
  const [nutCarbsTotal, setNutCarbsTotal] = useState(nf(init?.nut_carbs_total_g ?? null, item?.nut_carbs_total_g ?? null));
  const [nutCarbsSugars, setNutCarbsSugars] = useState(nf(init?.nut_carbs_sugars_g ?? null, item?.nut_carbs_sugars_g ?? null));
  const [nutFibre, setNutFibre] = useState(nf(init?.nut_fibre_g ?? null, item?.nut_fibre_g ?? null));
  const [nutSodium, setNutSodium] = useState(nf(init?.nut_sodium_mg ?? null, item?.nut_sodium_mg ?? null));
  const [nutPerServing, setNutPerServing] = useState(nf(init?.nut_per_serving_g ?? null, item?.nut_per_serving_g ?? null));
  const [nutNotes, setNutNotes] = useState(ef(init?.nut_notes ?? null, item?.nut_notes ?? null));

  const [allergens, setAllergens] = useState<string[]>(init?.allergens ?? item?.allergens ?? []);

  // Migration 091 additions — populated by the BOM-walk auto-pop engine
  // (draftProductSpec) but always editable. Saved to product_specs.
  const [ingredientsStatement, setIngredientsStatement] = useState<string>(
    (init as { ingredients_statement?: string | null })?.ingredients_statement ?? "",
  );
  const [countryOfOrigin, setCountryOfOrigin] = useState<string>(
    (init as { country_of_origin?: string | null })?.country_of_origin ?? "",
  );
  const [heatingInstructions, setHeatingInstructions] = useState<string>(
    (init as { heating_instructions?: string | null })?.heating_instructions ?? "",
  );
  const [minLifeOnReceival, setMinLifeOnReceival] = useState<string>(
    nf((init as { min_life_on_receival_days?: number | null })?.min_life_on_receival_days ?? null, null),
  );
  const [packTareWeightInner, setPackTareWeightInner] = useState<string>(
    nf((init as { pack_tare_weight_inner_g?: number | null })?.pack_tare_weight_inner_g ?? null, null),
  );
  const [barcodeOverride, setBarcodeOverride] = useState<string>(
    (init as { barcode_override?: string | null })?.barcode_override ?? "",
  );

  // Auto-pop UI state — running, last warnings/missing components shown
  // as a dismissible card after a run.
  const [autopopBusy, setAutopopBusy] = useState(false);
  const [autopopMsg, setAutopopMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  // Phase 3H.5 v2: CoO breakdown panel — populated by Auto-fill from BOM.
  // Holds the structured per-country and per-ingredient origin breakdown so
  // we can render a % bar + tables on the new "CoO" tab. Stays null until
  // the operator runs Auto-fill (or until we hydrate it on edit by re-
  // running draftProductSpec server-side, see hydrateCooBreakdown effect).
  type CooBreakdown = {
    summary: string | null;
    localCountry: string | null;
    localAdjective: string | null;
    localPct: number;
    knownCoverage: number;
    byCountry: { country: string; pct: number }[];
    byIngredient: { name: string; country: string; pct: number; class: string | null }[];
  };
  const [cooBreakdown, setCooBreakdown] = useState<CooBreakdown | null>(null);
  // Persisted toggle — when ON the customer-facing PDF prints the breakdown
  // panel under the CoO statement; default OFF preserves legacy behaviour.
  const [showCooBreakdown, setShowCooBreakdown] = useState<boolean>(
    !!(init as { coo_show_breakdown?: boolean })?.coo_show_breakdown,
  );

  // Phase 3H.5 v3 (Tino May 8 2026): hydrate the CoO breakdown on mount so
  // operators don't have to re-click Auto-fill every time they re-open a
  // spec. Cheap to recompute (server-side BOM walk) and keeps the panel
  // showing live data tied to the current ingredient component countries.
  useEffect(() => {
    if (!selectedItem?.id) return;
    if (cooBreakdown) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await draftProductSpec(selectedItem.id);
        if (!cancelled && res.data?.cooBreakdown) {
          setCooBreakdown(res.data.cooBreakdown);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id]);

  // Pallet config
  const [pallet, setPallet] = useState({
    ti: n(palletConfig?.ti),
    hi: n(palletConfig?.hi),
    carton_length_mm: n(palletConfig?.carton_length_mm),
    carton_width_mm: n(palletConfig?.carton_width_mm),
    carton_height_mm: n(palletConfig?.carton_height_mm),
    carton_gross_weight_kg: n(palletConfig?.carton_gross_weight_kg),
    carton_net_weight_kg: n(palletConfig?.carton_net_weight_kg),
    pallet_type: palletConfig?.pallet_type ?? "plain",
    pallet_length_mm: n(palletConfig?.pallet_length_mm),
    pallet_width_mm: n(palletConfig?.pallet_width_mm),
    stack_height_mm: n(palletConfig?.stack_height_mm),
    total_pallet_weight_kg: n(palletConfig?.total_pallet_weight_kg),
    notes: palletConfig?.notes ?? "",
  });

  // Images
  const [images, setImages] = useState<SpecImage[]>(initImages);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Send modal
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendForm, setSendForm] = useState({ docType: "spec", recipientName: "", recipientEmail: "", customerId: "", notes: "" });
  const [sendSaving, setSendSaving] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"spec" | "nutrition" | "coo" | "pallet" | "images" | "sends">("spec");

  // ── Item search ─────────────────────────────────────────────────────────────
  function triggerItemSearch(q: string) {
    setItemSearch(q);
    if (itemSearchTimer.current) clearTimeout(itemSearchTimer.current);
    if (!q) { setItemResults([]); return; }
    setItemSearching(true);
    itemSearchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("items")
        .select("id, code, name, item_type")
        .eq("is_active", true)
        // Include wipf (filling stage) and wipp (packing stage) — German
        // Butchery's WIP tree splits Filling vs Packaging into distinct types,
        // not just "wip". Without these the picker silently hides things like
        // 2015.100 Chorizo 100g WIPF and W - 2015.100.03 Chorizo (3) WIPP.
        .in("item_type", ["finished_good", "wip", "wipf", "wipp"])
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .order("code")
        .limit(20);
      setItemResults(data ?? []);
      setItemSearching(false);
    }, 250);
  }

  async function pickItem(picked: Pick<Item, "id" | "code" | "name" | "item_type">) {
    setItemResults([]);
    setItemSearch("");
    // Fetch full item data
    const { data } = await supabase
      .from("items")
      .select(`
        id, code, name, item_type, department, unit,
        spec_storage_temp, spec_shelf_life, spec_notes, spec_origin,
        spec_fat_content, spec_protein, spec_moisture, spec_ph,
        spec_water_activity, spec_micro, spec_packaging, spec_labelling,
        nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_fibre_g, nut_sodium_mg, nut_per_serving_g, nut_notes,
        allergens, target_weight_g, units_per_inner, inner_per_outer, units_per_outer
      `)
      .eq("id", picked.id)
      .single();
    if (data) {
      setSelectedItem(data as Item);
      // Prefill fields from item master
      setStorageTemp(data.spec_storage_temp ?? "");
      setShelfLife(data.spec_shelf_life ?? "");
      setSpecNotes(data.spec_notes ?? "");
      setOrigin(data.spec_origin ?? "");
      setFatContent(data.spec_fat_content ?? "");
      setProtein(data.spec_protein ?? "");
      setMoisture(data.spec_moisture ?? "");
      setPh(data.spec_ph ?? "");
      setWaterActivity(data.spec_water_activity ?? "");
      setMicro(data.spec_micro ?? "");
      setPackaging(data.spec_packaging ?? "");
      setLabelling(data.spec_labelling ?? "");
      setNutEnergyKj(n(data.nut_energy_kj));
      setNutEnergyKcal(n(data.nut_energy_kcal));
      setNutProtein(n(data.nut_protein_g));
      setNutFatTotal(n(data.nut_fat_total_g));
      setNutFatSat(n(data.nut_fat_saturated_g));
      setNutFatTrans(n(data.nut_fat_trans_g));
      setNutCarbsTotal(n(data.nut_carbs_total_g));
      setNutCarbsSugars(n(data.nut_carbs_sugars_g));
      setNutFibre(n(data.nut_fibre_g));
      setNutSodium(n(data.nut_sodium_mg));
      setNutPerServing(n(data.nut_per_serving_g));
      setNutNotes(data.nut_notes ?? "");
      setAllergens(data.allergens ?? []);
      // Tino May 7 v3: when picking a different item dynamically (not from
      // the URL ?item_id= path) the page-level nextVersion is still the
      // initial 1, so saving a draft against an item that already has a
      // v1.0 violates the unique (tenant_id, item_id, version) constraint.
      // Re-count specs for the freshly-picked item and bump the version
      // label to (max(version) + 1).0 so Save Draft always lands cleanly.
      if (mode === "new") {
        const { data: existing } = await supabase
          .from("product_specs")
          .select("version")
          .eq("item_id", picked.id)
          .order("version", { ascending: false })
          .limit(1);
        const maxV = (existing && existing[0]?.version) ?? 0;
        setVersionLabel(`${maxV + 1}.0`);
      }
    }
  }

  // ── BOM-walk auto-pop ───────────────────────────────────────────────────
  // Calls the server action draftProductSpec(itemId) which recursively
  // walks the active BOMs from this finished good down to root raw
  // materials, then aggregates ingredients_statement (with > 5%
  // declarations), allergens (union), packaging, weighted nutrition.
  // Prefers BOM-derived values for the fields it computes; preserves
  // anything the operator has already filled. Sets autopopMsg with a
  // summary + warnings (e.g. nutrition components missing data).
  async function handleAutoFillFromBom() {
    if (!selectedItem) { setAutopopMsg({ kind: "err", text: "Pick a product first." }); return; }
    setAutopopBusy(true);
    setAutopopMsg(null);
    try {
      const res = await draftProductSpec(selectedItem.id);
      if (res.error || !res.data) {
        setAutopopMsg({ kind: "err", text: res.error ?? "Auto-fill failed." });
        return;
      }
      const d = res.data;

      // Apply only when the user hasn't already entered something —
      // we don't want to silently overwrite their work. Operator can
      // explicitly clear a field then re-run if they want a refresh.
      const apply = (cur: string, next: string | null | undefined) => (cur.trim() === "" && next ? next : cur);
      const applyN = (cur: string, next: number | null | undefined) =>
        (cur.trim() === "" && next != null ? String(Number(next.toFixed(2))) : cur);

      setIngredientsStatement(prev => apply(prev, d.ingredients_statement));
      // Allergens — replace if currently empty, else merge unique.
      setAllergens(prev => {
        if (prev.length === 0) return d.allergens;
        const merged = new Set([...prev, ...d.allergens]);
        return [...merged].sort();
      });
      setCountryOfOrigin(prev => apply(prev, d.tenantDefaults.country_of_origin));
      // Phase 3H.5 v2: capture the structured breakdown for the CoO tab.
      // Always overwrites — this is a recompute, not a user-typed override.
      setCooBreakdown(d.cooBreakdown);
      // Heating instructions — defer to AI/manual, leave alone here.
      // Pack size + barcode from item defaults
      setBarcodeOverride(prev => apply(prev, d.itemDefaults.barcode));

      // Storage / shelf life from item attributes
      setStorageTemp(prev => apply(prev, d.itemDefaults.spec_storage_temp));
      setShelfLife(prev => apply(prev, d.itemDefaults.spec_shelf_life));

      // Nutrition — ALWAYS fill what we have. Components missing data
      // contributed 0 in the engine, so the value is conservatively
      // understated. The result chip below loudly warns about coverage
      // so the operator can chase up the offending items in Item Master
      // and re-run auto-fill once they're fixed.
      const nut = d.nutrition;
      setNutEnergyKj(prev => applyN(prev, nut.nut_energy_kj));
      setNutEnergyKcal(prev => applyN(prev, nut.nut_energy_kcal));
      setNutProtein(prev => applyN(prev, nut.nut_protein_g));
      setNutFatTotal(prev => applyN(prev, nut.nut_fat_total_g));
      setNutFatSat(prev => applyN(prev, nut.nut_fat_saturated_g));
      setNutFatTrans(prev => applyN(prev, nut.nut_fat_trans_g));
      setNutCarbsTotal(prev => applyN(prev, nut.nut_carbs_total_g));
      setNutCarbsSugars(prev => applyN(prev, nut.nut_carbs_sugars_g));
      setNutFibre(prev => applyN(prev, nut.nut_fibre_g));
      setNutSodium(prev => applyN(prev, nut.nut_sodium_mg));

      // Packaging description — list of names if not already set.
      if (d.packaging.length > 0) {
        setPackaging(prev => apply(prev, d.packaging.map(p => p.name).join(", ")));
      }

      // Build a friendly result summary.
      const summary: string[] = [];
      summary.push(`✓ Filled ingredients (${d.ingredients_statement.split(",").length} components from BOM walk)`);
      summary.push(`✓ Allergens: ${d.allergens.length > 0 ? d.allergens.join(", ") : "none"}`);

      // Nutrition coverage: now we always fill values (treating missing
      // components as zero), but loudly flag coverage so the operator
      // knows to chase up the items missing data on Item Master.
      if (d.nutrition.nutrition_complete) {
        summary.push("✓ Nutrition (per 100g) auto-calculated from BOM weighted averages — full coverage");
      } else if (d.nutrition.missing_components.length > 0) {
        // Show worst-coverage field % so operator knows the magnitude.
        const cov = Object.entries(d.nutrition.coverage);
        const minCov = cov.length > 0 ? Math.min(...cov.map(([, v]) => v)) : 0;
        const minPct = Math.round(minCov * 100);
        const items = d.nutrition.missing_components;
        const itemList = items.slice(0, 5).join(", ") + (items.length > 5 ? ` + ${items.length - 5} more` : "");
        summary.push(
          `⚠ Nutrition partially filled (lowest coverage ${minPct}%) — ${items.length} item${items.length === 1 ? "" : "s"} on Item Master ` +
          `${items.length === 1 ? "is" : "are"} missing nutrition data: ${itemList}. ` +
          `Values shown UNDERSTATE actual nutrition (missing data treated as zero). ` +
          `Update the items, then re-click Auto-fill to refresh.`
        );
      }
      if (d.warnings.length > 0) summary.push(...d.warnings.map(w => `⚠ ${w}`));
      setAutopopMsg({
        kind: d.warnings.length > 0 || !d.nutrition.nutrition_complete ? "warn" : "ok",
        text: summary.join(" · "),
      });
    } catch (e) {
      setAutopopMsg({ kind: "err", text: e instanceof Error ? e.message : "Auto-fill failed." });
    } finally {
      setAutopopBusy(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave(asDraft = true) {
    if (!selectedItem) { setError("Please select a product first."); return; }
    setSaving(true); setError("");

    // Tino May 7 v3: derive numeric version from versionLabel ("2.0" → 2)
    // when creating a new spec, so the unique (tenant_id, item_id, version)
    // key always matches the label the operator sees. Otherwise an item
    // dynamically picked in the editor (without ?item_id= in the URL)
    // would still try to save version=1 against an item that already has a
    // v1, hitting the duplicate-key error.
    const labelMajor = parseInt((versionLabel.split(".")[0] ?? "1").trim(), 10);
    const versionNumber = mode === "new"
      ? (Number.isFinite(labelMajor) && labelMajor > 0 ? labelMajor : nextVersion)
      : spec!.version;
    const payload = {
      tenant_id: tenantId,
      item_id: selectedItem.id,
      version: versionNumber,
      version_label: versionLabel,
      status: asDraft ? "draft" : "approved",
      internal_notes: internalNotes || null,
      spec_storage_temp: storageTemp || null,
      storage_class: storageClass || null,
      nutrition_lab_tested: labTested,
      spec_shelf_life: shelfLife || null,
      spec_notes: specNotes || null,
      spec_origin: origin || null,
      spec_fat_content: fatContent || null,
      spec_protein: protein || null,
      spec_moisture: moisture || null,
      spec_ph: ph || null,
      spec_water_activity: waterActivity || null,
      spec_micro: micro || null,
      spec_packaging: packaging || null,
      spec_labelling: labelling || null,
      nut_energy_kj: nutEnergyKj ? parseFloat(nutEnergyKj) : null,
      nut_energy_kcal: nutEnergyKcal ? parseFloat(nutEnergyKcal) : null,
      nut_protein_g: nutProtein ? parseFloat(nutProtein) : null,
      nut_fat_total_g: nutFatTotal ? parseFloat(nutFatTotal) : null,
      nut_fat_saturated_g: nutFatSat ? parseFloat(nutFatSat) : null,
      nut_fat_trans_g: nutFatTrans ? parseFloat(nutFatTrans) : null,
      nut_carbs_total_g: nutCarbsTotal ? parseFloat(nutCarbsTotal) : null,
      nut_carbs_sugars_g: nutCarbsSugars ? parseFloat(nutCarbsSugars) : null,
      nut_fibre_g: nutFibre ? parseFloat(nutFibre) : null,
      nut_sodium_mg: nutSodium ? parseFloat(nutSodium) : null,
      nut_per_serving_g: nutPerServing ? parseFloat(nutPerServing) : null,
      nut_notes: nutNotes || null,
      allergens: allergens.length > 0 ? allergens : null,
      // Migration 091 fields — auto-pop targets these so they need to
      // round-trip on save. Empty string → null so the DB doesn't store
      // empty strings for nullable text columns.
      ingredients_statement: ingredientsStatement.trim() || null,
      country_of_origin:     countryOfOrigin.trim() || null,
      coo_show_breakdown:    showCooBreakdown,
      heating_instructions:  heatingInstructions.trim() || null,
      min_life_on_receival_days: minLifeOnReceival.trim()
        ? parseInt(minLifeOnReceival, 10) : null,
      pack_tare_weight_inner_g:  packTareWeightInner.trim()
        ? parseFloat(packTareWeightInner) : null,
      barcode_override: barcodeOverride.trim() || null,
      created_by: mode === "new" ? userId : undefined,
      updated_at: new Date().toISOString(),
    };

    let specId = spec?.id;

    if (mode === "new") {
      const { data, error: err } = await supabase
        .from("product_specs")
        .insert({ ...payload })
        .select("id")
        .single();
      if (err) { setError(err.message); setSaving(false); return; }
      specId = data.id;
    } else {
      const { error: err } = await supabase
        .from("product_specs")
        .update(payload)
        .eq("id", spec!.id);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    // Save pallet config
    const palletPayload = {
      tenant_id: tenantId,
      item_id: selectedItem.id,
      ti: pallet.ti ? parseInt(pallet.ti) : null,
      hi: pallet.hi ? parseInt(pallet.hi) : null,
      carton_length_mm: pallet.carton_length_mm ? parseInt(pallet.carton_length_mm) : null,
      carton_width_mm: pallet.carton_width_mm ? parseInt(pallet.carton_width_mm) : null,
      carton_height_mm: pallet.carton_height_mm ? parseInt(pallet.carton_height_mm) : null,
      carton_gross_weight_kg: pallet.carton_gross_weight_kg ? parseFloat(pallet.carton_gross_weight_kg) : null,
      carton_net_weight_kg: pallet.carton_net_weight_kg ? parseFloat(pallet.carton_net_weight_kg) : null,
      pallet_type: pallet.pallet_type,
      pallet_length_mm: pallet.pallet_length_mm ? parseInt(pallet.pallet_length_mm) : null,
      pallet_width_mm: pallet.pallet_width_mm ? parseInt(pallet.pallet_width_mm) : null,
      stack_height_mm: pallet.stack_height_mm ? parseInt(pallet.stack_height_mm) : null,
      total_pallet_weight_kg: pallet.total_pallet_weight_kg ? parseFloat(pallet.total_pallet_weight_kg) : null,
      notes: pallet.notes || null,
      updated_at: new Date().toISOString(),
    };

    if (palletConfig?.id) {
      await supabase.from("item_pallet_config").update(palletPayload).eq("id", palletConfig.id);
    } else if (pallet.ti || pallet.hi || pallet.carton_length_mm) {
      await supabase.from("item_pallet_config").insert(palletPayload);
    }

    setSaving(false);
    router.push(`/specs/${specId}`);
    router.refresh();
  }

  // ── Approve ─────────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!spec) return;
    setApproving(true); setError("");
    const { error: err } = await supabase
      .from("product_specs")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userId })
      .eq("id", spec.id);
    if (err) { setError(err.message); setApproving(false); return; }
    setApproving(false);
    router.refresh();
  }

  // ── Image upload ─────────────────────────────────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, imageType: "hero" | "packed" | "other") {
    const file = e.target.files?.[0];
    if (!file || !selectedItem) return;
    setUploadingImage(true);
    const path = `spec-images/${tenantId}/${selectedItem.id}/${imageType}-${Date.now()}.${file.name.split(".").pop()}`;
    const { error: upErr } = await supabase.storage.from("spec-images").upload(path, file, { upsert: true });
    if (upErr) { setError(upErr.message); setUploadingImage(false); return; }

    const { data: urlData } = supabase.storage.from("spec-images").getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const { data: imgData } = await supabase
      .from("spec_images")
      .insert({
        tenant_id: tenantId,
        item_id: selectedItem.id,
        spec_id: spec?.id ?? null,
        image_type: imageType,
        storage_path: path,
        public_url: publicUrl,
        display_order: images.filter(i => i.image_type === imageType).length,
      })
      .select()
      .single();

    if (imgData) setImages(prev => [...prev, imgData as SpecImage]);
    setUploadingImage(false);
    e.target.value = "";
  }

  async function handleDeleteImage(imgId: string, storagePath: string) {
    await supabase.storage.from("spec-images").remove([storagePath]);
    await supabase.from("spec_images").delete().eq("id", imgId);
    setImages(prev => prev.filter(i => i.id !== imgId));
  }

  // ── Send to customer ─────────────────────────────────────────────────────────
  // Tino May 2026: was doing a DB-only insert which is why the May 6 test
  // email never arrived in the gmail account. Now calls the sendProductSpec
  // server action which fires Resend + writes the audit row in one step.
  // Sender + tenants.qa_email are auto-Cc'd by the action.
  async function handleSend() {
    if (!spec || !selectedItem) return;
    if (!sendForm.recipientEmail?.trim()) {
      setError("Recipient email is required.");
      return;
    }
    setError(null);
    setSendSaving(true);

    const result = await sendProductSpec({
      specId: spec.id,
      documentType: sendForm.docType as "spec" | "pif",
      recipientName: sendForm.recipientName?.trim() || null,
      recipientEmail: sendForm.recipientEmail.trim(),
      customerId: sendForm.customerId || null,
      notes: sendForm.notes?.trim() || null,
    });

    setSendSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Send failed.");
      return;
    }
    setShowSendModal(false);
    router.refresh();
  }

  // Field / NumField hoisted to module scope (below this component) so React
  // doesn't recreate them on every render — that was unmounting the inputs
  // on every keystroke, so the operator couldn't actually type into spec
  // fields. Tino May 2026.

  const heroImages = images.filter(i => i.image_type === "hero");
  const packedImages = images.filter(i => i.image_type === "packed");
  const otherImages = images.filter(i => i.image_type === "other");

  const isApproved = spec?.status === "approved";

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: "900px" }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Link href="/specs" style={{ color: "#78716c", fontSize: "0.8125rem", textDecoration: "none" }}>Specs</Link>
            <span style={{ color: "#a8a29e" }}>/</span>
            <span style={{ color: "#a8a29e", fontSize: "0.8125rem" }}>
              {mode === "new" ? "New Spec" : `${spec?.item ? (spec.item as any).name : ""} v${spec?.version_label}`}
            </span>
          </div>
          <h1 className="page-title" style={{ marginBottom: "0.25rem" }}>
            {mode === "new" ? "New Product Spec" : `${(spec?.item as any)?.name ?? "Spec"}`}
          </h1>
          {mode === "edit" && spec && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "0.375rem",
                padding: "0.2rem 0.6rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600,
                background: isApproved ? "rgba(34,197,94,0.15)" : "rgba(234,179,8,0.15)",
                color: isApproved ? "#4ade80" : "#facc15",
              }}>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: isApproved ? "#4ade80" : "#facc15" }} />
                {isApproved ? "Approved" : "Draft"}
              </span>
              <span style={{ color: "#57534e", fontSize: "0.8125rem" }}>v{spec.version_label}</span>
              {spec.approved_at && spec.approver && (
                <span style={{ color: "#57534e", fontSize: "0.75rem" }}>
                  Approved by {spec.approver.full_name} on {new Date(spec.approved_at).toLocaleDateString("en-AU")}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.625rem", alignItems: "center", flexShrink: 0 }}>
          {mode === "edit" && spec && (
            <Link
              href={`/specs/${spec.id}/preview`}
              style={{ padding: "0.5rem 1rem", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 500, background: "#fff", border: "1px solid #e7e5e4", color: "#1c1917", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Preview
            </Link>
          )}
          {mode === "edit" && spec && !isApproved && canApprove && (
            <button
              onClick={handleApprove}
              disabled={approving}
              style={{ padding: "0.5rem 1rem", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 600, background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", cursor: "pointer" }}
            >
              {approving ? "Approving…" : "✓ Approve"}
            </button>
          )}
          {/* Send button intentionally lives on /specs/[id]/preview now —
              Tino May 2026 wanted the send action next to the print preview,
              not buried in the editor toolbar. The Sends tab below still
              shows the audit history of past sends. */}
          {canEdit && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? "Saving…" : "Save Draft"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", borderRadius: "0.5rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Item picker (new mode only) */}
      {mode === "new" && (
        <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700, color: "#1c1917" }}>Select Product</h2>
          {selectedItem ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", background: "#fafaf9", borderRadius: "0.5rem", border: "1px solid #e7e5e4" }}>
              <div>
                <div style={{ fontWeight: 600, color: "#1c1917" }}>{selectedItem.name}</div>
                <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{selectedItem.code} · {selectedItem.item_type.replace(/_/g, " ")}</div>
              </div>
              <button onClick={() => setSelectedItem(null)} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", padding: "0.25rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={itemSearch}
                onChange={e => triggerItemSearch(e.target.value)}
                placeholder="Type to search products…"
                className="input"
                style={{ width: "100%", boxSizing: "border-box" }}
                autoComplete="off"
              />
              {(itemSearching || itemResults.length > 0) && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.5rem", zIndex: 50, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                  {itemSearching ? (
                    <div style={{ padding: "0.75rem 1rem", color: "#78716c", fontSize: "0.8125rem" }}>Searching…</div>
                  ) : itemResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => pickItem(r)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "0.625rem 1rem", background: "none", border: "none", cursor: "pointer", borderBottom: "1px solid #e7e5e4", color: "#1c1917" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f4")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{r.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{r.code} · {r.item_type.replace(/_/g, " ")}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Version */}
      <div className="card" style={{ marginBottom: "1.5rem", padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700, color: "#1c1917" }}>Version</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Version Label</label>
            <input
              type="text"
              value={versionLabel}
              onChange={e => setVersionLabel(e.target.value)}
              placeholder="e.g. 1.0, 2.1"
              style={{ width: "100%", padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", color: "#1c1917", fontSize: "0.875rem", boxSizing: "border-box" }}
            />
          </div>
          <Field label="Internal Notes" value={internalNotes} onChange={setInternalNotes} placeholder="Notes for internal use only (not printed on spec sheet)" />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0", marginBottom: "0", borderBottom: "1px solid #e7e5e4" }}>
        {(["spec", "nutrition", "coo", "pallet", "images", "sends"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "0.625rem 1.125rem", background: "none", border: "none", cursor: "pointer",
              fontSize: "0.875rem", fontWeight: activeTab === tab ? 700 : 400,
              color: activeTab === tab ? "#f5f5f4" : "#78716c",
              borderBottom: activeTab === tab ? "2px solid #b91c1c" : "2px solid transparent",
              marginBottom: "-1px", textTransform: tab === "coo" ? "none" : "capitalize",
            }}
          >
            {tab === "sends"
              ? `Sends${spec?.sends?.length ? ` (${spec.sends.length})` : ""}`
              : tab === "coo"
              ? "CoO"
              : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Auto-fill from BOM walk — ABOVE the tabs ──────────────────────
          Pulled out of the Spec tab and lifted above the tab bar so it
          stays visible regardless of which tab the operator is viewing.
          This action affects fields across BOTH the Spec tab (ingredients,
          allergens, country, storage, etc) AND the Nutrition tab (the
          weighted per-100g aggregates). Hiding it on a single tab made it
          easy to miss. */}
      <div className="card" style={{ marginBottom: "0.75rem", padding: "0.875rem 1rem", borderRadius: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={handleAutoFillFromBom}
            disabled={!selectedItem || autopopBusy}
            style={{
              padding: "0.55rem 1rem", borderRadius: "0.375rem", border: "1px solid #b91c1c",
              background: "#b91c1c", color: "#fff", cursor: !selectedItem || autopopBusy ? "not-allowed" : "pointer",
              fontSize: "0.875rem", fontWeight: 600,
              opacity: !selectedItem || autopopBusy ? 0.6 : 1,
            }}
          >
            {autopopBusy ? "Walking BOM…" : "✨ Auto-fill from BOM"}
          </button>
          <span style={{ fontSize: "0.75rem", color: "#78716c", flex: 1, minWidth: "260px" }}>
            Recursively walks the active BOM from this product to all raw materials. Fills ingredients (Spec tab), allergens, nutrition (Nutrition tab — per 100g, weighted), country of origin, packaging, storage temp, shelf life. Only fills BLANK fields — your existing entries are preserved.
          </span>
        </div>
        {autopopMsg && (
          <div style={{
            marginTop: "0.625rem", padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
            background:
              autopopMsg.kind === "ok"   ? "rgba(34,197,94,0.1)"
            : autopopMsg.kind === "warn" ? "rgba(245,158,11,0.1)"
                                          : "rgba(239,68,68,0.1)",
            border:
              autopopMsg.kind === "ok"   ? "1px solid rgba(34,197,94,0.3)"
            : autopopMsg.kind === "warn" ? "1px solid rgba(245,158,11,0.3)"
                                          : "1px solid rgba(239,68,68,0.3)",
            color:
              autopopMsg.kind === "ok"   ? "#166534"
            : autopopMsg.kind === "warn" ? "#854d0e"
                                          : "#991b1b",
            fontSize: "0.8125rem", lineHeight: 1.5,
          }}>
            {autopopMsg.text}
          </div>
        )}
      </div>

      {/* Tab: Spec */}
      {activeTab === "spec" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          {/* ── New spec fields (migration 091): ingredients statement,
              CoO, heating instructions, MLOR, pack tare, barcode override.
              These all auto-fill via the BOM walk. ───────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <Field label="Ingredients statement (auto-filled from BOM walk)" value={ingredientsStatement} onChange={setIngredientsStatement} multiline placeholder="e.g. Pork (72%), Water, Starch (Potato), Salt, Spices..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <Field label="Country of Origin" value={countryOfOrigin} onChange={setCountryOfOrigin} placeholder='e.g. "Made in Australia from local and imported ingredients"' />
            <Field label="MLOR (Min Life on Receival, days)" value={minLifeOnReceival} onChange={setMinLifeOnReceival} placeholder="e.g. 28" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.25rem" }}>
            <Field label="Pack Tare Weight Inner (g)" value={packTareWeightInner} onChange={setPackTareWeightInner} placeholder="e.g. 12" />
            <Field label="Barcode (override)" value={barcodeOverride} onChange={setBarcodeOverride} placeholder="Leave blank to use item's barcode" />
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
            <Field label="Heating instructions" value={heatingInstructions} onChange={setHeatingInstructions} multiline placeholder='e.g. "Heat in microwave on high for 2-3 minutes" or "Ready to eat — refrigerate after opening"' />
          </div>

          {/* Storage class radio (Tino May 2026). Pick one and the spec
              renders the canonical wording. The free-text Storage
              Temperature field below stays as an override. */}
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#57534e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>Storage Class</label>
            <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
              {[
                { v: "chilled", label: "Chilled (<5°C)" },
                { v: "frozen",  label: "Frozen (-18°C)" },
                { v: "ambient", label: "Ambient" },
              ].map(opt => (
                <label key={opt.v} style={{
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                  padding: "0.4rem 0.75rem",
                  border: `1px solid ${storageClass === opt.v ? "#1e40af" : "#d6d3d1"}`,
                  background: storageClass === opt.v ? "#dbeafe" : "#fff",
                  color: storageClass === opt.v ? "#1e3a8a" : "#1c1917",
                  borderRadius: "9999px",
                  fontSize: "0.8125rem", fontWeight: 600,
                  cursor: "pointer",
                }}>
                  <input
                    type="radio"
                    name="storage_class"
                    value={opt.v}
                    checked={storageClass === opt.v}
                    onChange={e => setStorageClass(e.target.value)}
                    style={{ margin: 0 }}
                  />
                  {opt.label}
                </label>
              ))}
              {storageClass && (
                <button
                  type="button"
                  onClick={() => setStorageClass("")}
                  style={{ background: "none", border: "1px dashed #d6d3d1", color: "#78716c", borderRadius: "9999px", padding: "0.4rem 0.75rem", fontSize: "0.75rem", cursor: "pointer" }}
                  title="Clear the storage class to fall back on the free-text Storage Temperature field below."
                >× Clear</button>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
            <Field label="Storage Temperature (override)" value={storageTemp} onChange={setStorageTemp} placeholder="e.g. 0–4°C — only fill if you need a custom range" />
            <Field label="Shelf Life" value={shelfLife} onChange={setShelfLife} placeholder="e.g. 21 days from manufacture" />
            <Field label="Origin (legacy text)" value={origin} onChange={setOrigin} placeholder='Use "Country of Origin" above for the PIF render' />
            <Field label="Fat Content" value={fatContent} onChange={setFatContent} placeholder="e.g. max 30%" />
            <Field label="Protein" value={protein} onChange={setProtein} placeholder="e.g. min 12%" />
            <Field label="Moisture" value={moisture} onChange={setMoisture} placeholder="e.g. max 70%" />
            <Field label="pH" value={ph} onChange={setPh} placeholder="e.g. 6.0–6.4" />
            <Field label="Water Activity (Aw)" value={waterActivity} onChange={setWaterActivity} placeholder="e.g. max 0.97" />
          </div>
          <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "1fr", gap: "1.25rem" }}>
            <Field label="Microbiological Standards" value={micro} onChange={setMicro} multiline placeholder="e.g. TPC <100,000 CFU/g, Listeria Not Detected..." />
            <Field label="Packaging" value={packaging} onChange={setPackaging} multiline placeholder="e.g. Vacuum-packed in cryovac bag, outer carton 300x200x100mm" />
            <Field label="Labelling" value={labelling} onChange={setLabelling} multiline placeholder="e.g. Label includes product name, use-by date, batch number, ingredients..." />
            <Field label="Spec Notes" value={specNotes} onChange={setSpecNotes} multiline placeholder="Additional spec notes..." />
          </div>

          {/* Allergens */}
          <div style={{ marginTop: "1.5rem" }}>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Allergens</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {ALLERGEN_OPTIONS.map(a => (
                <button
                  key={a}
                  onClick={() => setAllergens(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])}
                  style={{
                    padding: "0.25rem 0.75rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 600,
                    cursor: "pointer", border: allergens.includes(a) ? "1px solid #b91c1c" : "1px solid #e7e5e4",
                    background: allergens.includes(a) ? "rgba(185,28,28,0.2)" : "#1c1917",
                    color: allergens.includes(a) ? "#fca5a5" : "#78716c",
                    transition: "all 0.1s",
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
            {allergens.length > 0 && (
              <div style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#a8a29e" }}>
                Contains: <strong style={{ color: "#fca5a5" }}>{allergens.join(", ")}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Nutrition */}
      {activeTab === "nutrition" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.875rem", color: "#78716c" }}>
            Per serving / per 100g. These values override the item master nutrition data on the spec sheet.
          </p>
          {/* Lab-tested toggle (Tino May 2026, mig 095). Drives the
              "Lab tested" vs "Theoretical values" disclaimer printed
              under the NIP on the spec sheet. */}
          <div style={{ marginBottom: "1.25rem", padding: "0.625rem 0.875rem", border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: labTested ? "#ecfdf5" : "#fefce8", display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <input
              type="checkbox"
              id="lab-tested"
              checked={labTested}
              onChange={e => setLabTested(e.target.checked)}
              style={{ margin: 0 }}
            />
            <label htmlFor="lab-tested" style={{ flex: 1, cursor: "pointer", fontSize: "0.875rem", fontWeight: 600, color: labTested ? "#166534" : "#92400e" }}>
              {labTested ? "✓ Lab tested values" : "⚠ Theoretical values (no lab certificate)"}
            </label>
            <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
              Toggles the disclaimer line under the NIP on the printed spec.
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
            <NumField label="Serving Size" value={nutPerServing} onChange={setNutPerServing} unit="g" />
            <NumField label="Energy" value={nutEnergyKj} onChange={setNutEnergyKj} unit="kJ" />
            <NumField label="Energy" value={nutEnergyKcal} onChange={setNutEnergyKcal} unit="kcal" />
            <NumField label="Protein" value={nutProtein} onChange={setNutProtein} unit="g" />
            <NumField label="Total Fat" value={nutFatTotal} onChange={setNutFatTotal} unit="g" />
            <NumField label="– Saturated Fat" value={nutFatSat} onChange={setNutFatSat} unit="g" />
            <NumField label="– Trans Fat" value={nutFatTrans} onChange={setNutFatTrans} unit="g" />
            <NumField label="Total Carbohydrate" value={nutCarbsTotal} onChange={setNutCarbsTotal} unit="g" />
            <NumField label="– Sugars" value={nutCarbsSugars} onChange={setNutCarbsSugars} unit="g" />
            <NumField label="Dietary Fibre" value={nutFibre} onChange={setNutFibre} unit="g" />
            <NumField label="Sodium" value={nutSodium} onChange={setNutSodium} unit="mg" />
          </div>
          <div style={{ marginTop: "1.25rem" }}>
            <Field label="Nutrition Notes" value={nutNotes} onChange={setNutNotes} multiline placeholder="e.g. Values are approximate and may vary..." />
          </div>
        </div>
      )}

      {/* Tab: Country of Origin breakdown (Phase 3H.5 v2) */}
      {activeTab === "coo" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#78716c" }}>
            Visualises the live origin breakdown computed from each ingredient&rsquo;s
            <strong> Country of Origin</strong> on the Item Master. Run
            <strong> Auto-fill from BOM</strong> above to (re)compute. Any updates to the
            ingredient component sub-grid flow through on the next auto-fill.
          </p>

          {/* Editable summary statement */}
          <div style={{ marginBottom: "1.25rem" }}>
            <Field
              label="Country of Origin statement (printed on spec)"
              value={countryOfOrigin}
              onChange={setCountryOfOrigin}
              placeholder='e.g. "Made in Australia from at least 75% Australian ingredients"'
            />
          </div>

          {/* Show-on-PDF toggle (Tino May 8 2026): default is HIDDEN —
              ticking the box hides the country bar from the PDF; un-ticking
              shows the country breakdown only (per-ingredient stays internal). */}
          <div style={{ marginBottom: "1.25rem", padding: "0.625rem 0.875rem", border: "1px solid #e7e5e4", borderRadius: "0.5rem", background: !showCooBreakdown ? "#fafaf9" : "#ecfdf5", display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <input
              type="checkbox"
              id="coo-hide-breakdown"
              checked={!showCooBreakdown}
              onChange={e => setShowCooBreakdown(!e.target.checked)}
              style={{ margin: 0 }}
            />
            <label htmlFor="coo-hide-breakdown" style={{ flex: 1, cursor: "pointer", fontSize: "0.875rem", fontWeight: 600, color: "#1c1917" }}>
              {!showCooBreakdown ? "Hide country breakdown on customer spec PDF" : "✓ Country breakdown visible on customer spec PDF"}
            </label>
            <span style={{ fontSize: "0.75rem", color: "#78716c" }}>
              Per-ingredient breakdown is always internal-only.
            </span>
          </div>

          {!cooBreakdown && (
            <div style={{ padding: "1.25rem", background: "#fefce8", border: "1px solid #fde68a", borderRadius: "0.5rem", color: "#78350f", fontSize: "0.875rem", lineHeight: 1.55 }}>
              No breakdown computed yet. Click <strong>✨ Auto-fill from BOM</strong> at the
              top of the page to walk this product&rsquo;s BOM and compute the origin shares
              from each component&rsquo;s declared country.
            </div>
          )}

          {cooBreakdown && (
            <>
              {/* Local-share country mark + coverage hint */}
              {cooBreakdown.localCountry && (
                <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap" }}>
                  <CountryMark
                    country={cooBreakdown.localCountry}
                    adjective={cooBreakdown.localAdjective}
                    localPct={cooBreakdown.localPct}
                    size="md"
                  />
                  <div style={{ flex: 1, minWidth: "240px", fontSize: "0.75rem", color: "#78716c", lineHeight: 1.5 }}>
                    Coverage: {Math.round(cooBreakdown.knownCoverage * 100)}% of ingredient mass has a
                    declared country (the remaining {Math.round((1 - cooBreakdown.knownCoverage) * 100)}% is treated as unknown
                    for this calculation — assign countries on the items&rsquo; component sub-grids to lift coverage).
                    This badge prints on every customer spec PDF as Australia&apos;s consumer-law CoO mark.
                  </div>
                </div>
              )}

              {/* Country breakdown desc */}
              {cooBreakdown.byCountry.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <h3 style={{ margin: "0 0 0.625rem", fontSize: "0.8125rem", fontWeight: 700, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Breakdown by Country
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {cooBreakdown.byCountry.map(row => (
                      <div key={row.country} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 18%) 1fr 70px", gap: "0.625rem", alignItems: "center" }}>
                        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#1c1917", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.country}</div>
                        <div style={{ height: "0.625rem", background: "#f3f4f6", borderRadius: "0.5rem", overflow: "hidden", border: "1px solid #e5e7eb" }}>
                          <div style={{
                            width: `${Math.min(100, Math.max(0, row.pct))}%`,
                            height: "100%",
                            background: row.country === cooBreakdown.localCountry ? "#16a34a" : "#94a3b8",
                          }} />
                        </div>
                        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#1c1917", textAlign: "right" }}>
                          {row.pct.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-ingredient breakdown */}
              {cooBreakdown.byIngredient.length > 0 && (
                <div>
                  <h3 style={{ margin: "0 0 0.625rem", fontSize: "0.8125rem", fontWeight: 700, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Breakdown by Ingredient
                  </h3>
                  <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "0.5rem" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb" }}>
                          <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb" }}>Ingredient</th>
                          <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb" }}>Class</th>
                          <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb" }}>Country</th>
                          <th style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontSize: "0.6875rem", fontWeight: 700, color: "#78716c", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb" }}>% of FG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cooBreakdown.byIngredient.map((row, i) => (
                          <tr key={`${row.name}-${i}`} style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#1c1917" }}>{row.name}</td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#78716c" }}>{row.class ?? "—"}</td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#1c1917", fontWeight: row.country === cooBreakdown.localCountry ? 600 : 400 }}>
                              {row.country === cooBreakdown.localCountry && (
                                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "#16a34a", marginRight: "0.4rem", verticalAlign: "middle" }} />
                              )}
                              {row.country}
                            </td>
                            <td style={{ padding: "0.5rem 0.75rem", color: "#1c1917", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {row.pct.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Pallet Config */}
      {activeTab === "pallet" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.875rem", color: "#78716c" }}>
            Pallet configuration is shared across all spec versions for this product.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>
            <NumField label="Ti (units per layer)" value={pallet.ti} onChange={v => setPallet(p => ({ ...p, ti: v }))} />
            <NumField label="Hi (layers per pallet)" value={pallet.hi} onChange={v => setPallet(p => ({ ...p, hi: v }))} />
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Units per Pallet</label>
              <div style={{ padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", color: "#78716c", fontSize: "0.875rem" }}>
                {pallet.ti && pallet.hi ? parseInt(pallet.ti) * parseInt(pallet.hi) : "—"}
              </div>
            </div>
          </div>

          <h3 style={{ margin: "0 0 1rem", fontSize: "0.875rem", fontWeight: 700, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em" }}>Carton Dimensions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <NumField label="Length" value={pallet.carton_length_mm} onChange={v => setPallet(p => ({ ...p, carton_length_mm: v }))} unit="mm" />
            <NumField label="Width" value={pallet.carton_width_mm} onChange={v => setPallet(p => ({ ...p, carton_width_mm: v }))} unit="mm" />
            <NumField label="Height" value={pallet.carton_height_mm} onChange={v => setPallet(p => ({ ...p, carton_height_mm: v }))} unit="mm" />
            <NumField label="Gross Weight" value={pallet.carton_gross_weight_kg} onChange={v => setPallet(p => ({ ...p, carton_gross_weight_kg: v }))} unit="kg" />
            <NumField label="Net Weight" value={pallet.carton_net_weight_kg} onChange={v => setPallet(p => ({ ...p, carton_net_weight_kg: v }))} unit="kg" />
          </div>

          <h3 style={{ margin: "0 0 1rem", fontSize: "0.875rem", fontWeight: 700, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pallet Dimensions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Pallet Type</label>
              <select
                value={pallet.pallet_type}
                onChange={e => setPallet(p => ({ ...p, pallet_type: e.target.value }))}
                className="input"
                style={{ width: "100%" }}
              >
                <option value="plain">Plain</option>
                <option value="chep">CHEP</option>
                <option value="loscam">Loscam</option>
                <option value="other">Other</option>
              </select>
            </div>
            <NumField label="Length" value={pallet.pallet_length_mm} onChange={v => setPallet(p => ({ ...p, pallet_length_mm: v }))} unit="mm" />
            <NumField label="Width" value={pallet.pallet_width_mm} onChange={v => setPallet(p => ({ ...p, pallet_width_mm: v }))} unit="mm" />
            <NumField label="Stack Height" value={pallet.stack_height_mm} onChange={v => setPallet(p => ({ ...p, stack_height_mm: v }))} unit="mm" />
            <NumField label="Total Weight" value={pallet.total_pallet_weight_kg} onChange={v => setPallet(p => ({ ...p, total_pallet_weight_kg: v }))} unit="kg" />
          </div>
          <Field label="Pallet Notes" value={pallet.notes} onChange={v => setPallet(p => ({ ...p, notes: v }))} placeholder="e.g. Must be stretch-wrapped, 2 strapping bands required" />
        </div>
      )}

      {/* Tab: Images */}
      {activeTab === "images" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          {!selectedItem ? (
            <p style={{ color: "#78716c", fontSize: "0.875rem" }}>Select a product first to upload images.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>
              {(["hero", "packed", "other"] as const).map(type => {
                const typeImages = images.filter(i => i.image_type === type);
                const labels = { hero: "Hero Shot", packed: "Packed Product", other: "Other" };
                return (
                  <div key={type}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#a8a29e", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.75rem" }}>
                      {labels[type]}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {typeImages.map(img => (
                        <div key={img.id} style={{ position: "relative", borderRadius: "0.5rem", overflow: "hidden", border: "1px solid #e7e5e4", background: "#fafaf9" }}>
                          {img.public_url ? (
                            <img src={img.public_url} alt={img.caption ?? type} style={{ width: "100%", height: "160px", objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ height: "160px", display: "flex", alignItems: "center", justifyContent: "center", color: "#57534e", fontSize: "0.75rem" }}>No preview</div>
                          )}
                          <button
                            onClick={() => handleDeleteImage(img.id, img.storage_path)}
                            style={{ position: "absolute", top: "0.5rem", right: "0.5rem", background: "rgba(0,0,0,0.7)", border: "none", borderRadius: "0.25rem", color: "#f87171", cursor: "pointer", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <label style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                        padding: "0.75rem", borderRadius: "0.5rem", border: "2px dashed #d6d3d1",
                        cursor: uploadingImage ? "not-allowed" : "pointer", color: "#57534e", fontSize: "0.8125rem",
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#3c3533"; e.currentTarget.style.color = "#a8a29e"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#292524"; e.currentTarget.style.color = "#57534e"; }}
                      >
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImageUpload(e, type)} disabled={uploadingImage} />
                        {uploadingImage ? "Uploading…" : "+ Add Image"}
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Sends */}
      {activeTab === "sends" && (
        <div className="card" style={{ padding: "1.5rem", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          {!spec?.sends?.length ? (
            <p style={{ color: "#78716c", fontSize: "0.875rem", margin: 0 }}>No sends recorded yet. Approve the spec and use &quot;Send to Customer&quot; to archive a copy.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e7e5e4" }}>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Date</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Type</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Version</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Recipient</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Customer</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", color: "#78716c", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Sent By</th>
                </tr>
              </thead>
              <tbody>
                {spec.sends.map((send, i) => (
                  <tr key={send.id} style={{ borderBottom: i < spec.sends.length - 1 ? "1px solid #1c1917" : "none" }}>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#a8a29e" }}>
                      {new Date(send.sent_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td style={{ padding: "0.625rem 0.75rem" }}>
                      <span style={{
                        padding: "0.15rem 0.5rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 600,
                        background: send.document_type === "pif" ? "rgba(99,102,241,0.15)" : "rgba(14,165,233,0.15)",
                        color: send.document_type === "pif" ? "#a5b4fc" : "#38bdf8",
                      }}>
                        {send.document_type.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#a8a29e" }}>v{send.version_label}</td>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#a8a29e" }}>v{send.version_label}</td>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#1c1917" }}>
                      <div>{send.recipient_name ?? "-"}</div>
                      {send.recipient_email && <div style={{ fontSize: "0.75rem", color: "#78716c" }}>{send.recipient_email}</div>}
                    </td>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#a8a29e" }}>{send.customer?.name ?? "-"}</td>
                    <td style={{ padding: "0.625rem 0.75rem", color: "#a8a29e" }}>{send.sender?.full_name ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Send to Customer Modal */}
      {showSendModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", border: "1px solid #e7e5e4", borderRadius: "0.75rem", padding: "1.5rem", width: "480px", maxWidth: "95vw", boxShadow: "0 12px 40px rgba(0,0,0,0.18)" }}>
            <h2 style={{ margin: "0 0 1.25rem", fontSize: "1.0625rem", fontWeight: 700, color: "#1c1917" }}>Send to Customer</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase" }}>Document Type</label>
                <select value={sendForm.docType} onChange={e => setSendForm(f => ({ ...f, docType: e.target.value }))} className="input" style={{ width: "100%" }}>
                  <option value="spec">Product Spec Sheet</option>
                  <option value="pif">Product Information Form (PIF)</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase" }}>Recipient Name</label>
                <input type="text" value={sendForm.recipientName} onChange={e => setSendForm(f => ({ ...f, recipientName: e.target.value }))} className="input" style={{ width: "100%", boxSizing: "border-box" }} placeholder="Contact person" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase" }}>Recipient Email</label>
                <input type="email" value={sendForm.recipientEmail} onChange={e => setSendForm(f => ({ ...f, recipientEmail: e.target.value }))} className="input" style={{ width: "100%", boxSizing: "border-box" }} placeholder="email@customer.com" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase" }}>Notes</label>
                <textarea value={sendForm.notes} onChange={e => setSendForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input" style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} placeholder="Optional notes about this send" />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => setShowSendModal(false)} style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid #e7e5e4", borderRadius: "0.5rem", color: "#78716c", cursor: "pointer", fontSize: "0.875rem" }}>
                Cancel
              </button>
              <button onClick={handleSend} disabled={sendSaving} style={{ padding: "0.5rem 1.25rem", background: "#b91c1c", border: "none", borderRadius: "0.5rem", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}>
                {sendSaving ? "Recording..." : "Record Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Module-scope helpers ───────────────────────────────────────────────────
// Tino May 2026: previously these lived INSIDE SpecEditor, which made React
// recreate the component identity on every parent render. The inputs got
// unmounted/remounted on every keystroke and the operator couldn't actually
// type. Hoisted here so the components are stable across renders.

function Field({ label, value, onChange, multiline, placeholder }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          style={{ width: "100%", padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", color: "#1c1917", fontSize: "0.875rem", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", color: "#1c1917", fontSize: "0.875rem", boxSizing: "border-box" }}
        />
      )}
    </div>
  );
}

function NumField({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#78716c", marginBottom: "0.375rem" }}>
        {label}{unit && <span style={{ fontWeight: 400, color: "#57534e", marginLeft: "0.25rem" }}>({unit})</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "0.5rem 0.75rem", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: "0.375rem", color: "#1c1917", fontSize: "0.875rem", boxSizing: "border-box" }}
      />
    </div>
  );
}
                