-- ============================================================================
-- Migration 111 — Add effective_cost to v_item_cost_health
--
-- Surfaces the canonical "what cost should every calc use" number directly
-- on the view so screens (Inventory, RM wizard, test_product_cascade) don't
-- need to re-implement the COALESCE logic.
--
-- Rule: effective_cost = COALESCE(items.standard_cost, supplier_max_price, 0)
--   1. If an admin has set an explicit override on items.standard_cost, use it.
--   2. Otherwise default to the HIGHEST supplier price (safe for costing
--      calculations — never under-cost a recipe).
--   3. If neither exists, fall back to 0.
--
-- New column added at the end of the view to preserve column order
-- (CREATE OR REPLACE VIEW won't allow column-order changes).
-- ============================================================================
CREATE OR REPLACE VIEW public.v_item_cost_health AS
WITH normalised AS (
  SELECT si.item_id, si.supplier_id, si.unit_price, si.currency,
         CASE
           WHEN si.purchase_uom_qty IS NOT NULL AND si.purchase_uom_qty > 0
             THEN si.unit_price / si.purchase_uom_qty
           ELSE si.unit_price
         END AS price_per_base_unit,
         si.is_preferred, si.price_valid_to
  FROM supplier_items si
),
agg AS (
  SELECT n.item_id,
         count(*)                        AS supplier_count,
         min(n.price_per_base_unit)      AS supplier_min_price,
         max(n.price_per_base_unit)      AS supplier_max_price,
         (array_agg(n.supplier_id ORDER BY n.price_per_base_unit,      n.is_preferred DESC))[1] AS cheapest_supplier_id,
         (array_agg(n.supplier_id ORDER BY n.price_per_base_unit DESC, n.is_preferred DESC))[1] AS highest_supplier_id
  FROM normalised n
  GROUP BY n.item_id
)
SELECT i.id AS item_id,
       i.code, i.name, i.unit,
       i.standard_cost,
       i.standard_cost_override_by,
       i.standard_cost_override_at,
       COALESCE(agg.supplier_count, 0::bigint) AS supplier_count,
       agg.supplier_min_price,
       agg.supplier_max_price,
       agg.cheapest_supplier_id,
       agg.highest_supplier_id,
       CASE
         WHEN i.standard_cost IS NOT NULL
              AND agg.supplier_min_price IS NOT NULL
              AND i.standard_cost < agg.supplier_min_price
           THEN true
         ELSE false
       END AS is_below_cheapest,
       COALESCE(i.standard_cost, agg.supplier_max_price, 0)::numeric AS effective_cost
FROM items i
LEFT JOIN agg ON agg.item_id = i.id;
