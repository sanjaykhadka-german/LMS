-- ============================================================
-- Migration 015 — Barcodes
-- item_barcodes: multiple barcodes per item (internal/GS1/supplier)
-- tenant_barcode_pool: tenant's GS1 barcode inventory to assign from
-- ============================================================

-- ─── TENANT BARCODE POOL ─────────────────────────────────────────────────────
-- GS1-allocated barcodes owned by the tenant, assigned to items as needed.

create table if not exists tenant_barcode_pool (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  barcode_value   text not null,
  barcode_format  text not null default 'ean13'
                    check (barcode_format in ('ean13','ean8','upc_a','itf14','gs1_128')),
  status          text not null default 'available'
                    check (status in ('available','assigned','reserved','retired')),
  assigned_item_id uuid references items(id) on delete set null,
  assigned_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  unique(tenant_id, barcode_value)
);

create index if not exists pool_tenant_idx  on tenant_barcode_pool(tenant_id);
create index if not exists pool_status_idx  on tenant_barcode_pool(tenant_id, status);
create index if not exists pool_item_idx    on tenant_barcode_pool(assigned_item_id);

alter table tenant_barcode_pool enable row level security;

drop policy if exists "pool_select" on tenant_barcode_pool;
create policy "pool_select" on tenant_barcode_pool
  for select using (tenant_id = my_tenant_id());

drop policy if exists "pool_insert" on tenant_barcode_pool;
create policy "pool_insert" on tenant_barcode_pool
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "pool_update" on tenant_barcode_pool;
create policy "pool_update" on tenant_barcode_pool
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "pool_delete" on tenant_barcode_pool;
create policy "pool_delete" on tenant_barcode_pool
  for delete using (tenant_id = my_tenant_id() and is_admin_or_above());

-- ─── ITEM BARCODES ───────────────────────────────────────────────────────────
-- Multiple barcodes per item. Types:
--   internal  = company's own internal barcode (Code128, QR, etc.)
--   gs1       = from the tenant's GS1 pool (EAN-13, etc.)
--   supplier  = supplier's own barcode for this item

create table if not exists item_barcodes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  item_id         uuid not null references items(id) on delete cascade,
  barcode_type    text not null default 'internal'
                    check (barcode_type in ('internal','gs1','supplier')),
  barcode_format  text not null default 'code128'
                    check (barcode_format in ('ean13','ean8','upc_a','itf14','code128','qr','gs1_128','datamatrix')),
  barcode_value   text not null,
  supplier_id     uuid references suppliers(id) on delete set null,  -- populated for type=supplier
  pool_id         uuid references tenant_barcode_pool(id) on delete set null, -- populated for type=gs1
  description     text,       -- optional label e.g. "Retail 500g" or "Coles EDI code"
  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  -- Note: uniqueness enforced via partial indexes below, not a simple unique constraint,
  -- because supplier barcodes are unique per (tenant, supplier) not globally per tenant.
  constraint item_barcodes_no_self_ref check (true) -- placeholder, see indexes below
);

create index if not exists item_barcodes_item_idx     on item_barcodes(item_id);
create index if not exists item_barcodes_tenant_idx   on item_barcodes(tenant_id);
create index if not exists item_barcodes_supplier_idx on item_barcodes(supplier_id);

-- Internal + GS1 barcodes: globally unique within the tenant
-- (you don't want the same internal barcode on two different items)
create unique index if not exists item_barcodes_internal_unique
  on item_barcodes(tenant_id, barcode_value)
  where barcode_type in ('internal', 'gs1');

-- Supplier barcodes: unique per tenant + supplier
-- (Supplier A and Supplier B can both use barcode "9300675012345" for different items,
--  but the same supplier cannot have the same barcode on two different items)
create unique index if not exists item_barcodes_supplier_unique
  on item_barcodes(tenant_id, supplier_id, barcode_value)
  where barcode_type = 'supplier';

alter table item_barcodes enable row level security;

drop policy if exists "item_barcodes_select" on item_barcodes;
create policy "item_barcodes_select" on item_barcodes
  for select using (tenant_id = my_tenant_id());

drop policy if exists "item_barcodes_insert" on item_barcodes;
create policy "item_barcodes_insert" on item_barcodes
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "item_barcodes_update" on item_barcodes;
create policy "item_barcodes_update" on item_barcodes
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "item_barcodes_delete" on item_barcodes;
create policy "item_barcodes_delete" on item_barcodes
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

-- ─── AUTO-UPDATE POOL STATUS ON BARCODE ASSIGN/REMOVE ────────────────────────
-- When a gs1 barcode is inserted/deleted, sync the pool row status.

create or replace function fn_sync_barcode_pool()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and NEW.barcode_type = 'gs1' and NEW.pool_id is not null then
    update tenant_barcode_pool
    set status = 'assigned', assigned_item_id = NEW.item_id, assigned_at = now()
    where id = NEW.pool_id;

  elsif TG_OP = 'DELETE' and OLD.barcode_type = 'gs1' and OLD.pool_id is not null then
    update tenant_barcode_pool
    set status = 'available', assigned_item_id = null, assigned_at = null
    where id = OLD.pool_id;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_barcode_pool on item_barcodes;
create trigger trg_sync_barcode_pool
  after insert or delete on item_barcodes
  for each row execute procedure fn_sync_barcode_pool();

-- ─── ENSURE ONLY ONE PRIMARY BARCODE PER ITEM ────────────────────────────────
create or replace function fn_enforce_primary_barcode()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.is_primary then
    update item_barcodes
    set is_primary = false
    where item_id = NEW.item_id and id != NEW.id and is_primary = true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_primary_barcode on item_barcodes;
create trigger trg_primary_barcode
  after insert or update of is_primary on item_barcodes
  for each row when (NEW.is_primary = true)
  execute procedure fn_enforce_primary_barcode();

-- ─── AUDIT ───────────────────────────────────────────────────────────────────
drop trigger if exists trg_item_barcodes_audit on item_barcodes;
create trigger trg_item_barcodes_audit
  after insert or update or delete on item_barcodes
  for each row execute procedure fn_audit_log();

-- ─── ITEM SPEC DOCUMENTS ─────────────────────────────────────────────────────
-- Primarily for raw material specs (TDS, CoA, SDS, allergen declarations etc.)
-- but available for any item type.

create table if not exists item_spec_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  item_id         uuid not null references items(id) on delete cascade,
  document_type   text not null default 'spec_sheet'
                    check (document_type in (
                      'spec_sheet',      -- Technical Data Sheet / Product Spec
                      'coa',             -- Certificate of Analysis
                      'sds',             -- Safety Data Sheet
                      'allergen_decl',   -- Allergen Declaration
                      'nutritional',     -- Nutritional Analysis
                      'micro_report',    -- Microbiological Report
                      'supplier_spec',   -- Supplier specification document
                      'other'
                    )),
  title           text not null,
  version         text,                  -- e.g. "v2", "Jan 2025"
  effective_date  date,
  expiry_date     date,                  -- for CoAs, certs etc.
  supplier_id     uuid references suppliers(id) on delete set null,
  document_url    text not null,         -- Supabase Storage path
  document_name   text not null,         -- original filename
  file_size_bytes bigint,
  mime_type       text,
  -- Extracted spec values (populated by AI after upload)
  extracted_data  jsonb,                 -- raw AI extraction result
  extraction_status text default 'pending'
                    check (extraction_status in ('pending','processing','done','failed','skipped')),
  uploaded_by     uuid references profiles(id),
  created_at      timestamptz not null default now()
);

create index if not exists item_spec_docs_item_idx   on item_spec_documents(item_id);
create index if not exists item_spec_docs_tenant_idx on item_spec_documents(tenant_id);
create index if not exists item_spec_docs_type_idx   on item_spec_documents(item_id, document_type);

alter table item_spec_documents enable row level security;

drop policy if exists "item_spec_docs_select" on item_spec_documents;
create policy "item_spec_docs_select" on item_spec_documents
  for select using (tenant_id = my_tenant_id());

drop policy if exists "item_spec_docs_insert" on item_spec_documents;
create policy "item_spec_docs_insert" on item_spec_documents
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "item_spec_docs_update" on item_spec_documents;
create policy "item_spec_docs_update" on item_spec_documents
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "item_spec_docs_delete" on item_spec_documents;
create policy "item_spec_docs_delete" on item_spec_documents
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

-- Storage bucket for item spec documents (run separately in Supabase dashboard
-- or via the storage API — SQL cannot create buckets directly):
-- Bucket name: item-specs
-- Max file size: 20MB
-- Allowed MIME types: application/pdf, application/msword,
--   application/vnd.openxmlformats-officedocument.wordprocessingml.document,
--   image/jpeg, image/png

-- Audit
drop trigger if exists trg_item_spec_docs_audit on item_spec_documents;
create trigger trg_item_spec_docs_audit
  after insert or update or delete on item_spec_documents
  for each row execute procedure fn_audit_log();
