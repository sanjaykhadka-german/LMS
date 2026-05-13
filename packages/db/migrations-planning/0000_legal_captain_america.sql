CREATE TABLE "pl_allergen_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"regulatory_standard" text DEFAULT 'FSANZ' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pl_allergen_defs_std_chk" CHECK ("pl_allergen_definitions"."regulatory_standard" in ('FSANZ','EU','FDA','CUSTOM'))
);
--> statement-breakpoint
CREATE TABLE "pl_bom_headers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reference_batch_size" numeric NOT NULL,
	"reference_batch_unit" text DEFAULT 'kg' NOT NULL,
	"yield_factor" numeric DEFAULT '1.0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"bom_header_id" uuid NOT NULL,
	"component_item_id" uuid NOT NULL,
	"qty_per_batch" numeric NOT NULL,
	"unit" text NOT NULL,
	"percentage" numeric,
	"grind_size" text,
	"comment" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"consume_per_qty" numeric,
	"basis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_cooking_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"filling_order_id" uuid NOT NULL,
	"cook_date" date,
	"raw_weight_in_kg" numeric,
	"cooked_weight_out_kg" numeric,
	"yield_pct" numeric,
	"core_temp_achieved_c" numeric,
	"cook_program" text,
	"oven_id" text,
	"cook_start_time" timestamp with time zone,
	"cook_end_time" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimal_places" integer DEFAULT 2 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"mobile" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"receives_orders" boolean DEFAULT false NOT NULL,
	"receives_invoices" boolean DEFAULT false NOT NULL,
	"receives_claims" boolean DEFAULT false NOT NULL,
	"receives_delivery_notices" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_customer_item_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"min_shelf_life_days" integer,
	"unit_price" numeric,
	"currency" text DEFAULT 'AUD',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_customer_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"line_number" integer DEFAULT 1 NOT NULL,
	"qty_units" integer,
	"qty_kg" numeric,
	"unit_price" numeric,
	"line_total" numeric,
	"currency" text DEFAULT 'AUD',
	"sales_tax_code_id" uuid,
	"tax_amount" numeric,
	"dispatched_units" integer,
	"dispatched_kg" numeric,
	"lot_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_customer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"customer_po_number" text,
	"channel" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date DEFAULT current_date NOT NULL,
	"required_date" date,
	"delivery_date" date,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"notes" text,
	"delivery_address" text,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"trading_name" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"website" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postcode" text,
	"country_code" text DEFAULT 'AU',
	"currency" text DEFAULT 'AUD',
	"price_group_id" uuid,
	"payment_terms" text,
	"account_number" text,
	"tax_registration" text,
	"sales_account_code" text,
	"min_shelf_life_days" integer,
	"delivery_day" smallint,
	"delivery_instructions" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"receiving_days" text[],
	"receiving_open" time,
	"receiving_close" time,
	"loading_dock_notes" text,
	"billing_address_line1" text,
	"billing_address_line2" text,
	"billing_city" text,
	"billing_state" text,
	"billing_postcode" text,
	"billing_country_code" text DEFAULT 'AU',
	"abn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_demand_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"demand_plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"demand_type" text DEFAULT 'replenishment' NOT NULL,
	"planned_qty_kg" numeric,
	"planned_units" integer,
	"planned_weight_kg" numeric,
	"customer_ref" text,
	"customer_name" text,
	"required_date" date,
	"day_of_week" smallint,
	"priority" integer DEFAULT 5,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_demand_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_dispatch_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"dispatch_date" date NOT NULL,
	"customer_name" text,
	"customer_ref" text,
	"demand_line_id" uuid,
	"item_id" uuid NOT NULL,
	"qty_units" integer,
	"qty_kg" numeric,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_filling_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"production_order_id" uuid NOT NULL,
	"fill_item_id" uuid NOT NULL,
	"kg_planned" numeric NOT NULL,
	"kg_produced" numeric,
	"fill_weight_raw_g" numeric,
	"n_links_planned" integer,
	"n_links_produced" integer,
	"fill_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric NOT NULL,
	"valid_on" date NOT NULL,
	"source" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_goods_in_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"goods_in_receipt_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_lot" text,
	"supplier_barcode" text,
	"purchase_uom" text,
	"n_purchase_units" integer,
	"purchase_uom_qty_each" numeric,
	"qty_received" numeric NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"received_date" date,
	"best_before_date" date,
	"use_by_date" date,
	"lot_id" uuid,
	"unit_price" numeric,
	"currency" text DEFAULT 'AUD',
	"total_price" numeric,
	"is_quarantined" boolean DEFAULT false NOT NULL,
	"quarantine_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_goods_in_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"supplier_id" uuid,
	"receipt_number" text,
	"supplier_delivery_ref" text,
	"received_date" date DEFAULT current_date NOT NULL,
	"received_by" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_ingredient_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_australian" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"tx_type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_order_id" uuid,
	"invoice_number" text NOT NULL,
	"invoice_date" date DEFAULT current_date NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"subtotal" numeric,
	"tax_total" numeric,
	"total" numeric,
	"notes" text,
	"external_ref" text,
	"exported_at" timestamp with time zone,
	"custom_template" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"barcode_type" text DEFAULT 'internal' NOT NULL,
	"barcode_format" text DEFAULT 'code128' NOT NULL,
	"barcode_value" text NOT NULL,
	"supplier_id" uuid,
	"pool_id" uuid,
	"description" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size_bytes" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_ingredient_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"classification_id" uuid,
	"e_number" text,
	"percentage" numeric,
	"meat_species" text,
	"country_of_origin" text,
	"is_processing_aid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_pallet_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"template_id" uuid,
	"ti" integer,
	"hi" integer,
	"units_per_pallet" integer,
	"carton_length_mm" integer,
	"carton_width_mm" integer,
	"carton_height_mm" integer,
	"carton_gross_weight_kg" numeric,
	"carton_net_weight_kg" numeric,
	"pallet_type" text DEFAULT 'plain' NOT NULL,
	"pallet_length_mm" integer,
	"pallet_width_mm" integer,
	"stack_height_mm" integer,
	"total_pallet_weight_kg" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_item_spec_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"document_type" text DEFAULT 'spec_sheet' NOT NULL,
	"title" text NOT NULL,
	"version" text,
	"effective_date" date,
	"expiry_date" date,
	"supplier_id" uuid,
	"document_url" text NOT NULL,
	"document_name" text NOT NULL,
	"file_size_bytes" bigint,
	"mime_type" text,
	"extracted_data" jsonb,
	"extraction_status" text DEFAULT 'pending',
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_item_subcategories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_item_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6B7280' NOT NULL,
	"is_purchasable" boolean DEFAULT false NOT NULL,
	"can_have_bom" boolean DEFAULT false NOT NULL,
	"is_sellable" boolean DEFAULT false NOT NULL,
	"is_producible" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"item_type" text DEFAULT 'raw_material' NOT NULL,
	"parent_item_id" uuid,
	"item_subcategory_id" uuid,
	"production_method" text,
	"department" text,
	"machine" text,
	"room" text,
	"priority" numeric DEFAULT '5',
	"unit" text DEFAULT 'kg' NOT NULL,
	"default_batch_size" numeric,
	"batch_unit" text DEFAULT 'kg',
	"weight_mode" text DEFAULT 'random',
	"target_weight_g" numeric,
	"target_weight_per_piece_g" numeric,
	"target_weight_per_inner_g" numeric,
	"tare_weight_g" numeric,
	"tolerance_over_g" numeric,
	"tolerance_under_g" numeric,
	"units_per_inner" integer,
	"units_per_outer" integer,
	"inner_per_outer" integer,
	"units_per_pallet" integer,
	"outers_per_pallet" integer,
	"fill_weight_g" numeric,
	"process_loss_pct" numeric,
	"giveaway_pct" numeric,
	"consumed_in_weight" numeric,
	"consumed_in_basis" text,
	"allergens" text[] DEFAULT '{}'::text[],
	"current_stock" numeric DEFAULT '0' NOT NULL,
	"min_stock" numeric DEFAULT '0' NOT NULL,
	"max_stock" numeric DEFAULT '0' NOT NULL,
	"is_make_to_order" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer,
	"item_number" text,
	"spec_storage_temp" text,
	"spec_shelf_life" text,
	"spec_notes" text,
	"spec_origin" text,
	"spec_fat_content" text,
	"spec_protein" text,
	"spec_moisture" text,
	"spec_ph" text,
	"spec_water_activity" text,
	"spec_micro" text,
	"spec_weight_per_unit" text,
	"spec_packaging" text,
	"spec_labelling" text,
	"supplier" text,
	"supplier_code" text,
	"purchase_tax_code_id" uuid,
	"sales_tax_code_id" uuid,
	"purchase_account_code" text,
	"sales_account_code" text,
	"purchase_uom" text,
	"purchase_uom_qty" numeric,
	"purchase_uom_type" text,
	"purchase_unit_price" numeric,
	"purchase_currency" text DEFAULT 'AUD',
	"procurement_type" text,
	"nut_energy_kj" numeric,
	"nut_energy_kcal" numeric,
	"nut_protein_g" numeric,
	"nut_fat_total_g" numeric,
	"nut_fat_saturated_g" numeric,
	"nut_fat_trans_g" numeric,
	"nut_carbs_total_g" numeric,
	"nut_carbs_sugars_g" numeric,
	"nut_fibre_g" numeric,
	"nut_sodium_mg" numeric,
	"nut_per_serving_g" numeric,
	"nut_notes" text,
	"preferred_supplier_id" uuid,
	"standard_cost" numeric,
	"nip_large_item" boolean,
	"default_location_id" uuid,
	"ingredient_classification_id" uuid,
	"pack_levels" jsonb,
	"sell_pricing_policy" text,
	"order_uom" text,
	"invoice_prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"room_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"barcode" text,
	"color" text,
	"sort_order" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_lot_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_code" text NOT NULL,
	"supplier_lot" text,
	"received_date" date,
	"best_before_date" date,
	"use_by_date" date,
	"qty_received" numeric NOT NULL,
	"qty_remaining" numeric NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"is_quarantined" boolean DEFAULT false NOT NULL,
	"quarantine_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_machine_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_by" uuid,
	"severity" text DEFAULT 'medium' NOT NULL,
	"description" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_notes" text,
	"downtime_hours" numeric,
	"repair_cost" numeric,
	"parts_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_machine_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"document_url" text,
	"document_name" text,
	"file_size_bytes" bigint,
	"version" text,
	"effective_date" date,
	"expiry_date" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_machine_maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"maintenance_date" date NOT NULL,
	"maintenance_type" text,
	"description" text,
	"performed_by" uuid,
	"performed_by_name" text,
	"duration_hours" numeric,
	"cost" numeric,
	"next_due_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_machine_spare_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"part_name" text NOT NULL,
	"part_number" text,
	"description" text,
	"quantity_on_hand" numeric DEFAULT '0' NOT NULL,
	"reorder_level" numeric,
	"unit" text DEFAULT 'each',
	"supplier_name" text,
	"supplier_part_no" text,
	"unit_cost" numeric,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"department_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"machine_type" text,
	"capacity_value" numeric,
	"capacity_unit" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"asset_number" text,
	"purchase_date" date,
	"purchase_price" numeric,
	"last_service_date" date,
	"next_service_date" date,
	"service_interval_days" integer,
	"service_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'operational' NOT NULL,
	"location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_mrp_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"demand_plan_id" uuid,
	"item_id" uuid NOT NULL,
	"department" text,
	"override_qty" numeric,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_mrp_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"demand_plan_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"department" text NOT NULL,
	"bom_id" uuid,
	"required_qty" numeric NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"standard_batch_size" numeric,
	"suggested_batches" numeric,
	"rounded_batches" integer,
	"planned_qty" numeric,
	"surplus_qty" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_order_line_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"customer_order_line_id" uuid NOT NULL,
	"lot_id" uuid,
	"lot_code" text,
	"qty_kg" numeric,
	"qty_units" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_packing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"cooking_order_id" uuid,
	"filling_order_id" uuid,
	"pack_item_id" uuid NOT NULL,
	"pack_date" date,
	"day_of_week" smallint,
	"planned_units" integer,
	"packed_units" integer,
	"wastage_units" integer,
	"total_giveaway_g" numeric,
	"avg_giveaway_g" numeric,
	"planned_weight_kg" numeric,
	"packed_weight_kg" numeric,
	"wastage_weight_kg" numeric,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_pallet_config_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ti" integer,
	"hi" integer,
	"pallet_type" text DEFAULT 'plain' NOT NULL,
	"pallet_length_mm" integer,
	"pallet_width_mm" integer,
	"pallet_height_mm" integer,
	"max_weight_kg" numeric,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_planning_user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"planning_role_id" uuid,
	"home_department_id" uuid,
	"force_password_change" boolean DEFAULT false NOT NULL,
	"all_departments" boolean DEFAULT true NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_price_group_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"price_group_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_price" numeric,
	"discount_pct" numeric,
	"currency" text DEFAULT 'AUD',
	"valid_from" date,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_price_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_standard" boolean,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_product_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"version_label" text DEFAULT '1.0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"internal_notes" text,
	"spec_storage_temp" text,
	"spec_shelf_life" text,
	"spec_notes" text,
	"spec_origin" text,
	"spec_fat_content" text,
	"spec_protein" text,
	"spec_moisture" text,
	"spec_ph" text,
	"spec_water_activity" text,
	"spec_micro" text,
	"spec_packaging" text,
	"spec_labelling" text,
	"nut_energy_kj" numeric,
	"nut_energy_kcal" numeric,
	"nut_protein_g" numeric,
	"nut_fat_total_g" numeric,
	"nut_fat_saturated_g" numeric,
	"nut_fat_trans_g" numeric,
	"nut_carbs_total_g" numeric,
	"nut_carbs_sugars_g" numeric,
	"nut_fibre_g" numeric,
	"nut_sodium_mg" numeric,
	"nut_per_serving_g" numeric,
	"nut_notes" text,
	"allergens" text[],
	"show_coo_detail" boolean DEFAULT false NOT NULL,
	"coo_breakdown" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"demand_plan_id" uuid,
	"item_id" uuid NOT NULL,
	"department" text DEFAULT 'production' NOT NULL,
	"batch_number" text NOT NULL,
	"production_date" date,
	"day_of_week" smallint,
	"batch_size" numeric NOT NULL,
	"n_of_batches" integer NOT NULL,
	"planned_qty" numeric NOT NULL,
	"actual_qty" numeric,
	"unit" text DEFAULT 'kg' NOT NULL,
	"machine" text,
	"machine_id" uuid,
	"run_sequence" integer,
	"machine_notes" text,
	"room" text,
	"priority" numeric DEFAULT '5',
	"bom_id" uuid,
	"batch_recipe_generated" boolean DEFAULT false NOT NULL,
	"batch_recipe_approved" boolean DEFAULT false NOT NULL,
	"batch_recipe_approved_by" uuid,
	"batch_recipe_approved_at" timestamp with time zone,
	"raw_weight_kg" numeric,
	"injection_target_pct" numeric,
	"actual_pct_injected" numeric,
	"tumble_hours" numeric,
	"pickle_bom_id" uuid,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_production_sub_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"production_order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"machine" text,
	"operator_name" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"planned_qty" numeric,
	"actual_qty" numeric,
	"unit" text DEFAULT 'kg',
	"notes" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_item_id" uuid,
	"qty_ordered" numeric DEFAULT '0' NOT NULL,
	"unit" text,
	"unit_price" numeric,
	"currency" text DEFAULT 'AUD',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"po_number" text,
	"supplier_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date DEFAULT current_date NOT NULL,
	"expected_date" date,
	"notes" text,
	"created_by" uuid,
	"fx_rate_currency" text,
	"fx_rate" numeric,
	"fx_rate_locked_at" timestamp with time zone,
	"purchasing_email" text,
	"sent_email" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"section" text NOT NULL,
	"access" text DEFAULT 'none' NOT NULL,
	CONSTRAINT "pl_role_perms_access_chk" CHECK ("pl_role_permissions"."access" in ('none','read','write'))
);
--> statement-breakpoint
CREATE TABLE "pl_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"barcode" text,
	"color" text,
	"sort_order" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"barcode" text NOT NULL,
	"barcode_type" text,
	"item_id" uuid,
	"lot_id" uuid,
	"purpose" text DEFAULT 'unknown' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"processed_into_type" text,
	"processed_into_id" uuid,
	"is_processed" boolean DEFAULT false NOT NULL,
	"scanned_by" uuid,
	"device_id" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_spec_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"spec_id" uuid,
	"image_type" text DEFAULT 'other' NOT NULL,
	"storage_path" text NOT NULL,
	"public_url" text,
	"caption" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_spec_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"spec_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"customer_id" uuid,
	"document_type" text DEFAULT 'spec' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid,
	"recipient_name" text,
	"recipient_email" text,
	"version_label" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_stocktake_department_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_stocktake_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid,
	"batch_number_id" uuid,
	"requires_flags" text,
	"system_qty" numeric DEFAULT '0' NOT NULL,
	"counted_qty" numeric,
	"variance" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"reference" text,
	"week_type" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"uncounted_policy" text DEFAULT 'carry_over' NOT NULL,
	"notes" text,
	"counted_by" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_supplier_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"certification_type" text NOT NULL,
	"certificate_number" text,
	"issued_by" text,
	"issued_date" date,
	"expiry_date" date,
	"document_url" text,
	"document_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_supplier_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"mobile" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"receives_orders" boolean DEFAULT false NOT NULL,
	"receives_invoices" boolean DEFAULT false NOT NULL,
	"receives_claims" boolean DEFAULT false NOT NULL,
	"receives_cert_reminders" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"supplier_item_code" text,
	"supplier_item_name" text,
	"unit_price" numeric,
	"currency" text DEFAULT 'AUD',
	"price_valid_from" date,
	"price_valid_to" date,
	"purchase_uom" text,
	"purchase_uom_qty" numeric,
	"purchase_uom_type" text,
	"min_order_qty" numeric,
	"lead_time_days" integer,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"trading_name" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"website" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postcode" text,
	"country_code" text DEFAULT 'AU',
	"currency" text DEFAULT 'AUD' NOT NULL,
	"payment_terms" text,
	"account_number" text,
	"tax_registration" text,
	"purchase_account_code" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"operating_days" text[],
	"operating_open" time,
	"operating_close" time,
	"loading_dock_open" time,
	"loading_dock_close" time,
	"loading_dock_notes" text,
	"order_cutoff_time" time,
	"delivery_days" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_tax_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"rate_pct" numeric DEFAULT '0' NOT NULL,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"is_default_purchase" boolean DEFAULT false NOT NULL,
	"is_default_sales" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pl_tax_codes_applies_chk" CHECK ("pl_tax_codes"."applies_to" in ('purchase','sales','both'))
);
--> statement-breakpoint
CREATE TABLE "pl_tenant_allergen_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"active_standards" text[] DEFAULT '{FSANZ}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_tenant_barcode_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"barcode_value" text NOT NULL,
	"barcode_format" text DEFAULT 'ean13' NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"assigned_item_id" uuid,
	"assigned_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_tenant_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"label_key" text NOT NULL,
	"label_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_tenant_pack_level_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_label" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_traceability_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"production_order_id" uuid NOT NULL,
	"component_item_id" uuid NOT NULL,
	"lot_id" uuid,
	"weight_used" numeric NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_units_of_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pl_uom_category_chk" CHECK ("pl_units_of_measure"."category" in ('weight','count','volume','length','other'))
);
--> statement-breakpoint
CREATE TABLE "pl_user_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_user_department_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_user_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text,
	"user_id" uuid,
	"user_email" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pl_wastage_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"stage" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pl_wastage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"stage" text NOT NULL,
	"reason_code" text,
	"description" text,
	"weight_kg" numeric,
	"unit_count" integer,
	"unit" text DEFAULT 'kg',
	"production_order_id" uuid,
	"filling_order_id" uuid,
	"packing_order_id" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pl_bom_headers" ADD CONSTRAINT "pl_bom_headers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_bom_headers" ADD CONSTRAINT "pl_bom_headers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_customer_orders" ADD CONSTRAINT "pl_customer_orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_customer_orders" ADD CONSTRAINT "pl_customer_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_demand_plans" ADD CONSTRAINT "pl_demand_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_demand_plans" ADD CONSTRAINT "pl_demand_plans_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_dispatch_records" ADD CONSTRAINT "pl_dispatch_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_fx_rates" ADD CONSTRAINT "pl_fx_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_goods_in_receipts" ADD CONSTRAINT "pl_goods_in_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_inventory_transactions" ADD CONSTRAINT "pl_inventory_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_invoices" ADD CONSTRAINT "pl_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_item_images" ADD CONSTRAINT "pl_item_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_item_spec_documents" ADD CONSTRAINT "pl_item_spec_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_machine_breakdowns" ADD CONSTRAINT "pl_machine_breakdowns_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_machine_breakdowns" ADD CONSTRAINT "pl_machine_breakdowns_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_machine_documents" ADD CONSTRAINT "pl_machine_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_machine_maintenance_logs" ADD CONSTRAINT "pl_machine_maintenance_logs_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_mrp_overrides" ADD CONSTRAINT "pl_mrp_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_planning_user_settings" ADD CONSTRAINT "pl_planning_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_product_specs" ADD CONSTRAINT "pl_product_specs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_product_specs" ADD CONSTRAINT "pl_product_specs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_production_orders" ADD CONSTRAINT "pl_production_orders_batch_recipe_approved_by_users_id_fk" FOREIGN KEY ("batch_recipe_approved_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_production_orders" ADD CONSTRAINT "pl_production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_purchase_orders" ADD CONSTRAINT "pl_purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_scan_events" ADD CONSTRAINT "pl_scan_events_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_spec_sends" ADD CONSTRAINT "pl_spec_sends_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_stocktake_department_signoffs" ADD CONSTRAINT "pl_stocktake_department_signoffs_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_stocktakes" ADD CONSTRAINT "pl_stocktakes_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_user_department_access" ADD CONSTRAINT "pl_user_department_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_user_logins" ADD CONSTRAINT "pl_user_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pl_wastage_records" ADD CONSTRAINT "pl_wastage_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pl_allergen_defs_tenant_code_uq" ON "pl_allergen_definitions" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_bom_headers_item_version_uq" ON "pl_bom_headers" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "pl_bom_lines_header_idx" ON "pl_bom_lines" USING btree ("bom_header_id");--> statement-breakpoint
CREATE INDEX "pl_bom_lines_component_idx" ON "pl_bom_lines" USING btree ("component_item_id");--> statement-breakpoint
CREATE INDEX "pl_cooking_orders_filling_idx" ON "pl_cooking_orders" USING btree ("filling_order_id");--> statement-breakpoint
CREATE INDEX "pl_customer_contacts_customer_idx" ON "pl_customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "pl_customer_contacts_tenant_idx" ON "pl_customer_contacts" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_cust_item_overrides_uq" ON "pl_customer_item_overrides" USING btree ("customer_id","item_id");--> statement-breakpoint
CREATE INDEX "pl_customer_order_lines_order_idx" ON "pl_customer_order_lines" USING btree ("customer_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_customer_orders_tenant_num_uq" ON "pl_customer_orders" USING btree ("tracey_tenant_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_customers_tenant_code_uq" ON "pl_customers" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_demand_lines_plan_idx" ON "pl_demand_lines" USING btree ("demand_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_demand_plans_tenant_week_uq" ON "pl_demand_plans" USING btree ("tracey_tenant_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_departments_tenant_name_uq" ON "pl_departments" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE INDEX "pl_dispatch_tenant_date_item_idx" ON "pl_dispatch_records" USING btree ("tracey_tenant_id","dispatch_date","item_id");--> statement-breakpoint
CREATE INDEX "pl_filling_orders_po_idx" ON "pl_filling_orders" USING btree ("production_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_fx_rates_tenant_pair_date_uq" ON "pl_fx_rates" USING btree ("tracey_tenant_id","from_currency","to_currency","valid_on");--> statement-breakpoint
CREATE INDEX "pl_fx_rates_lookup_idx" ON "pl_fx_rates" USING btree ("tracey_tenant_id","from_currency","to_currency","valid_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pl_goods_in_lines_receipt_idx" ON "pl_goods_in_lines" USING btree ("goods_in_receipt_id");--> statement-breakpoint
CREATE INDEX "pl_goods_in_tenant_idx" ON "pl_goods_in_receipts" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_goods_in_supplier_idx" ON "pl_goods_in_receipts" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_ing_class_tenant_code_uq" ON "pl_ingredient_classifications" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_ing_class_tenant_idx" ON "pl_ingredient_classifications" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_inv_tx_tenant_item_created_idx" ON "pl_inventory_transactions" USING btree ("tracey_tenant_id","item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_invoices_tenant_num_uq" ON "pl_invoices" USING btree ("tracey_tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "pl_item_barcodes_item_idx" ON "pl_item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_item_barcodes_tenant_idx" ON "pl_item_barcodes" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_item_barcodes_supplier_idx" ON "pl_item_barcodes" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_item_categories_tenant_name_uq" ON "pl_item_categories" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE INDEX "pl_item_images_item_idx" ON "pl_item_images" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_iic_tenant_idx" ON "pl_item_ingredient_components" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_iic_item_idx" ON "pl_item_ingredient_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_iic_class_idx" ON "pl_item_ingredient_components" USING btree ("classification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_item_pallet_cfg_tenant_item_uq" ON "pl_item_pallet_config" USING btree ("tracey_tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "pl_item_pallet_cfg_item_idx" ON "pl_item_pallet_config" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_item_spec_docs_item_idx" ON "pl_item_spec_documents" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_item_spec_docs_tenant_idx" ON "pl_item_spec_documents" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_item_spec_docs_type_idx" ON "pl_item_spec_documents" USING btree ("item_id","document_type");--> statement-breakpoint
CREATE INDEX "pl_item_subcategories_category_idx" ON "pl_item_subcategories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_item_types_tenant_code_uq" ON "pl_item_types" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_item_types_tenant_idx" ON "pl_item_types" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_items_tenant_code_uq" ON "pl_items" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_items_tenant_type_active_idx" ON "pl_items" USING btree ("tracey_tenant_id","item_type","is_active");--> statement-breakpoint
CREATE INDEX "pl_items_tenant_active_idx" ON "pl_items" USING btree ("tracey_tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "pl_items_parent_idx" ON "pl_items" USING btree ("parent_item_id");--> statement-breakpoint
CREATE INDEX "pl_locations_tenant_idx" ON "pl_locations" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_locations_room_idx" ON "pl_locations" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "pl_locations_barcode_idx" ON "pl_locations" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_lot_numbers_tenant_item_code_uq" ON "pl_lot_numbers" USING btree ("tracey_tenant_id","item_id","lot_code");--> statement-breakpoint
CREATE INDEX "pl_machine_breakdowns_machine_idx" ON "pl_machine_breakdowns" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "pl_machine_docs_machine_idx" ON "pl_machine_documents" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "pl_machine_maint_machine_idx" ON "pl_machine_maintenance_logs" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "pl_machine_spare_parts_machine_idx" ON "pl_machine_spare_parts" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "pl_machines_tenant_idx" ON "pl_machines" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_machines_dept_idx" ON "pl_machines" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "pl_mrp_overrides_plan_idx" ON "pl_mrp_overrides" USING btree ("demand_plan_id");--> statement-breakpoint
CREATE INDEX "pl_mrp_results_plan_idx" ON "pl_mrp_results" USING btree ("demand_plan_id");--> statement-breakpoint
CREATE INDEX "pl_mrp_results_plan_item_idx" ON "pl_mrp_results" USING btree ("demand_plan_id","item_id");--> statement-breakpoint
CREATE INDEX "pl_order_line_lots_line_idx" ON "pl_order_line_lots" USING btree ("customer_order_line_id");--> statement-breakpoint
CREATE INDEX "pl_packing_orders_cooking_idx" ON "pl_packing_orders" USING btree ("cooking_order_id");--> statement-breakpoint
CREATE INDEX "pl_packing_orders_filling_idx" ON "pl_packing_orders" USING btree ("filling_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_pallet_tmpl_tenant_name_uq" ON "pl_pallet_config_templates" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE INDEX "pl_pallet_tmpl_tenant_idx" ON "pl_pallet_config_templates" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_planning_user_settings_tenant_idx" ON "pl_planning_user_settings" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_price_group_lines_pg_item_uq" ON "pl_price_group_lines" USING btree ("price_group_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_price_groups_tenant_name_uq" ON "pl_price_groups" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_product_specs_tenant_item_ver_uq" ON "pl_product_specs" USING btree ("tracey_tenant_id","item_id","version");--> statement-breakpoint
CREATE INDEX "pl_product_specs_item_idx" ON "pl_product_specs" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_product_specs_tenant_status_idx" ON "pl_product_specs" USING btree ("tracey_tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_production_orders_tenant_batch_uq" ON "pl_production_orders" USING btree ("tracey_tenant_id","batch_number");--> statement-breakpoint
CREATE INDEX "pl_production_orders_plan_idx" ON "pl_production_orders" USING btree ("demand_plan_id");--> statement-breakpoint
CREATE INDEX "pl_prod_sub_ops_po_idx" ON "pl_production_sub_operations" USING btree ("production_order_id");--> statement-breakpoint
CREATE INDEX "pl_po_lines_po_idx" ON "pl_purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "pl_po_lines_item_idx" ON "pl_purchase_order_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_po_tenant_idx" ON "pl_purchase_orders" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_po_supplier_idx" ON "pl_purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_role_perms_role_section_uq" ON "pl_role_permissions" USING btree ("role_id","section");--> statement-breakpoint
CREATE INDEX "pl_role_perms_role_idx" ON "pl_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_roles_tenant_name_uq" ON "pl_roles" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE INDEX "pl_roles_tenant_idx" ON "pl_roles" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_rooms_tenant_idx" ON "pl_rooms" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_rooms_dept_idx" ON "pl_rooms" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "pl_scan_events_tenant_barcode_idx" ON "pl_scan_events" USING btree ("tracey_tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "pl_spec_images_item_idx" ON "pl_spec_images" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_spec_images_spec_idx" ON "pl_spec_images" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "pl_spec_sends_spec_idx" ON "pl_spec_sends" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "pl_spec_sends_item_idx" ON "pl_spec_sends" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_spec_sends_tenant_idx" ON "pl_spec_sends" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_st_signoff_st_dept_uq" ON "pl_stocktake_department_signoffs" USING btree ("stocktake_id","department_id");--> statement-breakpoint
CREATE INDEX "pl_st_signoff_st_idx" ON "pl_stocktake_department_signoffs" USING btree ("stocktake_id");--> statement-breakpoint
CREATE INDEX "pl_st_signoff_dept_idx" ON "pl_stocktake_department_signoffs" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "pl_stocktake_lines_st_idx" ON "pl_stocktake_lines" USING btree ("stocktake_id");--> statement-breakpoint
CREATE INDEX "pl_stocktake_lines_item_idx" ON "pl_stocktake_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pl_stocktakes_tenant_idx" ON "pl_stocktakes" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_supplier_certs_supplier_idx" ON "pl_supplier_certifications" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "pl_supplier_contacts_supplier_idx" ON "pl_supplier_contacts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "pl_supplier_contacts_tenant_idx" ON "pl_supplier_contacts" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_supplier_items_supplier_item_uq" ON "pl_supplier_items" USING btree ("supplier_id","item_id");--> statement-breakpoint
CREATE INDEX "pl_suppliers_tenant_idx" ON "pl_suppliers" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_tax_codes_tenant_name_uq" ON "pl_tax_codes" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_tenant_allergen_settings_tenant_uq" ON "pl_tenant_allergen_settings" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_barcode_pool_tenant_val_uq" ON "pl_tenant_barcode_pool" USING btree ("tracey_tenant_id","barcode_value");--> statement-breakpoint
CREATE INDEX "pl_barcode_pool_tenant_idx" ON "pl_tenant_barcode_pool" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_barcode_pool_status_idx" ON "pl_tenant_barcode_pool" USING btree ("tracey_tenant_id","status");--> statement-breakpoint
CREATE INDEX "pl_barcode_pool_item_idx" ON "pl_tenant_barcode_pool" USING btree ("assigned_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_tenant_labels_tenant_key_uq" ON "pl_tenant_labels" USING btree ("tracey_tenant_id","label_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_tplds_tenant_code_uq" ON "pl_tenant_pack_level_defs" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_tplds_tenant_active_idx" ON "pl_tenant_pack_level_defs" USING btree ("tracey_tenant_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "pl_traceability_po_idx" ON "pl_traceability_links" USING btree ("production_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_uom_tenant_code_lower_uq" ON "pl_units_of_measure" USING btree ("tracey_tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "pl_uom_tenant_active_idx" ON "pl_units_of_measure" USING btree ("tracey_tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_user_categories_tenant_name_uq" ON "pl_user_categories" USING btree ("tracey_tenant_id","name");--> statement-breakpoint
CREATE INDEX "pl_user_categories_tenant_idx" ON "pl_user_categories" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pl_uda_user_dept_uq" ON "pl_user_department_access" USING btree ("user_id","department_id");--> statement-breakpoint
CREATE INDEX "pl_uda_user_idx" ON "pl_user_department_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pl_uda_dept_idx" ON "pl_user_department_access" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "pl_uda_tenant_idx" ON "pl_user_department_access" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "pl_user_logins_user_idx" ON "pl_user_logins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pl_user_logins_created_idx" ON "pl_user_logins" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pl_wastage_reasons_tenant_code_uq" ON "pl_wastage_reasons" USING btree ("tracey_tenant_id","code");--> statement-breakpoint
CREATE INDEX "pl_wastage_tenant_item_stage_idx" ON "pl_wastage_records" USING btree ("tracey_tenant_id","item_id","stage");