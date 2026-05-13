-- ============================================================
-- Phase 1 — Item Master Extensions
-- Adds: tax codes, nutrition panel, accounting codes,
--        purchase UOM, and supplier reference fields.
-- ============================================================

-- ─── TAX CODES ───────────────────────────────────────────────────────────────
-- One row per tax code per tenant.
-- applies_to: 'purchase' | 'sales' | 'both'
-- Tenants in AUS typically need just 2: GST (10%) and GST-Free (0%).
-- EU tenants may have 3–5 VAT rates. Tenant manages this list themselves.

create table tax_codes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  name                  text not null,            -- e.g. "GST 10%", "GST-Free"
  rate_pct              numeric not null default 0 -- e.g. 10, 0
    check (rate_pct >= 0 and rate_pct <= 100),
  applies_to            text not null default 'both'
    check (applies_to in ('purchase', 'sales', 'both')),
  is_default_purchase   boolean not null default false,
  is_default_sales      boolean not null default false,
  is_active             boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(tenant_id, name)
);

alter table tax_codes enable row level security;

create policy "tax_codes_select" on tax_codes
  for select using (tenant_id = my_tenant_id());

create policy "tax_codes_insert" on tax_codes
  for insert with check (tenant_id = my_tenant_id() and is_admin_or_above());

create policy "tax_codes_update" on tax_codes
  for update using (tenant_id = my_tenant_id() and is_admin_or_above());

create policy "tax_codes_delete" on tax_codes
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

create trigger trg_tax_codes_uat
  before update on tax_codes
  for each row execute procedure update_updated_at();

-- ─── EXTEND ITEMS TABLE ──────────────────────────────────────────────────────

-- Tax code references
alter table items
  add column if not exists purchase_tax_code_id uuid references tax_codes(id),
  add column if not exists sales_tax_code_id    uuid references tax_codes(id);

-- Accounting codes (for Xero/MYOB/QuickBooks/DATEV export)
alter table items
  add column if not exists purchase_account_code text,   -- e.g. "300" (Cost of Sales)
  add column if not exists sales_account_code    text;   -- e.g. "200" (Revenue)

-- Purchase UOM (how you buy it: bin, bag, carton, etc.)
-- purchase_uom_qty: how many stock units are in one purchase unit
-- purchase_uom_type: 'fixed' = always exact qty; 'average' = weighed at receipt
alter table items
  add column if not exists purchase_uom          text,         -- e.g. 'bin', 'bag', 'carton', 'ea'
  add column if not exists purchase_uom_qty      numeric,      -- e.g. 30 (kg per bin)
  add column if not exists purchase_uom_type     text          -- 'fixed' | 'average'
    check (purchase_uom_type in ('fixed', 'average') or purchase_uom_type is null),
  add column if not exists purchase_unit_price   numeric,      -- price per purchase_uom (in purchase_currency)
  add column if not exists purchase_currency     text default 'AUD';

-- Nutrition panel — all values per 100g of product
alter table items
  add column if not exists nut_energy_kj         numeric,   -- kJ
  add column if not exists nut_energy_kcal        numeric,   -- kcal
  add column if not exists nut_protein_g          numeric,   -- g
  add column if not exists nut_fat_total_g        numeric,   -- g
  add column if not exists nut_fat_saturated_g    numeric,   -- g
  add column if not exists nut_fat_trans_g        numeric,   -- g (optional, regulatory)
  add column if not exists nut_carbs_total_g      numeric,   -- g
  add column if not exists nut_carbs_sugars_g     numeric,   -- g
  add column if not exists nut_fibre_g            numeric,   -- g
  add column if not exists nut_sodium_mg          numeric,   -- mg (note: mg not g)
  add column if not exists nut_per_serving_g      numeric,   -- serving size in grams (for per-serve column)
  add column if not exists nut_notes             text;       -- e.g. "Values are averages. Analysed by NATA lab."

-- ─── TENANTS EXTENSIONS ──────────────────────────────────────────────────────
-- Add default currency and country for multi-currency support in Phase 2+

alter table tenants
  add column if not exists country_code     text default 'AU',  -- ISO 3166-1 alpha-2
  add column if not exists default_currency text default 'AUD'; -- ISO 4217

-- ─── SEED DEFAULT AUS TAX CODES ──────────────────────────────────────────────

do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from tenants where subdomain = 'germanbutchery';

  -- Only insert if not already present (idempotent)
  insert into tax_codes (tenant_id, name, rate_pct, applies_to, is_default_purchase, is_default_sales, notes)
  values
    (v_tenant_id, 'GST 10%',   10, 'both', false, true,
     'Standard Australian GST rate. Applies to most processed food products (sausages, smallgoods, etc.) on sales. Applies to packaging, consumables on purchase.'),
    (v_tenant_id, 'GST-Free',   0, 'both', true,  false,
     'GST-free supply. Applies to basic foods (raw/unprocessed meat, spices) on purchase. Some bulk/unpackaged products may qualify on sales — confirm with your accountant.'),
    (v_tenant_id, 'Input-Taxed', 0, 'purchase', false, false,
     'No GST credit claimable. Rare — mainly applies to financial services. Available for edge cases.')
  on conflict (tenant_id, name) do nothing;

end;
$$;
