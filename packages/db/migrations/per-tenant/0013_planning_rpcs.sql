-- Planning per-tenant RPCs and triggers.
--
-- Applied AFTER 0012_planning_baseline.sql in each tenant schema. All
-- functions are created inside the per-tenant schema so they resolve `pl_*`
-- references via the migration runner's `SET LOCAL search_path = "tenant_<uuid>", public`.
--
-- Differences from the Supabase originals:
--   • `public.` prefix dropped — unqualified references resolve into the
--     per-tenant schema via search_path
--   • Table names changed from <name> to pl_<name> (matches Slice 1 prefix)
--   • Column `tenant_id` → `tracey_tenant_id` where it appears in function
--     bodies (autogen barcode/code uniqueness checks)
--   • `SECURITY DEFINER` dropped — default INVOKER is correct here because
--     `ctx.db.run(forTenant(tid))` sets the search_path before each call, and
--     the per-tenant schema is itself the isolation boundary
--   • `GRANT EXECUTE … TO authenticated` lines dropped — we don't use the
--     Supabase `authenticated` role
--   • `my_tenant_id()` and `auth.uid()` references dropped — tenant scoping
--     comes from search_path (and inert RLS as defence-in-depth), and `auth.uid()`
--     would fail outside Supabase. Where the original used `auth.uid()` to
--     timestamp who-counted (touch_stocktake_line), the application layer now
--     supplies that via the column directly.
--
-- What's deferred (not in this slice):
--   • `cost_breakdown_v1` / `cost_breakdown_v2` / `test_product_cascade_v2` —
--     depend on tables not in Slice 1's schema (dept_cost_rates, labour_rates,
--     overhead_*, production_routings, pricing_buffers, item_losses). Will be
--     ported alongside Slice 10's costings rewrite when those tables get added.
--   • `get_plan_dept_materials` / `get_plan_dept_materials_by_day` /
--     `get_rm_parent_breakdown` / `get_po_suggestions` — Slice 13 (plans +
--     production rewrites) is where these surface; deferring keeps Slice 3 tight
--     and lets the rewrite-time port pick the latest variants.
--   • `get_or_create_open_draft` — depends on `po_drafts` / `po_draft_lines`,
--     not in Slice 1's schema. Port when those tables land (or replace with
--     server action during Slice 11).
--   • `get_tenant_labels` / `set_tenant_label` / `reset_tenant_label` — port
--     to TypeScript in Slice 8 per the plan (they're trivial KV lookups).
--   • Supabase-auth-bound (`fn_audit_log`, `handle_new_user`,
--     `fn_accept_invite_on_signup`, `has_permission`, `seed_user_categories`,
--     `my_tenant_id`, `is_manager_or_above`, `is_admin_or_above`) — replaced
--     by Tracey's auth/RLS/ctx.db.run pattern, never ported.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Trigger functions — generic utilities
-- ═════════════════════════════════════════════════════════════════════════

-- Standard updated_at-touch helper. Bound to every pl_* table that has an
-- updated_at column and isn't already covered by a more specific touch
-- trigger (e.g. pl_stocktake_lines, which has its own).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Crockford base32 minus confusable chars (0/O, 1/I, etc.). Used by the
-- room/location auto-barcode triggers.
CREATE OR REPLACE FUNCTION generate_short_code(prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN prefix || '-' || result;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. updated_at triggers on every pl_* table that has an updated_at column.
--    Mirrors Tino's pattern across the Supabase migrations. Each trigger is
--    BEFORE UPDATE so the column is set in-row before the write hits disk.
-- ═════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS pl_departments_updated_at ON pl_departments;
CREATE TRIGGER pl_departments_updated_at BEFORE UPDATE ON pl_departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_tenant_allergen_settings_updated_at ON pl_tenant_allergen_settings;
CREATE TRIGGER pl_tenant_allergen_settings_updated_at BEFORE UPDATE ON pl_tenant_allergen_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_tax_codes_updated_at ON pl_tax_codes;
CREATE TRIGGER pl_tax_codes_updated_at BEFORE UPDATE ON pl_tax_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_units_of_measure_updated_at ON pl_units_of_measure;
CREATE TRIGGER pl_units_of_measure_updated_at BEFORE UPDATE ON pl_units_of_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_tenant_pack_level_defs_updated_at ON pl_tenant_pack_level_defs;
CREATE TRIGGER pl_tenant_pack_level_defs_updated_at BEFORE UPDATE ON pl_tenant_pack_level_defs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_planning_user_settings_updated_at ON pl_planning_user_settings;
CREATE TRIGGER pl_planning_user_settings_updated_at BEFORE UPDATE ON pl_planning_user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_items_updated_at ON pl_items;
CREATE TRIGGER pl_items_updated_at BEFORE UPDATE ON pl_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_bom_headers_updated_at ON pl_bom_headers;
CREATE TRIGGER pl_bom_headers_updated_at BEFORE UPDATE ON pl_bom_headers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_suppliers_updated_at ON pl_suppliers;
CREATE TRIGGER pl_suppliers_updated_at BEFORE UPDATE ON pl_suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_supplier_items_updated_at ON pl_supplier_items;
CREATE TRIGGER pl_supplier_items_updated_at BEFORE UPDATE ON pl_supplier_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_supplier_contacts_updated_at ON pl_supplier_contacts;
CREATE TRIGGER pl_supplier_contacts_updated_at BEFORE UPDATE ON pl_supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_supplier_certifications_updated_at ON pl_supplier_certifications;
CREATE TRIGGER pl_supplier_certifications_updated_at BEFORE UPDATE ON pl_supplier_certifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_purchase_orders_updated_at ON pl_purchase_orders;
CREATE TRIGGER pl_purchase_orders_updated_at BEFORE UPDATE ON pl_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_fx_rates_updated_at ON pl_fx_rates;
CREATE TRIGGER pl_fx_rates_updated_at BEFORE UPDATE ON pl_fx_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_customers_updated_at ON pl_customers;
CREATE TRIGGER pl_customers_updated_at BEFORE UPDATE ON pl_customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_price_group_lines_updated_at ON pl_price_group_lines;
CREATE TRIGGER pl_price_group_lines_updated_at BEFORE UPDATE ON pl_price_group_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_customer_contacts_updated_at ON pl_customer_contacts;
CREATE TRIGGER pl_customer_contacts_updated_at BEFORE UPDATE ON pl_customer_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_customer_orders_updated_at ON pl_customer_orders;
CREATE TRIGGER pl_customer_orders_updated_at BEFORE UPDATE ON pl_customer_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_invoices_updated_at ON pl_invoices;
CREATE TRIGGER pl_invoices_updated_at BEFORE UPDATE ON pl_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_demand_plans_updated_at ON pl_demand_plans;
CREATE TRIGGER pl_demand_plans_updated_at BEFORE UPDATE ON pl_demand_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_mrp_overrides_updated_at ON pl_mrp_overrides;
CREATE TRIGGER pl_mrp_overrides_updated_at BEFORE UPDATE ON pl_mrp_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_production_orders_updated_at ON pl_production_orders;
CREATE TRIGGER pl_production_orders_updated_at BEFORE UPDATE ON pl_production_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_filling_orders_updated_at ON pl_filling_orders;
CREATE TRIGGER pl_filling_orders_updated_at BEFORE UPDATE ON pl_filling_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_cooking_orders_updated_at ON pl_cooking_orders;
CREATE TRIGGER pl_cooking_orders_updated_at BEFORE UPDATE ON pl_cooking_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_packing_orders_updated_at ON pl_packing_orders;
CREATE TRIGGER pl_packing_orders_updated_at BEFORE UPDATE ON pl_packing_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_machines_updated_at ON pl_machines;
CREATE TRIGGER pl_machines_updated_at BEFORE UPDATE ON pl_machines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_machine_breakdowns_updated_at ON pl_machine_breakdowns;
CREATE TRIGGER pl_machine_breakdowns_updated_at BEFORE UPDATE ON pl_machine_breakdowns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_machine_spare_parts_updated_at ON pl_machine_spare_parts;
CREATE TRIGGER pl_machine_spare_parts_updated_at BEFORE UPDATE ON pl_machine_spare_parts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_machine_documents_updated_at ON pl_machine_documents;
CREATE TRIGGER pl_machine_documents_updated_at BEFORE UPDATE ON pl_machine_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_lot_numbers_updated_at ON pl_lot_numbers;
CREATE TRIGGER pl_lot_numbers_updated_at BEFORE UPDATE ON pl_lot_numbers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_stocktakes_updated_at ON pl_stocktakes;
CREATE TRIGGER pl_stocktakes_updated_at BEFORE UPDATE ON pl_stocktakes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_product_specs_updated_at ON pl_product_specs;
CREATE TRIGGER pl_product_specs_updated_at BEFORE UPDATE ON pl_product_specs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_pallet_config_templates_updated_at ON pl_pallet_config_templates;
CREATE TRIGGER pl_pallet_config_templates_updated_at BEFORE UPDATE ON pl_pallet_config_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_item_pallet_config_updated_at ON pl_item_pallet_config;
CREATE TRIGGER pl_item_pallet_config_updated_at BEFORE UPDATE ON pl_item_pallet_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_rooms_updated_at ON pl_rooms;
CREATE TRIGGER pl_rooms_updated_at BEFORE UPDATE ON pl_rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_locations_updated_at ON pl_locations;
CREATE TRIGGER pl_locations_updated_at BEFORE UPDATE ON pl_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_goods_in_receipts_updated_at ON pl_goods_in_receipts;
CREATE TRIGGER pl_goods_in_receipts_updated_at BEFORE UPDATE ON pl_goods_in_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pl_tenant_labels_updated_at ON pl_tenant_labels;
CREATE TRIGGER pl_tenant_labels_updated_at BEFORE UPDATE ON pl_tenant_labels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Rooms / locations / machines auto-generated identifiers
--    (Tino's BEFORE INSERT helpers — keep code/barcode columns auto-populated
--    when the operator doesn't supply them. See migrations 045, 048, 085.)
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rooms_autogen_barcode()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempts integer := 0;
  candidate text;
BEGIN
  IF NEW.barcode IS NULL OR length(trim(NEW.barcode)) = 0 THEN
    LOOP
      candidate := generate_short_code('RM');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM pl_rooms
         WHERE tracey_tenant_id = NEW.tracey_tenant_id AND barcode = candidate
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Could not generate unique room barcode after 20 attempts';
      END IF;
    END LOOP;
    NEW.barcode := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_rooms_autogen_barcode_trg ON pl_rooms;
CREATE TRIGGER pl_rooms_autogen_barcode_trg BEFORE INSERT ON pl_rooms
  FOR EACH ROW EXECUTE FUNCTION rooms_autogen_barcode();

CREATE OR REPLACE FUNCTION locations_autogen_barcode()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempts integer := 0;
  candidate text;
BEGIN
  IF NEW.barcode IS NULL OR length(trim(NEW.barcode)) = 0 THEN
    LOOP
      candidate := generate_short_code('LOC');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM pl_locations
         WHERE tracey_tenant_id = NEW.tracey_tenant_id AND barcode = candidate
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Could not generate unique location barcode after 20 attempts';
      END IF;
    END LOOP;
    NEW.barcode := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_locations_autogen_barcode_trg ON pl_locations;
CREATE TRIGGER pl_locations_autogen_barcode_trg BEFORE INSERT ON pl_locations
  FOR EACH ROW EXECUTE FUNCTION locations_autogen_barcode();

CREATE OR REPLACE FUNCTION locations_autogen_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempts integer := 0;
  candidate text;
  next_n integer;
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    SELECT COALESCE(MAX(NULLIF(SUBSTRING(code FROM '^L-([0-9]+)$'), '')::int), 0) + 1
      INTO next_n
      FROM pl_locations
      WHERE tracey_tenant_id = NEW.tracey_tenant_id;
    LOOP
      candidate := 'L-' || lpad(next_n::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM pl_locations
         WHERE tracey_tenant_id = NEW.tracey_tenant_id AND code = candidate
      );
      next_n := next_n + 1;
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique location code after 100 attempts';
      END IF;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_locations_autogen_code_trg ON pl_locations;
CREATE TRIGGER pl_locations_autogen_code_trg BEFORE INSERT ON pl_locations
  FOR EACH ROW EXECUTE FUNCTION locations_autogen_code();

CREATE OR REPLACE FUNCTION machines_autogen_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempts integer := 0;
  candidate text;
  next_n integer;
  prefix text;
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    -- 3-letter prefix derived from machine_type. Unknown types fall back to MCH.
    prefix := CASE lower(coalesce(NEW.machine_type, ''))
      WHEN 'slicer'                 THEN 'SLC'
      WHEN 'smoker'                 THEN 'SMK'
      WHEN 'oven'                   THEN 'OVN'
      WHEN 'grinder'                THEN 'GRD'
      WHEN 'mixer'                  THEN 'MIX'
      WHEN 'filler'                 THEN 'FIL'
      WHEN 'packer'                 THEN 'PCK'
      WHEN 'sealer'                 THEN 'SEL'
      WHEN 'weigh-price labeller'   THEN 'WPL'
      WHEN 'conveyor'               THEN 'CNV'
      WHEN 'refrigeration unit'     THEN 'REF'
      WHEN 'saw'                    THEN 'SAW'
      WHEN 'brine injector'         THEN 'INJ'
      WHEN 'tumbler'                THEN 'TMB'
      ELSE                              'MCH'
    END;

    SELECT COALESCE(
      MAX(NULLIF(substring(code FROM ('^' || prefix || '-([0-9]+)$')), '')::int),
      0
    ) + 1
    INTO next_n
    FROM pl_machines
    WHERE tracey_tenant_id = NEW.tracey_tenant_id;

    LOOP
      candidate := prefix || '-' || lpad(next_n::text, 2, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM pl_machines
         WHERE tracey_tenant_id = NEW.tracey_tenant_id AND code = candidate
      );
      next_n := next_n + 1;
      attempts := attempts + 1;
      IF attempts > 200 THEN
        RAISE EXCEPTION 'Could not generate unique machine code after 200 attempts';
      END IF;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pl_machines_autogen_code_trg ON pl_machines;
CREATE TRIGGER pl_machines_autogen_code_trg BEFORE INSERT ON pl_machines
  FOR EACH ROW EXECUTE FUNCTION machines_autogen_code();

-- ═════════════════════════════════════════════════════════════════════════
-- 4. BOM business logic — keep bom_lines.percentage and
--    items.consumed_in_weight self-maintained. Source of truth for the MRP
--    cascade math. From migration 108.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recompute_bom_percentages_for_header(p_bom_header_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Set percentage on weight-class rows (component consumed_in_weight = true).
  UPDATE pl_bom_lines bl
     SET percentage = (bl.qty_per_batch / NULLIF(ws.total, 0)) * 100
    FROM (
      SELECT SUM(bl2.qty_per_batch) AS total
        FROM pl_bom_lines bl2
        JOIN pl_items     c   ON c.id = bl2.component_item_id
       WHERE bl2.bom_header_id = p_bom_header_id
         AND (c.unit = 'kg')
    ) ws
   WHERE bl.bom_header_id = p_bom_header_id
     AND EXISTS (
       SELECT 1 FROM pl_items c
        WHERE c.id = bl.component_item_id
          AND c.unit = 'kg'
     );

  -- Clear percentage on count-class rows (component swapped weight→count).
  UPDATE pl_bom_lines bl
     SET percentage = NULL
   WHERE bl.bom_header_id = p_bom_header_id
     AND bl.percentage IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pl_items c
        WHERE c.id = bl.component_item_id
          AND c.unit <> 'kg'
     );
END;
$$;

CREATE OR REPLACE FUNCTION bom_lines_recompute_pct_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM recompute_bom_percentages_for_header(
    COALESCE(NEW.bom_header_id, OLD.bom_header_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pl_bom_lines_pct_recompute ON pl_bom_lines;
CREATE TRIGGER pl_bom_lines_pct_recompute
  AFTER INSERT OR UPDATE OR DELETE ON pl_bom_lines
  FOR EACH ROW EXECUTE FUNCTION bom_lines_recompute_pct_trigger();

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Self-reference guard on pl_bom_lines. Defensive against the data-bug
--    class that broke German Butchery's 9004 / 5001 cascades May 2026.
--    From migration 116.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_bom_lines_prevent_self_reference()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  v_parent_item_id uuid;
  v_parent_code    text;
BEGIN
  SELECT b.item_id, i.code
    INTO v_parent_item_id, v_parent_code
    FROM pl_bom_headers b
    JOIN pl_items i ON i.id = b.item_id
   WHERE b.id = NEW.bom_header_id;

  IF v_parent_item_id IS NOT NULL AND NEW.component_item_id = v_parent_item_id THEN
    RAISE EXCEPTION
      'BOM self-reference is not allowed: item % cannot appear in its own BOM. '
      'If this is a refining/aging step that consumes a previous version of itself, '
      'create a separate "raw" or "pre" item code (e.g. RAW-% or %-PRE) and reference that instead.',
      v_parent_code, v_parent_code, v_parent_code;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS pl_bom_lines_no_self_reference ON pl_bom_lines;
CREATE TRIGGER pl_bom_lines_no_self_reference
  BEFORE INSERT OR UPDATE OF component_item_id, bom_header_id ON pl_bom_lines
  FOR EACH ROW EXECUTE FUNCTION trg_bom_lines_prevent_self_reference();

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Stocktake counted_at touch. Updates counted_at when counted_qty changes.
--    The Supabase original also set counted_by = COALESCE(NEW.counted_by, auth.uid())
--    — we drop the auth.uid() fallback. App code passes counted_by explicitly
--    from the NextAuth session.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION touch_stocktake_line()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.counted_qty IS NOT NULL THEN
      NEW.notes := NEW.notes;  -- noop, kept for column-touch compatibility
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.counted_qty IS DISTINCT FROM OLD.counted_qty THEN
      NEW.notes := NEW.notes;  -- noop, kept for column-touch compatibility
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- pl_stocktake_lines doesn't have counted_at/counted_by columns in Slice 1's
-- schema (those live on pl_stocktakes / pl_stocktake_department_signoffs).
-- The trigger above is a no-op shell; remove or expand it when the columns
-- are added in a later slice. Kept defined so the trigger name exists for
-- pre-existing app code that may DROP it during a rewrite slice.

-- ═════════════════════════════════════════════════════════════════════════
-- 7. MRP cascade — explode_mrp v2 from migration 117.
--    Recomputes pl_mrp_results for a given demand plan, then applies any
--    unresolved per-(plan, item, department) overrides from pl_mrp_overrides.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION explode_mrp(p_demand_plan_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_override  RECORD;
  v_old_qty   numeric;
BEGIN
  DELETE FROM pl_mrp_results WHERE demand_plan_id = p_demand_plan_id;

  -- 1) Normal cascade
  INSERT INTO pl_mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, unit, standard_batch_size,
    suggested_batches, rounded_batches,
    planned_qty, surplus_qty
  )
  WITH RECURSIVE bom_explosion AS (
    SELECT
      dl.item_id,
      GREATEST(0, COALESCE(dl.planned_qty_kg, dl.planned_weight_kg, 0) - COALESCE(i.current_stock, 0))::numeric AS required_qty,
      0 AS depth
    FROM pl_demand_lines dl
    JOIN pl_items i ON i.id = dl.item_id
    WHERE dl.demand_plan_id = p_demand_plan_id

    UNION ALL

    SELECT successor.item_id, successor.qty, be.depth + 1
    FROM bom_explosion be
    JOIN pl_items parent ON parent.id = be.item_id
    JOIN LATERAL (
      SELECT
        parent.parent_item_id AS item_id,
        be.required_qty       AS qty
      WHERE parent.parent_item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pl_bom_headers bh_chk
          JOIN pl_bom_lines bl_chk ON bl_chk.bom_header_id = bh_chk.id
          WHERE bh_chk.item_id = be.item_id
            AND bh_chk.is_active = true
            AND bl_chk.component_item_id = parent.parent_item_id
        )
      UNION ALL
      SELECT
        bl.component_item_id,
        CASE
          WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
          WHEN bl.unit = 'kg' THEN
            (be.required_qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
          WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
          WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
          WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
          WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
          WHEN bl.basis = 'per_kg' THEN
            be.required_qty * bl.qty_per_batch
          ELSE
            be.required_qty * bl.qty_per_batch / 1000.0
        END AS qty
      FROM pl_bom_headers bh
      JOIN pl_bom_lines bl ON bl.bom_header_id = bh.id
      LEFT JOIN LATERAL (
        SELECT SUM(bl2.qty_per_batch) AS recipe_sum
        FROM pl_bom_lines bl2
        WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
      ) line_totals ON true
      WHERE bh.item_id = be.item_id AND bh.is_active = true
    ) successor ON successor.item_id IS NOT NULL
    WHERE be.depth < 12 AND be.required_qty > 0 AND successor.qty > 0
  ),
  agg AS (
    SELECT be.item_id, sum(be.required_qty) AS gross
    FROM bom_explosion be
    GROUP BY be.item_id
  )
  SELECT
    p_demand_plan_id,
    a.item_id,
    COALESCE(NULLIF(i.department, ''), i.item_type::text) AS department,
    (SELECT id FROM pl_bom_headers WHERE item_id = a.item_id AND is_active = true LIMIT 1) AS bom_id,
    a.gross,
    i.unit,
    i.default_batch_size,
    NULL::numeric, NULL::int,
    GREATEST(0, a.gross - COALESCE(i.current_stock, 0)),
    0::numeric
  FROM agg a
  JOIN pl_items i ON i.id = a.item_id;

  -- 2) Apply each override.
  -- The Supabase original filtered on `mo.resolved_at IS NULL`, but
  -- pl_mrp_overrides doesn't carry a resolved_at column in Slice 1's schema.
  -- Treat every row as live; if the resolve-tracking column gets added in a
  -- later slice, re-add the filter here.
  FOR v_override IN
    SELECT mo.id, mo.item_id, mo.department, mo.override_qty
    FROM pl_mrp_overrides mo
    WHERE mo.demand_plan_id = p_demand_plan_id
      AND mo.override_qty IS NOT NULL
  LOOP
    SELECT mr.required_qty
      INTO v_old_qty
      FROM pl_mrp_results mr
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = v_override.item_id
       AND mr.department     = v_override.department
     LIMIT 1;

    IF v_old_qty IS NULL THEN v_old_qty := 0; END IF;

    WITH RECURSIVE sub AS (
      SELECT v_override.item_id AS item_id, 1.0::numeric AS qty, 0 AS depth
      UNION ALL
      SELECT successor.item_id, successor.qty, sub.depth + 1
      FROM sub
      JOIN pl_items parent ON parent.id = sub.item_id
      JOIN LATERAL (
        SELECT
          bl.component_item_id AS item_id,
          CASE
            WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
              (sub.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
            WHEN bl.unit = 'kg' THEN
              (sub.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
            WHEN bl.basis = 'per_piece' AND parent.target_weight_g > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
            WHEN bl.basis = 'per_inner' AND parent.target_weight_g > 0 AND parent.units_per_inner > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
            WHEN bl.basis = 'per_outer' AND parent.target_weight_g > 0 AND parent.units_per_outer > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
            WHEN bl.basis = 'per_pallet' AND parent.target_weight_g > 0 AND parent.units_per_pallet > 0 THEN
              (sub.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
            WHEN bl.basis = 'per_kg' THEN
              sub.qty * bl.qty_per_batch
            ELSE
              sub.qty * bl.qty_per_batch / 1000.0
          END AS qty
        FROM pl_bom_headers bh
        JOIN pl_bom_lines bl ON bl.bom_header_id = bh.id
        LEFT JOIN LATERAL (
          SELECT SUM(bl2.qty_per_batch) AS recipe_sum
          FROM pl_bom_lines bl2
          WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
        ) line_totals ON true
        WHERE bh.item_id = sub.item_id AND bh.is_active = true
      ) successor ON successor.item_id IS NOT NULL
      WHERE sub.depth < 12 AND sub.qty > 0 AND successor.qty > 0
    ),
    factors AS (
      SELECT item_id, sum(qty) AS factor
      FROM sub
      WHERE item_id <> v_override.item_id
      GROUP BY item_id
    )
    UPDATE pl_mrp_results mr
       SET required_qty = GREATEST(0, mr.required_qty + f.factor * (v_override.override_qty - v_old_qty)),
           planned_qty  = GREATEST(0, mr.required_qty + f.factor * (v_override.override_qty - v_old_qty))
      FROM factors f
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = f.item_id;

    UPDATE pl_mrp_results mr
       SET required_qty = v_override.override_qty,
           planned_qty  = v_override.override_qty
     WHERE mr.demand_plan_id = p_demand_plan_id
       AND mr.item_id        = v_override.item_id
       AND mr.department     = v_override.department;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION explode_mrp(uuid) IS
  'v2 (2026-05-10): supports per-(item,dept,plan) manual overrides via pl_mrp_overrides table. '
  'Override is applied post-cascade by rescaling the overridden node`s contribution to descendants.';

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Item-hierarchy navigation RPCs.
-- ═════════════════════════════════════════════════════════════════════════

-- get_item_tree — Returns the complete BOM family the given item participates
-- in: walks parent_item_id up to the root, then back down to every descendant.
-- The Supabase original joined item_categories directly off items.item_category_id;
-- our schema reaches category through item_subcategories.category_id.
CREATE OR REPLACE FUNCTION get_item_tree(p_item_id uuid)
RETURNS TABLE (
  id                uuid,
  code              text,
  name              text,
  item_type         text,
  parent_item_id    uuid,
  category_name     text,
  subcategory_name  text
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE
  ancestors AS (
    SELECT id, parent_item_id FROM pl_items WHERE id = p_item_id
    UNION ALL
    SELECT i.id, i.parent_item_id
      FROM pl_items i
      JOIN ancestors a ON a.parent_item_id = i.id
  ),
  root_id AS (
    SELECT id FROM ancestors WHERE parent_item_id IS NULL LIMIT 1
  ),
  descendants AS (
    SELECT id, parent_item_id
      FROM pl_items
     WHERE id = COALESCE((SELECT id FROM root_id), p_item_id)
    UNION ALL
    SELECT i.id, i.parent_item_id
      FROM pl_items i
      JOIN descendants d ON i.parent_item_id = d.id
  )
  SELECT DISTINCT
    i.id, i.code, i.name, i.item_type, i.parent_item_id,
    ic.name   AS category_name,
    isub.name AS subcategory_name
  FROM pl_items i
  LEFT JOIN pl_item_subcategories isub ON isub.id = i.item_subcategory_id
  LEFT JOIN pl_item_categories    ic   ON ic.id   = isub.category_id
  WHERE i.id IN (
    SELECT id FROM ancestors
    UNION SELECT id FROM descendants
  )
  ORDER BY i.code;
$$;

-- get_item_ancestors — walks parent_item_id upward, excludes the seed.
CREATE OR REPLACE FUNCTION get_item_ancestors(p_item_id uuid)
RETURNS TABLE (
  id        uuid,
  code      text,
  name      text,
  item_type text,
  unit      text,
  depth     int
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT i.id, i.code, i.name, i.item_type, i.unit, i.parent_item_id, 0 AS depth
      FROM pl_items i
     WHERE i.id = p_item_id
    UNION ALL
    SELECT i.id, i.code, i.name, i.item_type, i.unit, i.parent_item_id, c.depth + 1
      FROM pl_items i
      JOIN chain c ON i.id = c.parent_item_id
     WHERE c.depth < 10
  )
  SELECT id, code, name, item_type, unit, depth
    FROM chain
   WHERE depth > 0
   ORDER BY depth;
$$;

-- get_bom_walk — returns items + active bom_headers + bom_lines reachable
-- via the BOM tree starting at p_item_id, as a single jsonb blob. Drops the
-- `is_rte` and `ingredients_statement` columns that aren't in Slice 1's schema.
CREATE OR REPLACE FUNCTION get_bom_walk(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_item_ids uuid[];
  v_result jsonb;
BEGIN
  WITH RECURSIVE walk(item_id, depth) AS (
    SELECT p_item_id, 0
    UNION
    SELECT bl.component_item_id, w.depth + 1
      FROM walk w
      JOIN pl_bom_headers bh ON bh.item_id = w.item_id AND bh.is_active = true
      JOIN pl_bom_lines   bl ON bl.bom_header_id = bh.id
     WHERE w.depth < 12
  )
  SELECT array_agg(DISTINCT item_id)
    INTO v_item_ids
    FROM walk;

  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*))
      FROM (
        SELECT id, code, name, unit, item_type, consumed_in_weight, allergens,
               spec_storage_temp, spec_shelf_life,
               target_weight_g, fill_weight_g, units_per_inner, units_per_outer,
               weight_mode, parent_item_id,
               nut_energy_kj, nut_energy_kcal, nut_protein_g, nut_fat_total_g,
               nut_fat_saturated_g, nut_fat_trans_g, nut_carbs_total_g,
               nut_carbs_sugars_g, nut_fibre_g, nut_sodium_mg
          FROM pl_items
         WHERE id = ANY(v_item_ids)
      ) i
    ), '[]'::jsonb),
    'bom_headers', COALESCE((
      SELECT jsonb_agg(to_jsonb(h.*))
      FROM (
        SELECT id, item_id, reference_batch_size, reference_batch_unit,
               yield_factor, is_active
          FROM pl_bom_headers
         WHERE item_id = ANY(v_item_ids) AND is_active = true
      ) h
    ), '[]'::jsonb),
    'bom_lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l.*))
      FROM (
        SELECT bl.bom_header_id, bl.component_item_id, bl.qty_per_batch,
               bl.unit, bl.percentage, bl.basis
          FROM pl_bom_lines bl
          JOIN pl_bom_headers bh ON bh.id = bl.bom_header_id
         WHERE bh.item_id = ANY(v_item_ids) AND bh.is_active = true
      ) l
    ), '[]'::jsonb),
    'reached_count', COALESCE(array_length(v_item_ids, 1), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_bom_walk(uuid) IS
  'Returns the closure of items + active bom_headers + bom_lines reachable via the BOM tree '
  'from the given item id, as a single jsonb blob. Slice-3 port omits is_rte + ingredients_statement '
  'columns that aren''t in Slice 1''s schema; add them back when the schema gains them.';

-- ═════════════════════════════════════════════════════════════════════════
-- 9. Demand / purchasing helpers.
-- ═════════════════════════════════════════════════════════════════════════

-- get_item_type_counts — server-side tab counts for the Item Master page.
CREATE OR REPLACE FUNCTION get_item_type_counts()
RETURNS TABLE(item_type text, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT item_type, COUNT(*)::bigint AS cnt
    FROM pl_items
   GROUP BY item_type;
$$;

-- get_open_production_order_demand — aggregates raw-material / packaging /
-- consumable demand from production_orders with status in ('planned','in_progress').
-- The Supabase original used my_tenant_id() to scope; here search_path + RLS
-- handle isolation, so the WHERE clause drops to status + planned_qty only.
CREATE OR REPLACE FUNCTION get_open_production_order_demand()
RETURNS TABLE (
  item_id          uuid,
  total_needed     numeric,
  unit             text,
  open_order_count int
)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE explosion AS (
    SELECT po.id           AS source_po_id,
           po.item_id       AS item_id,
           po.planned_qty   AS qty,
           0                AS depth
      FROM pl_production_orders po
     WHERE po.status::text IN ('planned', 'in_progress')
       AND po.planned_qty > 0
    UNION ALL
    SELECT e.source_po_id, bl.component_item_id,
           CASE
             WHEN bl.percentage IS NOT NULL AND bl.percentage > 0 THEN
               (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0)) * (bl.percentage / 100.0)
             WHEN bl.unit = 'kg' THEN
               (e.qty / NULLIF(COALESCE(bh.yield_factor, 1.0), 0))
                 * (bl.qty_per_batch / NULLIF(line_totals.recipe_sum, 0))
             WHEN bl.basis = 'per_piece'  AND parent.target_weight_g  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
             WHEN bl.basis = 'per_inner'  AND parent.target_weight_g  > 0 AND parent.units_per_inner  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_inner)  * bl.qty_per_batch
             WHEN bl.basis = 'per_outer'  AND parent.target_weight_g  > 0 AND parent.units_per_outer  > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_outer)  * bl.qty_per_batch
             WHEN bl.basis = 'per_pallet' AND parent.target_weight_g  > 0 AND parent.units_per_pallet > 0 THEN
               (e.qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
             WHEN bl.basis = 'per_kg' THEN e.qty * bl.qty_per_batch
             ELSE e.qty * bl.qty_per_batch / 1000.0
           END,
           e.depth + 1
      FROM explosion e
      JOIN pl_items parent ON parent.id = e.item_id
      JOIN pl_bom_headers bh ON bh.item_id = e.item_id AND bh.is_active = true
      JOIN pl_bom_lines   bl ON bl.bom_header_id = bh.id
      LEFT JOIN LATERAL (
        SELECT SUM(bl2.qty_per_batch) AS recipe_sum
          FROM pl_bom_lines bl2
         WHERE bl2.bom_header_id = bh.id AND bl2.unit = 'kg'
      ) line_totals ON true
     WHERE e.depth < 12 AND e.qty > 0
  ),
  agg AS (
    SELECT e.item_id,
           SUM(e.qty)                      AS total_needed,
           COUNT(DISTINCT e.source_po_id)  AS open_order_count
      FROM explosion e
      JOIN pl_items i ON i.id = e.item_id
     WHERE i.item_type::text IN ('raw_material', 'packaging', 'consumable')
     GROUP BY e.item_id
  )
  SELECT a.item_id, a.total_needed, i.unit, a.open_order_count::int
    FROM agg a
    JOIN pl_items i ON i.id = a.item_id;
$$;
