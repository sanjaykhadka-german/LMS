-- Phase 7a — per-tenant migration ledger.
--
-- Tracks which per-tenant DDL migrations have run against each tenant's
-- schema (tenant_<uuid>). Consulted by the per-tenant migration runner
-- (packages/db/src/per-tenant-migrate.ts) to decide what to apply.
--
-- One row per (tenant_id, migration_name). The application provisions the
-- baseline tables via provisionTenant(), then any future per-tenant DDL
-- changes (e.g. adding a column to lms_modules across all tenants) ride
-- this ledger so they're idempotent and resumable.
--
-- ─── HOW TO RUN ──────────────────────────────────────────────────────
--
-- Local:
--   psql "postgres://root:root@localhost:5432/lms_dev" \
--        -f packages/db/migrations/manual/0006_tenant_migrations_ledger.sql
--
-- Render (lms-db PSQL shell):
--   \i 0006_tenant_migrations_ledger.sql
--
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS app.tenant_migrations (
  tenant_id      uuid        NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  migration_name text        NOT NULL,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, migration_name)
);

COMMENT ON TABLE app.tenant_migrations IS
  'Phase 7a: per-tenant DDL migration ledger. One row per (tenant, migration) pair. '
  'Consulted by provisionTenant() and the per-tenant migration runner.';

COMMIT;
