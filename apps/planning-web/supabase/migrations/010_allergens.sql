-- ============================================================
-- Migration 010 — Allergen Definitions + Tenant Settings
-- ============================================================

-- ─── ALLERGEN DEFINITIONS (global reference, not per-tenant) ─────────────────
-- Admins can also add custom entries (regulatory_standard = 'CUSTOM')

create table if not exists allergen_definitions (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,            -- e.g. 'MILK', 'GLUTEN_WHEAT'
  name                 text not null,                   -- Display name
  description          text,                            -- e.g. 'includes butter, cream, cheese'
  regulatory_standard  text not null default 'FSANZ',  -- FSANZ | EU | FDA | CUSTOM
  sort_order           int  not null default 0,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

-- ─── TENANT ALLERGEN STANDARDS ───────────────────────────────────────────────
-- Which regulatory standards a tenant follows (drives which allergens appear on labels/exports)

create table if not exists tenant_allergen_settings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) unique,
  active_standards     text[] not null default '{FSANZ}',  -- e.g. '{FSANZ,EU}'
  updated_at           timestamptz not null default now()
);

alter table allergen_definitions    enable row level security;
alter table tenant_allergen_settings enable row level security;

-- allergen_definitions: everyone can read (global reference data)
drop policy if exists "allergen_defs_select" on allergen_definitions;
create policy "allergen_defs_select" on allergen_definitions
  for select using (true);

drop policy if exists "allergen_defs_insert" on allergen_definitions;
create policy "allergen_defs_insert" on allergen_definitions
  for insert with check (is_manager_or_above());

drop policy if exists "allergen_defs_update" on allergen_definitions;
create policy "allergen_defs_update" on allergen_definitions
  for update using (is_manager_or_above());

-- tenant settings
drop policy if exists "tenant_allergen_settings_select" on tenant_allergen_settings;
create policy "tenant_allergen_settings_select" on tenant_allergen_settings
  for select using (tenant_id = my_tenant_id());

drop policy if exists "tenant_allergen_settings_upsert" on tenant_allergen_settings;
create policy "tenant_allergen_settings_upsert" on tenant_allergen_settings
  for all using (tenant_id = my_tenant_id() and is_manager_or_above())
  with check (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── SEED DATA ───────────────────────────────────────────────────────────────

-- FSANZ (Australia & New Zealand) — 14 priority allergens
insert into allergen_definitions (code, name, description, regulatory_standard, sort_order) values
  ('FSANZ_MILK',        'Milk',                       'Cow milk and all milk products (butter, cream, cheese, yoghurt, whey, casein, lactose)',  'FSANZ', 1),
  ('FSANZ_EGG',         'Egg',                        'Egg and egg products',                                                                    'FSANZ', 2),
  ('FSANZ_FISH',        'Fish',                       'Fish and fish products (finfish only)',                                                   'FSANZ', 3),
  ('FSANZ_CRUSTACEAN',  'Crustacea',                  'Prawns, crabs, lobsters, crayfish, and their products',                                   'FSANZ', 4),
  ('FSANZ_MOLLUSC',     'Mollusc',                    'Oysters, mussels, scallops, squid, abalone and their products',                           'FSANZ', 5),
  ('FSANZ_WHEAT',       'Wheat / Gluten',             'Wheat, rye, barley, oats, spelt, and related cereals containing gluten',                  'FSANZ', 6),
  ('FSANZ_SOY',         'Soy',                        'Soybeans and soy products (tofu, tempeh, miso, soy sauce)',                               'FSANZ', 7),
  ('FSANZ_PEANUT',      'Peanut',                     'Peanuts and peanut products (includes groundnut)',                                        'FSANZ', 8),
  ('FSANZ_TREE_NUTS',   'Tree Nuts',                  'Almonds, cashews, hazelnuts, walnuts, pecans, pistachios, macadamias, pine nuts, brazil nuts', 'FSANZ', 9),
  ('FSANZ_SESAME',      'Sesame Seeds',               'Sesame seeds and products (tahini, sesame oil)',                                          'FSANZ', 10),
  ('FSANZ_LUPIN',       'Lupin',                      'Lupin flour and seeds (found in some gluten-free products and pasta)',                     'FSANZ', 11),
  ('FSANZ_SULPHITES',   'Sulphites / Sulphur Dioxide','Sulphur dioxide and sulphites at concentrations >10 mg/kg (SO2 equivalent)',              'FSANZ', 12),
  ('FSANZ_BEE_POLLEN',  'Bee Pollen',                 'Bee pollen as a food ingredient or supplement',                                          'FSANZ', 13),
  ('FSANZ_ROYAL_JELLY', 'Royal Jelly',                'Royal jelly as a food ingredient or supplement',                                         'FSANZ', 14)
on conflict (code) do nothing;

-- EU — 14 major allergens (EU 1169/2011)
insert into allergen_definitions (code, name, description, regulatory_standard, sort_order) values
  ('EU_GLUTEN',         'Cereals Containing Gluten',  'Wheat, rye, barley, oats, spelt, kamut and hybridised strains',                          'EU', 1),
  ('EU_CRUSTACEAN',     'Crustaceans',                'Crustaceans and products thereof',                                                       'EU', 2),
  ('EU_EGG',            'Eggs',                       'Eggs and products thereof',                                                              'EU', 3),
  ('EU_FISH',           'Fish',                       'Fish and products thereof',                                                              'EU', 4),
  ('EU_PEANUT',         'Peanuts',                    'Peanuts and products thereof',                                                           'EU', 5),
  ('EU_SOY',            'Soybeans',                   'Soybeans and products thereof',                                                          'EU', 6),
  ('EU_MILK',           'Milk',                       'Milk and products thereof (including lactose)',                                          'EU', 7),
  ('EU_NUTS',           'Nuts',                       'Almonds, hazelnuts, walnuts, cashews, pecans, brazil nuts, pistachios, macadamia',        'EU', 8),
  ('EU_CELERY',         'Celery',                     'Celery and products thereof',                                                            'EU', 9),
  ('EU_MUSTARD',        'Mustard',                    'Mustard and products thereof',                                                           'EU', 10),
  ('EU_SESAME',         'Sesame Seeds',               'Sesame seeds and products thereof',                                                      'EU', 11),
  ('EU_SULPHITES',      'Sulphur Dioxide',            'Sulphur dioxide and sulphites at concentrations >10 mg/kg SO2 equivalent',               'EU', 12),
  ('EU_LUPIN',          'Lupin',                      'Lupin and products thereof',                                                             'EU', 13),
  ('EU_MOLLUSC',        'Molluscs',                   'Molluscs and products thereof',                                                          'EU', 14)
on conflict (code) do nothing;

-- FDA (US) — Top 9 major food allergens (FALCPA + FASTER Act 2023)
insert into allergen_definitions (code, name, description, regulatory_standard, sort_order) values
  ('FDA_MILK',          'Milk',                       'Milk and dairy products',                                                                'FDA', 1),
  ('FDA_EGG',           'Eggs',                       'Eggs and egg products',                                                                  'FDA', 2),
  ('FDA_FISH',          'Fish',                       'Bass, flounder, cod and other finfish',                                                  'FDA', 3),
  ('FDA_CRUSTACEAN',    'Crustacean Shellfish',        'Crab, lobster, shrimp and other crustacean shellfish',                                   'FDA', 4),
  ('FDA_TREE_NUTS',     'Tree Nuts',                  'Almonds, cashews, hazelnuts, pecans, pistachios, walnuts',                               'FDA', 5),
  ('FDA_WHEAT',         'Wheat',                      'Wheat and wheat products',                                                               'FDA', 6),
  ('FDA_PEANUT',        'Peanuts',                    'Peanuts and peanut products',                                                            'FDA', 7),
  ('FDA_SOY',           'Soybeans',                   'Soybeans and soy products',                                                              'FDA', 8),
  ('FDA_SESAME',        'Sesame',                     'Sesame seeds and sesame products (added 2023 under FASTER Act)',                          'FDA', 9)
on conflict (code) do nothing;
