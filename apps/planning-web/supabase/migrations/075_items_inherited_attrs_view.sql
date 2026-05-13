-- ============================================================================
-- 075  V_ITEMS_INHERITED_ATTRS — pack/fill/target inherited from parent chain
-- ----------------------------------------------------------------------------
-- For each item, exposes the "effective" value of fill_weight_g / target_weight_g
-- and the pack-hierarchy columns by walking UP the parent_item_id chain and
-- taking the FIRST non-null value found. So a leaf FG that doesn't have its
-- own fill/target set will inherit them from its closest ancestor (typically
-- a WIPF or WIP).
--
-- Why a view: the items table is fetched paginated (200 rows per page) in
-- the Item Master grid. Walking the parent chain client-side would require
-- loading every ancestor, which isn't practical. The view does a single
-- recursive CTE pass and returns the inherited values per leaf item, ready
-- to merge into the grid.
--
-- Depth cap: 10. Tracey's family trees are 3-5 levels deep; 10 gives plenty
-- of headroom and protects against cycles.
-- ============================================================================

create or replace view public.v_items_inherited_attrs as
with recursive walk as (
  -- Anchor: each item starts the walk at itself.
  select
    id              as leaf_id,
    id              as current_id,
    parent_item_id,
    tenant_id,
    fill_weight_g,
    target_weight_g,
    process_loss_pct,
    units_per_inner,
    units_per_outer,
    units_per_pallet,
    inner_per_outer,
    outers_per_pallet,
    tare_weight_g,
    tolerance_over_g,
    tolerance_under_g,
    0               as depth
  from public.items

  union all

  -- Recursive step: for each row already in walk, jump to its parent and
  -- emit a new row. The leaf_id is preserved so we can aggregate per leaf.
  select
    w.leaf_id,
    p.id,
    p.parent_item_id,
    w.tenant_id,
    p.fill_weight_g,
    p.target_weight_g,
    p.process_loss_pct,
    p.units_per_inner,
    p.units_per_outer,
    p.units_per_pallet,
    p.inner_per_outer,
    p.outers_per_pallet,
    p.tare_weight_g,
    p.tolerance_over_g,
    p.tolerance_under_g,
    w.depth + 1
  from walk w
  join public.items p on p.id = w.parent_item_id
  where w.depth < 10
)
select
  leaf_id as id,
  -- For each field, take the value at the SHALLOWEST depth where it's non-null.
  -- The depth-ordered array_agg + [1] picks the closest ancestor's value.
  (array_agg(fill_weight_g     order by depth) filter (where fill_weight_g     is not null))[1] as inherited_fill_weight_g,
  (array_agg(target_weight_g   order by depth) filter (where target_weight_g   is not null))[1] as inherited_target_weight_g,
  (array_agg(process_loss_pct  order by depth) filter (where process_loss_pct  is not null))[1] as inherited_process_loss_pct,
  (array_agg(units_per_inner   order by depth) filter (where units_per_inner   is not null))[1] as inherited_units_per_inner,
  (array_agg(units_per_outer   order by depth) filter (where units_per_outer   is not null))[1] as inherited_units_per_outer,
  (array_agg(units_per_pallet  order by depth) filter (where units_per_pallet  is not null))[1] as inherited_units_per_pallet,
  (array_agg(inner_per_outer   order by depth) filter (where inner_per_outer   is not null))[1] as inherited_inner_per_outer,
  (array_agg(outers_per_pallet order by depth) filter (where outers_per_pallet is not null))[1] as inherited_outers_per_pallet,
  (array_agg(tare_weight_g     order by depth) filter (where tare_weight_g     is not null))[1] as inherited_tare_weight_g,
  (array_agg(tolerance_over_g  order by depth) filter (where tolerance_over_g  is not null))[1] as inherited_tolerance_over_g,
  (array_agg(tolerance_under_g order by depth) filter (where tolerance_under_g is not null))[1] as inherited_tolerance_under_g,
  -- Tenant follows the leaf — every row in the walk has the same tenant
  -- because parent_item_id never crosses tenants. Surface it so RLS works.
  (array_agg(tenant_id order by depth desc))[1] as tenant_id
from walk
group by leaf_id;

comment on view public.v_items_inherited_attrs is
  'For each item, returns fill / target / pack-hierarchy values inherited from the closest ancestor with that value set. Used by the Item Master grid for parent-down value propagation.';

-- The view inherits RLS from the underlying items table since it's defined
-- as security_invoker by default. No additional policies needed.
