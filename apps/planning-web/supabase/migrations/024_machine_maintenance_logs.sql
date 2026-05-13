-- Machine maintenance log register
CREATE TABLE IF NOT EXISTS machine_maintenance_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  machine_id      uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  log_type        text NOT NULL CHECK (log_type IN ('service', 'breakdown', 'repair', 'inspection', 'calibration', 'other')),
  performed_date  date NOT NULL,
  performed_by    text,
  description     text NOT NULL,
  cost            numeric(12, 2),
  parts_used      text,
  next_service_date date,
  downtime_hours  numeric(6, 2),
  is_resolved     boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE machine_maintenance_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON machine_maintenance_logs
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_insert" ON machine_maintenance_logs
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_update" ON machine_maintenance_logs
  FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_delete" ON machine_maintenance_logs
  FOR DELETE USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS machine_maintenance_logs_machine_id_idx ON machine_maintenance_logs(machine_id);
CREATE INDEX IF NOT EXISTS machine_maintenance_logs_performed_date_idx ON machine_maintenance_logs(performed_date DESC);
