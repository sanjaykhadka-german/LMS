"use client";

/**
 * Tenant vocabulary hook.
 *
 * Reads the merged label set (system defaults + tenant overrides) via the
 * get_tenant_labels() RPC. Cached for 5 minutes — short enough that admin
 * edits via the Vocabulary settings page show up nearly live, long enough
 * that we don't re-fetch on every navigation.
 *
 * Usage:
 *   const { t, isFetching } = useTenantLabels();
 *   t("step")  →  "Stage"  (or whatever the tenant renamed it to)
 *
 * Falls back to the canonical key itself if no label is loaded yet — that
 * way nothing renders blank during first paint.
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached, invalidateCache } from "@/lib/cache";

const CACHE_KEY = "tenant_labels";
const STALE_MS  = 5 * 60 * 1000;

export type LabelRow = {
  canonical_key:     string;
  display_label:     string;
  default_label:     string;
  is_overridden:     boolean;
  description:       string | null;
  example_locations: string | null;
  sort_order:        number;
};

/** Map of canonical_key → display_label for quick lookup. */
type LabelMap = Record<string, string>;

function rowsToMap(rows: LabelRow[]): LabelMap {
  const map: LabelMap = {};
  for (const r of rows) map[r.canonical_key] = r.display_label;
  return map;
}

export function useTenantLabels() {
  const supabase = createClient();
  const [data, setData] = useState<LabelRow[]>(() =>
    getCached<LabelRow[]>(CACHE_KEY, STALE_MS) ?? []
  );
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    const cached = getCached<LabelRow[]>(CACHE_KEY, STALE_MS);
    if (cached !== undefined) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    supabase.rpc("get_tenant_labels").then(({ data: rows, error }) => {
      if (cancelled) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("get_tenant_labels failed:", error.message);
        setIsFetching(false);
        return;
      }
      const list = (rows ?? []) as LabelRow[];
      setCached(CACHE_KEY, list);
      setData(list);
      setIsFetching(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const map = rowsToMap(data);

  /** Look up the display label for a canonical key. Falls back to a
   *  human-readable version of the key if no row is loaded yet. */
  function t(canonicalKey: string): string {
    return map[canonicalKey] ?? canonicalKey
      .replace(/_/g, " ")
      .replace(/^\w/, c => c.toUpperCase());
  }

  return { rows: data, t, isFetching };
}

/** Force re-fetch on next mount. Call this after admin edits a label so the
 *  vocabulary spreads across tabs/users on their next render. */
export function invalidateTenantLabels() {
  invalidateCache(CACHE_KEY);
}
