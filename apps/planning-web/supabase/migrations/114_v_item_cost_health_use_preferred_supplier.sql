-- Fix v_item_cost_health.effective_cost to prefer the PREFERRED supplier's
-- per-base-unit price, falling back through cheapest, then max, then 0.
--
-- Old behavior used supplier_max_price as the fallback which yielded the
-- WORST-case price as the canonical "effective" — this confused operators
-- who'd flagged a cheaper preferred supplier and still saw the high price
-- treated as the cost-of-record everywhere (Inventory total $, Need-now
-- Line $, Quick-fix modal "Effective" hint).
--
-- New cascade:
--   1. items.standard_cost (manual override)
--   2. price-per-base of the supplier flagged is_preferred = true
--   3. min price-per-base across linked suppliers
--   4. max price-per-base (legacy fallback, very rare path)
--   5. 0

CREATE OR REPLACE VIEW v_item_cost_health AS
WITH normalised AS (
  SELECT
    si.item_id,
    si.supplier_id,
    si.unit_price,
    si.currency,
    CASE
      WHEN si.purchase_uom_qty IS NOT NULL AND si.purchase_uom_qty > 0
        THEN si.unit_price / si.purchase_uom_qty
      ELSE si.unit_price
    END AS price_per_base_unit,
    si.is_preferred,
    si.price_valid_to
  FROM supplier_items si
),
agg AS (
  SELECT
    n.item_id,
    count(*) AS supplier_count,
    min(n.price_per_base_unit) AS supplier_min_price,
    max(n.price_per_base_unit) AS supplier_max_price,
    -- Preferred wins, then cheapest by per-base.
    (array_agg(n.price_per_base_unit ORDER BY n.is_preferred DESC, n.price_per_base_unit))[1]
      AS preferred_price,
    (array_agg(n.supplier_id        ORDER BY n.price_per_base_unit, n.is_preferred DESC))[1]
      AS cheapest_supplier_id,
    (array_agg(n.supplier_id        ORDER BY n.price_per_base_unit DESC, n.is_preferred DESC))[1]
      AS highest_supplier_id
  FROM normalised n
  GROUP BY n.item_id
)
SELECT
  i.id AS item_id,
  i.code,
  i.name,
  i.unit,
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
    THEN true ELSE false
  END AS is_below_cheapest,
  -- Effective cost cascade
  COALESCE(
    i.standard_cost,
    agg.preferred_price,
    agg.supplier_min_price,
    agg.supplier_max_price,
    0::numeric
  ) AS effective_cost
FROM items i
LEFT JOIN agg ON agg.item_id = i.id;
