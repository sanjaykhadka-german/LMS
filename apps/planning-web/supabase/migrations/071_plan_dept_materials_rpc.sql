-- ============================================================================
-- 071  RPC — get_plan_dept_materials(plan_id)
-- ----------------------------------------------------------------------------
-- Backs the per-department "🧂 Materials" modal on the demand plan page.
-- Returns one row per (consuming_dept, component) tuple, where consuming_dept
-- is the department of the IMMEDIATE parent item that uses this material in
-- its BOM (one level deep — not the full recursive explosion).
--
-- Math mirrors the explode_mrp function (migration 067) exactly so per-dept
-- numbers reconcile with the global Raw Materials view:
--   • consumed_in_weight = true   → recipe-ratio split with yield_factor
--   • basis = per_piece / per_inner / per_outer / per_pallet / per_kg
--   • basis = NULL on a non-weight line → legacy "per 1000 kg of parent"
--     fallback (matches migration 067)
--
-- The first attempt at this feature did the math client-side with a simplified
-- formula that assumed every BOM had at least one weight-consumed line. Tracey's
-- Filling and Packing BOMs only contain casings / crates / labels (all
-- consumed_in_weight = false), so that formula divided by zero and showed an
-- empty list. This RPC handles every basis variant the same way explode_mrp
-- does, so Filling/Packing/Labelling now produce results too.
-- ============================================================================

create or replace function public.get_plan_dept_materials(p_demand_plan_id uuid)
returns table (
  consuming_dept   text,
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
  -- All items in the plan that have an active BOM. These are the "parents"
  -- whose BOM lines we attribute material consumption against.
  parents as (
    select
      m.item_id,
      coalesce(nullif(p.department, ''), p.item_type::text) as parent_dept,
      m.planned_qty                                          as parent_qty,
      m.bom_id,
      p.target_weight_g,
      p.units_per_inner,
      p.units_per_outer,
      p.units_per_pallet,
      coalesce(bh.yield_factor, 1.0)                         as yield_factor,
      p.code                                                  as parent_code
    from public.mrp_results m
    join public.items        p  on p.id  = m.item_id
    left join public.bom_headers bh on bh.id = m.bom_id
    where m.demand_plan_id = p_demand_plan_id
      and m.bom_id is not null
      and m.planned_qty > 0
  ),
  -- Per-BOM recipe sum (Σ consumed_in_weight=true qty_per_batch). Empty
  -- when a BOM has only packaging/casing lines — that's fine, only the
  -- recipe-ratio branch needs a non-null recipe_sum.
  recipe_totals as (
    select
      bl.bom_header_id          as bom_id,
      sum(bl.qty_per_batch)     as recipe_sum
    from public.bom_lines bl
    join public.items     c  on c.id = bl.component_item_id
    where c.consumed_in_weight = true
    group by bl.bom_header_id
  ),
  -- Per parent × bom-line edge: gross qty contributed to this component by
  -- this parent. Uses the same case-statement as explode_mrp.
  consumption as (
    select
      p.parent_dept                               as consuming_dept,
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
          -- Legacy fallback: basis missing on a non-weight line → "per 1000 kg of parent"
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
  group by cn.consuming_dept, cn.component_id, i.code, i.name, i.item_type, i.unit, i.current_stock;
$$;

comment on function public.get_plan_dept_materials(uuid) is
  'Per-department materials for a demand plan (one BOM level deep). Returns one row per (consuming_dept, component) tuple. Math mirrors explode_mrp (migration 067).';
