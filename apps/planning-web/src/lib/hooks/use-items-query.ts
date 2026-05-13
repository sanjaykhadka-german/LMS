"use client";

/**
 * Paginated, filtered items query.
 *
 * Each unique combination of filters + page gets its own cache entry, so
 * switching between filtered views is instant on the second visit.
 * The list stays fresh for 5 minutes, then re-fetches silently in the background.
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached, invalidateCache, invalidateCachePrefix } from "@/lib/cache";

const PAGE_SIZE = 200;
const STALE_5_MIN = 5 * 60 * 1000;

export interface ItemFilters {
  code?: string;
  name?: string;
  desc?: string;
  /** Comma-separated list of item_type values; empty/missing = no filter. */
  type?: string;
  /** Comma-separated list of item_category_id UUIDs. */
  category?: string;
  /** Comma-separated list of item_subcategory_id UUIDs. */
  subcat?: string;
  /** Comma-separated list of department names. */
  dept?: string;
  suppliers?: string; // comma-separated supplier IDs
  // 'active' (default) | 'inactive' | 'both' — filter on items.is_active
  status?: "active" | "inactive" | "both";
  page?: number;
}

/** Split a comma-separated filter param into a clean string[] (drops empties). */
function csvList(s: string | undefined | null): string[] {
  if (!s) return [];
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

export function useItemsQuery(filters: ItemFilters = {}) {
  const supabase = createClient();
  const cacheKey = `items:${JSON.stringify(filters)}`;

  const [result, setResult] = useState<{ items: unknown[]; totalCount: number }>(
    () => getCached(cacheKey, STALE_5_MIN) ?? { items: [], totalCount: 0 }
  );
  const [isFetching, setIsFetching] = useState(false);
  // Bumping `refreshTick` forces the fetch effect to re-run AND skips the
  // cache-hit short-circuit (so refetch() always pulls fresh from the DB).
  // Why: invalidateItemsCache() clears the global cache for new mounts, but
  // the currently-mounted component still holds stale `result` state. After
  // a bulk-save, the caller bumps refreshTick to force a real round-trip.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const key = cacheKey;
    // On a manual refetch (refreshTick > 0) skip the cache and go straight
    // to the DB — the cache may have just been invalidated for THIS key.
    const cached = refreshTick === 0
      ? getCached<{ items: unknown[]; totalCount: number }>(key, STALE_5_MIN)
      : null;
    if (cached) {
      setResult(cached);
      return;
    }

    let cancelled = false;
    setIsFetching(true);

    (async () => {
      try {
        const page = Math.max(1, filters.page ?? 1);
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        // Resolve supplier filter to item IDs if needed
        let supplierItemIds: string[] | null = null;
        const supplierArr = filters.suppliers
          ? filters.suppliers.split(",").filter(Boolean)
          : [];

        if (supplierArr.length > 0) {
          const { data: siRows } = await supabase
            .from("supplier_items")
            .select("item_id")
            .in("supplier_id", supplierArr);
          supplierItemIds = siRows
            ? [...new Set(siRows.map((r: { item_id: string }) => r.item_id))]
            : [];
        }

        // Pull every items column (excluding structural FKs we don't render) so
        // the table column-toggle can expose any field for bulk editing. The
        // payload is fine: ~80 cols × ~1500 rows ≈ 120k cells, well within limits
        // and cached client-side anyway.
        let q = supabase
          .from("items")
          .select(
            "*, item_category:item_category_id(id, name, color)",
            { count: "exact" }
          )
          .order("item_type")
          .order("code")
          .range(from, to);

        if (filters.code)     q = q.ilike("code", `%${filters.code}%`);
        if (filters.name)     q = q.ilike("name", `%${filters.name}%`);
        if (filters.desc)     q = q.ilike("description", `%${filters.desc}%`);
        // Multi-value filters: each accepts a comma-separated list. One value
        // → exact match (eq); multiple → "in" any of the listed values.
        // Empty list → no filter applied (the field is absent from the URL).
        const typeArr   = csvList(filters.type);
        const catArr    = csvList(filters.category);
        const subcatArr = csvList(filters.subcat);
        const deptArr   = csvList(filters.dept);
        if (typeArr.length === 1)   q = q.eq("item_type", typeArr[0]);
        else if (typeArr.length > 1) q = q.in("item_type", typeArr);
        // Active-status filter: default 'active' hides inactive rows; 'inactive'
        // shows only the deactivated; 'both' applies no filter.
        if (filters.status === "active")        q = q.eq("is_active", true);
        else if (filters.status === "inactive") q = q.eq("is_active", false);
        if (catArr.length === 1)    q = q.eq("item_category_id", catArr[0]);
        else if (catArr.length > 1) q = q.in("item_category_id", catArr);
        if (subcatArr.length === 1)    q = q.eq("item_subcategory_id", subcatArr[0]);
        else if (subcatArr.length > 1) q = q.in("item_subcategory_id", subcatArr);
        if (deptArr.length === 1)    q = q.eq("department", deptArr[0]);
        else if (deptArr.length > 1) q = q.in("department", deptArr);
        if (supplierItemIds !== null) {
          const ids = supplierItemIds.length > 0
            ? supplierItemIds
            : ["00000000-0000-0000-0000-000000000000"];
          q = q.in("id", ids);
        }

        const { data, count, error } = await q;
        if (error) throw error;
        if (cancelled) return;

        // Pull inherited pack/fill/target attrs from the v_items_inherited_attrs
        // view (migration 075). These let columns like "Actual fill (g/piece)"
        // show a value on a child item that doesn't have its own fill set,
        // by walking up the parent chain. Done as a parallel fetch keyed to
        // the visible page's IDs so it scales.
        type InheritedRow = {
          id: string;
          inherited_fill_weight_g: number | null;
          inherited_target_weight_g: number | null;
          inherited_process_loss_pct: number | null;
          inherited_units_per_inner: number | null;
          inherited_units_per_outer: number | null;
          inherited_units_per_pallet: number | null;
          inherited_inner_per_outer: number | null;
          inherited_outers_per_pallet: number | null;
          inherited_tare_weight_g: number | null;
          inherited_tolerance_over_g: number | null;
          inherited_tolerance_under_g: number | null;
        };
        const ids = (data ?? []).map((r: { id: string }) => r.id);
        let inheritedMap = new Map<string, InheritedRow>();
        type PalletRow = {
          item_id: string;
          carton_gross_weight_kg: number | null;
          carton_net_weight_kg:   number | null;
          total_pallet_weight_kg: number | null;
        };
        let palletMap = new Map<string, PalletRow>();
        // Cost health from v_item_cost_health (migration 086) — surfaces the
        // standard cost vs supplier-price aggregate so the grid can render
        // both columns and the red-line below-cheapest row tint.
        type CostHealthRow = {
          item_id: string;
          supplier_count: number;
          supplier_min_price: number | null;
          supplier_max_price: number | null;
          cheapest_supplier_id: string | null;
          highest_supplier_id: string | null;
          is_below_cheapest: boolean;
        };
        let costMap = new Map<string, CostHealthRow>();
        if (ids.length > 0) {
          // Three parallel fetches — inherited pack/fill values from the view,
          // pallet config (carton/pallet weights) from item_pallet_config, and
          // the per-item cost health snapshot from v_item_cost_health.
          const [inhRes, palRes, costRes] = await Promise.all([
            supabase
              .from("v_items_inherited_attrs")
              .select("*")
              .in("id", ids),
            supabase
              .from("item_pallet_config")
              .select("item_id, carton_gross_weight_kg, carton_net_weight_kg, total_pallet_weight_kg")
              .in("item_id", ids),
            supabase
              .from("v_item_cost_health")
              .select("item_id, supplier_count, supplier_min_price, supplier_max_price, cheapest_supplier_id, highest_supplier_id, is_below_cheapest")
              .in("item_id", ids),
          ]);
          inheritedMap = new Map(((inhRes.data ?? []) as InheritedRow[]).map(r => [r.id, r]));
          palletMap = new Map(((palRes.data ?? []) as PalletRow[]).map(r => [r.item_id, r]));
          costMap = new Map(((costRes.data ?? []) as CostHealthRow[]).map(r => [r.item_id, r]));
        }
        const enriched = (data ?? []).map((r: Record<string, unknown> & { id: string }) => {
          const inh = inheritedMap.get(r.id);
          const pal = palletMap.get(r.id);
          const cost = costMap.get(r.id);
          // Surface pallet/carton weights + cost-health fields flat on the
          // row so column renderers can read them without an extra join.
          const palletFields = pal ? {
            carton_gross_weight_kg: pal.carton_gross_weight_kg,
            carton_net_weight_kg:   pal.carton_net_weight_kg,
            total_pallet_weight_kg: pal.total_pallet_weight_kg,
          } : {};
          const costFields = cost ? {
            supplier_count:       cost.supplier_count,
            supplier_min_price:   cost.supplier_min_price,
            supplier_max_price:   cost.supplier_max_price,
            cheapest_supplier_id: cost.cheapest_supplier_id,
            highest_supplier_id:  cost.highest_supplier_id,
            is_below_cheapest:    cost.is_below_cheapest,
          } : {
            supplier_count: 0,
            is_below_cheapest: false,
          };
          return { ...r, ...(inh ?? {}), ...palletFields, ...costFields };
        });

        const value = { items: enriched, totalCount: count ?? 0 };
        setCached(key, value);
        setResult(value);
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, refreshTick]);

  // Caller can force a fresh DB pull (bypassing the 5-min cache) by calling
  // refetch(). Pair with invalidateItemsCache() so other mounts also miss
  // the stale entry next time they render.
  const refetch = useCallback(() => {
    invalidateCache(`items:${JSON.stringify(filters)}`);
    setRefreshTick(t => t + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return { data: result, isFetching, refetch };
}

// ── Item type counts (for the tab badges) ─────────────────────────────────────
export function useItemTypeCounts() {
  const supabase = createClient();
  const cacheKey = "item_type_counts";

  const [data, setData] = useState<Record<string, number>>(
    () => getCached(cacheKey, STALE_5_MIN) ?? {}
  );

  useEffect(() => {
    const cached = getCached<Record<string, number>>(cacheKey, STALE_5_MIN);
    if (cached) { setData(cached); return; }

    let cancelled = false;
    supabase.rpc("get_item_type_counts").then(({ data: rows, error }) => {
      if (cancelled || error) return;
      const counts: Record<string, number> = {};
      for (const row of rows ?? []) counts[row.item_type] = Number(row.cnt);
      setCached(cacheKey, counts);
      setData(counts);
    });
    return () => { cancelled = true; };
  }, []);

  return { data };
}

// Call this after saving an item to bust the items cache
export function invalidateItemsCache() {
  invalidateCache("item_type_counts");
  invalidateCachePrefix("items:");
}
