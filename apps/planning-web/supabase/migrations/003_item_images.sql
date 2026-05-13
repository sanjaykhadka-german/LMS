-- Item images — multiple images per item, one can be primary
-- Images stored in Supabase Storage bucket: "item-images"

CREATE TABLE IF NOT EXISTS item_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,          -- path within the "item-images" bucket
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes  INTEGER,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one primary image per item
CREATE UNIQUE INDEX IF NOT EXISTS item_images_primary_idx
  ON item_images (item_id)
  WHERE is_primary = TRUE;

-- Row-level security
ALTER TABLE item_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON item_images
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "insert_own_tenant" ON item_images FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "delete_own_tenant" ON item_images FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Storage bucket (run once via Supabase dashboard or this helper)
-- If running via SQL only, create the bucket in Supabase Storage UI:
--   Bucket name: item-images
--   Public: false  (use signed URLs)
--   File size limit: 5 MB
--   Allowed MIME types: image/jpeg, image/png, image/webp

-- Storage RLS policies — allow authenticated users to read images from their tenant
-- (These must be set in the Supabase Storage dashboard or via the API, not SQL.)
-- Policy name: "tenant read"
--   allow SELECT WHERE bucket_id = 'item-images'
--   AND storage.foldername(name)[1] = (SELECT tenant_id::text FROM profiles WHERE id = auth.uid())

COMMENT ON TABLE item_images IS 'Product/item images stored in Supabase Storage';
