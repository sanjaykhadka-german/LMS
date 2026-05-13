-- Migration 034: Add item_number_upload to items table
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS item_number_upload text;

COMMENT ON COLUMN public.items.item_number_upload IS 'Item number from the source/upload system (e.g. AppSheet, old GB system) — for cross-referencing only';
