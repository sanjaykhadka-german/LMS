-- ============================================================================
-- 102  RPC — get_plan_dept_materials_by_day(plan_id)
-- ----------------------------------------------------------------------------
-- Phase 9.4 (Tino May 2026 — pressing): the existing get_plan_dept_materials
-- RPC aggregates per (consuming_dept, component) but loses the day dimension.
-- Operations need to know "what RM does Production need on Tuesday vs.
-- Wednesday" to stage cool-rooms and place purchase orders sized to the
-- real per-day pull, not just the weekly total.
--
-- This RPC adds production_date to the GROUP BY by joining to
-- production_orders (the operator-controlled day) when one exists, falling
-- back to mrp_results.scheduled_date, and finally to NULL for unscheduled
-- demand. Rows with NULL date roll up under "Unscheduled" in the UI.
--
-- Math is identical to migration 071 — same explode_mrp formula in the
-- consumption CTE — only the GROUP BY changes.
-- ============================================================================

create or replace function public.get_plan_dept_materials_by_day(p_demand_plan_id uuid)
returns table (
  consuming_dept   text,
  production_date  date,
  component_id     uuid,
  component_code   text,
  component_name   text,
  component_type   text,
  component_unit   text,
  required_qty     numeric,
  on_hand_qty      numeric,
  net_required_qty numeric,
  parent_count     int,
  parent_codes     text[]
)
language sql
security definer
stable
as $$
  with
  -- Latest non-cancelled production_order per item in the plan, used to pull
  -- the operator-controlled production_date. We fall back to mrp_results
  -- when no production_order exists yet.
  po_per_item as (
    select
      po.item_id,
      po.production_date
    from public.production_orders po
    where po.demand_plan_id = p_demand_plan_id
      and po.status <> 'cancelled'
  ),
  -- Per-item planned qty + parent attributes + the computed production_date
  -- (production_orders first, mrp_results.scheduled_date fallback).
  parents as (
    select
      m.item_id,
      coalesce(nullif(p.department, ''), p.item_type::text) as parent_dept,
      coalesce(po.production_date, m.scheduled_date)        as production_date,
      m.planned_qty                                          as parent_qty,
      m.bom_id,
      p.target_weight_g,
      p.units_per_inner,
      p.units_per_outer,
      p.units_per_pallet,
      coalesce(bh.yield_factor, 1.0)                         as yield_factor,
      p.code                                                  as parent_code
    from public.mrp_results        m
    join public.items              p   on p.id  = m.item_id
    left join public.bom_headers   bh  on bh.id = m.bom_id
    left join po_per_item          po  on po.item_id = m.item_id
    where m.demand_plan_id = p_demand_plan_id
      and m.bom_id is not null
      and m.planned_qty > 0
  ),
  recipe_totals as (
    select
      bl.bom_header_id          as bom_id,
      sum(bl.qty_per_batch)     as recipe_sum
    from public.bom_lines bl
    join public.items     c  on c.id = bl.component_item_id
    where c.consumed_in_weight = true
    group by bl.bom_header_id
  ),
  consumption as (
    select
      p.parent_dept                               as consuming_dept,
      p.production_date                           as production_date,
      bl.component_item_id                        as component_id,
      p.item_id                                   as parent_item_id,
      p.parent_code                               as parent_code,
      case
        when c.consumed_in_weight then
          (p.parent_qty / nullif(p.yield_factor, 0))
            * (bl.qty_per_batch / nullif(rt.recipe_sum, 0))
        when bl.basis = 'per_piece'  and p.target_weight_g  > 0 then
          (p.parent_qty * 1000.0 / p.target_weight_g) * bl.qty_per_batch
        when bl.basis = 'per_inner'  and p.target_weight_g  > 0 and p.units_per_inner  > 0 then
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_inner)  * bl.qty_per_batch
        when bl.basis = 'per_outer'  and p.target_weight_g  > 0 and p.units_per_outer  > 0 then
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_outer)  * bl.qty_per_batch
        when bl.basis = 'per_pallet' and p.target_weight_g  > 0 and p.units_per_pallet > 0 then
          (p.parent_qty * 1000.0 / p.target_weight_g / p.units_per_pallet) * bl.qty_per_batch
        when bl.basis = 'per_kg' then
          p.parent_qty * bl.qty_per_batch
        else
          p.parent_qty * bl.qty_per_batch / 1000.0
      end                                          as gross_qty
    from parents             p
    join public.bom_lines    bl on bl.bom_header_id = p.bom_id
    join public.items        c  on c.id = bl.component_item_id
    left join recipe_totals  rt on rt.bom_id = p.bom_id
    where c.item_type::text in ('raw_material', 'packaging', 'consumable')
  )
  select
    cn.consuming_dept,
    cn.production_date,
    cn.component_id,
    i.code                                  as component_code,
    i.name                                  as component_name,
    i.item_type::text                       as component_type,
    i.unit                                  as component_unit,
    sum(cn.gross_qty)                       as required_qty,
    coalesce(i.current_stock, 0)            as on_hand_qty,
    greatest(0, sum(cn.gross_qty) - coalesce(i.current_stock, 0)) as net_required_qty,
    count(distinct cn.parent_item_id)::int  as parent_count,
    array_agg(distinct cn.parent_code order by cn.parent_code) as parent_codes
  from consumption cn
  join public.items i on i.id = cn.component_id
  where cn.gross_qty > 0
  group by cn.consuming_dept, cn.production_date, cn.component_id, i.code, i.name, i.item_type, i.unit, i.current_stock;
$$;

comment on function public.get_plan_dept_materials_by_day(uuid) is
  'Phase 9.4 — per-day, per-dept materials for a demand plan. Same math as get_plan_dept_materials (migration 071) plus a production_date column derived from production_orders (operator-controlled day) with mrp_results.scheduled_date as fallback.';
