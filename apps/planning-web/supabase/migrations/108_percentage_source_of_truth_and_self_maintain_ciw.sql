-- ============================================================================
-- Migration 108
-- Foundation work for the upcoming Vocabulary + Test-product features.
--
-- Two structural moves, both already applied to production via direct RPC
-- during the May session — this file is the canonical record so dev/staging
-- can be brought into the same shape. All statements are idempotent:
-- functions use CREATE OR REPLACE, triggers DROP IF EXISTS first.
--
-- 1) bom_lines.percentage becomes the source of truth for cascade math.
--    A trigger on bom_lines auto-computes it on every save from
--    qty_per_batch / SUM(weight rows). The five cascade functions
--    (explode_mrp + 4 sisters) read percentage first, falling back to the
--    legacy weight-share math when percentage is null.
--
-- 2) items.consumed_in_weight derives automatically from items.unit on
--    insert/update via a trigger. Aligns with the rule "if unit = kg, the
--    component is consumed by weight". Removes the class of misconfiguration
--    that broke the 2032 cascade in May 2026.
--
-- Net effect: cascade math is now percentage-driven, item flag is purely
-- informational, and the BOM editor's existing absolute-quantity entry
-- workflow continues to work without any UI change.
-- ============================================================================

-- ── 1. Recompute helper + trigger on bom_lines ────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_bom_percentages_for_header(p_bom_header_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Set percentage on weight-class rows (component consumed_in_weight = true)
  UPDATE public.bom_lines bl
     SET percentage = (bl.qty_per_batch / NULLIF(ws.total, 0)) * 100
    FROM (
      SELECT SUM(bl2.qty_per_batch) AS total
        FROM public.bom_lines bl2
        JOIN public.items     c   ON c.id = bl2.component_item_id
       WHERE bl2.bom_header_id = p_bom_header_id
         AND c.consumed_in_weight = true
    ) ws
   WHERE bl.bom_header_id = p_bom_header_id
     AND EXISTS (
       SELECT 1 FROM public.items c
        WHERE c.id = bl.component_item_id
          AND c.consumed_in_weight = true
     );

  -- Clear percentage on count-class rows (handles row toggling weight→count)
  UPDATE public.bom_lines bl
     SET percentage = NULL
   WHERE bl.bom_header_id = p_bom_header_id
     AND bl.percentage IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.items c
        WHERE c.id = bl.component_item_id
          AND c.consumed_in_weight = false
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_bom_percentages_for_header(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bom_lines_recompute_pct_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Avoid recursion: the recompute itself updates bom_lines
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public.recompute_bom_percentages_for_header(
    COALESCE(NEW.bom_header_id, OLD.bom_header_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS bom_lines_pct_recompute ON public.bom_lines;
CREATE TRIGGER bom_lines_pct_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.bom_lines
FOR EACH ROW EXECUTE FUNCTION public.bom_lines_recompute_pct_trigger();

-- One-time backfill so existing weight rows have correct percentages.
-- (Skip on dev/staging if rows are already populated; UPDATE is a no-op
-- when values match.)
UPDATE public.bom_lines bl
   SET percentage = sub.pct
  FROM (
    SELECT bl.id,
           bl.qty_per_batch
             / NULLIF(SUM(bl.qty_per_batch) OVER (PARTITION BY bl.bom_header_id), 0)
             * 100 AS pct
      FROM public.bom_lines bl
      JOIN public.items     c  ON c.id = bl.component_item_id
     WHERE c.consumed_in_weight = true
  ) sub
 WHERE bl.id = sub.id
   AND bl.percentage IS DISTINCT FROM sub.pct;

-- ── 2. Self-maintain items.consumed_in_weight from items.unit ────────────────
CREATE OR REPLACE FUNCTION public.items_derive_consumed_in_weight()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.consumed_in_weight := (NEW.unit = 'kg');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_derive_ciw ON public.items;
CREATE TRIGGER items_derive_ciw
BEFORE INSERT OR UPDATE ON public.items
FOR EACH ROW EXECUTE FUNCTION public.items_derive_consumed_in_weight();

-- One-time alignment of existing data to the derived rule.
UPDATE public.items
   SET consumed_in_weight = (unit = 'kg')
 WHERE consumed_in_weight IS DISTINCT FROM (unit = 'kg');

-- ── 3. Refactor the 5 cascade functions to use bl.unit + bl.percentage ───────
-- (Functions are unchanged in interface, only the routing logic inside
--  changes. CREATE OR REPLACE so re-applying is safe.)

CREATE OR REPLACE FUNCTION public.explode_mrp(p_demand_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
      0 as depth
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
          when bl.percentage is not null and bl.percentage > 0 then
            (be.required_qty / nullif(coalesce(bh.yield_factor, 1.0), 0))
              * (bl.percentage / 100.0)
          when bl.unit = 'kg' then
            (be.required_qty / nullif(coalesce(bh.yield_factor, 1.0), 0))
              * (bl.qty_per_batch / nullif(line_totals.recipe_sum, 0))
          when bl.basis = 'per_piece' and parent.target_weight_g > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g) * bl.qty_per_batch
          when bl.basis = 'per_inner' and parent.target_weight_g > 0 and parent.units_per_inner > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_inner) * bl.qty_per_batch
          when bl.basis = 'per_outer' and parent.target_weight_g > 0 and parent.units_per_outer > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_outer) * bl.qty_per_batch
          when bl.basis = 'per_pallet' and parent.target_weight_g > 0 and parent.units_per_pallet > 0 then
            (be.required_qty * 1000.0 / parent.target_weight_g / parent.units_per_pallet) * bl.qty_per_batch
          when bl.basis = 'per_kg' then
            be.required_qty * bl.qty_per_batch
          else
            be.required_qty * bl.qty_per_batch / 1000.0
        end as qty
      from public.bom_headers bh
      join public.bom_lines   bl   on bl.bom_header_id = bh.id
      left join lateral (
        select sum(bl2.qty_per_batch) as recipe_sum
        from public.bom_lines bl2
        where bl2.bom_header_id = bh.id
          and bl2.unit = 'kg'
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
    coalesce(nullif(i.department, ''), i.item_type::text) as department,
    (select id from public.bom_headers
       where item_id = a.item_id and is_active = true limit 1) as bom_id,
    a.gross                                                    as required_qty,
    coalesce(i.current_stock, 0)                                as on_hand_qty,
    greatest(0, a.gross - coalesce(i.current_stock, 0))         as net_required_qty,
    i.unit                                                       as unit,
    i.default_batch_size                                         as standard_batch_size,
    null::numeric                                                as suggested_batches,
    null::int                                                    as rounded_batches,
    greatest(0, a.gross - coalesce(i.current_stock, 0))          as planned_qty,
    0::numeric                                                   as surplus_qty
  from agg a
  join public.items i on i.id = a.item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_plan_dept_materials(p_demand_plan_id uuid)
RETURNS TABLE(consuming_dept text, component_id uuid, component_code text, component_name text, component_type text, component_unit text, required_qty numeric, on_hand_qty numeric, net_required_qty numeric, parent_count integer, parent_codes text[])
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  with
  parents as (
    select
      m.item_id,
      coalesce(nullif(p.department, ''), p.item_type::text) as parent_dept,
      m.planned_qty                                          as parent_qty,
      m.bom_id,
      p.target_weight_g, p.units_per_inner, p.units_per_outer, p.units_per_pallet,
      coalesce(bh.yield_factor, 1.0) as yield_factor,
      p.code as parent_code
    from public.mrp_results m
    join public.items        p  on p.id  = m.item_id
    left join public.bom_headers bh on bh.id = m.bom_id
    where m.demand_plan_id = p_demand_plan_id
      and m.bom_id is not null
      and m.planned_qty > 0
  ),
  recipe_totals as (
    select bl.bom_header_id as bom_id, sum(bl.qty_per_batch) as recipe_sum
    from public.bom_lines bl
    where bl.unit = 'kg'
    group by bl.bom_header_id
  ),
  consumption as (
    select
      p.parent_dept                               as consuming_dept,
      bl.component_item_id                        as component_id,
      p.item_id                                   as parent_item_id,
      p.parent_code                               as parent_code,
      case
        when bl.percentage is not null and bl.percentage > 0 then
          (p.parent_qty / nullif(p.yield_factor, 0)) * (bl.percentage / 100.0)
        when bl.unit = 'kg' then
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
        when bl.basis = 'per_kg' then p.parent_qty * bl.qty_per_batch
        else p.parent_qty * bl.qty_per_batch / 1000.0
      end as gross_qty
    from parents p
    join public.bom_lines bl on bl.bom_header_id = p.bom_id
    join public.items     c  on c.id = bl.component_item_id
    left join recipe_totals rt on rt.bom_id = p.bom_id
    where c.item_type::text in ('raw_material','packaging','consumable')
  )
  select
    cn.consuming_dept,
    cn.component_id,
    i.code, i.name, i.item_type::text, i.unit,
    sum(cn.gross_qty)                       as required_qty,
    coalesce(i.current_stock, 0)            as on_hand_qty,
    greatest(0, sum(cn.gross_qty) - coalesce(i.current_stock, 0)) as net_required_qty,
    count(distinct cn.parent_item_id)::int  as parent_count,
    array_agg(distinct cn.parent_code order by cn.parent_code) as parent_codes
  from consumption cn
  join public.items i on i.id = cn.component_id
  where cn.gross_qty > 0
  group by cn.consuming_dept, cn.component_id, i.code, i.name, i.item_type, i.unit, i.current_stock;
$function$;

-- get_plan_dept_materials_by_day, get_po_suggestions, get_rm_parent_breakdown
-- already in production (applied in May 2026 session). Their bodies use
-- the same percentage-first / bl.unit='kg' pattern. They are NOT duplicated
-- here to keep this migration focused on the single fix; their canonical
-- definitions sit in their own existing migration files (102, 105, 107)
-- and the May 2026 session updated them in-place via CREATE OR REPLACE.
-- If you're applying these migrations to a fresh dev DB, run migrations
-- 102 + 105 + 107 + 108 in order.
