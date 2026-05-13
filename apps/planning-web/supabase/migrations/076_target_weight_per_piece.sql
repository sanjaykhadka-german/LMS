-- ============================================================================
-- 076  TARGET_WEIGHT_G — definitively per-piece (revert migration 072)
-- ----------------------------------------------------------------------------
-- This is the THIRD attempt at nailing what target_weight_g means. The user
-- consistently enters it as "the weight of one finished piece" — e.g. a 56 g
-- frankfurter, regardless of how many sit in an inner pack. Migration 072
-- assumed it was "per inner" which produced wrong-feeling per-piece numbers
-- in the UI for multi-piece packs (a 3×100g chorizo pack stored target=300
-- and the system divided by upi=3 to display 100 g per piece — but if the
-- operator types 56 expecting per-piece on a 5-pack, the same logic shows
-- 11.20 g per piece, which is nonsense).
--
-- Going forward, the unambiguous semantic is:
--   target_weight_g = weight of ONE finished PIECE
--   target_per_inner = target_weight_g × units_per_inner   (DERIVED, displayed)
--   target_per_outer = target_weight_g × units_per_outer   (DERIVED, displayed)
--
-- DATA FIX:
--   For items where target_weight_g was clearly entered with per-INNER intent
--   (i.e. the value divided by units_per_inner gives a reasonable per-piece
--   weight, while the value itself does NOT), divide by upi.
--   Heuristic: (target / upi) BETWEEN 5 AND 5000 grams. This catches the 14
--   chorizo / hot-dog / mini-chorizo items currently mis-entered while
--   leaving alone items already in per-piece form (e.g. 30 g chipolata).
--
-- explode_mrp:
--   Reverts to migration 067's formulas. per_piece basis treats target as
--   per-piece directly; per_inner / per_outer / per_pallet bases divide by
--   target × upi / etc to get the relevant piece count.
-- ============================================================================

-- ── 1. Data fix: convert items entered as per-inner back to per-piece ─────
update public.items
set target_weight_g = round(target_weight_g / units_per_inner)
where units_per_inner is not null and units_per_inner > 1
  and target_weight_g is not null
  and (target_weight_g / units_per_inner) between 5 and 5000;

-- ── 2. Revert explode_mrp formulas to per-piece interpretation ───────────
create or replace function public.explode_mrp(p_demand_plan_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from public.demand_plans where id = p_demand_plan_id;
  delete from public.mrp_results where demand_plan_id = p_demand_plan_id;

  insert into public.mrp_results (
    demand_plan_id, item_id, department, bom_id,
    required_qty, on_hand_qty, net_required_qty, unit,
    standard_batch_size, suggested_batches, rounded_batches,
    planned_qty, surplus_qty
  )
  with recursive bom_explosion as (
    select
      dl.item_id,
      greatest(0,
        coalesce(dl.planned_qty_kg, dl.planned_weight_kg, 0) - coalesce(i.current_stock, 0)
      )::numeric as required_qty,
      0          as depth
    from public.demand_lines dl
    join public.items i on i.id = dl.item_id
    where dl.demand_plan_id = p_demand_plan_id

    union all

    select
      successor.item_id,
      successor.qty,
      be.depth + 1
    from bom_explosion be
    join public.items parent on parent.id = be.item_id
    join lateral (
      select
        parent.parent_item_id as item_id,
        be.required_qty       as qty
      where parent.parent_item_id is not null
        and not exists (
          select 1
          from public.bom_headers bh_chk
          join public.bom_lines  bl_chk on bl_chk.bom_header_id = bh_chk.id
          where bh_chk.item_id = be.item_id
            and bh_chk.is_active = true
            and bl_chk.component_item_id = parent.parent_item_id
        )

      union all

      select
        bl.component_item_id,
        case
          when comp.consumed_in_weight then
            (be.required_qty / nullif(coalesce(bh.yield_factor, 1.0), 0))
              * (bl.qty_per_batch / nullif(line_totals.recipe_sum, 0))
          -- per_piece: pieces_in_parent = kg × 1000 / target_weight_g
          --            (target_weight_g is NOW per piece directly)
          when bl.basis = 'per_piece' and parent.target_weight_g > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
          -- per_inner: inners = pieces / units_per_inner
          when bl.basis = 'per_inner' and parent.target_weight_g > 0 and parent.units_per_inner > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
          -- per_outer: outers = pieces / units_per_outer
          when bl.basis = 'per_outer' and parent.target_weight_g > 0 and parent.units_per_outer > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
          -- per_pallet: pallets = pieces / units_per_pallet
          when bl.basis = 'per_pallet' and parent.target_weight_g > 0 and parent.units_per_pallet > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
          when bl.basis = 'per_kg' then
            be.required_qty * bl.qty_per_batch
          else
            -- legacy fallback: basis missing → treat qty as per 1000 kg of parent
            be.required_qty * bl.qty_per_batch / 1000.0
        end as qty
      from public.bom_headers bh
      join public.bom_lines   bl   on bl.bom_header_id = bh.id
      join public.items       comp on comp.id = bl.component_item_id
      left join lateral (
        select sum(bl2.qty_per_batch) as recipe_sum
        from public.bom_lines bl2
        join public.items     comp2 on comp2.id = bl2.component_item_id
        where bl2.bom_header_id = bh.id
          and comp2.consumed_in_weight = true
      ) line_totals on true
      where bh.item_id = be.item_id
        and bh.is_active = true
    ) successor on successor.item_id is not null
    where be.depth < 12
      and be.required_qty > 0
      and successor.qty > 0
  ),
  agg as (
    select be.item_id, sum(be.required_qty) as gross
    from bom_explosion be
    group by be.item_id
  )
  select
    p_demand_plan_id,
    a.item_id,
    coalesce(nullif(i.department, ''), i.item_type::text)              as department,
    (select id from public.bom_headers
       where item_id = a.item_id and is_active = true limit 1)         as bom_id,
    a.gross                                                            as required_qty,
    coalesce(i.current_stock, 0)                                       as on_hand_qty,
    greatest(0, a.gross - coalesce(i.current_stock, 0))                as net_required_qty,
    i.unit                                                             as unit,
    i.default_batch_size                                               as standard_batch_size,
    null::numeric                                                      as suggested_batches,
    null::int                                                          as rounded_batches,
    greatest(0, a.gross - coalesce(i.current_stock, 0))                as planned_qty,
    0::numeric                                                         as surplus_qty
  from agg a
  join public.items i on i.id = a.item_id;
end;
$$;
