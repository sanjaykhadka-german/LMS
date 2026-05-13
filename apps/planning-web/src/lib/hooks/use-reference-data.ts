"use client";

/**
 * Hooks for slow-changing reference data: departments, categories,
 * subcategories, item types, suppliers, allergen definitions.
 *
 * Data is cached for 30 minutes in a module-level store — these values
 * almost never change mid-session, so re-fetching every navigation is wasteful.
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached } from "@/lib/cache";

const STALE_30_MIN = 30 * 60 * 1000;
// Shorter cache for register-style settings the user edits and expects to
// see immediately reflected (e.g. Type tabs in Item Master after renaming
// a type in /settings/item-types). 1 minute is short enough to feel live
// without re-fetching on every page focus.
const STALE_1_MIN  = 60 * 1000;

function useSimpleQuery<T>(
  cacheKey: string,
  staleMs: number,
  fetcher: () => Promise<T>,
  empty: T
): { data: T; isFetching: boolean } {
  const [data, setData] = useState<T>(() => getCached<T>(cacheKey, staleMs) ?? empty);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    const cached = getCached<T>(cacheKey, staleMs);
    if (cached !== undefined) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    fetcher().then((result) => {
      if (cancelled) return;
      setCached(cacheKey, result);
      setData(result);
      setIsFetching(false);
    }).catch(() => {
      if (!cancelled) setIsFetching(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { data, isFetching };
}

// ── Departments ──────────────────────────────────────────────────────────────
export function useDepartments() {
  const supabase = createClient();
  return useSimpleQuery(
    "departments",
    STALE_30_MIN,
    async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Item categories ───────────────────────────────────────────────────────────
export function useItemCategories() {
  const supabase = createClient();
  return useSimpleQuery(
    "item_categories",
    STALE_30_MIN,
    async () => {
      const { data, error } = await supabase
        .from("item_categories")
        .select("id, name, color")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Item subcategories ────────────────────────────────────────────────────────
export function useItemSubcategories() {
  const supabase = createClient();
  return useSimpleQuery(
    "item_subcategories",
    STALE_30_MIN,
    async () => {
      const { data, error } = await supabase
        .from("item_subcategories")
        .select("id, category_id, name")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Units of measure ──────────────────────────────────────────────────────────
// Sourced from /settings/units-of-measure. Shorter cache so renames /
// additions show up wherever UOM dropdowns render (BOM form, item form,
// stocktake, etc.) without a hard refresh.
export function useUnitsOfMeasure() {
  const supabase = createClient();
  return useSimpleQuery(
    "units_of_measure",
    STALE_1_MIN,
    async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("id, code, name, category, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Item types ────────────────────────────────────────────────────────────────
export function useItemTypes() {
  const supabase = createClient();
  return useSimpleQuery(
    "item_types",
    STALE_1_MIN,
    async () => {
      const { data, error } = await supabase
        .from("item_types")
        .select("id, code, name, color, is_purchasable, can_have_bom, is_sellable, is_producible, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Suppliers (active list) ───────────────────────────────────────────────────
export function useSuppliers() {
  const supabase = createClient();
  return useSimpleQuery(
    "suppliers",
    STALE_30_MIN,
    async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}

// ── Allergen definitions ──────────────────────────────────────────────────────
export function useAllergenDefs(activeStandards: string[] = ["FSANZ"]) {
  const supabase = createClient();
  const key = `allergen_definitions:${activeStandards.join(",")}`;
  return useSimpleQuery(
    key,
    STALE_30_MIN,
    async () => {
      const { data, error } = await supabase
        .from("allergen_definitions")
        .select("code, name, regulatory_standard")
        .in("regulatory_standard", activeStandards)
        .eq("is_active", true)
        .order("regulatory_standard")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    []
  );
}
