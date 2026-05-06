-- Phase 2.5: enforce one tenant per slug. Allows future tenant URLs
-- (e.g. /t/<slug>) without ambiguity, and stops the silent-collision
-- footgun where two unrelated workspaces could end up with the same slug.
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_uq" ON "app"."tenants" USING btree ("slug");
