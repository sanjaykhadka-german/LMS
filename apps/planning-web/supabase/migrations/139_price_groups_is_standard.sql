-- =====================================================================
-- 139_price_groups_is_standard.sql
-- Standard vs Custom price groups. The 7 seeded groups (WS1, WS2, WS3,
-- DB1, DB2, DB3, RETAIL) are "Standard" — every new tenant gets them out
-- of the box. Custom groups are anything the user creates later for one-
-- off / customer-specific pricing structures.
-- =====================================================================

ALTER TABLE price_groups
  ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN price_groups.is_standard IS
  'TRUE for system-seeded ladder groups (WS*, DB*, RETAIL). FALSE for user-created custom groups.';

UPDATE price_groups
SET is_standard = true
WHERE code IN ('WS1','WS2','WS3','DB1','DB2','DB3','RETAIL');
