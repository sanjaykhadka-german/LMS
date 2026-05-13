-- ============================================================================
-- 097  items — ingredient classification fields for label-ready statements
-- ----------------------------------------------------------------------------
-- Tino May 2026: the auto-filled ingredients statement currently spits the
-- raw component names verbatim. On a customer-facing spec this needs to be
-- classified per FSANZ Std 1.2.4 / labelling practice:
--   - All meats grouped: "Meat (Pork, Beef Fat, Chicken)"
--   - Mineral salts + E number: "Mineral Salts (451)"
--   - Preservatives + E number: "Preservative (250)"
--   - Spices grouped: "Spices (Chilli, Garlic, Paprika)"
--   - Spice extracts grouped: "Spice Extracts (Paprika)"
--   - Antioxidants: "Antioxidant (300)"
--
-- Three new columns drive this. Operator fills them on raw-material rows in
-- the Item Master; the auto-fill action (Phase 3H) groups BOM weight-leaves
-- by ingredient_class, joins meat_species, and renders the canonical
-- statement. This migration lands the data shape.
-- ============================================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS ingredient_class           text,
  ADD COLUMN IF NOT EXISTS ingredient_e_number        text,
  ADD COLUMN IF NOT EXISTS ingredient_meat_species    text;

COMMENT ON COLUMN public.items.ingredient_class IS
  'FSANZ-aligned classification for label rendering. Values: meat, water, mineral_salt, preservative, antioxidant, spice, spice_extract, herb, starch, binder, humectant, acidity_regulator, colour, flavour, casing, packaging, consumable, other. NULL = use the item name verbatim on the label.';
COMMENT ON COLUMN public.items.ingredient_e_number IS
  'INS / E number for additives (e.g. 451 for STPP, 250 for sodium nitrite, 220 for sulphur dioxide, 300 for ascorbic acid). Renders in brackets after the class name on the label.';
COMMENT ON COLUMN public.items.ingredient_meat_species IS
  'Species name for meat ingredients (Pork, Beef, Chicken, Lamb, etc.). Only used when ingredient_class = meat. Multiple species can be comma-separated for cuts containing several.';
