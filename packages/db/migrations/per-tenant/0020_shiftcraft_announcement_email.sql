-- ShiftCraft per-tenant — add emailed_at + emailed_recipient_count to
-- sc_announcements so the email-fan-out feature can record what was sent.
-- Idempotent ADD COLUMN IF NOT EXISTS so re-runs across already-migrated
-- tenants are safe.

ALTER TABLE sc_announcements
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

ALTER TABLE sc_announcements
  ADD COLUMN IF NOT EXISTS emailed_recipient_count integer;
