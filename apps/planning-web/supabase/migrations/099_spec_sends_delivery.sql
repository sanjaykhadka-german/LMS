-- ============================================================================
-- 099  Spec / PIF send delivery tracking
-- ----------------------------------------------------------------------------
-- Tino May 2026: spec_sends only logged the intent to send — no email ever
-- went out. Phase 3I.2 wires Resend in, mirroring the PO send path. These
-- columns capture the delivery audit so failures can be diagnosed:
--
--   subject / body_text  - what was actually sent (snapshot at send time)
--   to_addresses          - rendered "name <email>" recipients
--   cc_addresses          - rendered "name <email>" CCs (sender + qa_email)
--   provider              - 'resend' for now
--   provider_message_id   - Resend message id, lets us look it up in their
--                            dashboard / replay logs
--   status                - 'sent' | 'failed'
--   error_message         - SDK error string when failed (nullable)
-- ============================================================================

ALTER TABLE public.spec_sends
  ADD COLUMN IF NOT EXISTS subject              text,
  ADD COLUMN IF NOT EXISTS body_text            text,
  ADD COLUMN IF NOT EXISTS to_addresses         text,
  ADD COLUMN IF NOT EXISTS cc_addresses         text,
  ADD COLUMN IF NOT EXISTS provider             text,
  ADD COLUMN IF NOT EXISTS provider_message_id  text,
  ADD COLUMN IF NOT EXISTS status               text,
  ADD COLUMN IF NOT EXISTS error_message        text;

COMMENT ON COLUMN public.spec_sends.status IS
  'sent | failed - tracks Resend delivery outcome. NULL on legacy rows that pre-date 099.';
