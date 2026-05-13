-- po_drafts: persistent shopping cart for "Order by item" flow in /purchasing.
-- One open draft per (tenant_id, user_id). Lines stack as user adds/splits.
-- Submission later turns each supplier's lines into purchase_orders + po_lines.

CREATE TABLE IF NOT EXISTS po_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text DEFAULT 'Draft',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','cancelled')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_draft_per_user
  ON po_drafts(tenant_id, user_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS po_draft_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES po_drafts(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_id       uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  qty               numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit              text NOT NULL DEFAULT 'kg',
  unit_price        numeric,
  currency          text DEFAULT 'AUD',
  purchase_uom      text,
  purchase_uom_qty  numeric,
  notes             text,
  sort_order        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_draft_lines_draft     ON po_draft_lines(draft_id);
CREATE INDEX IF NOT EXISTS idx_po_draft_lines_item      ON po_draft_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_po_draft_lines_supplier  ON po_draft_lines(supplier_id);

ALTER TABLE po_drafts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_draft_lines  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select_drafts" ON po_drafts;
DROP POLICY IF EXISTS "tenant_modify_drafts" ON po_drafts;
CREATE POLICY "tenant_select_drafts" ON po_drafts FOR SELECT
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_modify_drafts" ON po_drafts FOR ALL
  USING (tenant_id = my_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = my_tenant_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "tenant_select_draft_lines" ON po_draft_lines;
DROP POLICY IF EXISTS "tenant_modify_draft_lines" ON po_draft_lines;
CREATE POLICY "tenant_select_draft_lines" ON po_draft_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM po_drafts d
    WHERE d.id = po_draft_lines.draft_id AND d.tenant_id = my_tenant_id()
  ));
CREATE POLICY "tenant_modify_draft_lines" ON po_draft_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM po_drafts d
    WHERE d.id = po_draft_lines.draft_id
      AND d.tenant_id = my_tenant_id()
      AND d.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM po_drafts d
    WHERE d.id = po_draft_lines.draft_id
      AND d.tenant_id = my_tenant_id()
      AND d.user_id = auth.uid()
  ));

-- Helper: get-or-create an open draft for the current user.
CREATE OR REPLACE FUNCTION get_or_create_open_draft()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := my_tenant_id();
  v_user   uuid := auth.uid();
  v_id     uuid;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_id
    FROM po_drafts
   WHERE tenant_id = v_tenant
     AND user_id   = v_user
     AND status    = 'open'
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO po_drafts(tenant_id, user_id, status)
    VALUES (v_tenant, v_user, 'open')
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END
$fn$;

GRANT EXECUTE ON FUNCTION get_or_create_open_draft() TO authenticated;

COMMENT ON TABLE po_drafts IS
  'Persistent shopping cart for Purchasing > Order by item. One open draft per (tenant_id, user_id). Submission later turns each supplier''s lines into purchase_orders + po_lines.';
COMMENT ON TABLE po_draft_lines IS
  'A line in a po_draft. Multiple lines can exist for the same item across different suppliers (split orders).';
