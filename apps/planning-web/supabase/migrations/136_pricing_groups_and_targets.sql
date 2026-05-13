-- =====================================================================
-- 136_pricing_groups_and_targets.sql
-- Phase A of the pricing / margins feature.
--
-- Extends price_groups so a tenant can run unlimited groups with codes
-- (WS1, DB2, Retail, etc.), each with a default margin %.
-- Adds item_price_targets — per-item, per-(group|customer), holding either
-- a target margin % or a fixed sell price (or both — fixed price wins).
-- Adds item_price_target_history — every change to a target is logged so
-- we can answer "what did Costco's bratwurst price look like in March".
-- Seeds German Butchery's standard ladders.
-- =====================================================================

-- 1) Extend price_groups -----------------------------------------------
ALTER TABLE price_groups
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS default_margin_pct NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS default_target_unit TEXT DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

CREATE UNIQUE INDEX IF NOT EXISTS price_groups_tenant_code_uq
  ON price_groups (tenant_id, code)
  WHERE code IS NOT NULL;

COMMENT ON COLUMN price_groups.code IS 'Short identifier shown in dropdowns and reports e.g. WS1, DB2, RETAIL.';
COMMENT ON COLUMN price_groups.default_margin_pct IS 'Gross margin % on top of loaded cost when no per-item override. Stored as e.g. 22.5 for 22.5%.';
COMMENT ON COLUMN price_groups.default_target_unit IS 'Default unit prices are entered in for this group — usually kg, sometimes ea/piece.';

-- 2) item_price_targets ------------------------------------------------
CREATE TABLE IF NOT EXISTS item_price_targets (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL DEFAULT my_tenant_id(),
  item_id             UUID        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  scope_type          TEXT        NOT NULL CHECK (scope_type IN ('group','customer')),
  scope_id            UUID        NOT NULL,
  target_margin_pct   NUMERIC(6,3),
  target_sell_price   NUMERIC(12,4),
  target_unit         TEXT        NOT NULL DEFAULT 'kg',
  effective_from      DATE        NOT NULL DEFAULT CURRENT_DATE,
  effective_to        DATE,
  notes               TEXT,
  created_by          UUID        REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID        REFERENCES profiles(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ipt_at_least_one_pricing
    CHECK (target_margin_pct IS NOT NULL OR target_sell_price IS NOT NULL),
  CONSTRAINT ipt_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS item_price_targets_unique_current
  ON item_price_targets (item_id, scope_type, scope_id, effective_from);

CREATE INDEX IF NOT EXISTS item_price_targets_lookup
  ON item_price_targets (tenant_id, item_id, scope_type, scope_id, effective_from DESC);

COMMENT ON TABLE item_price_targets IS
  'Per-item pricing target for a price group or specific customer. Customer rows override group rows. Effective-dated so price changes do not rewrite history.';

-- 3) Audit log ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_price_target_history (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL DEFAULT my_tenant_id(),
  item_price_target_id  UUID,
  item_id               UUID,
  scope_type            TEXT,
  scope_id              UUID,
  action                TEXT        NOT NULL CHECK (action IN ('insert','update','delete')),
  old_target_margin_pct NUMERIC(6,3),
  new_target_margin_pct NUMERIC(6,3),
  old_target_sell_price NUMERIC(12,4),
  new_target_sell_price NUMERIC(12,4),
  reason                TEXT,
  changed_by            UUID        REFERENCES profiles(id),
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ipt_history_by_item
  ON item_price_target_history (tenant_id, item_id, changed_at DESC);

CREATE OR REPLACE FUNCTION fn_log_item_price_target_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO item_price_target_history (
      tenant_id, item_price_target_id, item_id, scope_type, scope_id,
      action, new_target_margin_pct, new_target_sell_price, reason, changed_by
    ) VALUES (
      NEW.tenant_id, NEW.id, NEW.item_id, NEW.scope_type, NEW.scope_id,
      'insert', NEW.target_margin_pct, NEW.target_sell_price, NEW.notes, NEW.created_by
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.target_margin_pct IS DISTINCT FROM OLD.target_margin_pct)
       OR (NEW.target_sell_price IS DISTINCT FROM OLD.target_sell_price) THEN
      INSERT INTO item_price_target_history (
        tenant_id, item_price_target_id, item_id, scope_type, scope_id,
        action,
        old_target_margin_pct, new_target_margin_pct,
        old_target_sell_price, new_target_sell_price,
        reason, changed_by
      ) VALUES (
        NEW.tenant_id, NEW.id, NEW.item_id, NEW.scope_type, NEW.scope_id,
        'update',
        OLD.target_margin_pct, NEW.target_margin_pct,
        OLD.target_sell_price, NEW.target_sell_price,
        NEW.notes, NEW.updated_by
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO item_price_target_history (
      tenant_id, item_price_target_id, item_id, scope_type, scope_id,
      action, old_target_margin_pct, old_target_sell_price, changed_by
    ) VALUES (
      OLD.tenant_id, OLD.id, OLD.item_id, OLD.scope_type, OLD.scope_id,
      'delete', OLD.target_margin_pct, OLD.target_sell_price, OLD.updated_by
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_item_price_target_change ON item_price_targets;
CREATE TRIGGER trg_log_item_price_target_change
  AFTER INSERT OR UPDATE OR DELETE ON item_price_targets
  FOR EACH ROW EXECUTE FUNCTION fn_log_item_price_target_change();

-- 4) RLS ---------------------------------------------------------------
ALTER TABLE item_price_targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_price_target_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ipt_tenant_isolation ON item_price_targets;
CREATE POLICY ipt_tenant_isolation
  ON item_price_targets
  FOR ALL
  USING (tenant_id = my_tenant_id())
  WITH CHECK (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS ipth_tenant_select ON item_price_target_history;
CREATE POLICY ipth_tenant_select
  ON item_price_target_history
  FOR SELECT
  USING (tenant_id = my_tenant_id());

-- 5) Seed German Butchery's standard ladders ---------------------------
INSERT INTO price_groups (tenant_id, code, name, description, default_margin_pct, default_target_unit, sort_order, is_default, is_active)
SELECT 'f6e8c84f-5dfc-49ee-afe2-d53fd8be2dc2', v.code, v.name, v.description, v.margin_pct, 'kg', v.sort_order, v.is_default, true
FROM (VALUES
  ('WS1',    'Wholesale 1',      'Top-tier wholesale customers — best discount',  25.0, 10, false),
  ('WS2',    'Wholesale 2',      'Mid-tier wholesale',                            30.0, 20, false),
  ('WS3',    'Wholesale 3',      'Entry wholesale tier',                          35.0, 30, false),
  ('DB1',    'Distributor 1',    'Top-tier distributor',                          20.0, 40, false),
  ('DB2',    'Distributor 2',    'Mid-tier distributor',                          22.5, 50, false),
  ('DB3',    'Distributor 3',    'Entry distributor tier',                        25.0, 60, false),
  ('RETAIL', 'Retail / Walk-in', 'Retail and walk-in customers — full margin',    45.0, 70, true)
) AS v(code, name, description, margin_pct, sort_order, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM price_groups pg
  WHERE pg.tenant_id = 'f6e8c84f-5dfc-49ee-afe2-d53fd8be2dc2'
    AND pg.code = v.code
);
