-- ============================================================
-- Phase 2 — Suppliers
-- Adds: suppliers master, supplier_items (catalogue lines),
--        currencies table.
-- ============================================================

-- ─── CURRENCIES ──────────────────────────────────────────────────────────────
-- Global list of supported currencies. Seed the most common ones.
-- Tenants pick their default from tenants.default_currency (added in 005).

create table if not exists currencies (
  code          text primary key,   -- ISO 4217 (AUD, USD, EUR, GBP, NZD, etc.)
  name          text not null,
  symbol        text not null,
  decimal_places int not null default 2
);

insert into currencies (code, name, symbol, decimal_places) values
  ('AUD', 'Australian Dollar',   'A$',  2),
  ('USD', 'US Dollar',           '$',   2),
  ('EUR', 'Euro',                '€',   2),
  ('GBP', 'British Pound',       '£',   2),
  ('NZD', 'New Zealand Dollar',  'NZ$', 2),
  ('CAD', 'Canadian Dollar',     'CA$', 2),
  ('CHF', 'Swiss Franc',         'Fr',  2),
  ('JPY', 'Japanese Yen',        '¥',   0),
  ('CNY', 'Chinese Yuan',        '¥',   2),
  ('HKD', 'Hong Kong Dollar',    'HK$', 2),
  ('SGD', 'Singapore Dollar',    'S$',  2),
  ('DKK', 'Danish Krone',        'kr',  2),
  ('NOK', 'Norwegian Krone',     'kr',  2),
  ('SEK', 'Swedish Krona',       'kr',  2),
  ('PLN', 'Polish Złoty',        'zł',  2),
  ('CZK', 'Czech Koruna',        'Kč',  2),
  ('HUF', 'Hungarian Forint',    'Ft',  0),
  ('ZAR', 'South African Rand',  'R',   2)
on conflict (code) do nothing;

-- ─── SUPPLIERS ───────────────────────────────────────────────────────────────

create table if not exists suppliers (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  code                  text not null,              -- short internal code, e.g. "SUP001"
  name                  text not null,
  trading_name          text,                       -- "trading as" if different
  contact_name          text,
  phone                 text,
  email                 text,
  website               text,
  address_line1         text,
  address_line2         text,
  city                  text,
  state                 text,
  postcode              text,
  country_code          text default 'AU',
  currency              text not null default 'AUD' references currencies(code),
  payment_terms         text,                       -- e.g. "Net 30", "COD", "7 days EOM"
  account_number        text,                       -- our account number with this supplier
  tax_registration      text,                       -- supplier's ABN / VAT number
  purchase_account_code text,                       -- default accounting code for this supplier
  notes                 text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(tenant_id, code)
);

alter table suppliers enable row level security;

drop policy if exists "suppliers_select" on suppliers;
drop policy if exists "suppliers_insert" on suppliers;
drop policy if exists "suppliers_update" on suppliers;
drop policy if exists "suppliers_delete" on suppliers;

create policy "suppliers_select" on suppliers
  for select using (tenant_id = my_tenant_id());

create policy "suppliers_insert" on suppliers
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "suppliers_update" on suppliers
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "suppliers_delete" on suppliers
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

drop trigger if exists trg_suppliers_uat on suppliers;
create trigger trg_suppliers_uat
  before update on suppliers
  for each row execute procedure update_updated_at();

-- ─── SUPPLIER ITEMS (Catalogue Lines) ────────────────────────────────────────
-- One row per item per supplier. Multiple suppliers can supply the same item.
-- is_preferred = the default supplier shown in purchasing/goods-in screens.

create table if not exists supplier_items (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  supplier_id           uuid not null references suppliers(id) on delete cascade,
  item_id               uuid not null references items(id),

  supplier_item_code    text,        -- supplier's own SKU / product code
  supplier_item_name    text,        -- supplier's description (may differ from our name)

  -- Pricing
  unit_price            numeric,     -- price per purchase_uom (or per stock unit if no purchase UOM)
  currency              text default 'AUD' references currencies(code),
  price_valid_from      date,
  price_valid_to        date,

  -- Purchase UOM override (overrides items.purchase_uom if set)
  purchase_uom          text,        -- e.g. 'bin', 'bag'
  purchase_uom_qty      numeric,     -- units per purchase pack (kg per bin etc.)
  purchase_uom_type     text check (purchase_uom_type in ('fixed', 'average') or purchase_uom_type is null),

  -- Order constraints
  min_order_qty         numeric,     -- minimum order quantity (in purchase_uom or stock unit)
  lead_time_days        int,         -- typical lead time from order to delivery

  is_preferred          boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(supplier_id, item_id)
);

alter table supplier_items enable row level security;

drop policy if exists "supplier_items_select" on supplier_items;
drop policy if exists "supplier_items_insert" on supplier_items;
drop policy if exists "supplier_items_update" on supplier_items;
drop policy if exists "supplier_items_delete" on supplier_items;

create policy "supplier_items_select" on supplier_items
  for select using (tenant_id = my_tenant_id());

create policy "supplier_items_insert" on supplier_items
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "supplier_items_update" on supplier_items
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "supplier_items_delete" on supplier_items
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_supplier_items_uat on supplier_items;
create trigger trg_supplier_items_uat
  before update on supplier_items
  for each row execute procedure update_updated_at();

-- ─── LINK PREFERRED SUPPLIER TO ITEMS ────────────────────────────────────────
-- Convenience: items.preferred_supplier_id points to the preferred supplier.
-- Updated automatically via trigger or manually via the UI.

alter table items
  add column if not exists preferred_supplier_id uuid references suppliers(id);
