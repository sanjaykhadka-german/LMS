-- Planning per-tenant baseline.
--
-- Applied by `packages/db/src/per-tenant-migrate.ts` (extended in Slice 4 to
-- run planning DDL when provisioning tenants) inside each tenant schema with:
--   SET LOCAL search_path = "tenant_<uuid>", public
--   SELECT set_config('app.tenant_id', '<uuid>', true)
--
-- Unqualified `pl_*` references below resolve into the tenant's schema.
-- `app.users` is explicitly qualified because `app` is intentionally not on
-- the search_path (see client.ts forTenant() comment for why).
--
-- The 75 `public.pl_*` template tables must already exist (created by
-- `pnpm db:migrate-planning` against `drizzle.config.planning.ts`).
-- LIKE INCLUDING ALL copies their structure (columns, defaults, CHECK
-- constraints, indexes) but NOT their FKs — those are recreated below pointing
-- at this tenant's sibling tables.
--
-- 9+ PL/pgSQL RPCs (explode_mrp, get_bom_walk, cost_breakdown_v2, get_item_tree,
-- etc.) and all 24+ triggers + trigger functions (set_updated_at,
-- rooms_autogen_barcode, bom_lines_pct_recompute, items_derive_consumed_in_weight,
-- etc.) land in Slice 3's 0013_planning_rpcs.sql — they are PL/pgSQL and grouped
-- there for review locality.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tables (75) — CREATE LIKE public.pl_* INCLUDING ALL
-- ─────────────────────────────────────────────────────────────────────────────

-- Reference data (14)
CREATE TABLE IF NOT EXISTS pl_departments (LIKE public.pl_departments INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_allergen_definitions (LIKE public.pl_allergen_definitions INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_tenant_allergen_settings (LIKE public.pl_tenant_allergen_settings INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_user_categories (LIKE public.pl_user_categories INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_user_department_access (LIKE public.pl_user_department_access INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_tax_codes (LIKE public.pl_tax_codes INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_units_of_measure (LIKE public.pl_units_of_measure INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_tenant_pack_level_defs (LIKE public.pl_tenant_pack_level_defs INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_roles (LIKE public.pl_roles INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_role_permissions (LIKE public.pl_role_permissions INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_user_logins (LIKE public.pl_user_logins INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_currencies (LIKE public.pl_currencies INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_ingredient_classifications (LIKE public.pl_ingredient_classifications INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_planning_user_settings (LIKE public.pl_planning_user_settings INCLUDING ALL);

-- Items, categories, allergens, images, ingredients (9)
CREATE TABLE IF NOT EXISTS pl_item_categories (LIKE public.pl_item_categories INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_subcategories (LIKE public.pl_item_subcategories INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_types (LIKE public.pl_item_types INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_items (LIKE public.pl_items INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_images (LIKE public.pl_item_images INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_barcodes (LIKE public.pl_item_barcodes INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_tenant_barcode_pool (LIKE public.pl_tenant_barcode_pool INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_spec_documents (LIKE public.pl_item_spec_documents INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_ingredient_components (LIKE public.pl_item_ingredient_components INCLUDING ALL);

-- BOM (2)
CREATE TABLE IF NOT EXISTS pl_bom_headers (LIKE public.pl_bom_headers INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_bom_lines (LIKE public.pl_bom_lines INCLUDING ALL);

-- Suppliers, supplier items, purchasing, FX (7)
CREATE TABLE IF NOT EXISTS pl_suppliers (LIKE public.pl_suppliers INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_supplier_items (LIKE public.pl_supplier_items INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_supplier_contacts (LIKE public.pl_supplier_contacts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_supplier_certifications (LIKE public.pl_supplier_certifications INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_purchase_orders (LIKE public.pl_purchase_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_purchase_order_lines (LIKE public.pl_purchase_order_lines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_fx_rates (LIKE public.pl_fx_rates INCLUDING ALL);

-- Customers, pricing, orders, invoices (9)
CREATE TABLE IF NOT EXISTS pl_customers (LIKE public.pl_customers INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_customer_item_overrides (LIKE public.pl_customer_item_overrides INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_price_groups (LIKE public.pl_price_groups INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_price_group_lines (LIKE public.pl_price_group_lines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_customer_contacts (LIKE public.pl_customer_contacts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_customer_orders (LIKE public.pl_customer_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_customer_order_lines (LIKE public.pl_customer_order_lines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_order_line_lots (LIKE public.pl_order_line_lots INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_invoices (LIKE public.pl_invoices INCLUDING ALL);

-- Plans, MRP, production, filling, cooking, packing, machines (10)
CREATE TABLE IF NOT EXISTS pl_demand_plans (LIKE public.pl_demand_plans INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_demand_lines (LIKE public.pl_demand_lines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_mrp_results (LIKE public.pl_mrp_results INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_mrp_overrides (LIKE public.pl_mrp_overrides INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_production_orders (LIKE public.pl_production_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_production_sub_operations (LIKE public.pl_production_sub_operations INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_traceability_links (LIKE public.pl_traceability_links INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_filling_orders (LIKE public.pl_filling_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_cooking_orders (LIKE public.pl_cooking_orders INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_packing_orders (LIKE public.pl_packing_orders INCLUDING ALL);

-- Machines (5)
CREATE TABLE IF NOT EXISTS pl_machines (LIKE public.pl_machines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_machine_breakdowns (LIKE public.pl_machine_breakdowns INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_machine_spare_parts (LIKE public.pl_machine_spare_parts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_machine_documents (LIKE public.pl_machine_documents INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_machine_maintenance_logs (LIKE public.pl_machine_maintenance_logs INCLUDING ALL);

-- Lots, stocktakes, specs, pallets, rooms, locations (10)
CREATE TABLE IF NOT EXISTS pl_lot_numbers (LIKE public.pl_lot_numbers INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_stocktakes (LIKE public.pl_stocktakes INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_stocktake_lines (LIKE public.pl_stocktake_lines INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_stocktake_department_signoffs (LIKE public.pl_stocktake_department_signoffs INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_product_specs (LIKE public.pl_product_specs INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_spec_images (LIKE public.pl_spec_images INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_spec_sends (LIKE public.pl_spec_sends INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_pallet_config_templates (LIKE public.pl_pallet_config_templates INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_item_pallet_config (LIKE public.pl_item_pallet_config INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_rooms (LIKE public.pl_rooms INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_locations (LIKE public.pl_locations INCLUDING ALL);

-- Wastage, goods-in, scan events (5)
CREATE TABLE IF NOT EXISTS pl_wastage_records (LIKE public.pl_wastage_records INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_wastage_reasons (LIKE public.pl_wastage_reasons INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_scan_events (LIKE public.pl_scan_events INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_goods_in_receipts (LIKE public.pl_goods_in_receipts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_goods_in_lines (LIKE public.pl_goods_in_lines INCLUDING ALL);

-- Miscellaneous (3)
CREATE TABLE IF NOT EXISTS pl_dispatch_records (LIKE public.pl_dispatch_records INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_inventory_transactions (LIKE public.pl_inventory_transactions INCLUDING ALL);
CREATE TABLE IF NOT EXISTS pl_tenant_labels (LIKE public.pl_tenant_labels INCLUDING ALL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Override tracey_tenant_id DEFAULT per table (read from the GUC set by the
--    migration runner). Skip pl_currencies (no tracey_tenant_id — it's a global
--    ISO-4217 reference table, identical content per tenant) and pl_role_permissions
--    (no tracey_tenant_id — inherited via role_id → pl_roles).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pl_departments ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_allergen_definitions ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_tenant_allergen_settings ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_user_categories ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_user_department_access ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_tax_codes ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_units_of_measure ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_tenant_pack_level_defs ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_roles ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_user_logins ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_ingredient_classifications ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_planning_user_settings ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_item_categories ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_subcategories ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_types ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_items ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_images ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_barcodes ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_tenant_barcode_pool ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_spec_documents ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_ingredient_components ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_bom_headers ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_bom_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_suppliers ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_supplier_items ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_supplier_contacts ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_supplier_certifications ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_purchase_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_purchase_order_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_fx_rates ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_customers ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_customer_item_overrides ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_price_groups ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_price_group_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_customer_contacts ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_customer_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_customer_order_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_order_line_lots ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_invoices ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_demand_plans ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_demand_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_mrp_results ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_mrp_overrides ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_production_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_production_sub_operations ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_traceability_links ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_filling_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_cooking_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_packing_orders ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_machines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_machine_breakdowns ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_machine_spare_parts ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_machine_documents ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_machine_maintenance_logs ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_lot_numbers ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_stocktakes ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_stocktake_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_stocktake_department_signoffs ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_product_specs ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_spec_images ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_spec_sends ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_pallet_config_templates ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_item_pallet_config ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_rooms ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_locations ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_wastage_records ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_wastage_reasons ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_scan_events ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_goods_in_receipts ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_goods_in_lines ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE pl_dispatch_records ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_inventory_transactions ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);
ALTER TABLE pl_tenant_labels ALTER COLUMN tracey_tenant_id SET DEFAULT current_setting('app.tenant_id', true);

-- pl_user_logins.tracey_tenant_id is nullable (cross-cutting login record) —
-- DEFAULT still helpful but the column itself stays NULLABLE per the schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Within-planning FKs (point at this tenant's sibling tables).
--    ON DELETE choices follow the source Supabase migrations:
--      CASCADE  — owned child rows (lines → header, contacts → parent)
--      SET NULL — optional pointers (parent_item_id, supplier_id on barcodes)
--      no clause (NO ACTION, default) — references to identity tables (items,
--                customers, suppliers, lot_numbers, departments) to prevent
--                orphaning
--    All FKs DEFERRABLE INITIALLY IMMEDIATE so the Slice 6 data import can use
--    SET CONSTRAINTS ALL DEFERRED to break import cycles.
-- ─────────────────────────────────────────────────────────────────────────────

-- Reference data FKs
ALTER TABLE pl_user_department_access
  ADD CONSTRAINT pl_user_department_access_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES pl_departments(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_role_permissions
  ADD CONSTRAINT pl_role_permissions_role_id_fkey
  FOREIGN KEY (role_id) REFERENCES pl_roles(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- Items hierarchy + subcategory FKs
ALTER TABLE pl_item_subcategories
  ADD CONSTRAINT pl_item_subcategories_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES pl_item_categories(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_parent_item_id_fkey
  FOREIGN KEY (parent_item_id) REFERENCES pl_items(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_item_subcategory_id_fkey
  FOREIGN KEY (item_subcategory_id) REFERENCES pl_item_subcategories(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_purchase_tax_code_id_fkey
  FOREIGN KEY (purchase_tax_code_id) REFERENCES pl_tax_codes(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_sales_tax_code_id_fkey
  FOREIGN KEY (sales_tax_code_id) REFERENCES pl_tax_codes(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_preferred_supplier_id_fkey
  FOREIGN KEY (preferred_supplier_id) REFERENCES pl_suppliers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_default_location_id_fkey
  FOREIGN KEY (default_location_id) REFERENCES pl_locations(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_items
  ADD CONSTRAINT pl_items_ingredient_classification_id_fkey
  FOREIGN KEY (ingredient_classification_id) REFERENCES pl_ingredient_classifications(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- Item images / barcodes / spec docs / ingredients
ALTER TABLE pl_item_images
  ADD CONSTRAINT pl_item_images_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_barcodes
  ADD CONSTRAINT pl_item_barcodes_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_barcodes
  ADD CONSTRAINT pl_item_barcodes_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_barcodes
  ADD CONSTRAINT pl_item_barcodes_pool_id_fkey
  FOREIGN KEY (pool_id) REFERENCES pl_tenant_barcode_pool(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_tenant_barcode_pool
  ADD CONSTRAINT pl_tenant_barcode_pool_assigned_item_id_fkey
  FOREIGN KEY (assigned_item_id) REFERENCES pl_items(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_spec_documents
  ADD CONSTRAINT pl_item_spec_documents_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_spec_documents
  ADD CONSTRAINT pl_item_spec_documents_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_ingredient_components
  ADD CONSTRAINT pl_item_ingredient_components_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_ingredient_components
  ADD CONSTRAINT pl_item_ingredient_components_classification_id_fkey
  FOREIGN KEY (classification_id) REFERENCES pl_ingredient_classifications(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- BOM
ALTER TABLE pl_bom_headers
  ADD CONSTRAINT pl_bom_headers_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_bom_lines
  ADD CONSTRAINT pl_bom_lines_bom_header_id_fkey
  FOREIGN KEY (bom_header_id) REFERENCES pl_bom_headers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_bom_lines
  ADD CONSTRAINT pl_bom_lines_component_item_id_fkey
  FOREIGN KEY (component_item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

-- Suppliers, purchasing
ALTER TABLE pl_supplier_items
  ADD CONSTRAINT pl_supplier_items_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_supplier_items
  ADD CONSTRAINT pl_supplier_items_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_supplier_contacts
  ADD CONSTRAINT pl_supplier_contacts_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_supplier_certifications
  ADD CONSTRAINT pl_supplier_certifications_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_purchase_orders
  ADD CONSTRAINT pl_purchase_orders_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_purchase_order_lines
  ADD CONSTRAINT pl_purchase_order_lines_purchase_order_id_fkey
  FOREIGN KEY (purchase_order_id) REFERENCES pl_purchase_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_purchase_order_lines
  ADD CONSTRAINT pl_purchase_order_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_purchase_order_lines
  ADD CONSTRAINT pl_purchase_order_lines_supplier_item_id_fkey
  FOREIGN KEY (supplier_item_id) REFERENCES pl_supplier_items(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- Customers, pricing, orders, invoices
ALTER TABLE pl_customers
  ADD CONSTRAINT pl_customers_price_group_id_fkey
  FOREIGN KEY (price_group_id) REFERENCES pl_price_groups(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_item_overrides
  ADD CONSTRAINT pl_customer_item_overrides_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES pl_customers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_item_overrides
  ADD CONSTRAINT pl_customer_item_overrides_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_price_group_lines
  ADD CONSTRAINT pl_price_group_lines_price_group_id_fkey
  FOREIGN KEY (price_group_id) REFERENCES pl_price_groups(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_price_group_lines
  ADD CONSTRAINT pl_price_group_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_contacts
  ADD CONSTRAINT pl_customer_contacts_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES pl_customers(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_orders
  ADD CONSTRAINT pl_customer_orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES pl_customers(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_order_lines
  ADD CONSTRAINT pl_customer_order_lines_customer_order_id_fkey
  FOREIGN KEY (customer_order_id) REFERENCES pl_customer_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_order_lines
  ADD CONSTRAINT pl_customer_order_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_order_lines
  ADD CONSTRAINT pl_customer_order_lines_sales_tax_code_id_fkey
  FOREIGN KEY (sales_tax_code_id) REFERENCES pl_tax_codes(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_order_line_lots
  ADD CONSTRAINT pl_order_line_lots_customer_order_line_id_fkey
  FOREIGN KEY (customer_order_line_id) REFERENCES pl_customer_order_lines(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_order_line_lots
  ADD CONSTRAINT pl_order_line_lots_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_invoices
  ADD CONSTRAINT pl_invoices_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES pl_customers(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_invoices
  ADD CONSTRAINT pl_invoices_customer_order_id_fkey
  FOREIGN KEY (customer_order_id) REFERENCES pl_customer_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- Plans / MRP / production
ALTER TABLE pl_demand_lines
  ADD CONSTRAINT pl_demand_lines_demand_plan_id_fkey
  FOREIGN KEY (demand_plan_id) REFERENCES pl_demand_plans(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_demand_lines
  ADD CONSTRAINT pl_demand_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_results
  ADD CONSTRAINT pl_mrp_results_demand_plan_id_fkey
  FOREIGN KEY (demand_plan_id) REFERENCES pl_demand_plans(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_results
  ADD CONSTRAINT pl_mrp_results_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_results
  ADD CONSTRAINT pl_mrp_results_bom_id_fkey
  FOREIGN KEY (bom_id) REFERENCES pl_bom_headers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_overrides
  ADD CONSTRAINT pl_mrp_overrides_demand_plan_id_fkey
  FOREIGN KEY (demand_plan_id) REFERENCES pl_demand_plans(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_overrides
  ADD CONSTRAINT pl_mrp_overrides_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_demand_plan_id_fkey
  FOREIGN KEY (demand_plan_id) REFERENCES pl_demand_plans(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pl_machines(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_bom_id_fkey
  FOREIGN KEY (bom_id) REFERENCES pl_bom_headers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_pickle_bom_id_fkey
  FOREIGN KEY (pickle_bom_id) REFERENCES pl_bom_headers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_sub_operations
  ADD CONSTRAINT pl_production_sub_operations_production_order_id_fkey
  FOREIGN KEY (production_order_id) REFERENCES pl_production_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_traceability_links
  ADD CONSTRAINT pl_traceability_links_production_order_id_fkey
  FOREIGN KEY (production_order_id) REFERENCES pl_production_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_traceability_links
  ADD CONSTRAINT pl_traceability_links_component_item_id_fkey
  FOREIGN KEY (component_item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_traceability_links
  ADD CONSTRAINT pl_traceability_links_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_filling_orders
  ADD CONSTRAINT pl_filling_orders_production_order_id_fkey
  FOREIGN KEY (production_order_id) REFERENCES pl_production_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_filling_orders
  ADD CONSTRAINT pl_filling_orders_fill_item_id_fkey
  FOREIGN KEY (fill_item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_cooking_orders
  ADD CONSTRAINT pl_cooking_orders_filling_order_id_fkey
  FOREIGN KEY (filling_order_id) REFERENCES pl_filling_orders(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_packing_orders
  ADD CONSTRAINT pl_packing_orders_cooking_order_id_fkey
  FOREIGN KEY (cooking_order_id) REFERENCES pl_cooking_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_packing_orders
  ADD CONSTRAINT pl_packing_orders_filling_order_id_fkey
  FOREIGN KEY (filling_order_id) REFERENCES pl_filling_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_packing_orders
  ADD CONSTRAINT pl_packing_orders_pack_item_id_fkey
  FOREIGN KEY (pack_item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

-- Machines
ALTER TABLE pl_machines
  ADD CONSTRAINT pl_machines_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES pl_departments(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_breakdowns
  ADD CONSTRAINT pl_machine_breakdowns_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pl_machines(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_spare_parts
  ADD CONSTRAINT pl_machine_spare_parts_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pl_machines(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_documents
  ADD CONSTRAINT pl_machine_documents_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pl_machines(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_maintenance_logs
  ADD CONSTRAINT pl_machine_maintenance_logs_machine_id_fkey
  FOREIGN KEY (machine_id) REFERENCES pl_machines(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- Lots / stocktakes / product specs
ALTER TABLE pl_lot_numbers
  ADD CONSTRAINT pl_lot_numbers_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_lines
  ADD CONSTRAINT pl_stocktake_lines_stocktake_id_fkey
  FOREIGN KEY (stocktake_id) REFERENCES pl_stocktakes(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_lines
  ADD CONSTRAINT pl_stocktake_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_lines
  ADD CONSTRAINT pl_stocktake_lines_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES pl_locations(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_lines
  ADD CONSTRAINT pl_stocktake_lines_batch_number_id_fkey
  FOREIGN KEY (batch_number_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_department_signoffs
  ADD CONSTRAINT pl_stocktake_department_signoffs_stocktake_id_fkey
  FOREIGN KEY (stocktake_id) REFERENCES pl_stocktakes(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_department_signoffs
  ADD CONSTRAINT pl_stocktake_department_signoffs_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES pl_departments(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_product_specs
  ADD CONSTRAINT pl_product_specs_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_images
  ADD CONSTRAINT pl_spec_images_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_images
  ADD CONSTRAINT pl_spec_images_spec_id_fkey
  FOREIGN KEY (spec_id) REFERENCES pl_product_specs(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_sends
  ADD CONSTRAINT pl_spec_sends_spec_id_fkey
  FOREIGN KEY (spec_id) REFERENCES pl_product_specs(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_sends
  ADD CONSTRAINT pl_spec_sends_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_sends
  ADD CONSTRAINT pl_spec_sends_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES pl_customers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_pallet_config
  ADD CONSTRAINT pl_item_pallet_config_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_pallet_config
  ADD CONSTRAINT pl_item_pallet_config_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES pl_pallet_config_templates(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_rooms
  ADD CONSTRAINT pl_rooms_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES pl_departments(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_locations
  ADD CONSTRAINT pl_locations_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES pl_rooms(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- Wastage, goods-in, scan events
ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_production_order_id_fkey
  FOREIGN KEY (production_order_id) REFERENCES pl_production_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_filling_order_id_fkey
  FOREIGN KEY (filling_order_id) REFERENCES pl_filling_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_packing_order_id_fkey
  FOREIGN KEY (packing_order_id) REFERENCES pl_packing_orders(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_scan_events
  ADD CONSTRAINT pl_scan_events_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_scan_events
  ADD CONSTRAINT pl_scan_events_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_goods_in_receipts
  ADD CONSTRAINT pl_goods_in_receipts_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES pl_suppliers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_goods_in_lines
  ADD CONSTRAINT pl_goods_in_lines_goods_in_receipt_id_fkey
  FOREIGN KEY (goods_in_receipt_id) REFERENCES pl_goods_in_receipts(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_goods_in_lines
  ADD CONSTRAINT pl_goods_in_lines_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_goods_in_lines
  ADD CONSTRAINT pl_goods_in_lines_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_dispatch_records
  ADD CONSTRAINT pl_dispatch_records_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_dispatch_records
  ADD CONSTRAINT pl_dispatch_records_demand_line_id_fkey
  FOREIGN KEY (demand_line_id) REFERENCES pl_demand_lines(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_inventory_transactions
  ADD CONSTRAINT pl_inventory_transactions_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES pl_items(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_inventory_transactions
  ADD CONSTRAINT pl_inventory_transactions_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES pl_lot_numbers(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FKs to cross-tenant identity (app.users — stays at the app schema).
--    Drizzle declared these via .references(() => users.id) in
--    planning-schema.ts, but LIKE INCLUDING ALL doesn't copy FKs, so they are
--    re-declared here pointing at the still-cross-schema app.users.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pl_user_department_access
  ADD CONSTRAINT pl_user_department_access_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_user_logins
  ADD CONSTRAINT pl_user_logins_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_planning_user_settings
  ADD CONSTRAINT pl_planning_user_settings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_images
  ADD CONSTRAINT pl_item_images_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_item_spec_documents
  ADD CONSTRAINT pl_item_spec_documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_bom_headers
  ADD CONSTRAINT pl_bom_headers_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_bom_headers
  ADD CONSTRAINT pl_bom_headers_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_purchase_orders
  ADD CONSTRAINT pl_purchase_orders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_fx_rates
  ADD CONSTRAINT pl_fx_rates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_orders
  ADD CONSTRAINT pl_customer_orders_confirmed_by_fkey
  FOREIGN KEY (confirmed_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_customer_orders
  ADD CONSTRAINT pl_customer_orders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_invoices
  ADD CONSTRAINT pl_invoices_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_demand_plans
  ADD CONSTRAINT pl_demand_plans_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_demand_plans
  ADD CONSTRAINT pl_demand_plans_locked_by_fkey
  FOREIGN KEY (locked_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_mrp_overrides
  ADD CONSTRAINT pl_mrp_overrides_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_batch_recipe_approved_by_fkey
  FOREIGN KEY (batch_recipe_approved_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_production_orders
  ADD CONSTRAINT pl_production_orders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_breakdowns
  ADD CONSTRAINT pl_machine_breakdowns_reported_by_fkey
  FOREIGN KEY (reported_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_breakdowns
  ADD CONSTRAINT pl_machine_breakdowns_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_documents
  ADD CONSTRAINT pl_machine_documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_machine_maintenance_logs
  ADD CONSTRAINT pl_machine_maintenance_logs_performed_by_fkey
  FOREIGN KEY (performed_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktakes
  ADD CONSTRAINT pl_stocktakes_counted_by_fkey
  FOREIGN KEY (counted_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_stocktake_department_signoffs
  ADD CONSTRAINT pl_stocktake_department_signoffs_signed_off_by_fkey
  FOREIGN KEY (signed_off_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_product_specs
  ADD CONSTRAINT pl_product_specs_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_product_specs
  ADD CONSTRAINT pl_product_specs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_spec_sends
  ADD CONSTRAINT pl_spec_sends_sent_by_fkey
  FOREIGN KEY (sent_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_wastage_records
  ADD CONSTRAINT pl_wastage_records_recorded_by_fkey
  FOREIGN KEY (recorded_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_scan_events
  ADD CONSTRAINT pl_scan_events_scanned_by_fkey
  FOREIGN KEY (scanned_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_goods_in_receipts
  ADD CONSTRAINT pl_goods_in_receipts_received_by_fkey
  FOREIGN KEY (received_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_dispatch_records
  ADD CONSTRAINT pl_dispatch_records_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE pl_inventory_transactions
  ADD CONSTRAINT pl_inventory_transactions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Generated columns. The Drizzle schema declares these as plain numeric/
--    integer; the baseline SQL rewrites them as GENERATED ALWAYS AS … STORED.
--    Drop-then-recreate is required because Postgres won't ALTER COLUMN SET
--    GENERATED on an existing non-generated column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pl_stocktake_lines DROP COLUMN variance;
ALTER TABLE pl_stocktake_lines
  ADD COLUMN variance numeric
  GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) STORED;

ALTER TABLE pl_item_pallet_config DROP COLUMN units_per_pallet;
ALTER TABLE pl_item_pallet_config
  ADD COLUMN units_per_pallet integer
  GENERATED ALWAYS AS (ti * hi) STORED;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Partial unique indexes (Drizzle's uniqueIndex().on(...) can express
--    composite UQs but the WHERE-clause partials below are added here).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS pl_rooms_tenant_barcode_uq
  ON pl_rooms (tracey_tenant_id, barcode)
  WHERE barcode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pl_locations_tenant_barcode_uq
  ON pl_locations (tracey_tenant_id, barcode)
  WHERE barcode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pl_customer_contacts_primary_uq
  ON pl_customer_contacts (customer_id)
  WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS pl_supplier_contacts_primary_uq
  ON pl_supplier_contacts (supplier_id)
  WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS pl_price_groups_tenant_code_uq
  ON pl_price_groups (tracey_tenant_id, name)
  WHERE name IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — defence-in-depth on top of physical schema isolation. Same policy
--    shape as the shiftcraft per-tenant tables and LMS phase-7 baseline. Skip
--    pl_currencies (global lookup, no tracey_tenant_id) and pl_role_permissions
--    (no tracey_tenant_id — reachable via FK to pl_roles which IS tenant-tagged).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pl_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_departments;
CREATE POLICY tenant_isolation ON pl_departments
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_allergen_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_allergen_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_allergen_definitions;
CREATE POLICY tenant_isolation ON pl_allergen_definitions
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_tenant_allergen_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tenant_allergen_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_tenant_allergen_settings;
CREATE POLICY tenant_isolation ON pl_tenant_allergen_settings
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_user_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_user_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_user_categories;
CREATE POLICY tenant_isolation ON pl_user_categories
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_user_department_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_user_department_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_user_department_access;
CREATE POLICY tenant_isolation ON pl_user_department_access
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tax_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_tax_codes;
CREATE POLICY tenant_isolation ON pl_tax_codes
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_units_of_measure FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_units_of_measure;
CREATE POLICY tenant_isolation ON pl_units_of_measure
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_tenant_pack_level_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tenant_pack_level_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_tenant_pack_level_defs;
CREATE POLICY tenant_isolation ON pl_tenant_pack_level_defs
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_roles;
CREATE POLICY tenant_isolation ON pl_roles
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_ingredient_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_ingredient_classifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_ingredient_classifications;
CREATE POLICY tenant_isolation ON pl_ingredient_classifications
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_planning_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_planning_user_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_planning_user_settings;
CREATE POLICY tenant_isolation ON pl_planning_user_settings
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_categories;
CREATE POLICY tenant_isolation ON pl_item_categories
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_subcategories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_subcategories;
CREATE POLICY tenant_isolation ON pl_item_subcategories
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_types;
CREATE POLICY tenant_isolation ON pl_item_types
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_items;
CREATE POLICY tenant_isolation ON pl_items
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_images;
CREATE POLICY tenant_isolation ON pl_item_images
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_barcodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_barcodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_barcodes;
CREATE POLICY tenant_isolation ON pl_item_barcodes
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_tenant_barcode_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tenant_barcode_pool FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_tenant_barcode_pool;
CREATE POLICY tenant_isolation ON pl_tenant_barcode_pool
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_spec_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_spec_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_spec_documents;
CREATE POLICY tenant_isolation ON pl_item_spec_documents
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_ingredient_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_ingredient_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_ingredient_components;
CREATE POLICY tenant_isolation ON pl_item_ingredient_components
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_bom_headers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_bom_headers;
CREATE POLICY tenant_isolation ON pl_bom_headers
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_bom_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_bom_lines;
CREATE POLICY tenant_isolation ON pl_bom_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_suppliers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_suppliers;
CREATE POLICY tenant_isolation ON pl_suppliers
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_supplier_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_supplier_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_supplier_items;
CREATE POLICY tenant_isolation ON pl_supplier_items
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_supplier_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_supplier_contacts;
CREATE POLICY tenant_isolation ON pl_supplier_contacts
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_supplier_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_supplier_certifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_supplier_certifications;
CREATE POLICY tenant_isolation ON pl_supplier_certifications
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_purchase_orders;
CREATE POLICY tenant_isolation ON pl_purchase_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_purchase_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_purchase_order_lines;
CREATE POLICY tenant_isolation ON pl_purchase_order_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_fx_rates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_fx_rates;
CREATE POLICY tenant_isolation ON pl_fx_rates
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_customers;
CREATE POLICY tenant_isolation ON pl_customers
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_customer_item_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_customer_item_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_customer_item_overrides;
CREATE POLICY tenant_isolation ON pl_customer_item_overrides
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_price_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_price_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_price_groups;
CREATE POLICY tenant_isolation ON pl_price_groups
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_price_group_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_price_group_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_price_group_lines;
CREATE POLICY tenant_isolation ON pl_price_group_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_customer_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_customer_contacts;
CREATE POLICY tenant_isolation ON pl_customer_contacts
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_customer_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_customer_orders;
CREATE POLICY tenant_isolation ON pl_customer_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_customer_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_customer_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_customer_order_lines;
CREATE POLICY tenant_isolation ON pl_customer_order_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_order_line_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_order_line_lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_order_line_lots;
CREATE POLICY tenant_isolation ON pl_order_line_lots
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_invoices;
CREATE POLICY tenant_isolation ON pl_invoices
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_demand_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_demand_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_demand_plans;
CREATE POLICY tenant_isolation ON pl_demand_plans
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_demand_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_demand_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_demand_lines;
CREATE POLICY tenant_isolation ON pl_demand_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_mrp_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_mrp_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_mrp_results;
CREATE POLICY tenant_isolation ON pl_mrp_results
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_mrp_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_mrp_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_mrp_overrides;
CREATE POLICY tenant_isolation ON pl_mrp_overrides
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_production_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_production_orders;
CREATE POLICY tenant_isolation ON pl_production_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_production_sub_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_production_sub_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_production_sub_operations;
CREATE POLICY tenant_isolation ON pl_production_sub_operations
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_traceability_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_traceability_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_traceability_links;
CREATE POLICY tenant_isolation ON pl_traceability_links
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_filling_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_filling_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_filling_orders;
CREATE POLICY tenant_isolation ON pl_filling_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_cooking_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_cooking_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_cooking_orders;
CREATE POLICY tenant_isolation ON pl_cooking_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_packing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_packing_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_packing_orders;
CREATE POLICY tenant_isolation ON pl_packing_orders
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_machines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_machines;
CREATE POLICY tenant_isolation ON pl_machines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_machine_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_machine_breakdowns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_machine_breakdowns;
CREATE POLICY tenant_isolation ON pl_machine_breakdowns
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_machine_spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_machine_spare_parts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_machine_spare_parts;
CREATE POLICY tenant_isolation ON pl_machine_spare_parts
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_machine_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_machine_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_machine_documents;
CREATE POLICY tenant_isolation ON pl_machine_documents
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_machine_maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_machine_maintenance_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_machine_maintenance_logs;
CREATE POLICY tenant_isolation ON pl_machine_maintenance_logs
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_lot_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_lot_numbers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_lot_numbers;
CREATE POLICY tenant_isolation ON pl_lot_numbers
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_stocktakes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_stocktakes;
CREATE POLICY tenant_isolation ON pl_stocktakes
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_stocktake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_stocktake_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_stocktake_lines;
CREATE POLICY tenant_isolation ON pl_stocktake_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_stocktake_department_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_stocktake_department_signoffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_stocktake_department_signoffs;
CREATE POLICY tenant_isolation ON pl_stocktake_department_signoffs
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_product_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_product_specs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_product_specs;
CREATE POLICY tenant_isolation ON pl_product_specs
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_spec_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_spec_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_spec_images;
CREATE POLICY tenant_isolation ON pl_spec_images
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_spec_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_spec_sends FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_spec_sends;
CREATE POLICY tenant_isolation ON pl_spec_sends
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_pallet_config_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_pallet_config_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_pallet_config_templates;
CREATE POLICY tenant_isolation ON pl_pallet_config_templates
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_item_pallet_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_item_pallet_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_item_pallet_config;
CREATE POLICY tenant_isolation ON pl_item_pallet_config
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_rooms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_rooms;
CREATE POLICY tenant_isolation ON pl_rooms
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_locations;
CREATE POLICY tenant_isolation ON pl_locations
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_wastage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_wastage_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_wastage_records;
CREATE POLICY tenant_isolation ON pl_wastage_records
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_wastage_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_wastage_reasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_wastage_reasons;
CREATE POLICY tenant_isolation ON pl_wastage_reasons
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_scan_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_scan_events;
CREATE POLICY tenant_isolation ON pl_scan_events
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_goods_in_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_goods_in_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_goods_in_receipts;
CREATE POLICY tenant_isolation ON pl_goods_in_receipts
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_goods_in_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_goods_in_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_goods_in_lines;
CREATE POLICY tenant_isolation ON pl_goods_in_lines
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_dispatch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_dispatch_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_dispatch_records;
CREATE POLICY tenant_isolation ON pl_dispatch_records
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_inventory_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_inventory_transactions;
CREATE POLICY tenant_isolation ON pl_inventory_transactions
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pl_tenant_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tenant_labels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pl_tenant_labels;
CREATE POLICY tenant_isolation ON pl_tenant_labels
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- pl_currencies and pl_role_permissions have no tracey_tenant_id and are not
-- enabled for RLS — pl_currencies is a global ISO-4217 lookup, pl_role_permissions
-- is reachable only via FK to pl_roles which IS tenant-tagged. Physical isolation
-- (per-tenant schema) + FK chain is the protection here.
