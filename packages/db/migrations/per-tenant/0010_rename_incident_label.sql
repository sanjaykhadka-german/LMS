-- Rename the seeded system kind label from 'Incident / near-miss' to
-- 'Incident'. Idempotent: only touches rows that still have the old label,
-- so environments where 0009_whs_kinds was applied AFTER the label change
-- (no rename needed) get a 0-row UPDATE.
--
-- Slug stays 'incident' so existing whs_records keep working — this is a
-- display-only change.

UPDATE whs_kinds
SET label = 'Incident'
WHERE slug = 'incident'
  AND is_system = true
  AND label = 'Incident / near-miss';
