-- ============================================================================
-- 074  ITEMS.PACK_LEVELS — variable-depth pack hierarchy
-- ----------------------------------------------------------------------------
-- Phase 1 of "Option B" — depends on migration 073 (tenant_pack_level_defs).
--
-- Adds items.pack_levels jsonb. Format: ordered array of objects, in
-- bottom-up order (closest to piece first):
--   [
--     { "code": "inner",     "qty_per_below": 3   },   -- 3 pieces per inner
--     { "code": "sub_outer", "qty_per_below": 5   },   -- 5 inners per sub-outer
--     { "code": "outer",     "qty_per_below": 2   },   -- 2 sub-outers per outer
--     { "code": "pallet",    "qty_per_below": 100 }    -- 100 outers per pallet
--   ]
-- The "code" matches a row in tenant_pack_level_defs (validated at the app
-- layer; we don't enforce a FK because pack_levels is jsonb).
--
-- Sync trigger: when pack_levels is set, the LEGACY columns are derived from
-- it so existing code paths (BOM editor, explode_mrp, items table column
-- "PIECES/INNER", etc.) keep working unchanged.
--   units_per_inner   = first level's qty_per_below
--   outers_per_pallet = last level's qty_per_below
--   inner_per_outer   = product of qty_per_below for every level BETWEEN
--                       the first and last (so for a 3-level chain it's the
--                       second level; for a 4-level chain it's level 2 × 3)
--   units_per_outer   = units_per_inner × inner_per_outer (existing formula)
--   units_per_pallet  = units_per_outer × outers_per_pallet
--
-- The trigger is a no-op when pack_levels is null/empty — items that haven't
-- been migrated keep using their existing legacy columns directly.
--
-- Replaces the trigger from migration 060.
-- ============================================================================

alter table public.items
  add column if not exists pack_levels jsonb;

comment on column public.items.pack_levels is
  'Ordered array of pack-hierarchy levels (bottom-up). Each element { code, qty_per_below }. Source of truth for new code paths; legacy columns auto-derived via trigger.';

create or replace function sync_pack_qtys() returns trigger language plpgsql as $$
declare
  level_count   int;
  product_inter numeric;
  i             int;
  qty           numeric;
begin
  -- If pack_levels is set, it's the source of truth — derive legacy fields.
  if new.pack_levels is not null
     and jsonb_typeof(new.pack_levels) <> 'null'
     and jsonb_array_length(new.pack_levels) > 0 then
    level_count := jsonb_array_length(new.pack_levels);

    -- units_per_inner = first level's qty_per_below
    new.units_per_inner := nullif((new.pack_levels->0->>'qty_per_below')::numeric, 0)::int;

    -- outers_per_pallet = last level's qty_per_below
    if level_count >= 2 then
      new.outers_per_pallet := nullif((new.pack_levels->(level_count - 1)->>'qty_per_below')::numeric, 0)::int;
    else
      new.outers_per_pallet := null;
    end if;

    -- inner_per_outer = product of qty_per_below for intermediate levels
    if level_count >= 3 then
      product_inter := 1;
      for i in 1..(level_count - 2) loop
        qty := (new.pack_levels->i->>'qty_per_below')::numeric;
        if qty is null or qty <= 0 then
          product_inter := null;
          exit;
        end if;
        product_inter := product_inter * qty;
      end loop;
      new.inner_per_outer := product_inter::int;
    elsif level_count = 2 then
      -- 2-level chain (e.g. just inner + pallet, no outer concept) — treat
      -- inner-per-outer as 1 so units_per_outer = units_per_inner.
      new.inner_per_outer := 1;
    else
      new.inner_per_outer := null;
    end if;
  end if;

  -- Always derive units_per_outer / units_per_pallet from legacy fields
  -- (the same logic that lived in migration 060's trigger).
  if new.units_per_inner is not null and new.inner_per_outer is not null then
    new.units_per_outer := new.units_per_inner * new.inner_per_outer;
  else
    new.units_per_outer := null;
  end if;
  if new.units_per_outer is not null and new.outers_per_pallet is not null then
    new.units_per_pallet := new.units_per_outer * new.outers_per_pallet;
  else
    new.units_per_pallet := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_items_derive_pack_qtys on public.items;
create trigger trg_items_sync_pack_qtys
  before insert or update of units_per_inner, inner_per_outer, outers_per_pallet, pack_levels
  on public.items
  for each row execute procedure sync_pack_qtys();

-- Backfill: only items with all three legacy columns populated get a starter
-- pack_levels JSON (3-level chain: inner / outer / pallet). Items with
-- partial data stay on the legacy path until an operator edits them.
update public.items
set pack_levels = jsonb_build_array(
  jsonb_build_object('code', 'inner',  'qty_per_below', units_per_inner),
  jsonb_build_object('code', 'outer',  'qty_per_below', inner_per_outer),
  jsonb_build_object('code', 'pallet', 'qty_per_below', outers_per_pallet)
)
where pack_levels is null
  and units_per_inner   is not null and units_per_inner   > 0
  and inner_per_outer   is not null and inner_per_outer   > 0
  and outers_per_pallet is not null and outers_per_pallet > 0;
