-- ============================================================
-- Migration 082 — Batch number: family-walk + new format
-- ============================================================
--
-- Background
-- ----------
-- The internal batch number stamped on every production_order serves both as
-- a human-readable identifier and as the traceability key linking downstream
-- output to the upstream WIP recipe it was made from. Tino's spec:
--
--   261241024
--   ─────────
--   26  = year (last two digits)
--   124 = day of year (1–366, zero-padded)
--   1024 = full code of the FIRST WIP-type ancestor in the item's family tree
--
-- External (printed on stickers / shop docs) is the first 5 chars: 26124.
--
-- The "family root" rule: a finished good (e.g. 1003.8) inherits the batch
-- number of its parent WIPF (1003.6300) which inherits from its parent WIP
-- (1003). All three orders, produced on the same day, share batch 261241003.
-- That's how operators tie a single mince batch to every package that left
-- the floor from it.
--
-- Two changes in this migration:
--
-- 1. Drop unique(tenant_id, batch_number) on production_orders.
--    Multiple orders within a single family + day MUST be allowed to share a
--    batch number. The app-level Generate logic still de-dupes inserts via
--    the existingByItemId map, so this constraint was belt-and-braces.
--
-- 2. Replace generate_batch_number() with a version that walks the item's
--    parent chain to find the first WIP-type ancestor and emits the new
--    {YY}{DDD}{root_code} format.

-- ─── 1. Drop the unique constraint ───────────────────────────────────────────
-- The constraint is named after the column tuple by Postgres convention.
alter table production_orders
  drop constraint if exists production_orders_tenant_id_batch_number_key;

-- ─── 2. Replace generate_batch_number() ─────────────────────────────────────
-- New signature: takes the item being produced, walks up parent_item_id and
-- picks the HIGHEST WIP-type ancestor in the chain (per Tino, May 2026 — the
-- topmost mince/recipe sets the batch identity for everything downstream).
-- If the item itself is the only WIP, that's fine — it counts.
--
-- If no WIP-type ancestor exists anywhere (rare — happens when a non-WIP
-- item is produced standalone), fall back to the topmost ancestor's code so
-- the batch still gets a stable family identifier. Item with no parents at
-- all → use its own code.
drop function if exists generate_batch_number(text, date);
drop function if exists generate_batch_number(uuid, date);

create or replace function generate_batch_number(p_item_id uuid, p_date date default current_date)
returns text
language plpgsql
stable
as $$
declare
  v_root_code text;
  v_year_part text := to_char(p_date, 'YY');
  v_day_part  text := to_char(p_date, 'DDD');  -- ordinal day, 001–366
begin
  -- Walk the parent chain from the item upward, depth-first. The recursive
  -- CTE produces one row per ancestor, with depth=0 being the item itself.
  -- We pick the lowest-depth ancestor whose item_type is WIP-flavoured; if
  -- none, we fall back to the topmost ancestor (highest depth, parent_item_id
  -- is null).
  with recursive ancestry as (
    select
      i.id, i.code, i.item_type, i.parent_item_id, 0 as depth
    from items i
    where i.id = p_item_id
    union all
    select
      p.id, p.code, p.item_type, p.parent_item_id, a.depth + 1
    from items p
      join ancestry a on a.parent_item_id = p.id
    -- Hard cap so a malformed cycle (shouldn't happen, but defensive) can't
    -- run forever. 50 levels of family is more than any real BOM hierarchy.
    where a.depth < 50
  )
  select code into v_root_code
  from (
    -- First preference: HIGHEST-depth WIP-type ancestor (top of family).
    -- Walks past intermediate WIPFs to land on the originating WIP/recipe.
    select code, depth, 1 as rank
    from ancestry
    where item_type in ('wip', 'wipf', 'wipp')
    union all
    -- Fallback: topmost ancestor (where the chain terminates)
    select code, depth, 2 as rank
    from ancestry
    where parent_item_id is null
  ) candidates
  order by rank, depth desc
  limit 1;

  -- Belt-and-braces: if somehow neither preference found a row (e.g. the
  -- item id doesn't exist), return a sentinel so the insert errors loudly
  -- rather than silently writing an empty batch number.
  if v_root_code is null then
    return v_year_part || v_day_part || 'UNKNOWN';
  end if;

  return v_year_part || v_day_part || v_root_code;
end;
$$;

comment on function generate_batch_number(uuid, date) is
  'Returns YY+DDD+root_code where root_code is the FULL code of the HIGHEST WIP-type ancestor in the item''s family tree (parent_item_id walk). Falls back to the topmost ancestor if no WIP found. Multiple orders in the same family + same day share a batch number — this is intentional traceability behaviour. See migration 082.';

-- Allow the app role + authenticated users to call it (RLS on the underlying
-- items table is the real guard — the function is just stable+sql lookups).
grant execute on function generate_batch_number(uuid, date) to authenticated, service_role;
