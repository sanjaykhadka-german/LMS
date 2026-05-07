-- AI Studio session state. One row per (user, tenant) pair. Wiped on /reset.
-- Run this once per environment (local + prod) before deploying the AI Studio
-- backend. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS app.ai_studio_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_module_json text,
  module_id integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_studio_sessions_user_tenant_uq
  ON app.ai_studio_sessions(user_id, tenant_id);
