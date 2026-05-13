-- ============================================================
-- Migration 040 — Structured micro panel + packaging materials
-- Adds: 8 micro test columns + reference + packaging_materials array
-- ============================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS micro_tpc                  text,
  ADD COLUMN IF NOT EXISTS micro_ecoli                text,
  ADD COLUMN IF NOT EXISTS micro_coliforms            text,
  ADD COLUMN IF NOT EXISTS micro_salmonella           text,
  ADD COLUMN IF NOT EXISTS micro_listeria             text,
  ADD COLUMN IF NOT EXISTS micro_s_aureus             text,
  ADD COLUMN IF NOT EXISTS micro_yeast_mould          text,
  ADD COLUMN IF NOT EXISTS micro_sulphite_clostridia  text,
  ADD COLUMN IF NOT EXISTS micro_reference            text,
  ADD COLUMN IF NOT EXISTS packaging_materials        text[];

COMMENT ON COLUMN public.items.micro_tpc                 IS 'Total Plate Count limit (e.g. <100,000 cfu/g).';
COMMENT ON COLUMN public.items.micro_ecoli               IS 'E. coli limit (e.g. <10 cfu/g).';
COMMENT ON COLUMN public.items.micro_coliforms           IS 'Coliforms limit (e.g. <100 cfu/g).';
COMMENT ON COLUMN public.items.micro_salmonella          IS 'Salmonella (e.g. Not detected in 25 g).';
COMMENT ON COLUMN public.items.micro_listeria            IS 'Listeria monocytogenes (e.g. Not detected in 25 g).';
COMMENT ON COLUMN public.items.micro_s_aureus            IS 'Staphylococcus aureus (e.g. <100 cfu/g).';
COMMENT ON COLUMN public.items.micro_yeast_mould         IS 'Yeasts and moulds (e.g. <1,000 cfu/g).';
COMMENT ON COLUMN public.items.micro_sulphite_clostridia IS 'Sulphite-reducing clostridia (e.g. <30 cfu/g).';
COMMENT ON COLUMN public.items.micro_reference           IS 'Reference standard (e.g. FSANZ, customer spec).';
COMMENT ON COLUMN public.items.packaging_materials       IS 'Packaging materials used (e.g. {"PVDC vacuum bag","carton","retail label"}).';
