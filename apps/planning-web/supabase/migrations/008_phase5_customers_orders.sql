-- ============================================================
-- Phase 5 — Customers, Price Groups, Orders & Dispatch
-- ============================================================

-- ─── PRICE GROUPS ────────────────────────────────────────────────────────────

create table if not exists price_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  description text,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(tenant_id, name)
);

alter table price_groups enable row level security;

drop policy if exists "price_groups_select" on price_groups;
drop policy if exists "price_groups_write"  on price_groups;

create policy "price_groups_select" on price_groups
  for select using (tenant_id = my_tenant_id());

create policy "price_groups_write" on price_groups
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── PRICE GROUP LINES ───────────────────────────────────────────────────────

create table if not exists price_group_lines (
  id              uuid primary key default gen_random_uuid(),
  price_group_id  uuid not null references price_groups(id) on delete cascade,
  item_id         uuid not null references items(id),
  tenant_id       uuid not null references tenants(id),
  unit_price      numeric,
  discount_pct    numeric,
  currency        text default 'AUD',
  valid_from      date,
  valid_to        date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(price_group_id, item_id)
);

alter table price_group_lines enable row level security;

drop policy if exists "price_group_lines_select" on price_group_lines;
drop policy if exists "price_group_lines_write"  on price_group_lines;

create policy "price_group_lines_select" on price_group_lines
  for select using (tenant_id = my_tenant_id());

create policy "price_group_lines_write" on price_group_lines
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── CUSTOMERS ───────────────────────────────────────────────────────────────

create table if not exists customers (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  code                  text not null,
  name                  text not null,
  trading_name          text,
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
  currency              text default 'AUD',
  price_group_id        uuid references price_groups(id),
  payment_terms         text,
  account_number        text,
  tax_registration      text,
  sales_account_code    text,
  min_shelf_life_days   int,
  delivery_day          smallint check (delivery_day between 0 and 6),
  delivery_instructions text,
  notes                 text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(tenant_id, code)
);

alter table customers enable row level security;

drop policy if exists "customers_select" on customers;
drop policy if exists "customers_insert" on customers;
drop policy if exists "customers_update" on customers;
drop policy if exists "customers_delete" on customers;

create policy "customers_select" on customers
  for select using (tenant_id = my_tenant_id());

create policy "customers_insert" on customers
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "customers_update" on customers
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "customers_delete" on customers
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

drop trigger if exists trg_customers_uat on customers;
create trigger trg_customers_uat
  before update on customers
  for each row execute procedure update_updated_at();

-- ─── CUSTOMER ITEM OVERRIDES ─────────────────────────────────────────────────

create table if not exists customer_item_overrides (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  customer_id         uuid not null references customers(id) on delete cascade,
  item_id             uuid not null references items(id),
  min_shelf_life_days int,
  unit_price          numeric,
  currency            text default 'AUD',
  notes               text,
  created_at          timestamptz not null default now(),
  unique(customer_id, item_id)
);

alter table customer_item_overrides enable row level security;

drop policy if exists "cust_item_overrides_select" on customer_item_overrides;
drop policy if exists "cust_item_overrides_write"  on customer_item_overrides;

create policy "cust_item_overrides_select" on customer_item_overrides
  for select using (tenant_id = my_tenant_id());

create policy "cust_item_overrides_write" on customer_item_overrides
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── CUSTOMER ORDERS ─────────────────────────────────────────────────────────

do $$ begin
  create type order_channel as enum ('manual', 'phone', 'email', 'web', 'edi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type customer_order_status as enum (
    'draft', 'confirmed', 'in_production', 'ready', 'dispatched', 'invoiced', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists customer_orders (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  customer_id         uuid not null references customers(id),
  order_number        text not null,
  customer_po_number  text,
  channel             order_channel not null default 'manual',
  status              customer_order_status not null default 'draft',
  order_date          date not null default current_date,
  required_date       date,
  delivery_date       date,
  currency            text not null default 'AUD',
  notes               text,
  delivery_address    text,
  confirmed_by        uuid references profiles(id),
  confirmed_at        timestamptz,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(tenant_id, order_number)
);

alter table customer_orders enable row level security;

drop policy if exists "customer_orders_select" on customer_orders;
drop policy if exists "customer_orders_insert" on customer_orders;
drop policy if exists "customer_orders_update" on customer_orders;

create policy "customer_orders_select" on customer_orders
  for select using (tenant_id = my_tenant_id());

create policy "customer_orders_insert" on customer_orders
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

create policy "customer_orders_update" on customer_orders
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_customer_orders_uat on customer_orders;
create trigger trg_customer_orders_uat
  before update on customer_orders
  for each row execute procedure update_updated_at();

-- ─── CUSTOMER ORDER LINES ────────────────────────────────────────────────────

create table if not exists customer_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  customer_order_id   uuid not null references customer_orders(id) on delete cascade,
  tenant_id           uuid not null references tenants(id),
  item_id             uuid not null references items(id),
  line_number         int not null default 1,
  qty_units           int,
  qty_kg              numeric,
  unit_price          numeric,
  line_total          numeric,
  currency            text default 'AUD',
  sales_tax_code_id   uuid references tax_codes(id),
  tax_amount          numeric,
  dispatched_units    int,
  dispatched_kg       numeric,
  notes               text,
  created_at          timestamptz not null default now()
);

alter table customer_order_lines enable row level security;

drop policy if exists "order_lines_select" on customer_order_lines;
drop policy if exists "order_lines_write"  on customer_order_lines;

create policy "order_lines_select" on customer_order_lines
  for select using (tenant_id = my_tenant_id());

create policy "order_lines_write" on customer_order_lines
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── DISPATCH INVOICES ───────────────────────────────────────────────────────

do $$ begin
  create type invoice_status as enum ('draft', 'sent', 'paid', 'void');
exception when duplicate_object then null; end $$;

create table if not exists invoices (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  customer_id         uuid not null references customers(id),
  customer_order_id   uuid references customer_orders(id),
  invoice_number      text not null,
  invoice_date        date not null default current_date,
  due_date            date,
  status              invoice_status not null default 'draft',
  currency            text not null default 'AUD',
  subtotal            numeric,
  tax_total           numeric,
  total               numeric,
  notes               text,
  external_ref        text,
  exported_at         timestamptz,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(tenant_id, invoice_number)
);

alter table invoices enable row level security;

drop policy if exists "invoices_select" on invoices;
drop policy if exists "invoices_write"  on invoices;

create policy "invoices_select" on invoices
  for select using (tenant_id = my_tenant_id());

create policy "invoices_write" on invoices
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_invoices_uat on invoices;
create trigger trg_invoices_uat
  before update on invoices
  for each row execute procedure update_updated_at();

-- ─── SEED DEFAULT PRICE GROUPS ───────────────────────────────────────────────

do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from tenants where subdomain = 'germanbutchery';

  insert into price_groups (tenant_id, name, description, is_default) values
    (v_tenant_id, 'Retail',     'Retail / walk-in customers',              false),
    (v_tenant_id, 'Wholesale',  'Wholesale — standard discount customers', true),
    (v_tenant_id, 'Export',     'Export customers — special pricing',       false)
  on conflict (tenant_id, name) do nothing;
end;
$$;
