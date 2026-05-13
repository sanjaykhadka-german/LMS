-- Migration 033: make item_subcategories.category_id nullable
-- Allows subcategories to exist in an "unassigned" holding state

ALTER TABLE public.item_subcategories
  ALTER COLUMN category_id DROP NOT NULL;
