-- 0008_drop_legacy_public_users_fks
--
-- Post Phase-7 per-tenant cutover, public.users still carries FKs from the
-- legacy Flask schema that point to public.departments / positions / employers.
-- Those parent tables no longer receive new rows — the source of truth has
-- moved to tenant_<uuid>.* schemas — so any create/update of a user with a
-- post-cutover department/position/employer ID trips a foreign-key violation:
--
--   PostgresError: insert or update on table "users" violates foreign key
--   constraint "users_department_id_fkey"
--
-- Application-level tenant scoping (tracey_tenant_id column + per-tenant
-- schemas + RLS) already enforces correctness; these cross-schema FKs add no
-- safety and actively break writes. Drop them.
--
-- Self-reference users_manager_id_fkey is intentionally kept: it targets
-- public.users which is still the canonical users table.
--
-- Idempotent: re-running is a no-op once the constraints are gone.
-- Manual migration: apply via psql / pgAdmin against local and prod.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_department_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_employer_id_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_position_id_fkey;
