-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Customer Contacts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customer_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  name            text NOT NULL,
  role            text,               -- e.g. "Accounts", "Store Manager", "Ordering"
  phone           text,
  mobile          text,
  email           text,

  is_primary               boolean NOT NULL DEFAULT false,
  receives_orders          boolean NOT NULL DEFAULT false,
  receives_invoices        boolean NOT NULL DEFAULT false,
  receives_claims          boolean NOT NULL DEFAULT false,
  receives_delivery_notices boolean NOT NULL DEFAULT false,

  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX idx_customer_contacts_tenant   ON customer_contacts(tenant_id);

-- Only one primary contact per customer
CREATE UNIQUE INDEX idx_customer_contacts_primary
  ON customer_contacts(customer_id)
  WHERE is_primary = true;

-- RLS
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON customer_contacts
  USING (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- updated_at trigger
CREATE TRIGGER customer_contacts_updated_at
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
