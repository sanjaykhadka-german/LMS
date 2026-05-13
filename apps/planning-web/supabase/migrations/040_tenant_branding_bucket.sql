-- ── Migration 040 — tenant-branding storage bucket + policies ───────────────
-- Stores tenant logo uploads used by invoice PDF templates.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-branding',
  'tenant-branding',
  false,
  2097152,   -- 2 MB limit
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tenant_branding_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "tenant_branding_storage_delete" ON storage.objects;

CREATE POLICY "tenant_branding_storage_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'tenant-branding' AND auth.role() = 'authenticated');

CREATE POLICY "tenant_branding_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'tenant-branding' AND auth.role() = 'authenticated');

CREATE POLICY "tenant_branding_storage_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'tenant-branding' AND auth.role() = 'authenticated');

CREATE POLICY "tenant_branding_storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'tenant-branding' AND auth.role() = 'authenticated');
