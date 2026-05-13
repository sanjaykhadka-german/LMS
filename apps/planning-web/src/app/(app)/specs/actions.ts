"use server";

/**
 * Spec / PIF server actions.
 *
 * draftProductSpec(itemId) — recursive BOM walk + auto-pop using the
 *   get_bom_walk RPC (recursive CTE). Reads (no writes).
 *
 * sendProductSpec(input) — Phase 3I.2. Actually sends the spec email via
 *   Resend (was previously a DB-insert-only stub which silently dropped
 *   every send). Auto-Ccs the operator + tenants.qa_email and writes the
 *   delivery audit row to spec_sends with provider_message_id / status /
 *   error_message so failures can be diagnosed.
 */

import { createClient } from "@/lib/supabase/server";
import { renderProductSpecPdfBuffer, type SpecPdfData } from "@/lib/spec-pdf";

export type DraftSpec = {
  treeItems: { id: string; code: string; name: string; depth: number; cumPct: number; isLeaf: boolean }[];
  ingredients_statement: string;
  allergens: string[];
  packaging: { code: string; name: string; qtyPerKgFP: number; unit: string }[];
  nutrition: {
    nut_energy_kj:        number | null;
    nut_energy_kcal:      number | null;
    nut_protein_g:        number | null;
    nut_fat_total_g:      number | null;
    nut_fat_saturated_g:  number | null;
    nut_fat_trans_g:      number | null;
    nut_carbs_total_g:    number | null;
    nut_carbs_sugars_g:   number | null;
    nut_fibre_g:          number | null;
    nut_sodium_mg:        number | null;
    coverage: Record<string, number>;
    nutrition_complete:   boolean;
    missing_components:   string[];
  };
  itemDefaults: {
    name: string | null;
    code: string | null;
    unit: string | null;
    is_rte: boolean | null;
    spec_storage_temp: string | null;
    spec_shelf_life: string | null;
    target_weight_g: number | null;
    fill_weight_g: number | null;
    units_per_inner: number | null;
    units_per_outer: number | null;
    weight_mode: string | null;
    barcode: string | null;
  };
  tenantDefaults: {
    country_of_origin: string | null;
  };
  /** Phase 3H.5: Country of Origin breakdown for the on-screen CoO panel. */
  cooBreakdown: {
    summary: string | null;
    localCountry: string | null;
    localAdjective: string | null;
    localPct: number;
    knownCoverage: number;
    byCountry: { country: string; pct: number }[];
    byIngredient: { name: string; country: string; pct: number; class: string | null }[];
  };
  warnings: string[];
};

const NUT_FIELDS = [
  "nut_energy_kj", "nut_energy_kcal", "nut_protein_g", "nut_fat_total_g",
  "nut_fat_saturated_g", "nut_fat_trans_g", "nut_carbs_total_g",
  "nut_carbs_sugars_g", "nut_fibre_g", "nut_sodium_mg",
] as const;
type NutKey = typeof NUT_FIELDS[number];

export async function draftProductSpec(itemId: string): Promise<{ data?: DraftSpec; error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles").select("tenant_id").eq("id", user.id).single();
  if (!profile) return { error: "Profile not found." };

  type WalkPayload = {
    items: Array<{
      id: string; code: string; name: string; unit: string | null;
      item_type: string | null; consumed_in_weight: boolean | null;
      allergens: string[] | null; is_rte: boolean | null;
      spec_storage_temp: string | null; spec_shelf_life: string | null;
      target_weight_g: number | null; fill_weight_g: number | null;
      units_per_inner: number | null; units_per_outer: number | null;
      weight_mode: string | null; parent_item_id: string | null;
      ingredients_statement: string | null;
      nut_energy_kj: number | null;       nut_energy_kcal: number | null;
      nut_protein_g: number | null;       nut_fat_total_g: number | null;
      nut_fat_saturated_g: number | null; nut_fat_trans_g: number | null;
      nut_carbs_total_g: number | null;   nut_carbs_sugars_g: number | null;
      nut_fibre_g: number | null;         nut_sodium_mg: number | null;
    }>;
    bom_headers: Array<{
      id: string; item_id: string; reference_batch_size: number | string;
      reference_batch_unit: string | null; yield_factor: number | string | null;
      is_active: boolean;
    }>;
    bom_lines: Array<{
      bom_header_id: string; component_item_id: string;
      qty_per_batch: number | string; unit: string | null;
      percentage: number | string | null; basis: string | null;
    }>;
    reached_count: number;
  };

  const [
    { data: walkData, error: walkErr },
    { data: tenant },
    { data: barcodeRow },
  ] = await Promise.all([
    supabase.rpc("get_bom_walk", { p_item_id: itemId }),
    supabase.from("tenants").select("billing_country").eq("id", profile.tenant_id).single(),
    supabase
      .from("item_barcodes")
      .select("barcode_value")
      .eq("item_id", itemId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (walkErr) return { error: `BOM walk RPC: ${walkErr.message}` };
  const walk_ = (walkData ?? null) as WalkPayload | null;
  if (!walk_) return { error: "BOM walk RPC returned no data." };

  const items = walk_.items ?? [];
  const boms  = walk_.bom_headers ?? [];
  const lines = walk_.bom_lines ?? [];

  // Diagnostic — surfaces in the success banner so we can tell at a glance
  // whether the recursive walk reached deep enough or got cut off (e.g. by
  // RLS, by an inactive intermediate BOM, or by the depth cap).
  const warnings: string[] = [];
  warnings.push(`RPC: ${walk_.reached_count ?? items.length} items, ${boms.length} BOMs, ${lines.length} lines.`);

  const itemMap = new Map(items.map(i => [i.id, i]));
  const target = itemMap.get(itemId);
  if (!target) return { error: "Item not found in tenant (RPC)." };

  const bomByItem = new Map<string, typeof boms[number]>();
  for (const b of boms) bomByItem.set(b.item_id, b);
  const linesByBom = new Map<string, typeof lines[number][]>();
  for (const l of lines) {
    const arr = linesByBom.get(l.bom_header_id) ?? [];
    arr.push(l);
    linesByBom.set(l.bom_header_id, arr);
  }

  type LeafContribution = {
    itemId: string;
    code: string;
    name: string;
    pct: number;
    consumedInWeight: boolean;
    allergens: string[];
    nut: Record<NutKey, number | null>;
    qty: number;
    unit: string;
    ingredientsStatement: string | null;
  };
  const treeItems: DraftSpec["treeItems"] = [];
  const weightLeaves: LeafContribution[] = [];
  const packagingLeaves: LeafContribution[] = [];
  const visited = new Set<string>();

  function walk(curId: string, parentPct: number, depth: number) {
    if (depth > 12) {
      warnings.push(`BOM walk hit depth cap at ${depth} (cycle?). Stopped.`);
      return;
    }
    if (visited.has(curId)) {
      warnings.push(`Cycle detected at item ${curId} — stopped to avoid infinite walk.`);
      return;
    }
    visited.add(curId);

    const it = itemMap.get(curId);
    if (!it) {
      warnings.push(`Item ${curId} referenced but not found in RPC payload.`);
      visited.delete(curId);
      return;
    }
    const bom = bomByItem.get(curId);
    const isLeaf = !bom;
    treeItems.push({ id: it.id, code: it.code, name: it.name, depth, cumPct: parentPct, isLeaf });

    if (isLeaf) {
      const nut: Record<NutKey, number | null> = {} as Record<NutKey, number | null>;
      for (const k of NUT_FIELDS) nut[k] = (it as Record<string, unknown>)[k] as number | null;
      const contribution: LeafContribution = {
        itemId: it.id, code: it.code, name: it.name,
        pct: parentPct,
        consumedInWeight: it.consumed_in_weight !== false,
        allergens: (it.allergens as string[] | null) ?? [],
        nut,
        qty: parentPct, unit: it.unit ?? "",
        ingredientsStatement: (it as { ingredients_statement?: string | null }).ingredients_statement ?? null,
      };
      if (contribution.consumedInWeight) weightLeaves.push(contribution);
      else                                packagingLeaves.push(contribution);
      visited.delete(curId);
      return;
    }

    const refBatch = Number(bom!.reference_batch_size) || 0;
    if (refBatch <= 0) {
      warnings.push(`BOM for ${it.code} has zero/missing reference_batch_size; treating as leaf.`);
      visited.delete(curId);
      return;
    }
    const ls = linesByBom.get(bom!.id) ?? [];
    if (ls.length === 0) {
      warnings.push(`BOM for ${it.code} (id ${bom!.id}) has no lines in RPC payload — treating as leaf.`);
      visited.delete(curId);
      return;
    }
    for (const l of ls) {
      const lineQty = Number(l.qty_per_batch) || 0;
      const sharePct = lineQty / refBatch;
      const childPct = parentPct * sharePct;
      walk(l.component_item_id, childPct, depth + 1);
    }
    visited.delete(curId);
  }

  walk(itemId, 1.0, 0);

  // Diagnostic — surface walk results so a "1 component" outcome shows
  // up as "1 weight leaf, 2 packaging leaves" rather than just a count.
  warnings.push(`Walk: ${treeItems.length} nodes (${weightLeaves.length} weight leaves, ${packagingLeaves.length} packaging leaves).`);

  const weightByItem = new Map<string, LeafContribution>();
  for (const l of weightLeaves) {
    const ex = weightByItem.get(l.itemId);
    if (ex) {
      ex.pct += l.pct;
    } else {
      weightByItem.set(l.itemId, { ...l });
    }
  }
  const weightSorted = [...weightByItem.values()].sort((a, b) => b.pct - a.pct);
  // Phase 3H.4 (Tino May 7 v2): class-only ingredients statement.
  // Customers want the FSANZ classification declaration, not the trade
  // name. So the output reads:
  //
  //   Meat (Pork, Chicken), Water, Mineral Salt (451), Preservative (250),
  //   Antioxidant (316), Spice (Paprika, Garlic Powder), …
  //
  // Rules:
  //   - Group by classification (Meat / Water / Mineral Salt / …)
  //   - For Meat: parens shows distinct meat_species (Pork, Chicken)
  //   - For other classes with E-numbers: parens shows distinct E-numbers
  //   - For other classes without E-numbers: parens shows distinct names
  //   - Class with nothing useful in parens prints just the label
  //   - Percentages are intentionally omitted at this stage — operator
  //     adds them by hand if a customer demands percentage labelling.
  //   - Processing aids hidden (FSANZ default).
  //   - Leaves with no components fall through as ungrouped (operator
  //     warning surfaces them so they can be classified).
  const leafIds = weightSorted.map(l => l.itemId);
  type CompRow = {
    item_id: string; name: string; sort_order: number;
    percentage: number | string | null; e_number: string | null;
    meat_species: string | null;
    country_of_origin: string | null;
    is_processing_aid: boolean | null;
    classification: { id: string; code: string; label: string; sort_order: number } | { id: string; code: string; label: string; sort_order: number }[] | null;
  };
  const { data: compsRaw } = leafIds.length > 0
    ? await supabase
        .from("item_ingredient_components")
        .select("item_id, name, sort_order, percentage, e_number, meat_species, country_of_origin, is_processing_aid, classification:classification_id(id, code, label, sort_order)")
        .in("item_id", leafIds)
        .order("sort_order")
    : { data: [] as CompRow[] };
  const compsByItem = new Map<string, CompRow[]>();
  for (const c of (compsRaw ?? []) as CompRow[]) {
    if (c.is_processing_aid) continue;
    const arr = compsByItem.get(c.item_id) ?? [];
    arr.push(c);
    compsByItem.set(c.item_id, arr);
  }

  type Tag = { name: string; eNumber: string | null; species: string | null };
  type Group = { code: string; label: string; sort: number; totalPct: number; tags: Tag[] };
  const groups = new Map<string, Group>();
  const ungroupedNames: string[] = [];
  const unclassifiedLeaves: string[] = [];

  for (const w of weightSorted) {
    const comps = compsByItem.get(w.itemId) ?? [];
    if (comps.length === 0) {
      // No components → fallback to leaf's own name. Surface as a warning.
      ungroupedNames.push(w.ingredientsStatement?.trim() || w.name);
      unclassifiedLeaves.push(`${w.code} ${w.name}`);
      continue;
    }
    // Distribute the leaf's pct across its components. Used for class-level
    // sort ordering only — no pct is rendered in the output (Tino May 7).
    const declared = comps.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
    for (const c of comps) {
      const cls = Array.isArray(c.classification) ? c.classification[0] : c.classification;
      const pctOfLeaf = declared > 0
        ? (Number(c.percentage) || 0) / declared
        : 1 / comps.length;
      const compPct = w.pct * pctOfLeaf;
      if (!cls) {
        ungroupedNames.push(c.e_number ? `${c.name} (${c.e_number})` : c.name);
        continue;
      }
      const g = groups.get(cls.code) ?? { code: cls.code, label: cls.label, sort: cls.sort_order, totalPct: 0, tags: [] };
      g.tags.push({ name: c.name, eNumber: c.e_number, species: c.meat_species });
      g.totalPct += compPct;
      groups.set(cls.code, g);
    }
  }

  function uniqueOrdered(values: (string | null)[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
      const t = (v ?? "").trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  // Tino May 7 v3: sort by total mass contribution descending (highest-pct
  // class first). Tie-breaker is the register sort_order so Meat / Water
  // still appear before minor classes when contributions are equal.
  const groupParts = [...groups.values()]
    .sort((a, b) => (b.totalPct - a.totalPct) || (a.sort - b.sort))
    .map(g => {
      let parens: string[] = [];
      if (g.code === "meat") {
        parens = uniqueOrdered(g.tags.map(t => t.species));
      } else {
        const eNums = uniqueOrdered(g.tags.map(t => t.eNumber));
        if (eNums.length > 0) parens = eNums;
        else parens = uniqueOrdered(g.tags.map(t => t.name));
      }
      // Drop redundant parens when its sole content equals the class label
      // (Water (Water) → Water; Salt (Salt) → Salt; Sugar (Sugar) → Sugar).
      const onlyEqualsLabel = parens.length === 1
        && parens[0].toLowerCase() === g.label.toLowerCase();
      return (parens.length > 0 && !onlyEqualsLabel)
        ? `${g.label} (${parens.join(", ")})`
        : g.label;
    });

  const ingredients_statement = [
    ...uniqueOrdered(ungroupedNames),
    ...groupParts,
  ].join(", ");

  if (unclassifiedLeaves.length > 0) {
    warnings.push(`${unclassifiedLeaves.length} ingredient${unclassifiedLeaves.length !== 1 ? "s" : ""} have no classification — set Class on each via Item Master → Ingredient Composition. Listed inline by name for now: ${unclassifiedLeaves.slice(0, 5).join(", ")}${unclassifiedLeaves.length > 5 ? `, +${unclassifiedLeaves.length - 5} more` : ""}.`);
  }
  warnings.push("Percentages are not auto-calculated on the ingredients statement — add by hand if a customer requires percentage labelling.");


  // Allergen union — filter against the FSANZ Std 1.2.3 / PEAL list so
  // legacy items.allergens entries like "Nitrite" (a preservative, NOT a
  // regulated allergen) don't end up on customer-facing specs. Tino May 2026.
  const FSANZ_ALLERGENS = new Set<string>([
    "milk", "dairy",
    "egg", "eggs",
    "fish",
    "crustacea", "crustaceans",
    "mollusc", "molluscs",
    "wheat", "gluten", "cereals containing gluten",
    "soy", "soya", "soybean", "soybeans",
    "peanut", "peanuts",
    "tree nuts", "tree nut",
    "sesame", "sesame seeds",
    "lupin",
    "sulphites", "sulphite", "sulphur dioxide", "sulphites / sulphur dioxide",
    "fsanz_milk", "fsanz_egg", "fsanz_fish", "fsanz_crustacea",
    "fsanz_mollusc", "fsanz_wheat", "fsanz_gluten", "fsanz_soy",
    "fsanz_peanut", "fsanz_tree_nuts", "fsanz_sesame", "fsanz_lupin",
    "fsanz_sulphites",
  ]);
  const allergenSet = new Set<string>();
  for (const w of weightSorted) {
    for (const a of w.allergens) {
      if (FSANZ_ALLERGENS.has(String(a).toLowerCase().trim())) {
        allergenSet.add(a);
      }
    }
  }
  const allergens = [...allergenSet].sort();

  const packaging = packagingLeaves.map(p => ({
    code: p.code, name: p.name, qtyPerKgFP: p.qty, unit: p.unit,
  }));

  const nutrition: DraftSpec["nutrition"] = {
    nut_energy_kj: null, nut_energy_kcal: null, nut_protein_g: null,
    nut_fat_total_g: null, nut_fat_saturated_g: null, nut_fat_trans_g: null,
    nut_carbs_total_g: null, nut_carbs_sugars_g: null,
    nut_fibre_g: null, nut_sodium_mg: null,
    coverage: {},
    nutrition_complete: true,
    missing_components: [],
  };
  if (weightSorted.length === 0) {
    nutrition.nutrition_complete = false;
  } else {
    const totalWeightPct = weightSorted.reduce((s, w) => s + w.pct, 0);
    const missingComponentsSet = new Set<string>();
    for (const k of NUT_FIELDS) {
      let weighted = 0;
      let coveredPct = 0;
      for (const w of weightSorted) {
        const v = w.nut[k];
        if (v == null) {
          missingComponentsSet.add(`${w.code} ${w.name}`);
          continue;
        }
        weighted += w.pct * Number(v);
        coveredPct += w.pct;
      }
      nutrition[k] = totalWeightPct > 0 ? weighted / totalWeightPct : 0;
      nutrition.coverage[k] = totalWeightPct > 0 ? coveredPct / totalWeightPct : 0;
      if (nutrition.coverage[k] < 1) nutrition.nutrition_complete = false;
    }
    if ((nutrition.coverage.nut_energy_kcal ?? 0) < (nutrition.coverage.nut_energy_kj ?? 0)
        && nutrition.nut_energy_kj != null) {
      nutrition.nut_energy_kcal = nutrition.nut_energy_kj / 4.184;
      nutrition.coverage.nut_energy_kcal = nutrition.coverage.nut_energy_kj;
    }
    nutrition.missing_components = [...missingComponentsSet].sort();
  }

  const primaryBarcode = (barcodeRow as { barcode_value?: string | null } | null)?.barcode_value ?? null;
  const itemDefaults: DraftSpec["itemDefaults"] = {
    name: target.name, code: target.code, unit: target.unit,
    name: target.name, code: target.code, unit: target.unit,
    is_rte: (target as { is_rte?: boolean | null }).is_rte ?? null,
    spec_storage_temp: target.spec_storage_temp,
    spec_shelf_life: target.spec_shelf_life,
    target_weight_g: target.target_weight_g,
    fill_weight_g:   target.fill_weight_g,
    units_per_inner: target.units_per_inner,
    units_per_outer: target.units_per_outer,
    weight_mode: target.weight_mode,
    barcode: primaryBarcode,
  };

  // Phase 3H.5: Country of Origin auto-calc.
  // Build the FSC CoOL summary from per-component country_of_origin on the
  // weight leaves' components. Same compsByItem map computed for the
  // ingredients statement is reused — each component contributes the
  // weighted % of its parent leaf's pct of FG. We bucket by country and
  // compute the local share, then pick the standard wording:
  //   - 100% local            -> "Made in <country> from <country>n ingredients"
  //   - >=50% local           -> "Made in <country> from at least N% <country>n ingredients"
  //   - >0% local + imported  -> "Made in <country> from <country>n and imported ingredients"
  //   - 0% local              -> "Made in <country> from imported ingredients" (operator
  //                              still has to confirm this is real "made in", not just packed)
  //   - no component data     -> falls back to the legacy tenant-billing wording
  const billingCountry = (tenant as { billing_country?: string | null } | null)?.billing_country ?? null;
  const localCountryName = billingCountry === "AU" ? "Australia"
    : billingCountry === "NZ" ? "New Zealand"
    : billingCountry === "GB" ? "United Kingdom"
    : billingCountry === "US" ? "United States"
    : billingCountry;
  const localAdjective = localCountryName === "Australia" ? "Australian"
    : localCountryName === "New Zealand" ? "New Zealand"
    : localCountryName === "United Kingdom" ? "British"
    : localCountryName === "United States" ? "American"
    : localCountryName;

  let cooStatement: string | null = null;
  const cooByCountry = new Map<string, number>();
  // Phase 3H.5 v3 (Tino May 8 2026): aggregate same-named ingredients across
  // multiple weight leaves so an ingredient appearing in N stages shows as a
  // SINGLE row with the summed % of FG, not N separate rows that each
  // exceeded 100% and made no sense to read.
  type IngAgg = { name: string; country: string; class: string | null; contribution: number };
  const cooIngAgg = new Map<string, IngAgg>();
  let cooKnownTotal = 0;
  let cooComponentCount = 0;
  for (const w of weightSorted) {
    const comps = compsByItem.get(w.itemId) ?? [];
    if (comps.length === 0) continue;
    const declared = comps.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
    for (const c of comps) {
      const country = c.country_of_origin;
      if (!country || !country.trim()) continue;
      cooComponentCount++;
      const pctOfLeaf = declared > 0
        ? (Number(c.percentage) || 0) / declared
        : 1 / comps.length;
      const contribution = w.pct * pctOfLeaf;
      const cls = Array.isArray(c.classification) ? c.classification[0] : c.classification;
      cooByCountry.set(country.trim(), (cooByCountry.get(country.trim()) ?? 0) + contribution);
      const key = `${c.name}|${country.trim()}`;
      const prev = cooIngAgg.get(key);
      if (prev) {
        prev.contribution += contribution;
      } else {
        cooIngAgg.set(key, { name: c.name, country: country.trim(), class: cls?.label ?? null, contribution });
      }
      cooKnownTotal += contribution;
    }
  }
  const coverageDenominator = weightSorted.reduce((s, w) => s + w.pct, 0) || 1;
  const cooKnownCoverage = Math.min(1, cooKnownTotal / coverageDenominator);
  // Bug fix: previously pct = contribution * 100 which double-counted the
  // 100x scale. Now we normalize by knownTotal so all ingredient rows sum
  // to 100% (same basis the by-country breakdown uses).
  const cooByCountrySorted = [...cooByCountry.entries()]
    .map(([country, contribution]) => ({ country, pct: cooKnownTotal > 0 ? (contribution / cooKnownTotal) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const cooIngredients = [...cooIngAgg.values()]
    .map(x => ({ name: x.name, country: x.country, class: x.class, pct: cooKnownTotal > 0 ? (x.contribution / cooKnownTotal) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const cooLocalPct = cooKnownTotal > 0
    ? ((cooByCountry.get(localCountryName ?? "") ?? cooByCountry.get(billingCountry ?? "") ?? 0) / cooKnownTotal) * 100
    : 0;

  if (cooComponentCount > 0 && cooKnownTotal > 0 && localCountryName) {
    const localPct = cooLocalPct;
    const isAllLocal = localPct >= 99.5;
    const isMostlyLocal = localPct >= 50 && !isAllLocal;
    const isSomeLocal = localPct > 0 && !isMostlyLocal && !isAllLocal;
    if (isAllLocal) {
      cooStatement = `Made in ${localCountryName} from ${localAdjective} ingredients`;
    } else if (isMostlyLocal) {
      // Round down to nearest 5% — FSC convention. Avoids over-claiming.
      const rounded = Math.max(50, Math.floor(localPct / 5) * 5);
      cooStatement = `Made in ${localCountryName} from at least ${rounded}% ${localAdjective} ingredients`;
    } else if (isSomeLocal) {
      cooStatement = `Made in ${localCountryName} from ${localAdjective} and imported ingredients`;
    } else {
      cooStatement = `Made in ${localCountryName} from imported ingredients`;
    }
  } else if (billingCountry) {
    cooStatement = `Made in ${localCountryName} from local and imported ingredients`;
  }
  const tenantDefaults: DraftSpec["tenantDefaults"] = {
    country_of_origin: cooStatement,
  };

  if (weightLeaves.length === 0 && packagingLeaves.length === 0) {
    warnings.push("No BOM found - auto-pop produced an empty ingredients list. Add an active BOM to this item to enable auto-fill.");
  }

  return {
    data: {
      treeItems,
      ingredients_statement,
      allergens,
      packaging,
      nutrition,
      itemDefaults,
      tenantDefaults,
      cooBreakdown: {
        summary: cooStatement,
        localCountry: localCountryName,
        localAdjective,
        localPct: Math.round(cooLocalPct * 10) / 10,
        knownCoverage: Math.round(cooKnownCoverage * 1000) / 1000,
        byCountry: cooByCountrySorted.map(x => ({ country: x.country, pct: Math.round(x.pct * 10) / 10 })),
        byIngredient: cooIngredients.map(x => ({ name: x.name, country: x.country, pct: Math.round(x.pct * 100) / 100, class: x.class })),
      },
      warnings,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3I.2 — sendProductSpec: actually send the spec email.
// ─────────────────────────────────────────────────────────────────────────────

export type SendSpecInput = {
  specId: string;
  documentType: "spec" | "pif";
  recipientName: string | null;
  recipientEmail: string;
  customerId: string | null;
  notes: string | null;
};

export type SendSpecResult = {
  ok: boolean;
  error?: string;
  providerMessageId?: string;
  sendId?: string;
};

function specBodyToHtml(body: string): string {
  return body
    .split("\n\n")
    .map(p => `<p style="margin:0 0 12px 0;line-height:1.5;color:#1c1917;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export async function sendProductSpec(input: SendSpecInput): Promise<SendSpecResult> {
  const supabase = await createClient();

  // ── Auth + tenant ─────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, tenant_id")
    .eq("id", user.id)
    .single();
  if (!profile?.tenant_id) return { ok: false, error: "Profile/tenant not found." };

  // ── Tenant info (sender, qa_email cc, brand, address for PDF header) ──────
  // Tino May 7 2026 fix: was selecting `address_line_1`/`suburb`/`state`/
  // `postcode` which don't exist — actual columns are billing_address_line1
  // etc. The bad select returned a Supabase error, tenant came back null,
  // and we surfaced the misleading "Tenant not found." error.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("name, abn, qa_email, company_email, company_phone, brand_color, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postcode, billing_country")
    .eq("id", profile.tenant_id)
    .single();
  if (tenantErr || !tenant) return { ok: false, error: tenantErr?.message ?? "Tenant not found." };

  // ── Spec + item (full set — mirrors preview/page.tsx data fetch) ─────────
  const { data: spec, error: specErr } = await supabase
    .from("product_specs")
    .select(`
      id, version_label, status, approved_at,
      ingredients_statement, country_of_origin, spec_origin,
      spec_storage_temp, spec_shelf_life, spec_micro,
      heating_instructions, internal_notes, spec_notes, storage_class, nutrition_lab_tested,
      min_life_on_receival_days, barcode_override,
      allergens,
      nut_energy_kj, nut_protein_g, nut_fat_total_g,
      nut_fat_saturated_g, nut_carbs_total_g, nut_carbs_sugars_g,
      nut_sodium_mg, nut_per_serving_g,
      item:items(
        id, code, name, weight_mode, is_rte, nip_large_item,
        target_weight_g, fill_weight_g,
        units_per_inner, units_per_outer, units_per_pallet,
        spec_storage_temp, spec_shelf_life, spec_micro, spec_origin,
        allergens
      ),
      approver:profiles!product_specs_approved_by_fkey(id, full_name)
    `)
    .eq("id", input.specId)
    .single();
  if (specErr || !spec) return { ok: false, error: specErr?.message ?? "Spec not found." };
  const itemRaw = (spec as { item: Record<string, unknown> | null }).item;
  if (!itemRaw) return { ok: false, error: "Spec has no linked item." };
  const itm = itemRaw as Record<string, unknown>;
  const item = { id: itm.id as string, code: itm.code as string, name: itm.name as string };
  const approverObj = (spec as { approver: { full_name: string } | null }).approver;

  // ── Side fetches: barcode, pallet config, tenant logo bytes ──────────────
  const [{ data: barcodeRow }, { data: palletConfig }] = await Promise.all([
    supabase.from("item_barcodes").select("barcode_value").eq("item_id", item.id).eq("is_active", true).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("item_pallet_config").select("ti, hi, units_per_pallet").eq("item_id", item.id).maybeSingle(),
  ]);

  // Tenant logo as base64 data URI (the bucket is private)
  let logoDataUri: string | null = null;
  const { data: tenantLogoRow } = await supabase.from("tenants").select("logo_url").eq("id", profile.tenant_id).single();
  const logoPath = (tenantLogoRow as { logo_url?: string | null } | null)?.logo_url ?? null;
  if (logoPath && logoPath.trim() !== "") {
    try {
      const { data: blob } = await supabase.storage.from("tenant-branding").download(logoPath);
      if (blob) {
        const arr = new Uint8Array(await blob.arrayBuffer());
        const ext = logoPath.split(".").pop()?.toLowerCase() ?? "png";
        const mime = ext === "svg" ? "image/svg+xml" : (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : `image/${ext}`;
        logoDataUri = `data:${mime};base64,${Buffer.from(arr).toString("base64")}`;
      }
    } catch { /* render without logo */ }
  }

  // ── Resolve preview-equivalent fields ─────────────────────────────────────
  const STORAGE_TEXT: Record<string, string> = { chilled: "<5°C (chilled)", frozen: "-18°C (frozen)", ambient: "Ambient" };
  const storageClass = (spec as { storage_class?: string | null }).storage_class ?? null;
  const storageTemp = storageClass && STORAGE_TEXT[storageClass]
    ? STORAGE_TEXT[storageClass]
    : ((spec.spec_storage_temp as string | null) ?? (itm.spec_storage_temp as string | null) ?? null);
  const shelfLife = (spec.spec_shelf_life as string | null) ?? (itm.spec_shelf_life as string | null) ?? null;
  const origin = ((spec as { country_of_origin?: string | null }).country_of_origin ?? spec.spec_origin ?? (itm.spec_origin as string | null) ?? null);
  const ingredientsLine = (((spec as { ingredients_statement?: string | null }).ingredients_statement) ?? "").toString().trim() || null;
  const heating = (((spec as { heating_instructions?: string | null }).heating_instructions) ?? "").toString().trim() || null;
  const minLifeReceival = (spec as { min_life_on_receival_days?: number | null }).min_life_on_receival_days ?? null;
  const specNotes = ((spec as { spec_notes?: string | null }).spec_notes) ?? null;
  const internalNotes = (spec as { internal_notes?: string | null }).internal_notes ?? null;
  const barcode = (((spec as { barcode_override?: string | null }).barcode_override) ?? "").toString().trim() || (barcodeRow as { barcode_value?: string } | null)?.barcode_value || null;

  // FSANZ allergen filter + display map (same as preview)
  const FSANZ_ALLERGENS = new Set<string>([
    "milk","dairy","egg","eggs","fish","crustacea","crustaceans","mollusc","molluscs",
    "wheat","gluten","cereals containing gluten","soy","soya","soybean","soybeans",
    "peanut","peanuts","tree nuts","tree nut","sesame","sesame seeds","lupin",
    "sulphites","sulphite","sulphur dioxide","sulphites / sulphur dioxide",
    "fsanz_milk","fsanz_egg","fsanz_fish","fsanz_crustacea","fsanz_mollusc",
    "fsanz_wheat","fsanz_gluten","fsanz_soy","fsanz_peanut","fsanz_tree_nuts",
    "fsanz_sesame","fsanz_lupin","fsanz_sulphites",
  ]);
  const ALLERGEN_DISPLAY: Record<string, string> = {
    fsanz_milk: "Milk", fsanz_egg: "Eggs", fsanz_fish: "Fish",
    fsanz_crustacea: "Crustacea", fsanz_mollusc: "Molluscs",
    fsanz_wheat: "Wheat", fsanz_gluten: "Gluten", fsanz_soy: "Soy",
    fsanz_peanut: "Peanuts", fsanz_tree_nuts: "Tree Nuts",
    fsanz_sesame: "Sesame", fsanz_lupin: "Lupin", fsanz_sulphites: "Sulphites",
  };
  const rawAllergens = (((spec as { allergens?: string[] | null }).allergens) ?? (itm.allergens as string[] | null) ?? []) as string[];
  const allergens = rawAllergens
    .filter(a => FSANZ_ALLERGENS.has(String(a).toLowerCase().trim()))
    .map(a => ALLERGEN_DISPLAY[String(a).toLowerCase().trim()] ?? a);

  // Pack hierarchy
  const perPieceG = (itm.target_weight_g as number | null) ?? (itm.fill_weight_g as number | null) ?? null;
  const piecesInner  = (itm.units_per_inner  as number | null) ?? null;
  const piecesOuter  = (itm.units_per_outer  as number | null) ?? null;
  const piecesPallet = (itm.units_per_pallet as number | null) ?? null;
  const pc = palletConfig as { ti?: number | null; hi?: number | null; units_per_pallet?: number | null } | null;
  const outersPerPallet = (pc?.units_per_pallet && pc.ti && pc.hi)
    ? pc.ti * pc.hi
    : (piecesPallet && piecesOuter ? Math.floor(piecesPallet / piecesOuter) : null);

  // Weight mode + RTE flags
  const weightMode = String(itm.weight_mode ?? "").toLowerCase();
  const isRandom = weightMode === "random" || weightMode === "catch";
  const isRTE = (itm.is_rte as boolean | null) ?? null;
  const isLargeItem = !!(itm.nip_large_item as boolean | null);
  const labTested = !!(spec as { nutrition_lab_tested?: boolean | null }).nutrition_lab_tested;
  const rteLabel = isRTE === true ? "Ready to Eat" : isRTE === false ? "Heating Required Before Consumption" : null;

  // Micro requirements: operator entry → FSANZ Schedule 27 default for RTE → null
  const microOp = (((spec as { spec_micro?: string | null }).spec_micro) ?? (itm.spec_micro as string | null) ?? "").toString().trim() || null;
  const FSANZ_RTE_MICRO_DEFAULT =
    "Listeria monocytogenes - not detected in 25 g\n" +
    "Salmonella spp. - not detected in 25 g\n" +
    "Coagulase-positive Staphylococci - < 100 cfu/g\n" +
    "Standard plate count (TPC) - < 1,000,000 cfu/g\n" +
    "(Reference: FSANZ Standard 1.6.1 / Schedule 27 - limits for ready-to-eat foods.)";
  const microRequirements = microOp ?? (isRTE === true ? FSANZ_RTE_MICRO_DEFAULT : null);

  // Servings: hide per-serving column for whole-muscle, otherwise compute
  const perServingG = (spec as { nut_per_serving_g?: number | null }).nut_per_serving_g ?? null;
  const outerWeightG = perPieceG && piecesOuter ? perPieceG * piecesOuter : null;
  const servesPerPack = outerWeightG && perServingG ? Math.round(outerWeightG / perServingG) : null;
  const showServings = !!(perServingG && !isLargeItem);

  // ── Recipient validation ──────────────────────────────────────────────────
  const recipientEmail = input.recipientEmail?.trim();
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: "Recipient email is missing or malformed." };
  }
  const toLine = input.recipientName ? `${input.recipientName} <${recipientEmail}>` : recipientEmail;

  // ── Cc list: sender + tenants.qa_email (deduped, lowercased) ──────────────
  const ccSet = new Set<string>();
  if (profile.email) ccSet.add(profile.email.toLowerCase());
  if (tenant.qa_email) ccSet.add(tenant.qa_email.toLowerCase());
  // Don't Cc the recipient
  ccSet.delete(recipientEmail.toLowerCase());
  const ccList = Array.from(ccSet);
  const bccList: string[] = [];

  // ── Compose subject + SHORT body ──────────────────────────────────────────
  // Tino May 2026: customers want the spec in a PDF attachment, NOT inlined.
  // Body is now a brief cover note only (sender + filename + optional notes).
  const docLabel = input.documentType === "pif" ? "Product Information Form" : "Product Specification";
  const subject  = `${docLabel}: ${item.name} (v${spec.version_label}) - ${tenant.name}`;
  const senderName = profile.full_name ?? profile.email ?? tenant.name;
  // Tino May 7 2026: filename format "<code> - <name> - <DocType> v<n>.pdf"
  // Item code first so the customer sorts/finds by our internal code; product
  // name in the middle so the file is human-readable in their inbox.
  const safeName = item.name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const safeCode = item.code.replace(/[\\/:*?"<>|]+/g, "").trim();
  const attachmentFilename = `${safeCode} - ${safeName} - ${docLabel} v${spec.version_label}.pdf`;
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(" ")[0]},` : "Hello,";

  const lines: string[] = [];
  lines.push(greeting);
  lines.push("");
  lines.push(`${senderName} from ${tenant.name} has sent you the ${docLabel.toLowerCase()} for ${item.name} (code ${item.code}, v${spec.version_label}).`);
  lines.push("");
  lines.push(`The full document is attached as ${attachmentFilename}.`);
  if (input.notes?.trim()) {
    lines.push("");
    lines.push("A note from " + senderName + ":");
    lines.push(input.notes.trim());
  }
  lines.push("");
  lines.push("Kind regards,");
  lines.push(senderName);
  lines.push(tenant.name);
  const body = lines.join("\n");

  const tenantAddressLines = [
    [tenant.billing_address_line1, tenant.billing_address_line2].filter(Boolean).join(" "),
    [tenant.billing_city, tenant.billing_state, tenant.billing_postcode].filter(Boolean).join(" "),
    tenant.billing_country,
  ].filter(Boolean) as string[];

  const pdfData: SpecPdfData = {
    tenant: {
      name: tenant.name,
      abn: tenant.abn ?? null,
      phone: tenant.company_phone ?? null,
      email: tenant.company_email ?? null,
      addressLines: tenantAddressLines,
      brandColor: tenant.brand_color || "#b91c1c",
      logoDataUri,
    },
    item: { code: item.code, name: item.name, barcode, perPieceG, piecesInner, piecesOuter, piecesPallet, outersPerPallet, isRandom, isRTE, isLargeItem },
    versionLabel: spec.version_label,
    status: spec.status as "draft" | "approved",
    approvedAt: (spec as { approved_at?: string | null }).approved_at ?? null,
    approverName: approverObj?.full_name ?? null,
    ingredientsStatement: ingredientsLine,
    allergens,
    storageTemp,
    shelfLife,
    minLifeReceivalDays: minLifeReceival,
    rteLabel,
    heatingInstructions: heating,
    countryOfOrigin: origin,
    microRequirements,
    notes: specNotes ?? internalNotes,
    nutrition: {
      energyKj:    (spec as { nut_energy_kj?: number | null }).nut_energy_kj ?? null,
      protein:     (spec as { nut_protein_g?: number | null }).nut_protein_g ?? null,
      fatTotal:    (spec as { nut_fat_total_g?: number | null }).nut_fat_total_g ?? null,
      fatSat:      (spec as { nut_fat_saturated_g?: number | null }).nut_fat_saturated_g ?? null,
      carbsTotal:  (spec as { nut_carbs_total_g?: number | null }).nut_carbs_total_g ?? null,
      carbsSugars: (spec as { nut_carbs_sugars_g?: number | null }).nut_carbs_sugars_g ?? null,
      sodium:      (spec as { nut_sodium_mg?: number | null }).nut_sodium_mg ?? null,
      perServingG,
      showServings,
      servesPerPack,
      labTested,
    },
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderProductSpecPdfBuffer(pdfData);
  } catch (e) {
    return { ok: false, error: `PDF render failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "specs@send.germanbutchery.com.au";
  const fromName  = process.env.RESEND_FROM_NAME  ?? `${tenant.name} Quality`;
  if (!resendKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured. Set it in Vercel and redeploy." };
  }

  let providerMessageId: string | null = null;
  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toLine,
      cc: ccList.length > 0 ? ccList : undefined,
      replyTo: profile.email ?? undefined,
      bcc: bccList.length > 0 ? bccList : undefined,
      subject: subject,
      text: body,
      html: specBodyToHtml(body),
      attachments: [{ filename: attachmentFilename, content: pdfBuffer.toString("base64") }],
    });
    if (error) {
      status = "failed";
      errorMessage = error.message ?? String(error);
    } else {
      providerMessageId = data?.id ?? null;
    }
  } catch (e) {
    status = "failed";
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  const snapshot = {
    from: `${fromName} <${fromEmail}>`,
    reply_to: profile.email,
    to: toLine,
    cc: ccList,
    subject: subject,
    body: body,
    bcc: bccList,
    document_type: input.documentType,
    attachment_filename: attachmentFilename,
    attachment_bytes: pdfBuffer.length,
  };

  const { data: sendRow, error: insErr } = await supabase
    .from("spec_sends")
    .insert({
      tenant_id: profile.tenant_id,
      spec_id: input.specId,
      item_id: item.id,
      customer_id: input.customerId,
      document_type: input.documentType,
      sent_at: new Date().toISOString(),
      sent_by: profile.id,
      recipient_name: input.recipientName,
      recipient_email: recipientEmail,
      version_label: spec.version_label,
      snapshot,
      notes: input.notes,
      subject: subject,
      body_text: body,
      to_addresses: toLine,
      cc_addresses: ccList.join(", "),
      provider: "resend",
      provider_message_id: providerMessageId,
      status,
      error_message: errorMessage,
    })
    .select("id")
    .single();

  if (insErr) {
    return {
      ok: status === "sent",
      error: status === "failed"
        ? errorMessage ?? "Send failed."
        : `Send succeeded but the audit row failed to write: ${insErr.message}`,
      providerMessageId: providerMessageId ?? undefined,
    };
  }

  return {
    ok: status === "sent",
    error: status === "failed" ? errorMessage ?? "Send failed." : undefined,
    providerMessageId: providerMessageId ?? undefined,
    sendId: sendRow.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3I.7 — sendProductSpecsBulk: ONE email with N PDF attachments.
// Duplicates the per-spec data prep so we can send a single email rather than
// looping sendProductSpec (which fires N emails). Each spec still gets its
// own spec_sends audit row but they all share one provider_message_id.
// ─────────────────────────────────────────────────────────────────────────────

export type SendBulkInput = {
  specIds: string[];
  documentType: "spec" | "pif";
  recipientName: string | null;
  recipientEmail: string;
  customerId: string | null;
  notes: string | null;
};

export type SendBulkResult = {
  ok: boolean;
  error?: string;
  providerMessageId?: string;
  results: { specId: string; ok: boolean; error?: string }[];
};

export async function sendProductSpecsBulk(input: SendBulkInput): Promise<SendBulkResult> {
  const supabase = await createClient();
  const results: { specId: string; ok: boolean; error?: string }[] = [];

  if (!input.specIds || input.specIds.length === 0) {
    return { ok: false, error: "No specs selected.", results };
  }
  const recipientEmail = input.recipientEmail?.trim();
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, error: "Recipient email is missing or malformed.", results };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in.", results };
  const { data: profile } = await supabase
    .from("profiles").select("id, full_name, email, tenant_id").eq("id", user.id).single();
  if (!profile?.tenant_id) return { ok: false, error: "Profile/tenant not found.", results };

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("name, abn, qa_email, company_email, company_phone, brand_color, billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postcode, billing_country, logo_url")
    .eq("id", profile.tenant_id)
    .single();
  if (tenantErr || !tenant) return { ok: false, error: tenantErr?.message ?? "Tenant not found.", results };

  // Tenant logo bytes (once for the batch)
  let logoDataUri: string | null = null;
  const logoPath = (tenant as { logo_url?: string | null }).logo_url ?? null;
  if (logoPath && logoPath.trim() !== "") {
    try {
      const { data: blob } = await supabase.storage.from("tenant-branding").download(logoPath);
      if (blob) {
        const arr = new Uint8Array(await blob.arrayBuffer());
        const ext = logoPath.split(".").pop()?.toLowerCase() ?? "png";
        const mime = ext === "svg" ? "image/svg+xml" : (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : `image/${ext}`;
        logoDataUri = `data:${mime};base64,${Buffer.from(arr).toString("base64")}`;
      }
    } catch { /* render without logo */ }
  }

  const tenantAddressLines = [
    [tenant.billing_address_line1, tenant.billing_address_line2].filter(Boolean).join(" "),
    [tenant.billing_city, tenant.billing_state, tenant.billing_postcode].filter(Boolean).join(" "),
    tenant.billing_country,
  ].filter(Boolean) as string[];

  const docLabel = input.documentType === "pif" ? "Product Information Form" : "Product Specification";
  const senderName = profile.full_name ?? profile.email ?? tenant.name;
  const toLine = input.recipientName ? `${input.recipientName} <${recipientEmail}>` : recipientEmail;
  const ccSet = new Set<string>();
  if (profile.email) ccSet.add(profile.email.toLowerCase());
  if (tenant.qa_email) ccSet.add(tenant.qa_email.toLowerCase());
  ccSet.delete(recipientEmail.toLowerCase());
  const ccList = Array.from(ccSet);

  // Per-spec attachments + per-spec metadata captured during rendering
  type SpecPrep = {
    specId: string;
    spec: { id: string; version_label: string; status: string };
    itemId: string;
    itemCode: string;
    itemName: string;
    attachmentFilename: string;
    pdfBuffer: Buffer;
  };
  const prepared: SpecPrep[] = [];

  // FSANZ + display map (shared)
  const FSANZ_ALLERGENS = new Set<string>([
    "milk","dairy","egg","eggs","fish","crustacea","crustaceans","mollusc","molluscs",
    "wheat","gluten","cereals containing gluten","soy","soya","soybean","soybeans",
    "peanut","peanuts","tree nuts","tree nut","sesame","sesame seeds","lupin",
    "sulphites","sulphite","sulphur dioxide","sulphites / sulphur dioxide",
    "fsanz_milk","fsanz_egg","fsanz_fish","fsanz_crustacea","fsanz_mollusc",
    "fsanz_wheat","fsanz_gluten","fsanz_soy","fsanz_peanut","fsanz_tree_nuts",
    "fsanz_sesame","fsanz_lupin","fsanz_sulphites",
  ]);
  const ALLERGEN_DISPLAY: Record<string, string> = {
    fsanz_milk: "Milk", fsanz_egg: "Eggs", fsanz_fish: "Fish",
    fsanz_crustacea: "Crustacea", fsanz_mollusc: "Molluscs",
    fsanz_wheat: "Wheat", fsanz_gluten: "Gluten", fsanz_soy: "Soy",
    fsanz_peanut: "Peanuts", fsanz_tree_nuts: "Tree Nuts",
    fsanz_sesame: "Sesame", fsanz_lupin: "Lupin", fsanz_sulphites: "Sulphites",
  };
  const STORAGE_TEXT: Record<string, string> = { chilled: "<5°C (chilled)", frozen: "-18°C (frozen)", ambient: "Ambient" };
  const FSANZ_RTE_MICRO_DEFAULT =
    "Listeria monocytogenes - not detected in 25 g\n" +
    "Salmonella spp. - not detected in 25 g\n" +
    "Coagulase-positive Staphylococci - < 100 cfu/g\n" +
    "Standard plate count (TPC) - < 1,000,000 cfu/g\n" +
    "(Reference: FSANZ Standard 1.6.1 / Schedule 27 - limits for ready-to-eat foods.)";

  // Render every spec PDF
  for (const specId of input.specIds) {
    const { data: spec, error: specErr } = await supabase
      .from("product_specs")
      .select(`
        id, version_label, status, approved_at,
        ingredients_statement, country_of_origin, spec_origin,
        spec_storage_temp, spec_shelf_life, spec_micro,
        heating_instructions, internal_notes, spec_notes, storage_class, nutrition_lab_tested,
        min_life_on_receival_days, barcode_override,
        allergens,
        nut_energy_kj, nut_protein_g, nut_fat_total_g,
        nut_fat_saturated_g, nut_carbs_total_g, nut_carbs_sugars_g,
        nut_sodium_mg, nut_per_serving_g,
        item:items(
          id, code, name, weight_mode, is_rte, nip_large_item,
          target_weight_g, fill_weight_g,
          units_per_inner, units_per_outer, units_per_pallet,
          spec_storage_temp, spec_shelf_life, spec_micro, spec_origin,
          allergens
        ),
        approver:profiles!product_specs_approved_by_fkey(id, full_name)
      `)
      .eq("id", specId)
      .single();
    if (specErr || !spec) {
      results.push({ specId, ok: false, error: specErr?.message ?? "Spec not found." });
      continue;
    }
    const itm = (spec as { item: Record<string, unknown> | null }).item as Record<string, unknown> | null;
    if (!itm) { results.push({ specId, ok: false, error: "Spec has no linked item." }); continue; }
    const item = { id: itm.id as string, code: itm.code as string, name: itm.name as string };
    const approverObj = (spec as { approver: { full_name: string } | null }).approver;

    const [{ data: barcodeRow }, { data: palletConfig }] = await Promise.all([
      supabase.from("item_barcodes").select("barcode_value").eq("item_id", item.id).eq("is_active", true).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("item_pallet_config").select("ti, hi, units_per_pallet").eq("item_id", item.id).maybeSingle(),
    ]);

    const storageClass = (spec as { storage_class?: string | null }).storage_class ?? null;
    const storageTemp = storageClass && STORAGE_TEXT[storageClass]
      ? STORAGE_TEXT[storageClass]
      : ((spec.spec_storage_temp as string | null) ?? (itm.spec_storage_temp as string | null) ?? null);
    const shelfLife = (spec.spec_shelf_life as string | null) ?? (itm.spec_shelf_life as string | null) ?? null;
    const origin = ((spec as { country_of_origin?: string | null }).country_of_origin ?? spec.spec_origin ?? (itm.spec_origin as string | null) ?? null);
    const ingredientsLine = (((spec as { ingredients_statement?: string | null }).ingredients_statement) ?? "").toString().trim() || null;
    const heating = (((spec as { heating_instructions?: string | null }).heating_instructions) ?? "").toString().trim() || null;
    const minLifeReceival = (spec as { min_life_on_receival_days?: number | null }).min_life_on_receival_days ?? null;
    const specNotes = ((spec as { spec_notes?: string | null }).spec_notes) ?? null;
    const internalNotes = (spec as { internal_notes?: string | null }).internal_notes ?? null;
    const barcode = (((spec as { barcode_override?: string | null }).barcode_override) ?? "").toString().trim() || (barcodeRow as { barcode_value?: string } | null)?.barcode_value || null;

    const rawAllergens = (((spec as { allergens?: string[] | null }).allergens) ?? (itm.allergens as string[] | null) ?? []) as string[];
    const allergens = rawAllergens
      .filter(a => FSANZ_ALLERGENS.has(String(a).toLowerCase().trim()))
      .map(a => ALLERGEN_DISPLAY[String(a).toLowerCase().trim()] ?? a);

    const perPieceG = (itm.target_weight_g as number | null) ?? (itm.fill_weight_g as number | null) ?? null;
    const piecesInner  = (itm.units_per_inner  as number | null) ?? null;
    const piecesOuter  = (itm.units_per_outer  as number | null) ?? null;
    const piecesPallet = (itm.units_per_pallet as number | null) ?? null;
    const pc = palletConfig as { ti?: number | null; hi?: number | null; units_per_pallet?: number | null } | null;
    const outersPerPallet = (pc?.units_per_pallet && pc.ti && pc.hi)
      ? pc.ti * pc.hi
      : (piecesPallet && piecesOuter ? Math.floor(piecesPallet / piecesOuter) : null);

    const weightMode = String(itm.weight_mode ?? "").toLowerCase();
    const isRandom = weightMode === "random" || weightMode === "catch";
    const isRTE = (itm.is_rte as boolean | null) ?? null;
    const isLargeItem = !!(itm.nip_large_item as boolean | null);
    const labTested = !!(spec as { nutrition_lab_tested?: boolean | null }).nutrition_lab_tested;
    const rteLabel = isRTE === true ? "Ready to Eat" : isRTE === false ? "Heating Required Before Consumption" : null;

    const microOp = (((spec as { spec_micro?: string | null }).spec_micro) ?? (itm.spec_micro as string | null) ?? "").toString().trim() || null;
    const microRequirements = microOp ?? (isRTE === true ? FSANZ_RTE_MICRO_DEFAULT : null);

    const perServingG = (spec as { nut_per_serving_g?: number | null }).nut_per_serving_g ?? null;
    const outerWeightG = perPieceG && piecesOuter ? perPieceG * piecesOuter : null;
    const servesPerPack = outerWeightG && perServingG ? Math.round(outerWeightG / perServingG) : null;
    const showServings = !!(perServingG && !isLargeItem);

    const pdfData: SpecPdfData = {
      tenant: {
        name: tenant.name,
        abn: tenant.abn ?? null,
        phone: tenant.company_phone ?? null,
        email: tenant.company_email ?? null,
        addressLines: tenantAddressLines,
        brandColor: tenant.brand_color || "#b91c1c",
        logoDataUri,
      },
      item: { code: item.code, name: item.name, barcode, perPieceG, piecesInner, piecesOuter, piecesPallet, outersPerPallet, isRandom, isRTE, isLargeItem },
      versionLabel: spec.version_label,
      status: spec.status as "draft" | "approved",
      approvedAt: (spec as { approved_at?: string | null }).approved_at ?? null,
      approverName: approverObj?.full_name ?? null,
      ingredientsStatement: ingredientsLine,
      allergens,
      storageTemp,
      shelfLife,
      minLifeReceivalDays: minLifeReceival,
      rteLabel,
      heatingInstructions: heating,
      countryOfOrigin: origin,
      microRequirements,
      notes: specNotes ?? internalNotes,
      nutrition: {
        energyKj:    (spec as { nut_energy_kj?: number | null }).nut_energy_kj ?? null,
        protein:     (spec as { nut_protein_g?: number | null }).nut_protein_g ?? null,
        fatTotal:    (spec as { nut_fat_total_g?: number | null }).nut_fat_total_g ?? null,
        fatSat:      (spec as { nut_fat_saturated_g?: number | null }).nut_fat_saturated_g ?? null,
        carbsTotal:  (spec as { nut_carbs_total_g?: number | null }).nut_carbs_total_g ?? null,
        carbsSugars: (spec as { nut_carbs_sugars_g?: number | null }).nut_carbs_sugars_g ?? null,
        sodium:      (spec as { nut_sodium_mg?: number | null }).nut_sodium_mg ?? null,
        perServingG, showServings, servesPerPack, labTested,
      },
    };

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderProductSpecPdfBuffer(pdfData);
    } catch (e) {
      results.push({ specId, ok: false, error: `PDF render failed: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    // Tino May 7 2026: filename format "<code> - <name> - <DocType> v<n>.pdf"
  // Item code first so the customer sorts/finds by our internal code; product
  // name in the middle so the file is human-readable in their inbox.
  const safeName = item.name.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const safeCode = item.code.replace(/[\\/:*?"<>|]+/g, "").trim();
  const attachmentFilename = `${safeCode} - ${safeName} - ${docLabel} v${spec.version_label}.pdf`;
    prepared.push({
      specId,
      spec: { id: spec.id, version_label: spec.version_label, status: spec.status as string },
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      attachmentFilename,
      pdfBuffer,
    });
  }

  if (prepared.length === 0) {
    return { ok: false, error: "No specs could be rendered.", results };
  }

  // Compose subject + body for the single email
  const subject = prepared.length === 1
    ? `${docLabel}: ${prepared[0].itemName} (v${prepared[0].spec.version_label}) - ${tenant.name}`
    : `${prepared.length} ${docLabel} attachments from ${tenant.name}`;

  const greeting = input.recipientName ? `Hi ${input.recipientName.split(" ")[0]},` : "Hello,";
  const lines: string[] = [];
  lines.push(greeting);
  lines.push("");
  if (prepared.length === 1) {
    lines.push(`${senderName} from ${tenant.name} has sent you the ${docLabel.toLowerCase()} for ${prepared[0].itemName} (code ${prepared[0].itemCode}, v${prepared[0].spec.version_label}).`);
    lines.push("");
    lines.push(`The full document is attached as ${prepared[0].attachmentFilename}.`);
  } else {
    lines.push(`${senderName} from ${tenant.name} has sent you ${prepared.length} ${docLabel.toLowerCase()} attachments:`);
    lines.push("");
    for (const p of prepared) lines.push(`  - ${p.itemName} (code ${p.itemCode}, v${p.spec.version_label})`);
    lines.push("");
    lines.push(`All ${prepared.length} PDFs are attached to this email.`);
  }
  if (input.notes?.trim()) {
    lines.push("");
    lines.push("A note from " + senderName + ":");
    lines.push(input.notes.trim());
  }
  lines.push("");
  lines.push("Kind regards,");
  lines.push(senderName);
  lines.push(tenant.name);
  const body = lines.join("\n");

  // Resend send (single email, N attachments)
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "specs@send.germanbutchery.com.au";
  const fromName  = process.env.RESEND_FROM_NAME  ?? `${tenant.name} Quality`;
  if (!resendKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured.", results };
  }

  let providerMessageId: string | null = null;
  let sendStatus: "sent" | "failed" = "sent";
  let sendError: string | null = null;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: toLine,
      cc: ccList.length > 0 ? ccList : undefined,
      replyTo: profile.email ?? undefined,
      subject,
      text: body,
      html: specBodyToHtml(body),
      attachments: prepared.map(p => ({ filename: p.attachmentFilename, content: p.pdfBuffer.toString("base64") })),
    });
    if (error) {
      sendStatus = "failed";
      sendError = error.message ?? String(error);
    } else {
      providerMessageId = data?.id ?? null;
    }
  } catch (e) {
    sendStatus = "failed";
    sendError = e instanceof Error ? e.message : String(e);
  }

  // Insert one audit row per spec, sharing provider_message_id + subject
  for (const p of prepared) {
    const snapshot = {
      from: `${fromName} <${fromEmail}>`,
      reply_to: profile.email,
      to: toLine,
      cc: ccList,
      subject,
      body,
      document_type: input.documentType,
      attachment_filename: p.attachmentFilename,
      attachment_bytes: p.pdfBuffer.length,
      bulk_batch_size: prepared.length,
    };
    const { error: insErr } = await supabase
      .from("spec_sends")
      .insert({
        tenant_id: profile.tenant_id,
        spec_id: p.specId,
        item_id: p.itemId,
        customer_id: input.customerId,
        document_type: input.documentType,
        sent_at: new Date().toISOString(),
        sent_by: profile.id,
        recipient_name: input.recipientName,
        recipient_email: recipientEmail,
        version_label: p.spec.version_label,
        snapshot,
        notes: input.notes,
        subject,
        body_text: body,
        to_addresses: toLine,
        cc_addresses: ccList.join(", "),
        provider: "resend",
        provider_message_id: providerMessageId,
        status: sendStatus,
        error_message: sendError,
      });
    results.push({
      specId: p.specId,
      ok: sendStatus === "sent" && !insErr,
      error: sendStatus === "failed" ? sendError ?? undefined : insErr?.message,
    });
  }

  return {
    ok: sendStatus === "sent" && results.every(r => r.ok),
    error: sendStatus === "failed" ? sendError ?? "Send failed." : undefined,
    providerMessageId: providerMessageId ?? undefined,
    results,
  };
}
