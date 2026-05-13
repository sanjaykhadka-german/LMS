// ─── TRACEY — TypeScript Types ───────────────────────────────────────────────
// Auto-kept in sync with supabase/migrations/001_initial.sql
// "Tracey got you covered"

// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'planner'
  | 'production'
  | 'filling'
  | 'cooking'
  | 'packing'
  | 'dispatch'
  | 'viewer';

// ItemType is now a plain string — values are tenant-configurable via item_types table
export type ItemType = string;

// Shape of a row from the item_types table
export interface ItemTypeRow {
  id: string;
  code: string;
  name: string;
  color: string;
  is_purchasable: boolean;
  can_have_bom: boolean;
  is_sellable: boolean;
  is_producible: boolean;
  sort_order: number;
  is_active: boolean;
}

export type ProductionMethod =
  | 'mincing_mixing'
  | 'injection_tumbling'
  | 'curing'
  | 'smoking'
  | 'cooking_only'
  | 'packing_only'
  | 'fresh_cut'
  | 'other';

export type WeightMode = 'fixed' | 'random';

export type PlanStatus = 'draft' | 'locked' | 'in_progress' | 'completed' | 'archived';

export type DemandType =
  | 'customer_order'
  | 'replenishment'
  | 'buffer_stock'
  | 'transfer'
  | 'export';

export type OrderStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'on_hold';

export type InvTxType =
  | 'receipt'
  | 'production_use'
  | 'production_output'
  | 'fill_output'
  | 'cook_output'
  | 'pack_output'
  | 'adjustment'
  | 'wastage'
  | 'dispatch'
  | 'transfer';

// ─── Tenant ──────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  plan: string;
  is_active: boolean;
  created_at: string;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  department: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Item (Unified Item Master) ───────────────────────────────────────────────

export interface Item {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  item_type: ItemType;
  parent_item_id: string | null;
  parent_item?: Item;           // joined

  // Processing
  production_method: ProductionMethod | null;
  department: string | null;
  machine: string | null;
  room: string | null;
  priority: number;

  // Units & batch defaults
  unit: string;
  default_batch_size: number | null;
  batch_unit: string | null;

  // Weight mode (FG)
  weight_mode: WeightMode;
  target_weight_g: number | null;
  tare_weight_g: number | null;
  tolerance_over_g: number | null;
  tolerance_under_g: number | null;
  units_per_inner: number | null;
  units_per_outer: number | null;
  inner_per_outer: number | null;

  // Allergens
  allergens: string[];

  // Stock
  current_stock: number;
  min_stock: number;
  max_stock: number;
  is_make_to_order: boolean;
  is_active: boolean;

  // Shared specs
  spec_storage_temp: string | null;
  spec_shelf_life: string | null;
  spec_notes: string | null;

  // RM-specific
  spec_origin: string | null;
  spec_fat_content: string | null;
  spec_protein: string | null;
  spec_moisture: string | null;
  spec_ph: string | null;
  spec_water_activity: string | null;
  spec_micro: string | null;
  supplier: string | null;
  supplier_code: string | null;

  // FG/WIP-specific
  spec_weight_per_unit: string | null;
  spec_packaging: string | null;
  spec_labelling: string | null;

  // Tax & accounting (Phase 1)
  purchase_tax_code_id: string | null;
  sales_tax_code_id: string | null;
  purchase_account_code: string | null;
  sales_account_code: string | null;

  // Purchase UOM (Phase 1)
  purchase_uom: string | null;
  purchase_uom_qty: number | null;
  purchase_uom_type: string | null;
  purchase_unit_price: number | null;
  purchase_currency: string | null;

  // Nutrition (Phase 1) — per 100g
  nut_energy_kj: number | null;
  nut_energy_kcal: number | null;
  nut_protein_g: number | null;
  nut_fat_total_g: number | null;
  nut_fat_saturated_g: number | null;
  nut_fat_trans_g: number | null;
  nut_carbs_total_g: number | null;
  nut_carbs_sugars_g: number | null;
  nut_fibre_g: number | null;
  nut_sodium_mg: number | null;
  nut_per_serving_g: number | null;
  nut_notes: string | null;

  created_at: string;
  updated_at: string;

  // Computed / joined
  children?: Item[];
  bom?: BomHeader;
}

// ─── Tax Codes (Phase 1) ──────────────────────────────────────────────────────

export interface TaxCode {
  id: string;
  tenant_id: string;
  name: string;
  rate_pct: number;
  applies_to: 'purchase' | 'sales' | 'both';
  is_default_purchase: boolean;
  is_default_sales: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Bill of Materials ────────────────────────────────────────────────────────

export interface BomHeader {
  id: string;
  tenant_id: string;
  item_id: string;
  item?: Item;
  version: number;
  reference_batch_size: number;
  reference_batch_unit: string;
  yield_factor: number;
  is_active: boolean;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lines?: BomLine[];
}

export interface BomLine {
  id: string;
  bom_header_id: string;
  component_item_id: string;
  component_item?: Item;
  qty_per_batch: number;
  unit: string;
  percentage: number | null;
  grind_size: string | null;
  comment: string | null;
  sort_order: number;
  created_at: string;
}

// ─── Lot Numbers ──────────────────────────────────────────────────────────────

export interface LotNumber {
  id: string;
  tenant_id: string;
  item_id: string;
  item?: Item;
  lot_code: string;
  supplier_lot: string | null;
  received_date: string | null;
  best_before_date: string | null;
  use_by_date: string | null;
  qty_received: number;
  qty_remaining: number;
  unit: string;
  is_quarantined: boolean;
  quarantine_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Demand Planning ──────────────────────────────────────────────────────────

export interface DemandPlan {
  id: string;
  tenant_id: string;
  week_start: string;         // ISO date (Monday)
  status: PlanStatus;
  notes: string | null;
  created_by: string | null;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  lines?: DemandLine[];
  mrp_results?: MrpResult[];
}

export interface DemandLine {
  id: string;
  demand_plan_id: string;
  item_id: string;
  item?: Item;
  demand_type: DemandType;
  planned_qty_kg: number | null;
  planned_units: number | null;
  planned_weight_kg: number | null;
  customer_ref: string | null;
  customer_name: string | null;
  required_date: string | null;
  day_of_week: number | null;   // 0=Mon … 6=Sun
  priority: number;
  notes: string | null;
  created_at: string;
}

export interface MrpResult {
  id: string;
  demand_plan_id: string;
  item_id: string;
  item?: Item;
  department: string;
  bom_id: string | null;
  required_qty: number;
  unit: string;
  standard_batch_size: number | null;
  suggested_batches: number | null;
  rounded_batches: number | null;
  planned_qty: number | null;
  surplus_qty: number | null;
  created_at: string;
}

// ─── Production Orders ────────────────────────────────────────────────────────

export interface ProductionOrder {
  id: string;
  tenant_id: string;
  demand_plan_id: string | null;
  item_id: string;
  item?: Item;
  department: string;
  batch_number: string;
  production_date: string | null;
  day_of_week: number | null;
  batch_size: number;
  n_of_batches: number;
  planned_qty: number;
  actual_qty: number | null;
  unit: string;
  machine: string | null;
  room: string | null;
  priority: number;
  bom_id: string | null;
  bom?: BomHeader;
  batch_recipe_generated: boolean;
  batch_recipe_approved: boolean;
  batch_recipe_approved_by: string | null;
  batch_recipe_approved_at: string | null;

  // Injection/tumble
  raw_weight_kg: number | null;
  injection_target_pct: number | null;
  actual_pct_injected: number | null;
  tumble_hours: number | null;
  pickle_bom_id: string | null;

  status: OrderStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  filling_orders?: FillingOrder[];
  traceability?: TraceabilityLink[];
}

export interface TraceabilityLink {
  id: string;
  production_order_id: string;
  component_item_id: string;
  component_item?: Item;
  lot_id: string | null;
  lot?: LotNumber;
  weight_used: number;
  unit: string;
  notes: string | null;
  created_at: string;
}

// ─── Filling Orders ───────────────────────────────────────────────────────────

export interface FillingOrder {
  id: string;
  production_order_id: string;
  fill_item_id: string;
  fill_item?: Item;
  kg_planned: number;
  kg_produced: number | null;
  fill_weight_raw_g: number | null;
  n_links_planned: number | null;
  n_links_produced: number | null;
  fill_date: string | null;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  cooking_orders?: CookingOrder[];
  packing_orders?: PackingOrder[];
}

// ─── Cooking Orders ───────────────────────────────────────────────────────────

export interface CookingOrder {
  id: string;
  filling_order_id: string;
  cook_date: string | null;
  raw_weight_in_kg: number | null;
  cooked_weight_out_kg: number | null;
  yield_pct: number | null;
  core_temp_achieved_c: number | null;
  cook_program: string | null;
  oven_id: string | null;
  cook_start_time: string | null;
  cook_end_time: string | null;
  status: OrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  packing_orders?: PackingOrder[];
}

// ─── Packing Orders ───────────────────────────────────────────────────────────

export interface PackingOrder {
  id: string;
  cooking_order_id: string | null;
  filling_order_id: string | null;  // bulk bypass
  pack_item_id: string;
  pack_item?: Item;
  pack_date: string | null;
  day_of_week: number | null;

  // Fixed-weight
  planned_units: number | null;
  packed_units: number | null;
  wastage_units: number | null;
  total_giveaway_g: number | null;
  avg_giveaway_g: number | null;

  // Random-weight
  planned_weight_kg: number | null;
  packed_weight_kg: number | null;
  wastage_weight_kg: number | null;

  status: OrderStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryTransaction {
  id: string;
  tenant_id: string;
  item_id: string;
  item?: Item;
  lot_id: string | null;
  lot?: LotNumber;
  tx_type: InvTxType;
  quantity: number;
  unit: string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Fallback labels/colors for when item_types haven't loaded yet
export const ITEM_TYPE_LABELS: Record<string, string> = {
  raw_material:  'Raw Material',
  wip:           'WIP / Mix',
  fill:          'Fill Code',
  finished_good: 'Finished Good',
  packaging:     'Packaging',
  consumable:    'Consumable',
};

// Map from DB hex color → CSS badge class (best-effort fallback)
export const ITEM_TYPE_COLORS: Record<string, string> = {
  raw_material:  'badge-yellow',
  wip:           'badge-red',
  fill:          'badge-blue',
  finished_good: 'badge-green',
  packaging:     'badge-gray',
  consumable:    'badge-gray',
};

/** Build label/color lookup maps from a live item_types array */
export function buildItemTypeMaps(itemTypes: ItemTypeRow[]) {
  const labels: Record<string, string> = {};
  const colors: Record<string, string> = {};
  for (const t of itemTypes) {
    labels[t.code] = t.name;
    colors[t.code] = t.color; // hex string from DB
  }
  return { labels, colors };
}

export const PRODUCTION_METHOD_LABELS: Record<ProductionMethod, string> = {
  mincing_mixing:     'Mincing / Mixing',
  injection_tumbling: 'Injection / Tumbling',
  curing:             'Curing',
  smoking:            'Smoking',
  cooking_only:       'Cooking Only',
  packing_only:       'Packing Only',
  fresh_cut:          'Fresh Cut',
  other:              'Other',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  planned:     'badge-gray',
  in_progress: 'badge-yellow',
  completed:   'badge-green',
  cancelled:   'badge-red',
  on_hold:     'badge-yellow',
};

export const DEPARTMENTS = [
  'production',
  'filling',
  'cooking',
  'packing',
  'dispatch',
] as const;

export type Department = typeof DEPARTMENTS[number];

export const DEPARTMENT_LABELS: Record<string, string> = {
  production: 'Production',
  filling:    'Filling',
  cooking:    'Cooking',
  packing:    'Packing',
  dispatch:   'Dispatch',
};

// Roles that can access the planner view
export const PLANNER_ROLES: UserRole[] = ['super_admin', 'admin', 'manager', 'planner'];

// Department-to-role mapping (which role sees which dept queue by default)
export const DEPT_ROLE_MAP: Record<string, UserRole> = {
  production: 'production',
  filling:    'filling',
  cooking:    'cooking',
  packing:    'packing',
  dispatch:   'dispatch',
};
