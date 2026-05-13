-- ============================================================
-- Phase 3 — Production Execution Extensions
-- Adds: wastage records, scan events log, batch number config,
--        production sub-operations, goods-in receipts.
-- ============================================================

-- ─── BATCH NUMBER FORMAT CONFIG ──────────────────────────────────────────────
alter table tenants
  add column if not exists batch_number_format text default '{YY}{DOY}{ITEM_CODE}',
  add column if not exists batch_seq_length    int  default 3;

-- ─── PRODUCTION SUB-OPERATIONS ────────────────────────────────────────────────

create table if not exists production_sub_operations (
  id                      uuid primary key default gen_random_uuid(),
  production_order_id     uuid not null references production_orders(id) on delete cascade,
  name                    text not null,
  sequence                int not null default 1,
  machine                 text,
  operator_name           text,
  started_at              timestamptz,
  completed_at            timestamptz,
  planned_qty             numeric,
  actual_qty              numeric,
  unit                    text default 'kg',
  notes                   text,
  status                  order_status not null default 'planned',
  created_at              timestamptz not null default now()
);

alter table production_sub_operations enable row level security;

drop policy if exists "sub_ops_select" on production_sub_operations;
drop policy if exists "sub_ops_write"  on production_sub_operations;

create policy "sub_ops_select" on production_sub_operations
  for select using (
    exists(select 1 from production_orders where id = production_sub_operations.production_order_id and tenant_id = my_tenant_id())
  );

create policy "sub_ops_write" on production_sub_operations
  for all using (
    exists(select 1 from production_orders where id = production_sub_operations.production_order_id and tenant_id = my_tenant_id())
  );

-- ─── WASTAGE RECORDS ─────────────────────────────────────────────────────────

do $$ begin
  create type wastage_stage as enum (
    'production', 'filling', 'cooking', 'packing', 'receiving', 'storage', 'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists wastage_records (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  item_id                 uuid not null references items(id),
  lot_id                  uuid references lot_numbers(id),
  stage                   wastage_stage not null,
  reason_code             text,
  description             text,
  weight_kg               numeric,
  unit_count              int,
  unit                    text default 'kg',
  production_order_id     uuid references production_orders(id),
  filling_order_id        uuid references filling_orders(id),
  packing_order_id        uuid references packing_orders(id),
  recorded_by             uuid references profiles(id),
  recorded_at             timestamptz not null default now(),
  notes                   text,
  created_at              timestamptz not null default now()
);

alter table wastage_records enable row level security;

drop policy if exists "wastage_select" on wastage_records;
drop policy if exists "wastage_insert" on wastage_records;
drop policy if exists "wastage_update" on wastage_records;

create policy "wastage_select" on wastage_records
  for select using (tenant_id = my_tenant_id());

create policy "wastage_insert" on wastage_records
  for insert with check (tenant_id = my_tenant_id());

create policy "wastage_update" on wastage_records
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── SCAN EVENTS UNIVERSAL LOG ────────────────────────────────────────────────

do $$ begin
  create type scan_purpose as enum (
    'goods_in', 'lot_issuance', 'production_complete', 'dispatch_pick', 'stocktake', 'quality_check', 'unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type scan_source as enum ('camera', 'hid', 'manual');
exception when duplicate_object then null; end $$;

create table if not exists scan_events (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  barcode                 text not null,
  barcode_type            text,
  item_id                 uuid references items(id),
  lot_id                  uuid references lot_numbers(id),
  purpose                 scan_purpose not null default 'unknown',
  source                  scan_source not null default 'manual',
  processed_into_type     text,
  processed_into_id       uuid,
  is_processed            boolean not null default false,
  scanned_by              uuid references profiles(id),
  device_id               text,
  scanned_at              timestamptz not null default now(),
  notes                   text,
  created_at              timestamptz not null default now()
);

alter table scan_events enable row level security;

drop policy if exists "scan_events_select" on scan_events;
drop policy if exists "scan_events_insert" on scan_events;
drop policy if exists "scan_events_update" on scan_events;

create policy "scan_events_select" on scan_events
  for select using (tenant_id = my_tenant_id());

create policy "scan_events_insert" on scan_events
  for insert with check (tenant_id = my_tenant_id());

create policy "scan_events_update" on scan_events
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

create index if not exists scan_events_barcode_idx      on scan_events(tenant_id, barcode);
create index if not exists scan_events_unprocessed_idx  on scan_events(tenant_id, is_processed) where is_processed = false;

-- ─── GOODS IN RECEIPTS ────────────────────────────────────────────────────────

do $$ begin
  create type receipt_status as enum ('draft', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists goods_in_receipts (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id),
  supplier_id             uuid references suppliers(id),
  receipt_number          text,
  supplier_delivery_ref   text,
  received_date           date not null default current_date,
  received_by             uuid references profiles(id),
  status                  receipt_status not null default 'draft',
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table goods_in_receipts enable row level security;

drop policy if exists "goods_in_select" on goods_in_receipts;
drop policy if exists "goods_in_insert" on goods_in_receipts;
drop policy if exists "goods_in_update" on goods_in_receipts;

create policy "goods_in_select" on goods_in_receipts
  for select using (tenant_id = my_tenant_id());

create policy "goods_in_insert" on goods_in_receipts
  for insert with check (tenant_id = my_tenant_id());

create policy "goods_in_update" on goods_in_receipts
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_goods_in_uat on goods_in_receipts;
create trigger trg_goods_in_uat
  before update on goods_in_receipts
  for each row execute procedure update_updated_at();

create table if not exists goods_in_lines (
  id                      uuid primary key default gen_random_uuid(),
  goods_in_receipt_id     uuid not null references goods_in_receipts(id) on delete cascade,
  item_id                 uuid not null references items(id),
  supplier_lot            text,
  supplier_barcode        text,
  purchase_uom            text,
  n_purchase_units        int,
  purchase_uom_qty_each   numeric,
  qty_received            numeric not null,
  unit                    text not null default 'kg',
  received_date           date,
  best_before_date        date,
  use_by_date             date,
  lot_id                  uuid references lot_numbers(id),
  unit_price              numeric,
  currency                text default 'AUD',
  total_price             numeric,
  is_quarantined          boolean not null default false,
  quarantine_reason       text,
  notes                   text,
  created_at              timestamptz not null default now()
);

alter table goods_in_lines enable row level security;

drop policy if exists "goods_in_lines_select" on goods_in_lines;
drop policy if exists "goods_in_lines_write"  on goods_in_lines;

create policy "goods_in_lines_select" on goods_in_lines
  for select using (
    exists(select 1 from goods_in_receipts where id = goods_in_lines.goods_in_receipt_id and tenant_id = my_tenant_id())
  );

create policy "goods_in_lines_write" on goods_in_lines
  for all using (
    exists(select 1 from goods_in_receipts where id = goods_in_lines.goods_in_receipt_id and tenant_id = my_tenant_id())
  );

-- ─── WASTAGE REASON CODES ────────────────────────────────────────────────────

create table if not exists wastage_reasons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null,
  description text not null,
  stage       wastage_stage,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  unique(tenant_id, code)
);

alter table wastage_reasons enable row level security;

drop policy if exists "wastage_reasons_select" on wastage_reasons;
drop policy if exists "wastage_reasons_write"  on wastage_reasons;

create policy "wastage_reasons_select" on wastage_reasons
  for select using (tenant_id = my_tenant_id());

create policy "wastage_reasons_write" on wastage_reasons
  for all using (tenant_id = my_tenant_id() and is_manager_or_above());

-- Seed default reason codes
do $$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from tenants where subdomain = 'germanbutchery';

  insert into wastage_reasons (tenant_id, code, description, stage, sort_order) values
    (v_tenant_id, 'OVERWEIGHT',       'Overweight — exceeds give-away limit',    'packing',    1),
    (v_tenant_id, 'UNDERWEIGHT',      'Underweight — below tolerance',            'packing',    2),
    (v_tenant_id, 'MISPRINT',         'Mislabelled or misprinted label',          'packing',    3),
    (v_tenant_id, 'SEAL_FAIL',        'Vacuum seal failure',                      'packing',    4),
    (v_tenant_id, 'DAMAGED_CASING',   'Burst / damaged casing',                   'filling',    5),
    (v_tenant_id, 'COOK_LOSS',        'Excess cook loss beyond yield target',      'cooking',    6),
    (v_tenant_id, 'SPOILAGE',         'Spoilage / end of shelf life',             'storage',    7),
    (v_tenant_id, 'FOREIGN_BODY',     'Foreign body detected — product recalled', null,         8),
    (v_tenant_id, 'SPILLAGE',         'Accidental spillage during production',     'production', 9),
    (v_tenant_id, 'DAMAGED_DELIVERY', 'Damaged on delivery from supplier',         'receiving',  10),
    (v_tenant_id, 'OTHER',            'Other — see notes',                        null,         99)
  on conflict (tenant_id, code) do nothing;
end;
$$;
