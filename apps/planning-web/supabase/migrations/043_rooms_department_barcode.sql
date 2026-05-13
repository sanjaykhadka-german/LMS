-- ============================================================
-- Migration 043 — Rooms: link to department + barcode
-- ============================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barcode       text;

COMMENT ON COLUMN public.rooms.department_id IS
  'Optional link to the department this room belongs to.';
COMMENT ON COLUMN public.rooms.barcode IS
  'Scannable barcode printed on the room/fridge door.';

CREATE INDEX IF NOT EXISTS idx_rooms_barcode  ON public.rooms(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_dept     ON public.rooms(department_id);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_tenant_barcode_uniq
  ON public.rooms(tenant_id, barcode) WHERE barcode IS NOT NULL;
