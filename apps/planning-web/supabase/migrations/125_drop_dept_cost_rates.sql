-- ============================================================================
-- Migration 125 — Drop dept_cost_rates (scrap Phase 2 Pass 1)
--
-- Pass 1 of Phase 2 modelled conversion as ONE per-kg rate per department,
-- applied to every product passing through. Tino's actual mental model is
-- per-PRODUCT step-based routings (e.g. "filling: 2 people, 120 min, per
-- 1000 kg"). Two products in the same dept can have wildly different time
-- profiles; a flat per-dept rate can't represent that.
--
-- Scrapping cleanly so the routing-based model (mig 126+) can land without
-- carrying a misshapen fallback table around.
--
-- Nothing else in the system references dept_cost_rates yet (the cascade
-- view was never wired to it), so the drop is a no-op for downstream code.
-- ============================================================================

DROP VIEW  IF EXISTS v_dept_cost_rates_current;
DROP TABLE IF EXISTS dept_cost_rates;

-- The trigger function `trg_dept_cost_rates_set_tenant` was attached to the
-- table only, so dropping the table also implicitly removes the trigger.
-- The function itself is harmless but no longer reachable; drop for tidiness.
DROP FUNCTION IF EXISTS trg_dept_cost_rates_set_tenant();
