"use client";

/**
 * BOM list query — cached for 5 minutes.
 * Navigating back to the BOM list after editing a recipe is instant.
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached, invalidateCache } from "@/lib/cache";
import { TENANT_FULL_FETCH } from "@/lib/limits";

const STALE_5_MIN = 5 * 60 * 1000;
const CACHE_KEY = "bom_list";

export function useBomList() {
  const supabase = createClient();

  const [data, setData] = useState<unknown[]>(
    () => getCached(CACHE_KEY, STALE_5_MIN) ?? []
  );
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    const cached = getCached<unknown[]>(CACHE_KEY, STALE_5_MIN);
    if (cached) { setData(cached); return; }

    let cancelled = false;
    setIsFetching(true);

    supabase
      .from("bom_headers")
      .select(
        "id, version, is_active, approved_at, created_at, reference_batch_size, reference_batch_unit, yield_factor, item:item_id(id, code, name, item_type)"
      )
      .order("created_at", { ascending: false })
      .limit(TENANT_FULL_FETCH)
      .then(({ data: rows, error }) => {
        if (cancelled) return;
        if (!error) {
          const value = rows ?? [];
          setCached(CACHE_KEY, value);
          setData(value);
        }
        setIsFetching(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { data, isFetching };
}

// Call this after saving a BOM to immediately invalidate the list cache
// so the next visit re-fetches fresh data.
export function useInvalidateBomList() {
  return () => invalidateCache(CACHE_KEY);
}
