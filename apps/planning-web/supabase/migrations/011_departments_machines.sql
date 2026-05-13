-- ============================================================
-- Migration 011 — Departments & Machine Register
-- ============================================================

-- ─── DEPARTMENTS ─────────────────────────────────────────────────────────────

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  code        text,                 -- short code e.g. BONE, MIX, SMOKE
  description text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(tenant_id, name)
);

alter table departments enable row level security;

drop policy if exists "departments_select" on departments;
create policy "departments_select" on departments
  for select using (tenant_id = my_tenant_id());

drop policy if exists "departments_insert" on departments;
create policy "departments_insert" on departments
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "departments_update" on departments;
create policy "departments_update" on departments
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "departments_delete" on departments;
create policy "departments_delete" on departments
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_departments_uat on departments;
create trigger trg_departments_uat
  before update on departments
  for each row execute procedure update_updated_at();

-- ─── MACHINES ────────────────────────────────────────────────────────────────

create table if not exists machines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  department_id         uuid references departments(id),

  -- Identity
  code                  text,                -- asset tag / short code
  name                  text not null,
  machine_type          text,                -- e.g. Slicer, Smoker, Oven, Grinder, Mixer, Filler, Packer

  -- Capacity
  capacity_value        numeric,
  capacity_unit         text,                -- e.g. kg/batch, links/min, kg/hr

  -- Asset details
  manufacturer          text,
  model                 text,
  serial_number         text,
  asset_number          text,
  purchase_date         date,
  purchase_price        numeric,

  -- Maintenance
  last_service_date     date,
  next_service_date     date,
  service_interval_days int,
  service_notes         text,

  -- Status
  is_active             boolean not null default true,
  status                text not null default 'operational'
                          check (status in ('operational','maintenance','breakdown','decommissioned')),
  location              text,               -- physical location within site
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table machines enable row level security;

drop policy if exists "machines_select" on machines;
create policy "machines_select" on machines
  for select using (tenant_id = my_tenant_id());

drop policy if exists "machines_insert" on machines;
create policy "machines_insert" on machines
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machines_update" on machines;
create policy "machines_update" on machines
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machines_delete" on machines;
create policy "machines_delete" on machines
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_machines_uat on machines;
create trigger trg_machines_uat
  before update on machines
  for each row execute procedure update_updated_at();

-- ─── MACHINE BREAKDOWNS ──────────────────────────────────────────────────────

create table if not exists machine_breakdowns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  machine_id      uuid not null references machines(id) on delete cascade,

  reported_at     timestamptz not null default now(),
  reported_by     uuid references profiles(id),
  severity        text not null default 'medium'
                    check (severity in ('low','medium','high','critical')),
  description     text not null,

  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id),
  resolution_notes text,

  downtime_hours  numeric,             -- calculated or manually entered
  repair_cost     numeric,
  parts_used      text,                -- free text list of parts used

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table machine_breakdowns enable row level security;

drop policy if exists "machine_breakdowns_select" on machine_breakdowns;
create policy "machine_breakdowns_select" on machine_breakdowns
  for select using (tenant_id = my_tenant_id());

drop policy if exists "machine_breakdowns_insert" on machine_breakdowns;
create policy "machine_breakdowns_insert" on machine_breakdowns
  for insert with check (tenant_id = my_tenant_id());

drop policy if exists "machine_breakdowns_update" on machine_breakdowns;
create policy "machine_breakdowns_update" on machine_breakdowns
  for update using (tenant_id = my_tenant_id());

drop trigger if exists trg_machine_breakdowns_uat on machine_breakdowns;
create trigger trg_machine_breakdowns_uat
  before update on machine_breakdowns
  for each row execute procedure update_updated_at();

-- ─── MACHINE SPARE PARTS ─────────────────────────────────────────────────────

create table if not exists machine_spare_parts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  machine_id      uuid not null references machines(id) on delete cascade,

  part_name       text not null,
  part_number     text,               -- OEM or internal part number
  description     text,
  quantity_on_hand numeric not null default 0,
  reorder_level   numeric,            -- alert when stock drops to this
  unit            text default 'each',
  supplier_name   text,
  supplier_part_no text,
  unit_cost       numeric,
  location        text,               -- storage location (shelf/bin)
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table machine_spare_parts enable row level security;

drop policy if exists "machine_spare_parts_select" on machine_spare_parts;
create policy "machine_spare_parts_select" on machine_spare_parts
  for select using (tenant_id = my_tenant_id());

drop policy if exists "machine_spare_parts_insert" on machine_spare_parts;
create policy "machine_spare_parts_insert" on machine_spare_parts
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machine_spare_parts_update" on machine_spare_parts;
create policy "machine_spare_parts_update" on machine_spare_parts
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machine_spare_parts_delete" on machine_spare_parts;
create policy "machine_spare_parts_delete" on machine_spare_parts
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_machine_spare_parts_uat on machine_spare_parts;
create trigger trg_machine_spare_parts_uat
  before update on machine_spare_parts
  for each row execute procedure update_updated_at();

-- ─── MACHINE DOCUMENTS ───────────────────────────────────────────────────────
-- Stores manuals, SOPs, training videos, compliance certificates, etc.

create table if not exists machine_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  machine_id      uuid not null references machines(id) on delete cascade,

  document_type   text not null
                    check (document_type in ('manual','sop','training_video','certificate','inspection','other')),
  title           text not null,
  description     text,
  document_url    text,               -- Supabase Storage path or external URL
  document_name   text,               -- original filename
  file_size_bytes bigint,
  version         text,               -- e.g. "v2.1", "Rev 3"
  effective_date  date,
  expiry_date     date,               -- for certificates
  uploaded_by     uuid references profiles(id),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table machine_documents enable row level security;

drop policy if exists "machine_documents_select" on machine_documents;
create policy "machine_documents_select" on machine_documents
  for select using (tenant_id = my_tenant_id());

drop policy if exists "machine_documents_insert" on machine_documents;
create policy "machine_documents_insert" on machine_documents
  for insert with check (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machine_documents_update" on machine_documents;
create policy "machine_documents_update" on machine_documents
  for update using (tenant_id = my_tenant_id() and is_manager_or_above());

drop policy if exists "machine_documents_delete" on machine_documents;
create policy "machine_documents_delete" on machine_documents
  for delete using (tenant_id = my_tenant_id() and is_manager_or_above());

drop trigger if exists trg_machine_documents_uat on machine_documents;
create trigger trg_machine_documents_uat
  before update on machine_documents
  for each row execute procedure update_updated_at();

-- ─── STORAGE BUCKET: machine-docs ────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'machine-docs',
  'machine-docs',
  false,
  52428800,  -- 50 MB
  array[
    'application/pdf',
    'image/jpeg','image/png','image/webp',
    'video/mp4','video/webm',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

drop policy if exists "machine_docs_storage_select" on storage.objects;
drop policy if exists "machine_docs_storage_insert" on storage.objects;
drop policy if exists "machine_docs_storage_delete" on storage.objects;

create policy "machine_docs_storage_select" on storage.objects
  for select using (bucket_id = 'machine-docs' and auth.role() = 'authenticated');

create policy "machine_docs_storage_insert" on storage.objects
  for insert with check (bucket_id = 'machine-docs' and auth.role() = 'authenticated');

create policy "machine_docs_storage_delete" on storage.objects
  for delete using (bucket_id = 'machine-docs' and auth.role() = 'authenticated');

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

create index if not exists machines_tenant_idx      on machines(tenant_id);
create index if not exists machines_dept_idx        on machines(department_id);
create index if not exists machines_service_idx     on machines(tenant_id, next_service_date) where next_service_date is not null;
create index if not exists breakdowns_machine_idx   on machine_breakdowns(machine_id);
create index if not exists spare_parts_machine_idx  on machine_spare_parts(machine_id);
create index if not exists machine_docs_machine_idx on machine_documents(machine_id);
