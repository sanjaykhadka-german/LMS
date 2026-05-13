-- ── Migration 041 — tenants UPDATE policy ───────────────────────────────────
-- The tenants table had RLS enabled with only a SELECT policy, so all updates
-- (invoice_prefix, branding, company info, etc.) silently failed. Allow admins
-- and super_admins to update their own tenant row.

DROP POLICY IF EXISTS "tenants_update" ON tenants;

CREATE POLICY "tenants_update" ON tenants
  FOR UPDATE
  USING (
    id = my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    id = my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );
