-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 — Supplier Contacts + Operating / Receiving Hours
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. supplier_contacts ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  name            text NOT NULL,
  role            text,               -- e.g. "Sales Rep", "Accounts", "Logistics"
  phone           text,
  mobile          text,
  email           text,

  is_primary               boolean NOT NULL DEFAULT false,
  receives_orders          boolean NOT NULL DEFAULT false,
  receives_invoices        boolean NOT NULL DEFAULT false,
  receives_claims          boolean NOT NULL DEFAULT false,
  receives_cert_reminders  boolean NOT NULL DEFAULT false,

  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);
CREATE INDEX idx_supplier_contacts_tenant   ON supplier_contacts(tenant_id);

-- Only one primary contact per supplier
CREATE UNIQUE INDEX idx_supplier_contacts_primary
  ON supplier_contacts(supplier_id)
  WHERE is_primary = true;

-- RLS
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON supplier_contacts
  USING (
    tenant_id = (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 2. Supplier operating hours / logistics ───────────────────────────────────

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS operating_days        text[],
  ADD COLUMN IF NOT EXISTS operating_open        time,
  ADD COLUMN IF NOT EXISTS operating_close       time,
  ADD COLUMN IF NOT EXISTS loading_dock_open     time,
  ADD COLUMN IF NOT EXISTS loading_dock_close    time,
  ADD COLUMN IF NOT EXISTS loading_dock_notes    text,
  ADD COLUMN IF NOT EXISTS order_cutoff_time     time,
  ADD COLUMN IF NOT EXISTS delivery_days         text[];

-- ── 3. Customer receiving / billing additions ─────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS receiving_days        text[],
  ADD COLUMN IF NOT EXISTS receiving_open        time,
  ADD COLUMN IF NOT EXISTS receiving_close       time,
  ADD COLUMN IF NOT EXISTS loading_dock_notes    text,
  ADD COLUMN IF NOT EXISTS billing_address_line1 text,
  ADD COLUMN IF NOT EXISTS billing_address_line2 text,
  ADD COLUMN IF NOT EXISTS billing_city          text,
  ADD COLUMN IF NOT EXISTS billing_state         text,
  ADD COLUMN IF NOT EXISTS billing_postcode      text,
  ADD COLUMN IF NOT EXISTS billing_country_code  text DEFAULT 'AU',
  ADD COLUMN IF NOT EXISTS abn                   text;

-- ── 4. updated_at trigger for supplier_contacts ──────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER supplier_contacts_updated_at
  BEFORE UPDATE ON supplier_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
