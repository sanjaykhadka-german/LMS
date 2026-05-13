-- ============================================================
-- TRACEY — Production Planning & Traceability SaaS
-- Initial Schema v1.0
-- "Tracey got you covered"
--
-- Multi-tenant: every table (except tenants) carries tenant_id.
-- RLS policies enforce that users can only see their own tenant's data.
-- Run this in Supabase SQL Editor on a fresh project.
-- ============================================================

create extension if not exists "pgcrypto";

-- ─── TENANTS ─────────────────────────────────────────────────────────────────

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subdomain   text unique not null,   -- e.g. 'germanbutchery'
  plan        text not null default 'trial',  -- trial | starter | pro | enterprise
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed the first tenant (German Butchery)
insert into tenants (name, subdomain, plan)
values ('German Butchery', 'germanbutchery', 'pro');

-- ─── PROFILES ────────────────────────────────────────────────────────────────
-- Roles: super_admin = Tracey platform staff; others are per-tenant roles.

create type user_role as enum (
  'super_admin',   -- Tracey platform
  'admin',         -- tenant owner/admin
  'manager',       -- production manager
  'planner',       -- planning staff
  'production',    -- production dept
  'filling',       -- filling dept
  'cooking',       -- cooking dept
  'packing',       -- packing dept
  'dispatch',      -- dispatch dept
  'viewer'         -- read-only
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id),
  email       text not null,
  full_name   text,
  role        user_role not null default 'viewer',
  department  text,         -- primary department (matches role if dept-specific)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create profile on Supabase Auth signup.
-- Set tenant_id via user metadata: { tenant_id: '...' }
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_tenant_id uuid;
begin
  -- Read tenant_id from user metadata if provided, else default to German Butchery
  v_tenant_id := coalesce(
    (new.raw_user_meta_data->>'tenant_id')::uuid,
    (select id from tenants where subdomain = 'germanbutchery' limit 1)
  );

  insert into profiles (id, tenant_id, email, full_name, role)
  values (
    new.id,
    v_tenant_id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'viewer')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── UNIFIED ITEM MASTER ─────────────────────────────────────────────────────
-- One table for all item types: raw materials, WIPs, fill codes, finished goods,
-- packaging materials, consumables.

create type item_type as enum (
  'raw_material',    -- RM: pork, salt, spices, casings
  'wip',             -- WIP: the mix/emulsion (e.g. 2015 - Chorizo WIP)
  'fill',            -- Fill code: WIP filled into casings (e.g. 2015.100)
  'finished_good',   -- FG: packed product ready for dispatch (e.g. 2015.100.1)
  'packaging',       -- packaging: films, boxes, labels (tracked but not in BOM tree)
  'consumable'       -- cleaning chemicals, gloves, etc.
);

create type production_method as enum (
  'mincing_mixing',      -- bowl cutter / mixer (frankfurters, chorizo, etc.)
  'injection_tumbling',  -- brine injection + vacuum tumble (ham, kassler, etc.)
  'curing',              -- dry or wet cure without injection
  'smoking',             -- cold or hot smoke
  'cooking_only',        -- sous vide, steam, roasting
  'packing_only',        -- takes cooked/cured item and packs it
  'fresh_cut',           -- fresh portioning (no cooking/curing)
  'other'
);

create type weight_mode as enum (
  'fixed',    -- every pack must hit a target weight (e.g. 500g)
  'random'    -- each item has its own weight, sold by kg
);

create table items (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  code                    text not null,
  name                    text not null,
  description             text,
  item_type               item_type not null,

  -- Hierarchy: explicit parent, not inferred from code
  parent_item_id          uuid references items(id),

  -- Processing
  production_method       production_method,
  department              text,        -- primary responsible dept
  machine                 text,
  room                    text,
  priority                numeric default 5,

  -- Units
  unit                    text not null default 'kg',
  default_batch_size      numeric,
  batch_unit              text default 'kg',

  -- Weight mode (finished goods)
  weight_mode             weight_mode default 'random',
  target_weight_g         numeric,   -- target weight in grams (fixed-weight)
  tare_weight_g           numeric,   -- packaging tare in grams
  tolerance_over_g        numeric,   -- max allowed giveaway (g)
  tolerance_under_g       numeric,   -- max allowed underweight (g)
  units_per_inner         int,       -- units per inner pack
  units_per_outer         int,       -- units per outer case/box
  inner_per_outer         int,       -- inner packs per outer case

  -- Allergens (stored as array for easy multi-allergen support)
  allergens               text[] default '{}',

  -- Stock management
  current_stock           numeric not null default 0,
  min_stock               numeric not null default 0,
  max_stock               numeric not null default 0,
  is_make_to_order        boolean not null default false,
  is_active               boolean not null default true,

  -- Shared specifications
  spec_storage_temp       text,
  spec_shelf_life         text,
  spec_notes              text,

  -- Raw material specifications
  spec_origin             text,
  spec_fat_content        text,
  spec_protein            text,
  spec_moisture           text,
  spec_ph                 text,
  spec_water_activity     text,
  spec_micro              text,      -- microbiological standards
  supplier                text,
  supplier_code           text,

  -- Finished good / WIP specifications
  spec_weight_per_unit    text,
  spec_packaging          text,
  spec_labelling          text,

  unique(tenant_id, code),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ─── BILL OF MATERIALS ───────────────────────────────────────────────────────
-- BOM headers are versioned per item. When a recipe changes, bump the version.
-- The yield_factor at each BOM represents the loss at THAT production stage.
-- e.g. a cooking BOM might have yield_factor = 0.85 (15% cook loss).

create table bom_headers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  item_id                 uuid not null references items(id),
  version                 int not null default 1,

  -- Reference batch (recipe quantities are expressed per this batch)
  reference_batch_size    numeric not null,
  reference_batch_unit    text not null default 'kg',

  -- Yield at THIS production stage
  -- (MRP uses 1/yield_factor to gross-up requirements)
  yield_factor            numeric not null default 1.0
    check (yield_factor > 0 and yield_factor <= 1.5),

  is_active               boolean not null default true,
  created_by              uuid references profiles(id),
  approved_by             uuid references profiles(id),
  approved_at             timestamptz,
  notes                   text,

  unique(item_id, version),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- BOM lines: each ingredient/component in a BOM.
-- component_item_id can reference any item type (RM, WIP, fill, FG, packaging).
create table bom_lines (
  id                      uuid primary key default gen_random_uuid(),
  bom_header_id           uuid not null references bom_headers(id) on delete cascade,
  component_item_id       uuid not null references items(id),
  qty_per_batch           numeric not null,
  unit                    text not null,
  percentage              numeric,   -- % of total batch weight
  grind_size              text,      -- e.g. "8mm" for mince products
  comment                 text,      -- free-text note on this ingredient
  sort_order              int not null default 0,
  created_at              timestamptz not null default now()
);

-- ─── LOT NUMBERS (Raw Material & WIP traceability) ───────────────────────────

create table lot_numbers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  item_id                 uuid not null references items(id),
  lot_code                text not null,
  supplier_lot            text,          -- supplier's own batch/lot reference
  received_date           date,
  best_before_date        date,
  use_by_date             date,
  qty_received            numeric not null,
  qty_remaining           numeric not null,
  unit                    text not null default 'kg',
  is_quarantined          boolean not null default false,
  quarantine_reason       text,
  notes                   text,
  unique(tenant_id, item_id, lot_code),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ─── DEMAND PLANS ────────────────────────────────────────────────────────────
-- A weekly demand plan is the starting point. Planners enter what they need to
-- produce (FG quantities from orders + replenishment). MRP explodes this down
-- through the BOM tree to generate production requirements per department.

create type plan_status as enum ('draft', 'locked', 'in_progress', 'completed', 'archived');
create type demand_type as enum ('customer_order', 'replenishment', 'buffer_stock', 'transfer', 'export');

create table demand_plans (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  week_start              date not null,  -- always Monday
  status                  plan_status not null default 'draft',
  notes                   text,
  created_by              uuid references profiles(id),
  locked_by               uuid references profiles(id),
  locked_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique(tenant_id, week_start)
);

create table demand_lines (
  id                      uuid primary key default gen_random_uuid(),
  demand_plan_id          uuid not null references demand_plans(id) on delete cascade,
  item_id                 uuid not null references items(id),
  demand_type             demand_type not null default 'replenishment',

  -- Quantities (use both: weight for random, units for fixed-weight)
  planned_qty_kg          numeric,   -- weight planned (kg)
  planned_units           int,       -- unit count planned
  planned_weight_kg       numeric,   -- calculated: units × target_weight_g / 1000

  -- Customer order fields
  customer_ref            text,
  customer_name           text,
  required_date           date,
  day_of_week             smallint check (day_of_week between 0 and 6),  -- 0=Mon

  priority                int default 5,
  notes                   text,
  created_at              timestamptz not null default now()
);

-- ─── MRP RESULTS ─────────────────────────────────────────────────────────────
-- Calculated by the MRP explosion function. Stored so the planner can see
-- and adjust before generating production orders.

create table mrp_results (
  id                      uuid primary key default gen_random_uuid(),
  demand_plan_id          uuid not null references demand_plans(id) on delete cascade,
  item_id                 uuid not null references items(id),
  department              text not null,
  bom_id                  uuid references bom_headers(id),

  -- Raw requirement (exact calculation)
  required_qty            numeric not null,
  unit                    text not null default 'kg',

  -- Batch planning
  standard_batch_size     numeric,
  suggested_batches       numeric,    -- required / batch_size (may be fractional)
  rounded_batches         int,        -- ceil(suggested_batches)
  planned_qty             numeric,    -- rounded_batches × batch_size
  surplus_qty             numeric,    -- planned - required (the surplus from rounding)

  created_at              timestamptz not null default now()
);

-- ─── PRODUCTION ORDERS ───────────────────────────────────────────────────────
-- One production order per WIP item per production run.
-- e.g. "2015 - Chorizo WIP, 3,000 kg, 4 × 750 kg batches"

create type order_status as enum ('planned', 'in_progress', 'completed', 'cancelled', 'on_hold');

create table production_orders (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id),
  demand_plan_id              uuid references demand_plans(id),
  item_id                     uuid not null references items(id),
  department                  text not null default 'production',

  -- Batch identification
  batch_number                text not null,
  production_date             date,
  day_of_week                 smallint check (day_of_week between 0 and 6),

  -- Quantities (flexible at plan time)
  batch_size                  numeric not null,
  n_of_batches                int not null,
  planned_qty                 numeric not null,   -- batch_size × n_of_batches
  actual_qty                  numeric,
  unit                        text not null default 'kg',

  -- Equipment
  machine                     text,
  room                        text,
  priority                    numeric default 5,

  -- BOM reference
  bom_id                      uuid references bom_headers(id),
  batch_recipe_generated      boolean not null default false,
  batch_recipe_approved       boolean not null default false,
  batch_recipe_approved_by    uuid references profiles(id),
  batch_recipe_approved_at    timestamptz,

  -- Injection/tumble (nullable — only used for those products)
  raw_weight_kg               numeric,           -- weight before injection
  injection_target_pct        numeric,           -- e.g. 27 = 27% injection
  actual_pct_injected         numeric,
  tumble_hours                numeric,
  pickle_bom_id               uuid references bom_headers(id),  -- brine recipe

  status                      order_status not null default 'planned',
  notes                       text,
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique(tenant_id, batch_number)
);

-- Traceability: which RM lots were used in each production order
create table traceability_links (
  id                          uuid primary key default gen_random_uuid(),
  production_order_id         uuid not null references production_orders(id) on delete cascade,
  component_item_id           uuid not null references items(id),
  lot_id                      uuid references lot_numbers(id),
  weight_used                 numeric not null,
  unit                        text not null default 'kg',
  notes                       text,
  created_at                  timestamptz not null default now()
);

-- ─── FILLING ORDERS ──────────────────────────────────────────────────────────
-- Each filling order represents one fill code produced from a production order.
-- One production order → multiple filling orders (one per fill size).

create table filling_orders (
  id                          uuid primary key default gen_random_uuid(),
  production_order_id         uuid not null references production_orders(id) on delete cascade,
  fill_item_id                uuid not null references items(id),  -- item_type = 'fill'

  kg_planned                  numeric not null,
  kg_produced                 numeric,

  -- Pre-cook fill data
  fill_weight_raw_g           numeric,     -- target pre-cook weight per link/unit (g)
  n_links_planned             int,
  n_links_produced            int,

  fill_date                   date,
  status                      order_status not null default 'planned',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ─── COOKING ORDERS ──────────────────────────────────────────────────────────

create table cooking_orders (
  id                          uuid primary key default gen_random_uuid(),
  filling_order_id            uuid not null references filling_orders(id) on delete cascade,

  cook_date                   date,
  raw_weight_in_kg            numeric,
  cooked_weight_out_kg        numeric,
  yield_pct                   numeric,   -- cooked_out / raw_in * 100

  -- HACCP records
  core_temp_achieved_c        numeric,
  cook_program                text,
  oven_id                     text,
  cook_start_time             timestamptz,
  cook_end_time               timestamptz,

  status                      order_status not null default 'planned',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ─── PACKING ORDERS ──────────────────────────────────────────────────────────
-- Links back to cooking order (normal) or directly to filling order (bulk bypass).
-- pack_item_id must be a finished_good.

create table packing_orders (
  id                          uuid primary key default gen_random_uuid(),
  cooking_order_id            uuid references cooking_orders(id),     -- normal route
  filling_order_id            uuid references filling_orders(id),     -- bulk bypass
  pack_item_id                uuid not null references items(id),     -- item_type = finished_good

  pack_date                   date,
  day_of_week                 smallint check (day_of_week between 0 and 6),

  -- Fixed-weight packing
  planned_units               int,
  packed_units                int,
  wastage_units               int,
  total_giveaway_g            numeric,  -- total giveaway weight (g) this run
  avg_giveaway_g              numeric,  -- average giveaway per unit (g)

  -- Random-weight packing
  planned_weight_kg           numeric,
  packed_weight_kg            numeric,
  wastage_weight_kg           numeric,

  status                      order_status not null default 'planned',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ─── DISPATCH RECORDS ────────────────────────────────────────────────────────

create table dispatch_records (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id),
  dispatch_date               date not null,
  customer_name               text,
  customer_ref                text,
  demand_line_id              uuid references demand_lines(id),
  item_id                     uuid not null references items(id),
  qty_units                   int,
  qty_kg                      numeric,
  notes                       text,
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now()
);

-- ─── INVENTORY TRANSACTIONS ──────────────────────────────────────────────────

create type inv_tx_type as enum (
  'receipt',            -- RM received from supplier
  'production_use',     -- RM consumed in production
  'production_output',  -- WIP produced
  'fill_output',        -- fill code produced
  'cook_output',        -- cooked WIP produced
  'pack_output',        -- FG packed
  'adjustment',         -- manual correction
  'wastage',            -- loss/spoilage
  'dispatch',           -- FG dispatched to customer
  'transfer'            -- internal transfer between locations
);

create table inventory_transactions (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id),
  item_id                     uuid not null references items(id),
  lot_id                      uuid references lot_numbers(id),
  tx_type                     inv_tx_type not null,
  quantity                    numeric not null,   -- positive = in, negative = out
  unit                        text not null,

  -- Reference to the source document
  reference_type              text,   -- 'production_order' | 'packing_order' | 'dispatch_record' etc.
  reference_id                uuid,

  notes                       text,
  created_by                  uuid references profiles(id),
  created_at                  timestamptz not null default now()
);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────

alter table tenants               enable row level security;
alter table profiles              enable row level security;
alter table items                 enable row level security;
alter table bom_headers           enable row level security;
alter table bom_lines             enable row level security;
alter table lot_numbers           enable row level security;
alter table demand_plans          enable row level security;
alter table demand_lines          enable row level security;
alter table mrp_results           enable row level security;
alter table production_orders     enable row level security;
alter table traceability_links    enable row level security;
alter table filling_orders        enable row level security;
alter table cooking_orders        enable row level security;
alter table packing_orders        enable row level security;
alter table dispatch_records      enable row level security;
alter table inventory_transactions enable row level security;

-- Helper: get current user's tenant_id
create or replace function my_tenant_id()
returns uuid language sql security definer stable as $$
  select tenant_id from profiles where id = auth.uid() limit 1;
$$;

-- Helper: is current user at least manager?
create or replace function is_manager_or_above()
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from profiles
    where id = auth.uid()
      and role in ('super_admin', 'admin', 'manager', 'planner')
  );
$$;

-- Helper: is current user admin or super_admin?
create or replace function is_admin_or_above()
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from profiles
    where id = auth.uid() and role in ('super_admin', 'admin')
  );
$$;

-- Tenants: only admins and super_admins can see/edit
create policy "tenants_select" on tenants for select using (
  id = my_tenant_id() or
  exists(select 1 from profiles where id = auth.uid() and role = 'super_admin')
);

-- Profiles: users see their own tenant's profiles
create policy "profiles_select" on profiles for select using (tenant_id = my_tenant_id());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());
create policy "profiles_update_admin" on profiles for update using (is_admin_or_above());

-- Items: all authenticated users in tenant can read; managers+ can write
create policy "items_select" on items for select using (tenant_id = my_tenant_id());
create policy "items_insert" on items for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "items_update" on items for update using (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "items_delete" on items for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

-- BOMs: same pattern
create policy "bom_headers_select" on bom_headers for select using (tenant_id = my_tenant_id());
create policy "bom_headers_insert" on bom_headers for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "bom_headers_update" on bom_headers for update using (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "bom_lines_select" on bom_lines for select using (
  exists(select 1 from bom_headers where id = bom_lines.bom_header_id and tenant_id = my_tenant_id())
);
create policy "bom_lines_insert" on bom_lines for insert with check (
  exists(select 1 from bom_headers where id = bom_lines.bom_header_id and tenant_id = my_tenant_id())
  and is_manager_or_above()
);
create policy "bom_lines_update" on bom_lines for update using (
  exists(select 1 from bom_headers where id = bom_lines.bom_header_id and tenant_id = my_tenant_id())
  and is_manager_or_above()
);
create policy "bom_lines_delete" on bom_lines for delete using (
  exists(select 1 from bom_headers where id = bom_lines.bom_header_id and tenant_id = my_tenant_id())
  and is_manager_or_above()
);

-- Lots
create policy "lots_select" on lot_numbers for select using (tenant_id = my_tenant_id());
create policy "lots_insert" on lot_numbers for insert with check (tenant_id = my_tenant_id());
create policy "lots_update" on lot_numbers for update using (tenant_id = my_tenant_id() and is_manager_or_above());

-- Demand plans & lines: all in tenant can read; planners+ can write
create policy "demand_plans_select" on demand_plans for select using (tenant_id = my_tenant_id());
create policy "demand_plans_insert" on demand_plans for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "demand_plans_update" on demand_plans for update using (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "demand_lines_select" on demand_lines for select using (
  exists(select 1 from demand_plans where id = demand_lines.demand_plan_id and tenant_id = my_tenant_id())
);
create policy "demand_lines_write" on demand_lines for all using (
  exists(select 1 from demand_plans where id = demand_lines.demand_plan_id and tenant_id = my_tenant_id())
);

-- MRP results
create policy "mrp_select" on mrp_results for select using (
  exists(select 1 from demand_plans where id = mrp_results.demand_plan_id and tenant_id = my_tenant_id())
);
create policy "mrp_write" on mrp_results for all using (
  exists(select 1 from demand_plans where id = mrp_results.demand_plan_id and tenant_id = my_tenant_id())
);

-- Production orders: all in tenant can read; managers+ can create/edit; dept staff can update status
create policy "prod_orders_select" on production_orders for select using (tenant_id = my_tenant_id());
create policy "prod_orders_insert" on production_orders for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());
create policy "prod_orders_update" on production_orders for update using (tenant_id = my_tenant_id());

-- Traceability
create policy "trace_select" on traceability_links for select using (
  exists(select 1 from production_orders where id = traceability_links.production_order_id and tenant_id = my_tenant_id())
);
create policy "trace_write" on traceability_links for all using (
  exists(select 1 from production_orders where id = traceability_links.production_order_id and tenant_id = my_tenant_id())
);

-- Filling, cooking, packing: all in tenant can read; anyone can update (floor recording)
create policy "filling_select" on filling_orders for select using (
  exists(select 1 from production_orders where id = filling_orders.production_order_id and tenant_id = my_tenant_id())
);
create policy "filling_write" on filling_orders for all using (
  exists(select 1 from production_orders where id = filling_orders.production_order_id and tenant_id = my_tenant_id())
);
create policy "cooking_select" on cooking_orders for select using (
  exists(select 1 from filling_orders fo
    join production_orders po on fo.production_order_id = po.id
    where fo.id = cooking_orders.filling_order_id and po.tenant_id = my_tenant_id())
);
create policy "cooking_write" on cooking_orders for all using (
  exists(select 1 from filling_orders fo
    join production_orders po on fo.production_order_id = po.id
    where fo.id = cooking_orders.filling_order_id and po.tenant_id = my_tenant_id())
);
create policy "packing_select" on packing_orders for select using (
  exists(
    select 1 from cooking_orders co
      join filling_orders fo on co.filling_order_id = fo.id
      join production_orders po on fo.production_order_id = po.id
      where co.id = packing_orders.cooking_order_id and po.tenant_id = my_tenant_id()
  ) or exists(
    select 1 from filling_orders fo
      join production_orders po on fo.production_order_id = po.id
      where fo.id = packing_orders.filling_order_id and po.tenant_id = my_tenant_id()
  )
);
create policy "packing_write" on packing_orders for all using (
  exists(
    select 1 from cooking_orders co
      join filling_orders fo on co.filling_order_id = fo.id
      join production_orders po on fo.production_order_id = po.id
      where co.id = packing_orders.cooking_order_id and po.tenant_id = my_tenant_id()
  ) or exists(
    select 1 from filling_orders fo
      join production_orders po on fo.production_order_id = po.id
      where fo.id = packing_orders.filling_order_id and po.tenant_id = my_tenant_id()
  )
);

-- Dispatch
create policy "dispatch_select" on dispatch_records for select using (tenant_id = my_tenant_id());
create policy "dispatch_write" on dispatch_records for all using (tenant_id = my_tenant_id());

-- Inventory
create policy "inv_select" on inventory_transactions for select using (tenant_id = my_tenant_id());
create policy "inv_insert" on inventory_transactions for insert with check (tenant_id = my_tenant_id());

-- ─── UPDATED-AT TRIGGERS ─────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_profiles_uat           before update on profiles           for each row execute procedure update_updated_at();
create trigger trg_items_uat              before update on items              for each row execute procedure update_updated_at();
create trigger trg_bom_headers_uat        before update on bom_headers        for each row execute procedure update_updated_at();
create trigger trg_lot_numbers_uat        before update on lot_numbers        for each row execute procedure update_updated_at();
create trigger trg_demand_plans_uat       before update on demand_plans       for each row execute procedure update_updated_at();
create trigger trg_production_orders_uat  before update on production_orders  for each row execute procedure update_updated_at();
create trigger trg_filling_orders_uat     before update on filling_orders     for each row execute procedure update_updated_at();
create trigger trg_cooking_orders_uat     before update on cooking_orders     for each row execute procedure update_updated_at();
create trigger trg_packing_orders_uat     before update on packing_orders     for each row execute procedure update_updated_at();

-- ─── MRP EXPLOSION FUNCTION ──────────────────────────────────────────────────
-- Calculates requirements for all items in a demand plan by walking the BOM tree.
-- Called server-side (service role) after the planner finalises demand lines.

create or replace function explode_mrp(p_demand_plan_id uuid)
returns void language plpgsql security definer as $$
declare
  v_tenant_id uuid;
begin
  -- Get tenant
  select tenant_id into v_tenant_id from demand_plans where id = p_demand_plan_id;

  -- Clear previous results
  delete from mrp_results where demand_plan_id = p_demand_plan_id;

  -- Recursive CTE to walk the BOM tree
  -- Start from demand lines (FG level) and explode down
  insert into mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, unit, standard_batch_size,
    suggested_batches, rounded_batches, planned_qty, surplus_qty
  )
  with recursive bom_explosion as (
    -- Base: finished goods from demand lines
    select
      dl.item_id,
      coalesce(dl.planned_qty_kg, dl.planned_weight_kg, 0) as required_qty,
      'finished_good'::text as level,
      0 as depth
    from demand_lines dl
    where dl.demand_plan_id = p_demand_plan_id

    union all

    -- Recurse: find components of each item via active BOM
    select
      bl.component_item_id as item_id,
      (be.required_qty / coalesce(bh.yield_factor, 1.0))
        * (bl.qty_per_batch / bh.reference_batch_size) as required_qty,
      i.department as level,
      be.depth + 1
    from bom_explosion be
    join bom_headers bh on bh.item_id = be.item_id and bh.is_active = true
    join bom_lines bl on bl.bom_header_id = bh.id
    join items i on i.id = bl.component_item_id
    where be.depth < 10  -- safety: max 10 levels deep
  )
  select
    p_demand_plan_id,
    be.item_id,
    coalesce(i.department, it.item_type::text) as department,
    (select id from bom_headers where item_id = be.item_id and is_active = true limit 1) as bom_id,
    sum(be.required_qty) as required_qty,
    i.unit,
    i.default_batch_size as standard_batch_size,
    case when i.default_batch_size > 0
      then sum(be.required_qty) / i.default_batch_size
      else null end as suggested_batches,
    case when i.default_batch_size > 0
      then ceil(sum(be.required_qty) / i.default_batch_size)::int
      else null end as rounded_batches,
    case when i.default_batch_size > 0
      then ceil(sum(be.required_qty) / i.default_batch_size) * i.default_batch_size
      else sum(be.required_qty) end as planned_qty,
    case when i.default_batch_size > 0
      then ceil(sum(be.required_qty) / i.default_batch_size) * i.default_batch_size - sum(be.required_qty)
      else 0 end as surplus_qty
  from bom_explosion be
  join items i on i.id = be.item_id
  join lateral (select item_type from items where id = be.item_id) it on true
  where be.item_id not in (select item_id from demand_lines where demand_plan_id = p_demand_plan_id)
  group by be.item_id, i.department, it.item_type, i.unit, i.default_batch_size;

end;
$$;

-- ─── BATCH NUMBER GENERATOR ──────────────────────────────────────────────────
-- Format: DDMMYYYY + item_code  e.g. "01042026-2015"

create or replace function generate_batch_number(p_item_code text, p_date date default current_date)
returns text language sql as $$
  select to_char(p_date, 'DDMMYYYY') || '-' || p_item_code;
$$;

-- ─── SEED DATA — GERMAN BUTCHERY ─────────────────────────────────────────────
-- Minimal seed so the app is usable out of the box.
-- Run the full data import separately via CSV once you're happy with the schema.

do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from tenants where subdomain = 'germanbutchery';

  -- Raw materials
  insert into items (tenant_id, code, name, item_type, unit, allergens, spec_storage_temp, spec_shelf_life, department)
  values
    (v_tenant_id, 'RM001', 'Pork 75CL',                  'raw_material', 'kg', '{}',           '0–4°C',   '5 days',   'production'),
    (v_tenant_id, 'RM002', 'Pork Shoulder (Bone-In)',     'raw_material', 'kg', '{}',           '0–4°C',   '5 days',   'production'),
    (v_tenant_id, 'RM003', 'Cutting Fat',                 'raw_material', 'kg', '{}',           '0–4°C',   '7 days',   'production'),
    (v_tenant_id, 'RM004', 'Chicken MDM',                 'raw_material', 'kg', '{}',           '0–4°C',   '3 days',   'production'),
    (v_tenant_id, 'RM005', 'Beef Brisket',                'raw_material', 'kg', '{}',           '0–4°C',   '5 days',   'production'),
    (v_tenant_id, 'RM006', 'Curing Salt #1 (Prague Pwd)', 'raw_material', 'kg', '{}',           'Ambient', '2 years',  'production'),
    (v_tenant_id, 'RM007', 'Sea Salt (Non-Iodised)',      'raw_material', 'kg', '{}',           'Ambient', '5 years',  'production'),
    (v_tenant_id, 'RM008', 'Black Pepper (Ground)',       'raw_material', 'kg', '{}',           'Ambient', '18 months','production'),
    (v_tenant_id, 'RM009', 'Garlic Powder',               'raw_material', 'kg', '{}',           'Ambient', '18 months','production'),
    (v_tenant_id, 'RM010', 'Dextrose',                    'raw_material', 'kg', '{}',           'Ambient', '2 years',  'production'),
    (v_tenant_id, 'RM011', 'Water',                       'raw_material', 'L',  '{}',           'Ambient', null,       'production'),
    (v_tenant_id, 'RM020', 'Pork Casings (32–35mm)',      'raw_material', 'm',  '{}',           '0–4°C',   '12 months','filling'),
    (v_tenant_id, 'RM021', 'Collagen Casings (22mm)',     'raw_material', 'm',  '{}',           'Ambient', '18 months','filling'),
    (v_tenant_id, 'RM022', 'Fibrous Casings (55mm)',      'raw_material', 'm',  '{}',           'Ambient', '24 months','filling'),
    (v_tenant_id, 'RM030', 'Vac Pack Film (500mm)',       'packaging',    'm',  '{}',           'Ambient', null,       'packing'),
    (v_tenant_id, 'RM031', 'Carton Box (Standard)',       'packaging',    'ea', '{}',           'Ambient', null,       'packing');

  -- WIP items (Chorizo example — matches the AppSheet screenshot)
  insert into items (tenant_id, code, name, item_type, unit, default_batch_size, batch_unit, allergens,
                     spec_storage_temp, spec_shelf_life, department, production_method, machine, room, priority)
  values
    (v_tenant_id, '2015', 'Chorizo - WIP', 'wip', 'kg', 750, 'kg', '{NITRITE,SOY}',
     '0–4°C', '2 days', 'production', 'mincing_mixing', 'LRG Mixer', 'Cutter Room', 4);

  -- Fill codes (children of 2015)
  insert into items (tenant_id, code, name, item_type, unit, allergens, spec_storage_temp, department,
                     production_method, weight_mode, target_weight_g)
  select
    v_tenant_id, code, name, 'fill', 'kg', '{NITRITE,SOY}', '0–4°C', 'filling', 'packing_only', 'fixed', target_g
  from (values
    ('2015.100', 'Chorizo - 100g Fill', 100),
    ('2015.125', 'Chorizo - 125g Fill', 125),
    ('2015.300', 'Chorizo - 300g Fill', 300),
    ('2015.630', 'Chorizo - 630g Fill (Bulk)', 630)
  ) t(code, name, target_g);

  -- Set parent of fill codes to the WIP
  update items set parent_item_id = (select id from items where code = '2015' and tenant_id = v_tenant_id)
  where tenant_id = v_tenant_id and code like '2015.%' and item_type = 'fill';

  -- Finished goods (children of fill codes)
  insert into items (tenant_id, code, name, item_type, unit, allergens, spec_storage_temp, spec_shelf_life,
                     department, production_method, weight_mode, target_weight_g, units_per_outer)
  values
    (v_tenant_id, '2015.100.1', 'Chorizo 100g × 5 Vac Pack',      'finished_good', 'ea', '{NITRITE,SOY}', '0–4°C', '21 days', 'packing', 'packing_only', 'fixed', 500,   12),
    (v_tenant_id, '2015.100.2', 'Chorizo 100g × 10 Vac Pack',     'finished_good', 'ea', '{NITRITE,SOY}', '0–4°C', '21 days', 'packing', 'packing_only', 'fixed', 1000,  10),
    (v_tenant_id, '2015.125.1', 'Chorizo 125g × 4 Vac Pack',      'finished_good', 'ea', '{NITRITE,SOY}', '0–4°C', '21 days', 'packing', 'packing_only', 'fixed', 500,   12),
    (v_tenant_id, '2015.300.1', 'Chorizo 300g Retail Vac',        'finished_good', 'ea', '{NITRITE,SOY}', '0–4°C', '21 days', 'packing', 'packing_only', 'fixed', 300,   20),
    (v_tenant_id, '2015.55',    'Chorizo Bulk 5kg',                'finished_good', 'kg', '{NITRITE,SOY}', '0–4°C', '14 days', 'packing', 'packing_only', 'random', null, null);

  -- Link FG codes to their fill parents
  update items set parent_item_id = (select id from items where code = '2015.100' and tenant_id = v_tenant_id)
  where tenant_id = v_tenant_id and code in ('2015.100.1','2015.100.2');
  update items set parent_item_id = (select id from items where code = '2015.125' and tenant_id = v_tenant_id)
  where tenant_id = v_tenant_id and code = '2015.125.1';
  update items set parent_item_id = (select id from items where code = '2015.300' and tenant_id = v_tenant_id)
  where tenant_id = v_tenant_id and code = '2015.300.1';
  update items set parent_item_id = (select id from items where code = '2015.630' and tenant_id = v_tenant_id)
  where tenant_id = v_tenant_id and code = '2015.55';

  -- Chorizo WIP BOM (per 750 kg batch)
  insert into bom_headers (tenant_id, item_id, version, reference_batch_size, reference_batch_unit, yield_factor)
  select v_tenant_id, id, 1, 750, 'kg', 1.0
  from items where code = '2015' and tenant_id = v_tenant_id;

  insert into bom_lines (bom_header_id, component_item_id, qty_per_batch, unit, percentage, grind_size, sort_order)
  select
    (select bh.id from bom_headers bh join items i on i.id = bh.item_id where i.code = '2015' and i.tenant_id = v_tenant_id limit 1),
    (select id from items where code = rm_code and tenant_id = v_tenant_id),
    qty, 'kg', pct, grind, ord
  from (values
    ('RM001', 406.75, 54.23, '8mm', 1),
    ('RM003', 111.45, 14.86, '8mm', 2),
    ('RM004',  69.18,  9.22, null,  3),
    ('RM007',  18.75,  2.50, null,  4),
    ('RM006',   2.25,  0.30, null,  5),
    ('RM010',   7.50,  1.00, null,  6),
    ('RM011',  47.00,  6.27, null,  7),
    ('RM008',   3.75,  0.50, null,  8),
    ('RM009',   3.00,  0.40, null,  9)
  ) t(rm_code, qty, pct, grind, ord);

end;
$$;
