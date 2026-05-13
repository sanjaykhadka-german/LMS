-- ============================================================================
-- 090  PO EMAIL — per-user template + send audit log
-- ----------------------------------------------------------------------------
-- profiles.po_email_template: per-user default body when emailing a PO to
-- a supplier. Operator can edit before sending; this is the seed.
--
-- purchase_order_sends: audit row per send attempt. Snapshot captures the
-- email body / subject at send time so historical replays are accurate
-- even after templates change. Mirrors spec_sends shape.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS po_email_template text;

COMMENT ON COLUMN public.profiles.po_email_template IS
  'Per-user default body for outgoing PO emails. Markdown allowed. Operator can override at send time.';

CREATE TABLE IF NOT EXISTS public.purchase_order_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purchase_order_id   uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  sent_by             uuid REFERENCES public.profiles(id),
  to_addresses        text NOT NULL,
  cc_addresses        text,
  bcc_addresses       text,
  subject             text NOT NULL,
  body_text           text,
  body_html           text,
  attachment_filename text,
  provider            text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','delivered','bounced','complained','failed')),
  error_message       text,
  snapshot            jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.purchase_order_sends IS
  'Audit log: one row per PO email send attempt. Snapshot preserves body / subject / attachment exactly as sent.';

CREATE INDEX IF NOT EXISTS idx_pos_purchase_order ON public.purchase_order_sends (purchase_order_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_status         ON public.purchase_order_sends (status) WHERE status != 'sent' AND status != 'delivered';

ALTER TABLE public.purchase_order_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_sends_select" ON public.purchase_order_sends;
CREATE POLICY "po_sends_select" ON public.purchase_order_sends
  FOR SELECT USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS "po_sends_insert" ON public.purchase_order_sends;
CREATE POLICY "po_sends_insert" ON public.purchase_order_sends
  FOR INSERT WITH CHECK (tenant_id = my_tenant_id());

-- Updates only via service-role (Resend webhook handler edge function).
DROP POLICY IF EXISTS "po_sends_update_service" ON public.purchase_order_sends;
CREATE POLICY "po_sends_update_service" ON public.purchase_order_sends
  FOR UPDATE USING (auth.role() = 'service_role');
