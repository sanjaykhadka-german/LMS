-- ============================================================
-- Migration 044 — Rooms: display colour
-- ============================================================
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS color text;
COMMENT ON COLUMN public.rooms.color IS 'UI display colour (hex). Used by stocktake / planning views to identify rooms at a glance.';
