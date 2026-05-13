// Planning tables — MRP / BOM / costings / production / orders / specs.
// Sourced from the Supabase-era planning-web app (Tino's repo, 135+ SQL
// migrations under apps/planning-web/supabase/migrations/) and consolidated
// into one Drizzle schema for the Tracey monorepo.
//
// Multi-tenant strategy: PER-TENANT POSTGRES SCHEMA (matches the LMS Phase 7
// and shiftcraft patterns in per-tenant-schema.ts / shiftcraft-schema.ts).
// The Drizzle table definitions below are declared as unqualified
// `pgTable("pl_*", ...)`. Two physical locations exist for each table:
//
//   1. `public.pl_*` — the source/template tables. Created by Drizzle.
//      App code never queries these in tenant-scoped paths; they exist so
//      Drizzle has a stable home and so per-tenant provisioning can use
//      `CREATE TABLE … LIKE INCLUDING ALL` to make the per-tenant copies.
//
//   2. `tenant_<uuid>.pl_*` — the per-tenant copies. Created by the SQL
//      migration `packages/db/migrations/per-tenant/0012_planning_baseline.sql`
//      (Slice 2). `pnpm db:migrate-planning` applies it inside each tenant's
//      schema with `SET LOCAL search_path = "tenant_<uuid>", public`.
//
// App-code queries route through `ctx.db.run(...)` (= `forTenant(tid).run(...)`)
// which sets `search_path` so unqualified `pl_*` references resolve to the
// per-tenant copy.
//
// `tracey_tenant_id` column is kept on every per-tenant table for
// defence-in-depth filtering. The DEFAULT is set per-tenant inside the
// baseline SQL so Drizzle INSERTs don't need to specify it explicitly.
//
// FK strategy:
//   - Within-planning FKs (e.g. pl_bom_lines.bom_header_id → pl_bom_headers.id)
//     are NOT declared via Drizzle .references(). The baseline SQL recreates
//     them inside each tenant schema (otherwise the FK in public.pl_* would
//     point at public.pl_* siblings instead of the tenant-schema siblings).
//   - FKs to app.users(id) ARE declared via Drizzle .references(() => users.id)
//     because app.users lives in `app` schema (shared across tenants) and
//     Drizzle's schema-qualified emission resolves it correctly from any
//     tenant schema's search_path.
//
// What's deliberately NOT in this file:
//   - CHECK constraints with complex predicates (status enums, range checks)
//     — emitted in the baseline SQL instead. Drizzle's `check()` helper is
//     fine for trivial cases but the baseline SQL is the source-of-truth.
//   - Partial unique indexes (e.g. WHERE is_primary = true) — baseline SQL.
//   - Generated columns (variance, units_per_pallet) — declared here as
//     plain columns; baseline SQL adds the GENERATED ALWAYS AS … STORED.
//   - Triggers (updated_at, autogen barcodes, primary-flag enforcement) —
//     baseline SQL.
//   - RLS policies — baseline SQL emits inert tenant_isolation per the
//     shiftcraft pattern.
//
// Supabase tables intentionally dropped (replaced by Tracey app.* schema):
//   - tenants       → app.tenants
//   - profiles      → app.users + app.members; planning-only fields move
//                     to pl_planning_user_settings below
//   - audit_log     → app.audit_events
//   - user_invites  → app.invitations

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

export const plDepartments = pgTable(
  "pl_departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_departments_tenant_name_uq").on(t.traceyTenantId, t.name)],
);

export const plAllergenDefinitions = pgTable(
  "pl_allergen_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    regulatoryStandard: text("regulatory_standard").notNull().default("FSANZ"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_allergen_defs_tenant_code_uq").on(t.traceyTenantId, t.code),
    check(
      "pl_allergen_defs_std_chk",
      sql`${t.regulatoryStandard} in ('FSANZ','EU','FDA','CUSTOM')`,
    ),
  ],
);

export const plTenantAllergenSettings = pgTable(
  "pl_tenant_allergen_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    activeStandards: text("active_standards").array().notNull().default(sql`'{FSANZ}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_tenant_allergen_settings_tenant_uq").on(t.traceyTenantId)],
);

export const plUserCategories = pgTable(
  "pl_user_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_user_categories_tenant_name_uq").on(t.traceyTenantId, t.name),
    index("pl_user_categories_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plUserDepartmentAccess = pgTable(
  "pl_user_department_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_uda_user_dept_uq").on(t.userId, t.departmentId),
    index("pl_uda_user_idx").on(t.userId),
    index("pl_uda_dept_idx").on(t.departmentId),
    index("pl_uda_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plTaxCodes = pgTable(
  "pl_tax_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    ratePct: numeric("rate_pct").notNull().default("0"),
    appliesTo: text("applies_to").notNull().default("both"),
    isDefaultPurchase: boolean("is_default_purchase").notNull().default(false),
    isDefaultSales: boolean("is_default_sales").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_tax_codes_tenant_name_uq").on(t.traceyTenantId, t.name),
    check("pl_tax_codes_applies_chk", sql`${t.appliesTo} in ('purchase','sales','both')`),
  ],
);

export const plUnitsOfMeasure = pgTable(
  "pl_units_of_measure",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("other"),
    isBase: boolean("is_base").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_uom_tenant_code_lower_uq").on(t.traceyTenantId, sql`lower(${t.code})`),
    index("pl_uom_tenant_active_idx").on(t.traceyTenantId, t.isActive),
    check(
      "pl_uom_category_chk",
      sql`${t.category} in ('weight','count','volume','length','other')`,
    ),
  ],
);

export const plTenantPackLevelDefs = pgTable(
  "pl_tenant_pack_level_defs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    shortLabel: text("short_label"),
    sortOrder: integer("sort_order").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_tplds_tenant_code_uq").on(t.traceyTenantId, t.code),
    index("pl_tplds_tenant_active_idx").on(t.traceyTenantId, t.isActive, t.sortOrder),
  ],
);

export const plRoles = pgTable(
  "pl_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_roles_tenant_name_uq").on(t.traceyTenantId, t.name),
    index("pl_roles_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plRolePermissions = pgTable(
  "pl_role_permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id").notNull(),
    section: text("section").notNull(),
    access: text("access").notNull().default("none"),
  },
  (t) => [
    uniqueIndex("pl_role_perms_role_section_uq").on(t.roleId, t.section),
    index("pl_role_perms_role_idx").on(t.roleId),
    check("pl_role_perms_access_chk", sql`${t.access} in ('none','read','write')`),
  ],
);

export const plUserLogins = pgTable(
  "pl_user_logins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    userEmail: text("user_email"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("pl_user_logins_user_idx").on(t.userId),
    index("pl_user_logins_created_idx").on(t.createdAt.desc()),
  ],
);

export const plCurrencies = pgTable(
  "pl_currencies",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    decimalPlaces: integer("decimal_places").notNull().default(2),
  },
);

export const plIngredientClassifications = pgTable(
  "pl_ingredient_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    defaultAustralian: boolean("default_australian").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_ing_class_tenant_code_uq").on(t.traceyTenantId, t.code),
    index("pl_ing_class_tenant_idx").on(t.traceyTenantId),
  ],
);

// NEW table (no Supabase equivalent) — holds the planning-specific user
// fields that lived on Supabase profiles but don't fit in app.users / app.members.
export const plPlanningUserSettings = pgTable(
  "pl_planning_user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    language: text("language").notNull().default("en"),
    planningRoleId: uuid("planning_role_id"),
    homeDepartmentId: uuid("home_department_id"),
    forcePasswordChange: boolean("force_password_change").notNull().default(false),
    allDepartments: boolean("all_departments").notNull().default(true),
    fullName: text("full_name"),
    avatarUrl: text("avatar_url"),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_planning_user_settings_tenant_idx").on(t.traceyTenantId)],
);

// ═══════════════════════════════════════════════════════════════════════════
// ITEMS, CATEGORIES, ALLERGENS, IMAGES, INGREDIENTS
// ═══════════════════════════════════════════════════════════════════════════

export const plItemCategories = pgTable(
  "pl_item_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_item_categories_tenant_name_uq").on(t.traceyTenantId, t.name)],
);

export const plItemSubcategories = pgTable(
  "pl_item_subcategories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    categoryId: uuid("category_id"),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("pl_item_subcategories_category_idx").on(t.categoryId)],
);

export const plItemTypes = pgTable(
  "pl_item_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#6B7280"),
    isPurchasable: boolean("is_purchasable").notNull().default(false),
    canHaveBom: boolean("can_have_bom").notNull().default(false),
    isSellable: boolean("is_sellable").notNull().default(false),
    isProducible: boolean("is_producible").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_item_types_tenant_code_uq").on(t.traceyTenantId, t.code),
    index("pl_item_types_tenant_idx").on(t.traceyTenantId),
  ],
);

// The big one — ~80 columns aggregated across many migrations.
export const plItems = pgTable(
  "pl_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    itemType: text("item_type").notNull().default("raw_material"),
    parentItemId: uuid("parent_item_id"),
    itemSubcategoryId: uuid("item_subcategory_id"),
    productionMethod: text("production_method"),
    department: text("department"),
    machine: text("machine"),
    room: text("room"),
    priority: numeric("priority").default("5"),
    unit: text("unit").notNull().default("kg"),
    defaultBatchSize: numeric("default_batch_size"),
    batchUnit: text("batch_unit").default("kg"),
    weightMode: text("weight_mode").default("random"),
    targetWeightG: numeric("target_weight_g"),
    targetWeightPerPieceG: numeric("target_weight_per_piece_g"),
    targetWeightPerInnerG: numeric("target_weight_per_inner_g"),
    tareWeightG: numeric("tare_weight_g"),
    toleranceOverG: numeric("tolerance_over_g"),
    toleranceUnderG: numeric("tolerance_under_g"),
    unitsPerInner: integer("units_per_inner"),
    unitsPerOuter: integer("units_per_outer"),
    innerPerOuter: integer("inner_per_outer"),
    unitsPerPallet: integer("units_per_pallet"),
    outersPerPallet: integer("outers_per_pallet"),
    fillWeightG: numeric("fill_weight_g"),
    processLossPct: numeric("process_loss_pct"),
    giveawayPct: numeric("giveaway_pct"),
    consumedInWeight: numeric("consumed_in_weight"),
    consumedInBasis: text("consumed_in_basis"),
    allergens: text("allergens").array().default(sql`'{}'::text[]`),
    currentStock: numeric("current_stock").notNull().default("0"),
    minStock: numeric("min_stock").notNull().default("0"),
    maxStock: numeric("max_stock").notNull().default("0"),
    isMakeToOrder: boolean("is_make_to_order").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order"),
    itemNumber: text("item_number"),
    specStorageTemp: text("spec_storage_temp"),
    specShelfLife: text("spec_shelf_life"),
    specNotes: text("spec_notes"),
    specOrigin: text("spec_origin"),
    specFatContent: text("spec_fat_content"),
    specProtein: text("spec_protein"),
    specMoisture: text("spec_moisture"),
    specPh: text("spec_ph"),
    specWaterActivity: text("spec_water_activity"),
    specMicro: text("spec_micro"),
    specWeightPerUnit: text("spec_weight_per_unit"),
    specPackaging: text("spec_packaging"),
    specLabelling: text("spec_labelling"),
    supplier: text("supplier"),
    supplierCode: text("supplier_code"),
    purchaseTaxCodeId: uuid("purchase_tax_code_id"),
    salesTaxCodeId: uuid("sales_tax_code_id"),
    purchaseAccountCode: text("purchase_account_code"),
    salesAccountCode: text("sales_account_code"),
    purchaseUom: text("purchase_uom"),
    purchaseUomQty: numeric("purchase_uom_qty"),
    purchaseUomType: text("purchase_uom_type"),
    purchaseUnitPrice: numeric("purchase_unit_price"),
    purchaseCurrency: text("purchase_currency").default("AUD"),
    procurementType: text("procurement_type"),
    nutEnergyKj: numeric("nut_energy_kj"),
    nutEnergyKcal: numeric("nut_energy_kcal"),
    nutProteinG: numeric("nut_protein_g"),
    nutFatTotalG: numeric("nut_fat_total_g"),
    nutFatSaturatedG: numeric("nut_fat_saturated_g"),
    nutFatTransG: numeric("nut_fat_trans_g"),
    nutCarbsTotalG: numeric("nut_carbs_total_g"),
    nutCarbsSugarsG: numeric("nut_carbs_sugars_g"),
    nutFibreG: numeric("nut_fibre_g"),
    nutSodiumMg: numeric("nut_sodium_mg"),
    nutPerServingG: numeric("nut_per_serving_g"),
    nutNotes: text("nut_notes"),
    preferredSupplierId: uuid("preferred_supplier_id"),
    standardCost: numeric("standard_cost"),
    nipLargeItem: boolean("nip_large_item"),
    defaultLocationId: uuid("default_location_id"),
    ingredientClassificationId: uuid("ingredient_classification_id"),
    packLevels: jsonb("pack_levels"),
    sellPricingPolicy: text("sell_pricing_policy"),
    orderUom: text("order_uom"),
    invoicePrefix: text("invoice_prefix"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_items_tenant_code_uq").on(t.traceyTenantId, t.code),
    index("pl_items_tenant_type_active_idx").on(t.traceyTenantId, t.itemType, t.isActive),
    index("pl_items_tenant_active_idx").on(t.traceyTenantId, t.isActive),
    index("pl_items_parent_idx").on(t.parentItemId),
  ],
);

export const plItemImages = pgTable(
  "pl_item_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    sizeBytes: integer("size_bytes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_item_images_item_idx").on(t.itemId)],
);

export const plItemBarcodes = pgTable(
  "pl_item_barcodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    barcodeType: text("barcode_type").notNull().default("internal"),
    barcodeFormat: text("barcode_format").notNull().default("code128"),
    barcodeValue: text("barcode_value").notNull(),
    supplierId: uuid("supplier_id"),
    poolId: uuid("pool_id"),
    description: text("description"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_item_barcodes_item_idx").on(t.itemId),
    index("pl_item_barcodes_tenant_idx").on(t.traceyTenantId),
    index("pl_item_barcodes_supplier_idx").on(t.supplierId),
  ],
);

export const plTenantBarcodePool = pgTable(
  "pl_tenant_barcode_pool",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    barcodeValue: text("barcode_value").notNull(),
    barcodeFormat: text("barcode_format").notNull().default("ean13"),
    status: text("status").notNull().default("available"),
    assignedItemId: uuid("assigned_item_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_barcode_pool_tenant_val_uq").on(t.traceyTenantId, t.barcodeValue),
    index("pl_barcode_pool_tenant_idx").on(t.traceyTenantId),
    index("pl_barcode_pool_status_idx").on(t.traceyTenantId, t.status),
    index("pl_barcode_pool_item_idx").on(t.assignedItemId),
  ],
);

export const plItemSpecDocuments = pgTable(
  "pl_item_spec_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    documentType: text("document_type").notNull().default("spec_sheet"),
    title: text("title").notNull(),
    version: text("version"),
    effectiveDate: date("effective_date"),
    expiryDate: date("expiry_date"),
    supplierId: uuid("supplier_id"),
    documentUrl: text("document_url").notNull(),
    documentName: text("document_name").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    mimeType: text("mime_type"),
    extractedData: jsonb("extracted_data"),
    extractionStatus: text("extraction_status").default("pending"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_item_spec_docs_item_idx").on(t.itemId),
    index("pl_item_spec_docs_tenant_idx").on(t.traceyTenantId),
    index("pl_item_spec_docs_type_idx").on(t.itemId, t.documentType),
  ],
);

export const plItemIngredientComponents = pgTable(
  "pl_item_ingredient_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    name: text("name").notNull(),
    classificationId: uuid("classification_id"),
    eNumber: text("e_number"),
    percentage: numeric("percentage"),
    meatSpecies: text("meat_species"),
    countryOfOrigin: text("country_of_origin"),
    isProcessingAid: boolean("is_processing_aid").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_iic_tenant_idx").on(t.traceyTenantId),
    index("pl_iic_item_idx").on(t.itemId),
    index("pl_iic_class_idx").on(t.classificationId),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// BOM (recipes)
// ═══════════════════════════════════════════════════════════════════════════

export const plBomHeaders = pgTable(
  "pl_bom_headers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull().default(1),
    referenceBatchSize: numeric("reference_batch_size").notNull(),
    referenceBatchUnit: text("reference_batch_unit").notNull().default("kg"),
    yieldFactor: numeric("yield_factor").notNull().default("1.0"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_bom_headers_item_version_uq").on(t.itemId, t.version)],
);

export const plBomLines = pgTable(
  "pl_bom_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    bomHeaderId: uuid("bom_header_id").notNull(),
    componentItemId: uuid("component_item_id").notNull(),
    qtyPerBatch: numeric("qty_per_batch").notNull(),
    unit: text("unit").notNull(),
    percentage: numeric("percentage"),
    grindSize: text("grind_size"),
    comment: text("comment"),
    sortOrder: integer("sort_order").notNull().default(0),
    consumePerQty: numeric("consume_per_qty"),
    basis: text("basis"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_bom_lines_header_idx").on(t.bomHeaderId),
    index("pl_bom_lines_component_idx").on(t.componentItemId),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIERS, SUPPLIER ITEMS, PURCHASING, FX
// ═══════════════════════════════════════════════════════════════════════════

export const plSuppliers = pgTable(
  "pl_suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code"),
    name: text("name").notNull(),
    tradingName: text("trading_name"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postcode: text("postcode"),
    countryCode: text("country_code").default("AU"),
    currency: text("currency").notNull().default("AUD"),
    paymentTerms: text("payment_terms"),
    accountNumber: text("account_number"),
    taxRegistration: text("tax_registration"),
    purchaseAccountCode: text("purchase_account_code"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    operatingDays: text("operating_days").array(),
    operatingOpen: time("operating_open"),
    operatingClose: time("operating_close"),
    loadingDockOpen: time("loading_dock_open"),
    loadingDockClose: time("loading_dock_close"),
    loadingDockNotes: text("loading_dock_notes"),
    orderCutoffTime: time("order_cutoff_time"),
    deliveryDays: text("delivery_days").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_suppliers_tenant_idx").on(t.traceyTenantId)],
);

export const plSupplierItems = pgTable(
  "pl_supplier_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    itemId: uuid("item_id").notNull(),
    supplierItemCode: text("supplier_item_code"),
    supplierItemName: text("supplier_item_name"),
    unitPrice: numeric("unit_price"),
    currency: text("currency").default("AUD"),
    priceValidFrom: date("price_valid_from"),
    priceValidTo: date("price_valid_to"),
    purchaseUom: text("purchase_uom"),
    purchaseUomQty: numeric("purchase_uom_qty"),
    purchaseUomType: text("purchase_uom_type"),
    minOrderQty: numeric("min_order_qty"),
    leadTimeDays: integer("lead_time_days"),
    isPreferred: boolean("is_preferred").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_supplier_items_supplier_item_uq").on(t.supplierId, t.itemId)],
);

export const plSupplierContacts = pgTable(
  "pl_supplier_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    phone: text("phone"),
    mobile: text("mobile"),
    email: text("email"),
    isPrimary: boolean("is_primary").notNull().default(false),
    receivesOrders: boolean("receives_orders").notNull().default(false),
    receivesInvoices: boolean("receives_invoices").notNull().default(false),
    receivesClaims: boolean("receives_claims").notNull().default(false),
    receivesCertReminders: boolean("receives_cert_reminders").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_supplier_contacts_supplier_idx").on(t.supplierId),
    index("pl_supplier_contacts_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plSupplierCertifications = pgTable(
  "pl_supplier_certifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    certificationType: text("certification_type").notNull(),
    certificateNumber: text("certificate_number"),
    issuedBy: text("issued_by"),
    issuedDate: date("issued_date"),
    expiryDate: date("expiry_date"),
    documentUrl: text("document_url"),
    documentName: text("document_name"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_supplier_certs_supplier_idx").on(t.supplierId)],
);

export const plPurchaseOrders = pgTable(
  "pl_purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    poNumber: text("po_number"),
    supplierId: uuid("supplier_id"),
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date").notNull().default(sql`current_date`),
    expectedDate: date("expected_date"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    fxRateCurrency: text("fx_rate_currency"),
    fxRate: numeric("fx_rate"),
    fxRateLockedAt: timestamp("fx_rate_locked_at", { withTimezone: true }),
    purchasingEmail: text("purchasing_email"),
    sentEmail: text("sent_email"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_po_tenant_idx").on(t.traceyTenantId),
    index("pl_po_supplier_idx").on(t.supplierId),
  ],
);

export const plPurchaseOrderLines = pgTable(
  "pl_purchase_order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    itemId: uuid("item_id").notNull(),
    supplierItemId: uuid("supplier_item_id"),
    qtyOrdered: numeric("qty_ordered").notNull().default("0"),
    unit: text("unit"),
    unitPrice: numeric("unit_price"),
    currency: text("currency").default("AUD"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_po_lines_po_idx").on(t.purchaseOrderId),
    index("pl_po_lines_item_idx").on(t.itemId),
  ],
);

export const plFxRates = pgTable(
  "pl_fx_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    fromCurrency: text("from_currency").notNull(),
    toCurrency: text("to_currency").notNull(),
    rate: numeric("rate").notNull(),
    validOn: date("valid_on").notNull(),
    source: text("source"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_fx_rates_tenant_pair_date_uq").on(
      t.traceyTenantId,
      t.fromCurrency,
      t.toCurrency,
      t.validOn,
    ),
    index("pl_fx_rates_lookup_idx").on(
      t.traceyTenantId,
      t.fromCurrency,
      t.toCurrency,
      t.validOn.desc(),
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMERS, PRICING, ORDERS, INVOICES
// ═══════════════════════════════════════════════════════════════════════════

export const plCustomers = pgTable(
  "pl_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    tradingName: text("trading_name"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postcode: text("postcode"),
    countryCode: text("country_code").default("AU"),
    currency: text("currency").default("AUD"),
    priceGroupId: uuid("price_group_id"),
    paymentTerms: text("payment_terms"),
    accountNumber: text("account_number"),
    taxRegistration: text("tax_registration"),
    salesAccountCode: text("sales_account_code"),
    minShelfLifeDays: integer("min_shelf_life_days"),
    deliveryDay: smallint("delivery_day"),
    deliveryInstructions: text("delivery_instructions"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    receivingDays: text("receiving_days").array(),
    receivingOpen: time("receiving_open"),
    receivingClose: time("receiving_close"),
    loadingDockNotes: text("loading_dock_notes"),
    billingAddressLine1: text("billing_address_line1"),
    billingAddressLine2: text("billing_address_line2"),
    billingCity: text("billing_city"),
    billingState: text("billing_state"),
    billingPostcode: text("billing_postcode"),
    billingCountryCode: text("billing_country_code").default("AU"),
    abn: text("abn"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_customers_tenant_code_uq").on(t.traceyTenantId, t.code)],
);

export const plCustomerItemOverrides = pgTable(
  "pl_customer_item_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    itemId: uuid("item_id").notNull(),
    minShelfLifeDays: integer("min_shelf_life_days"),
    unitPrice: numeric("unit_price"),
    currency: text("currency").default("AUD"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_cust_item_overrides_uq").on(t.customerId, t.itemId)],
);

export const plPriceGroups = pgTable(
  "pl_price_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    isStandard: boolean("is_standard"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_price_groups_tenant_name_uq").on(t.traceyTenantId, t.name)],
);

export const plPriceGroupLines = pgTable(
  "pl_price_group_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    priceGroupId: uuid("price_group_id").notNull(),
    itemId: uuid("item_id").notNull(),
    unitPrice: numeric("unit_price"),
    discountPct: numeric("discount_pct"),
    currency: text("currency").default("AUD"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_price_group_lines_pg_item_uq").on(t.priceGroupId, t.itemId)],
);

export const plCustomerContacts = pgTable(
  "pl_customer_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    phone: text("phone"),
    mobile: text("mobile"),
    email: text("email"),
    isPrimary: boolean("is_primary").notNull().default(false),
    receivesOrders: boolean("receives_orders").notNull().default(false),
    receivesInvoices: boolean("receives_invoices").notNull().default(false),
    receivesClaims: boolean("receives_claims").notNull().default(false),
    receivesDeliveryNotices: boolean("receives_delivery_notices").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_customer_contacts_customer_idx").on(t.customerId),
    index("pl_customer_contacts_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plCustomerOrders = pgTable(
  "pl_customer_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    orderNumber: text("order_number").notNull(),
    customerPoNumber: text("customer_po_number"),
    channel: text("channel").notNull().default("manual"),
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date").notNull().default(sql`current_date`),
    requiredDate: date("required_date"),
    deliveryDate: date("delivery_date"),
    currency: text("currency").notNull().default("AUD"),
    notes: text("notes"),
    deliveryAddress: text("delivery_address"),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_customer_orders_tenant_num_uq").on(t.traceyTenantId, t.orderNumber)],
);

export const plCustomerOrderLines = pgTable(
  "pl_customer_order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerOrderId: uuid("customer_order_id").notNull(),
    itemId: uuid("item_id").notNull(),
    lineNumber: integer("line_number").notNull().default(1),
    qtyUnits: integer("qty_units"),
    qtyKg: numeric("qty_kg"),
    unitPrice: numeric("unit_price"),
    lineTotal: numeric("line_total"),
    currency: text("currency").default("AUD"),
    salesTaxCodeId: uuid("sales_tax_code_id"),
    taxAmount: numeric("tax_amount"),
    dispatchedUnits: integer("dispatched_units"),
    dispatchedKg: numeric("dispatched_kg"),
    lotNumber: text("lot_number"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_customer_order_lines_order_idx").on(t.customerOrderId)],
);

export const plOrderLineLots = pgTable(
  "pl_order_line_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerOrderLineId: uuid("customer_order_line_id").notNull(),
    lotId: uuid("lot_id"),
    lotCode: text("lot_code"),
    qtyKg: numeric("qty_kg"),
    qtyUnits: integer("qty_units"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_order_line_lots_line_idx").on(t.customerOrderLineId)],
);

export const plInvoices = pgTable(
  "pl_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    customerOrderId: uuid("customer_order_id"),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date").notNull().default(sql`current_date`),
    dueDate: date("due_date"),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("AUD"),
    subtotal: numeric("subtotal"),
    taxTotal: numeric("tax_total"),
    total: numeric("total"),
    notes: text("notes"),
    externalRef: text("external_ref"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    customTemplate: text("custom_template"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_invoices_tenant_num_uq").on(t.traceyTenantId, t.invoiceNumber)],
);

// ═══════════════════════════════════════════════════════════════════════════
// PLANS, MRP, PRODUCTION, FILLING, COOKING, PACKING, MACHINES
// ═══════════════════════════════════════════════════════════════════════════

export const plDemandPlans = pgTable(
  "pl_demand_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    weekStart: date("week_start").notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_demand_plans_tenant_week_uq").on(t.traceyTenantId, t.weekStart)],
);

export const plDemandLines = pgTable(
  "pl_demand_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    demandPlanId: uuid("demand_plan_id").notNull(),
    itemId: uuid("item_id").notNull(),
    demandType: text("demand_type").notNull().default("replenishment"),
    plannedQtyKg: numeric("planned_qty_kg"),
    plannedUnits: integer("planned_units"),
    plannedWeightKg: numeric("planned_weight_kg"),
    customerRef: text("customer_ref"),
    customerName: text("customer_name"),
    requiredDate: date("required_date"),
    dayOfWeek: smallint("day_of_week"),
    priority: integer("priority").default(5),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_demand_lines_plan_idx").on(t.demandPlanId)],
);

export const plMrpResults = pgTable(
  "pl_mrp_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    demandPlanId: uuid("demand_plan_id").notNull(),
    itemId: uuid("item_id").notNull(),
    department: text("department").notNull(),
    bomId: uuid("bom_id"),
    requiredQty: numeric("required_qty").notNull(),
    unit: text("unit").notNull().default("kg"),
    standardBatchSize: numeric("standard_batch_size"),
    suggestedBatches: numeric("suggested_batches"),
    roundedBatches: integer("rounded_batches"),
    plannedQty: numeric("planned_qty"),
    surplusQty: numeric("surplus_qty"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_mrp_results_plan_idx").on(t.demandPlanId),
    index("pl_mrp_results_plan_item_idx").on(t.demandPlanId, t.itemId),
  ],
);

export const plMrpOverrides = pgTable(
  "pl_mrp_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    demandPlanId: uuid("demand_plan_id"),
    itemId: uuid("item_id").notNull(),
    department: text("department"),
    overrideQty: numeric("override_qty"),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_mrp_overrides_plan_idx").on(t.demandPlanId)],
);

export const plProductionOrders = pgTable(
  "pl_production_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    demandPlanId: uuid("demand_plan_id"),
    itemId: uuid("item_id").notNull(),
    department: text("department").notNull().default("production"),
    batchNumber: text("batch_number").notNull(),
    productionDate: date("production_date"),
    dayOfWeek: smallint("day_of_week"),
    batchSize: numeric("batch_size").notNull(),
    nOfBatches: integer("n_of_batches").notNull(),
    plannedQty: numeric("planned_qty").notNull(),
    actualQty: numeric("actual_qty"),
    unit: text("unit").notNull().default("kg"),
    machine: text("machine"),
    machineId: uuid("machine_id"),
    runSequence: integer("run_sequence"),
    machineNotes: text("machine_notes"),
    room: text("room"),
    priority: numeric("priority").default("5"),
    bomId: uuid("bom_id"),
    batchRecipeGenerated: boolean("batch_recipe_generated").notNull().default(false),
    batchRecipeApproved: boolean("batch_recipe_approved").notNull().default(false),
    batchRecipeApprovedBy: uuid("batch_recipe_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    batchRecipeApprovedAt: timestamp("batch_recipe_approved_at", { withTimezone: true }),
    rawWeightKg: numeric("raw_weight_kg"),
    injectionTargetPct: numeric("injection_target_pct"),
    actualPctInjected: numeric("actual_pct_injected"),
    tumbleHours: numeric("tumble_hours"),
    pickleBomId: uuid("pickle_bom_id"),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_production_orders_tenant_batch_uq").on(t.traceyTenantId, t.batchNumber),
    index("pl_production_orders_plan_idx").on(t.demandPlanId),
  ],
);

export const plProductionSubOperations = pgTable(
  "pl_production_sub_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    productionOrderId: uuid("production_order_id").notNull(),
    name: text("name").notNull(),
    sequence: integer("sequence").notNull().default(1),
    machine: text("machine"),
    operatorName: text("operator_name"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    plannedQty: numeric("planned_qty"),
    actualQty: numeric("actual_qty"),
    unit: text("unit").default("kg"),
    notes: text("notes"),
    status: text("status").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_prod_sub_ops_po_idx").on(t.productionOrderId)],
);

export const plTraceabilityLinks = pgTable(
  "pl_traceability_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    productionOrderId: uuid("production_order_id").notNull(),
    componentItemId: uuid("component_item_id").notNull(),
    lotId: uuid("lot_id"),
    weightUsed: numeric("weight_used").notNull(),
    unit: text("unit").notNull().default("kg"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_traceability_po_idx").on(t.productionOrderId)],
);

export const plFillingOrders = pgTable(
  "pl_filling_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    productionOrderId: uuid("production_order_id").notNull(),
    fillItemId: uuid("fill_item_id").notNull(),
    kgPlanned: numeric("kg_planned").notNull(),
    kgProduced: numeric("kg_produced"),
    fillWeightRawG: numeric("fill_weight_raw_g"),
    nLinksPlanned: integer("n_links_planned"),
    nLinksProduced: integer("n_links_produced"),
    fillDate: date("fill_date"),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_filling_orders_po_idx").on(t.productionOrderId)],
);

export const plCookingOrders = pgTable(
  "pl_cooking_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    fillingOrderId: uuid("filling_order_id").notNull(),
    cookDate: date("cook_date"),
    rawWeightInKg: numeric("raw_weight_in_kg"),
    cookedWeightOutKg: numeric("cooked_weight_out_kg"),
    yieldPct: numeric("yield_pct"),
    coreTempAchievedC: numeric("core_temp_achieved_c"),
    cookProgram: text("cook_program"),
    ovenId: text("oven_id"),
    cookStartTime: timestamp("cook_start_time", { withTimezone: true }),
    cookEndTime: timestamp("cook_end_time", { withTimezone: true }),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_cooking_orders_filling_idx").on(t.fillingOrderId)],
);

export const plPackingOrders = pgTable(
  "pl_packing_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    cookingOrderId: uuid("cooking_order_id"),
    fillingOrderId: uuid("filling_order_id"),
    packItemId: uuid("pack_item_id").notNull(),
    packDate: date("pack_date"),
    dayOfWeek: smallint("day_of_week"),
    plannedUnits: integer("planned_units"),
    packedUnits: integer("packed_units"),
    wastageUnits: integer("wastage_units"),
    totalGiveawayG: numeric("total_giveaway_g"),
    avgGiveawayG: numeric("avg_giveaway_g"),
    plannedWeightKg: numeric("planned_weight_kg"),
    packedWeightKg: numeric("packed_weight_kg"),
    wastageWeightKg: numeric("wastage_weight_kg"),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_packing_orders_cooking_idx").on(t.cookingOrderId),
    index("pl_packing_orders_filling_idx").on(t.fillingOrderId),
  ],
);

export const plMachines = pgTable(
  "pl_machines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    departmentId: uuid("department_id"),
    code: text("code"),
    name: text("name").notNull(),
    machineType: text("machine_type"),
    capacityValue: numeric("capacity_value"),
    capacityUnit: text("capacity_unit"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    assetNumber: text("asset_number"),
    purchaseDate: date("purchase_date"),
    purchasePrice: numeric("purchase_price"),
    lastServiceDate: date("last_service_date"),
    nextServiceDate: date("next_service_date"),
    serviceIntervalDays: integer("service_interval_days"),
    serviceNotes: text("service_notes"),
    isActive: boolean("is_active").notNull().default(true),
    status: text("status").notNull().default("operational"),
    location: text("location"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_machines_tenant_idx").on(t.traceyTenantId),
    index("pl_machines_dept_idx").on(t.departmentId),
  ],
);

export const plMachineBreakdowns = pgTable(
  "pl_machine_breakdowns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    severity: text("severity").notNull().default("medium"),
    description: text("description").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolutionNotes: text("resolution_notes"),
    downtimeHours: numeric("downtime_hours"),
    repairCost: numeric("repair_cost"),
    partsUsed: text("parts_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_machine_breakdowns_machine_idx").on(t.machineId)],
);

export const plMachineSpareParts = pgTable(
  "pl_machine_spare_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    partName: text("part_name").notNull(),
    partNumber: text("part_number"),
    description: text("description"),
    quantityOnHand: numeric("quantity_on_hand").notNull().default("0"),
    reorderLevel: numeric("reorder_level"),
    unit: text("unit").default("each"),
    supplierName: text("supplier_name"),
    supplierPartNo: text("supplier_part_no"),
    unitCost: numeric("unit_cost"),
    location: text("location"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_machine_spare_parts_machine_idx").on(t.machineId)],
);

export const plMachineDocuments = pgTable(
  "pl_machine_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    documentUrl: text("document_url"),
    documentName: text("document_name"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    version: text("version"),
    effectiveDate: date("effective_date"),
    expiryDate: date("expiry_date"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_machine_docs_machine_idx").on(t.machineId)],
);

export const plMachineMaintenanceLogs = pgTable(
  "pl_machine_maintenance_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    maintenanceDate: date("maintenance_date").notNull(),
    maintenanceType: text("maintenance_type"),
    description: text("description"),
    performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
    performedByName: text("performed_by_name"),
    durationHours: numeric("duration_hours"),
    cost: numeric("cost"),
    nextDueDate: date("next_due_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_machine_maint_machine_idx").on(t.machineId)],
);

// ═══════════════════════════════════════════════════════════════════════════
// LOTS, STOCKTAKES, SPECS, PALLETS, ROOMS, LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const plLotNumbers = pgTable(
  "pl_lot_numbers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    lotCode: text("lot_code").notNull(),
    supplierLot: text("supplier_lot"),
    receivedDate: date("received_date"),
    bestBeforeDate: date("best_before_date"),
    useByDate: date("use_by_date"),
    qtyReceived: numeric("qty_received").notNull(),
    qtyRemaining: numeric("qty_remaining").notNull(),
    unit: text("unit").notNull().default("kg"),
    isQuarantined: boolean("is_quarantined").notNull().default(false),
    quarantineReason: text("quarantine_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_lot_numbers_tenant_item_code_uq").on(t.traceyTenantId, t.itemId, t.lotCode)],
);

export const plStocktakes = pgTable(
  "pl_stocktakes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    reference: text("reference"),
    weekType: text("week_type"),
    status: text("status").notNull().default("draft"),
    uncountedPolicy: text("uncounted_policy").notNull().default("carry_over"),
    notes: text("notes"),
    countedBy: uuid("counted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_stocktakes_tenant_idx").on(t.traceyTenantId)],
);

export const plStocktakeLines = pgTable(
  "pl_stocktake_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    stocktakeId: uuid("stocktake_id").notNull(),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id"),
    batchNumberId: uuid("batch_number_id"),
    requiresFlags: text("requires_flags"),
    systemQty: numeric("system_qty").notNull().default("0"),
    countedQty: numeric("counted_qty"),
    // variance is a STORED generated column; declared as plain numeric here,
    // GENERATED ALWAYS AS … STORED added by the baseline SQL.
    variance: numeric("variance"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_stocktake_lines_st_idx").on(t.stocktakeId),
    index("pl_stocktake_lines_item_idx").on(t.itemId),
  ],
);

export const plStocktakeDepartmentSignoffs = pgTable(
  "pl_stocktake_department_signoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    stocktakeId: uuid("stocktake_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    signedOffBy: uuid("signed_off_by").references(() => users.id, { onDelete: "set null" }),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_st_signoff_st_dept_uq").on(t.stocktakeId, t.departmentId),
    index("pl_st_signoff_st_idx").on(t.stocktakeId),
    index("pl_st_signoff_dept_idx").on(t.departmentId),
  ],
);

export const plProductSpecs = pgTable(
  "pl_product_specs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull().default(1),
    versionLabel: text("version_label").notNull().default("1.0"),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    internalNotes: text("internal_notes"),
    specStorageTemp: text("spec_storage_temp"),
    specShelfLife: text("spec_shelf_life"),
    specNotes: text("spec_notes"),
    specOrigin: text("spec_origin"),
    specFatContent: text("spec_fat_content"),
    specProtein: text("spec_protein"),
    specMoisture: text("spec_moisture"),
    specPh: text("spec_ph"),
    specWaterActivity: text("spec_water_activity"),
    specMicro: text("spec_micro"),
    specPackaging: text("spec_packaging"),
    specLabelling: text("spec_labelling"),
    nutEnergyKj: numeric("nut_energy_kj"),
    nutEnergyKcal: numeric("nut_energy_kcal"),
    nutProteinG: numeric("nut_protein_g"),
    nutFatTotalG: numeric("nut_fat_total_g"),
    nutFatSaturatedG: numeric("nut_fat_saturated_g"),
    nutFatTransG: numeric("nut_fat_trans_g"),
    nutCarbsTotalG: numeric("nut_carbs_total_g"),
    nutCarbsSugarsG: numeric("nut_carbs_sugars_g"),
    nutFibreG: numeric("nut_fibre_g"),
    nutSodiumMg: numeric("nut_sodium_mg"),
    nutPerServingG: numeric("nut_per_serving_g"),
    nutNotes: text("nut_notes"),
    allergens: text("allergens").array(),
    showCooDetail: boolean("show_coo_detail").notNull().default(false),
    cooBreakdown: jsonb("coo_breakdown"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_product_specs_tenant_item_ver_uq").on(t.traceyTenantId, t.itemId, t.version),
    index("pl_product_specs_item_idx").on(t.itemId),
    index("pl_product_specs_tenant_status_idx").on(t.traceyTenantId, t.status),
  ],
);

export const plSpecImages = pgTable(
  "pl_spec_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    specId: uuid("spec_id"),
    imageType: text("image_type").notNull().default("other"),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url"),
    caption: text("caption"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("pl_spec_images_item_idx").on(t.itemId),
    index("pl_spec_images_spec_idx").on(t.specId),
  ],
);

export const plSpecSends = pgTable(
  "pl_spec_sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    specId: uuid("spec_id").notNull(),
    itemId: uuid("item_id").notNull(),
    customerId: uuid("customer_id"),
    documentType: text("document_type").notNull().default("spec"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    recipientName: text("recipient_name"),
    recipientEmail: text("recipient_email"),
    versionLabel: text("version_label"),
    snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("pl_spec_sends_spec_idx").on(t.specId),
    index("pl_spec_sends_item_idx").on(t.itemId),
    index("pl_spec_sends_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plPalletConfigTemplates = pgTable(
  "pl_pallet_config_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ti: integer("ti"),
    hi: integer("hi"),
    palletType: text("pallet_type").notNull().default("plain"),
    palletLengthMm: integer("pallet_length_mm"),
    palletWidthMm: integer("pallet_width_mm"),
    palletHeightMm: integer("pallet_height_mm"),
    maxWeightKg: numeric("max_weight_kg"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_pallet_tmpl_tenant_name_uq").on(t.traceyTenantId, t.name),
    index("pl_pallet_tmpl_tenant_idx").on(t.traceyTenantId),
  ],
);

export const plItemPalletConfig = pgTable(
  "pl_item_pallet_config",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    templateId: uuid("template_id"),
    ti: integer("ti"),
    hi: integer("hi"),
    // units_per_pallet is a STORED generated column; declared as plain integer
    // here, GENERATED ALWAYS AS (ti * hi) STORED added by the baseline SQL.
    unitsPerPallet: integer("units_per_pallet"),
    cartonLengthMm: integer("carton_length_mm"),
    cartonWidthMm: integer("carton_width_mm"),
    cartonHeightMm: integer("carton_height_mm"),
    cartonGrossWeightKg: numeric("carton_gross_weight_kg"),
    cartonNetWeightKg: numeric("carton_net_weight_kg"),
    palletType: text("pallet_type").notNull().default("plain"),
    palletLengthMm: integer("pallet_length_mm"),
    palletWidthMm: integer("pallet_width_mm"),
    stackHeightMm: integer("stack_height_mm"),
    totalPalletWeightKg: numeric("total_pallet_weight_kg"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pl_item_pallet_cfg_tenant_item_uq").on(t.traceyTenantId, t.itemId),
    index("pl_item_pallet_cfg_item_idx").on(t.itemId),
  ],
);

export const plRooms = pgTable(
  "pl_rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    barcode: text("barcode"),
    color: text("color"),
    sortOrder: integer("sort_order"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_rooms_tenant_idx").on(t.traceyTenantId),
    index("pl_rooms_dept_idx").on(t.departmentId),
  ],
);

export const plLocations = pgTable(
  "pl_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    roomId: uuid("room_id").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    description: text("description"),
    barcode: text("barcode"),
    color: text("color"),
    sortOrder: integer("sort_order"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_locations_tenant_idx").on(t.traceyTenantId),
    index("pl_locations_room_idx").on(t.roomId),
    index("pl_locations_barcode_idx").on(t.barcode),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════
// WASTAGE, GOODS-IN, SCAN EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const plWastageRecords = pgTable(
  "pl_wastage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    lotId: uuid("lot_id"),
    stage: text("stage").notNull(),
    reasonCode: text("reason_code"),
    description: text("description"),
    weightKg: numeric("weight_kg"),
    unitCount: integer("unit_count"),
    unit: text("unit").default("kg"),
    productionOrderId: uuid("production_order_id"),
    fillingOrderId: uuid("filling_order_id"),
    packingOrderId: uuid("packing_order_id"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_wastage_tenant_item_stage_idx").on(t.traceyTenantId, t.itemId, t.stage)],
);

export const plWastageReasons = pgTable(
  "pl_wastage_reasons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    stage: text("stage"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("pl_wastage_reasons_tenant_code_uq").on(t.traceyTenantId, t.code)],
);

export const plScanEvents = pgTable(
  "pl_scan_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    barcode: text("barcode").notNull(),
    barcodeType: text("barcode_type"),
    itemId: uuid("item_id"),
    lotId: uuid("lot_id"),
    purpose: text("purpose").notNull().default("unknown"),
    source: text("source").notNull().default("manual"),
    processedIntoType: text("processed_into_type"),
    processedIntoId: uuid("processed_into_id"),
    isProcessed: boolean("is_processed").notNull().default(false),
    scannedBy: uuid("scanned_by").references(() => users.id, { onDelete: "set null" }),
    deviceId: text("device_id"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_scan_events_tenant_barcode_idx").on(t.traceyTenantId, t.barcode)],
);

export const plGoodsInReceipts = pgTable(
  "pl_goods_in_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    supplierId: uuid("supplier_id"),
    receiptNumber: text("receipt_number"),
    supplierDeliveryRef: text("supplier_delivery_ref"),
    receivedDate: date("received_date").notNull().default(sql`current_date`),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pl_goods_in_tenant_idx").on(t.traceyTenantId),
    index("pl_goods_in_supplier_idx").on(t.supplierId),
  ],
);

export const plGoodsInLines = pgTable(
  "pl_goods_in_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    goodsInReceiptId: uuid("goods_in_receipt_id").notNull(),
    itemId: uuid("item_id").notNull(),
    supplierLot: text("supplier_lot"),
    supplierBarcode: text("supplier_barcode"),
    purchaseUom: text("purchase_uom"),
    nPurchaseUnits: integer("n_purchase_units"),
    purchaseUomQtyEach: numeric("purchase_uom_qty_each"),
    qtyReceived: numeric("qty_received").notNull(),
    unit: text("unit").notNull().default("kg"),
    receivedDate: date("received_date"),
    bestBeforeDate: date("best_before_date"),
    useByDate: date("use_by_date"),
    lotId: uuid("lot_id"),
    unitPrice: numeric("unit_price"),
    currency: text("currency").default("AUD"),
    totalPrice: numeric("total_price"),
    isQuarantined: boolean("is_quarantined").notNull().default(false),
    quarantineReason: text("quarantine_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_goods_in_lines_receipt_idx").on(t.goodsInReceiptId)],
);

// ═══════════════════════════════════════════════════════════════════════════
// MISCELLANEOUS
// ═══════════════════════════════════════════════════════════════════════════

export const plDispatchRecords = pgTable(
  "pl_dispatch_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    dispatchDate: date("dispatch_date").notNull(),
    customerName: text("customer_name"),
    customerRef: text("customer_ref"),
    demandLineId: uuid("demand_line_id"),
    itemId: uuid("item_id").notNull(),
    qtyUnits: integer("qty_units"),
    qtyKg: numeric("qty_kg"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_dispatch_tenant_date_item_idx").on(t.traceyTenantId, t.dispatchDate, t.itemId)],
);

export const plInventoryTransactions = pgTable(
  "pl_inventory_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    itemId: uuid("item_id").notNull(),
    lotId: uuid("lot_id"),
    txType: text("tx_type").notNull(),
    quantity: numeric("quantity").notNull(),
    unit: text("unit").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pl_inv_tx_tenant_item_created_idx").on(t.traceyTenantId, t.itemId, t.createdAt)],
);

export const plTenantLabels = pgTable(
  "pl_tenant_labels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    labelKey: text("label_key").notNull(),
    labelValue: text("label_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pl_tenant_labels_tenant_key_uq").on(t.traceyTenantId, t.labelKey)],
);

// ═══════════════════════════════════════════════════════════════════════════
// INFERRED TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type PlDepartment = typeof plDepartments.$inferSelect;
export type NewPlDepartment = typeof plDepartments.$inferInsert;
export type PlAllergenDefinition = typeof plAllergenDefinitions.$inferSelect;
export type PlTenantAllergenSettings = typeof plTenantAllergenSettings.$inferSelect;
export type PlUserCategory = typeof plUserCategories.$inferSelect;
export type PlUserDepartmentAccess = typeof plUserDepartmentAccess.$inferSelect;
export type PlTaxCode = typeof plTaxCodes.$inferSelect;
export type PlUnitOfMeasure = typeof plUnitsOfMeasure.$inferSelect;
export type PlTenantPackLevelDef = typeof plTenantPackLevelDefs.$inferSelect;
export type PlRole = typeof plRoles.$inferSelect;
export type PlRolePermission = typeof plRolePermissions.$inferSelect;
export type PlUserLogin = typeof plUserLogins.$inferSelect;
export type PlCurrency = typeof plCurrencies.$inferSelect;
export type PlIngredientClassification = typeof plIngredientClassifications.$inferSelect;
export type PlPlanningUserSettings = typeof plPlanningUserSettings.$inferSelect;
export type NewPlPlanningUserSettings = typeof plPlanningUserSettings.$inferInsert;

export type PlItemCategory = typeof plItemCategories.$inferSelect;
export type PlItemSubcategory = typeof plItemSubcategories.$inferSelect;
export type PlItemType = typeof plItemTypes.$inferSelect;
export type PlItem = typeof plItems.$inferSelect;
export type NewPlItem = typeof plItems.$inferInsert;
export type PlItemImage = typeof plItemImages.$inferSelect;
export type PlItemBarcode = typeof plItemBarcodes.$inferSelect;
export type PlTenantBarcodePool = typeof plTenantBarcodePool.$inferSelect;
export type PlItemSpecDocument = typeof plItemSpecDocuments.$inferSelect;
export type PlItemIngredientComponent = typeof plItemIngredientComponents.$inferSelect;

export type PlBomHeader = typeof plBomHeaders.$inferSelect;
export type NewPlBomHeader = typeof plBomHeaders.$inferInsert;
export type PlBomLine = typeof plBomLines.$inferSelect;
export type NewPlBomLine = typeof plBomLines.$inferInsert;

export type PlSupplier = typeof plSuppliers.$inferSelect;
export type PlSupplierItem = typeof plSupplierItems.$inferSelect;
export type PlSupplierContact = typeof plSupplierContacts.$inferSelect;
export type PlSupplierCertification = typeof plSupplierCertifications.$inferSelect;
export type PlPurchaseOrder = typeof plPurchaseOrders.$inferSelect;
export type PlPurchaseOrderLine = typeof plPurchaseOrderLines.$inferSelect;
export type PlFxRate = typeof plFxRates.$inferSelect;

export type PlCustomer = typeof plCustomers.$inferSelect;
export type PlCustomerItemOverride = typeof plCustomerItemOverrides.$inferSelect;
export type PlPriceGroup = typeof plPriceGroups.$inferSelect;
export type PlPriceGroupLine = typeof plPriceGroupLines.$inferSelect;
export type PlCustomerContact = typeof plCustomerContacts.$inferSelect;
export type PlCustomerOrder = typeof plCustomerOrders.$inferSelect;
export type PlCustomerOrderLine = typeof plCustomerOrderLines.$inferSelect;
export type PlOrderLineLot = typeof plOrderLineLots.$inferSelect;
export type PlInvoice = typeof plInvoices.$inferSelect;

export type PlDemandPlan = typeof plDemandPlans.$inferSelect;
export type PlDemandLine = typeof plDemandLines.$inferSelect;
export type PlMrpResult = typeof plMrpResults.$inferSelect;
export type PlMrpOverride = typeof plMrpOverrides.$inferSelect;
export type PlProductionOrder = typeof plProductionOrders.$inferSelect;
export type PlProductionSubOperation = typeof plProductionSubOperations.$inferSelect;
export type PlTraceabilityLink = typeof plTraceabilityLinks.$inferSelect;
export type PlFillingOrder = typeof plFillingOrders.$inferSelect;
export type PlCookingOrder = typeof plCookingOrders.$inferSelect;
export type PlPackingOrder = typeof plPackingOrders.$inferSelect;
export type PlMachine = typeof plMachines.$inferSelect;
export type PlMachineBreakdown = typeof plMachineBreakdowns.$inferSelect;
export type PlMachineSparePart = typeof plMachineSpareParts.$inferSelect;
export type PlMachineDocument = typeof plMachineDocuments.$inferSelect;
export type PlMachineMaintenanceLog = typeof plMachineMaintenanceLogs.$inferSelect;

export type PlLotNumber = typeof plLotNumbers.$inferSelect;
export type PlStocktake = typeof plStocktakes.$inferSelect;
export type PlStocktakeLine = typeof plStocktakeLines.$inferSelect;
export type PlStocktakeDepartmentSignoff = typeof plStocktakeDepartmentSignoffs.$inferSelect;
export type PlProductSpec = typeof plProductSpecs.$inferSelect;
export type PlSpecImage = typeof plSpecImages.$inferSelect;
export type PlSpecSend = typeof plSpecSends.$inferSelect;
export type PlPalletConfigTemplate = typeof plPalletConfigTemplates.$inferSelect;
export type PlItemPalletConfig = typeof plItemPalletConfig.$inferSelect;
export type PlRoom = typeof plRooms.$inferSelect;
export type PlLocation = typeof plLocations.$inferSelect;

export type PlWastageRecord = typeof plWastageRecords.$inferSelect;
export type PlWastageReason = typeof plWastageReasons.$inferSelect;
export type PlScanEvent = typeof plScanEvents.$inferSelect;
export type PlGoodsInReceipt = typeof plGoodsInReceipts.$inferSelect;
export type PlGoodsInLine = typeof plGoodsInLines.$inferSelect;
export type PlDispatchRecord = typeof plDispatchRecords.$inferSelect;
export type PlInventoryTransaction = typeof plInventoryTransactions.$inferSelect;
export type PlTenantLabel = typeof plTenantLabels.$inferSelect;
