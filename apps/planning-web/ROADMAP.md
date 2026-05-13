# Tracey Planning App — Roadmap

Living checklist of upcoming work, ordered by priority. Tick boxes as we go.
The TodoList widget in Cowork mirrors the active items below.

---

## 🟢 Up Next (immediate)

- [x] **Department fix for 5 orphan items** (1003SL, 2006, 2006.1, 2006.11, 2006.4 — `items.department` set so they stop landing in fake `wip`/`finished_good` buckets when Generate runs).
- [ ] **Reopen plan + re-run Generate Orders & Lock** so the 7 stale orders get re-routed to their proper departments.
- [ ] **Audit 14 migrated items** — open each in Item Master and confirm the per-piece value reads sensibly (after migration 076 divided by `units_per_inner`):
  - 100g Chorizo (R / 1000 / 15.0.08 / 1 / 100.2)
  - 125g Chorizo (125.02 / 125.03)
  - 50g Costco Hot Dog (×4 — DOMESTIC, NZ, W- variants)
  - 30g Chipolata (Downs Chorizo / 30.1500.0.8)
  - 15g Mini Chorizo (Flair)
  - Already-correct outlier: `2025.030.1000` Downs Chicken & Thyme Chipolata (skipped by migration heuristic)
- [ ] **Test the new Test-this-product button** on `2032.050.20.7` Costco Tasty Juicy. Order 33,600 units → expect 1,680 kg cascade at every level + ~$4,395 raw cost. Flip UOM tabs (kg, inner, outer, pallet) and verify totals stay constant.
- [ ] **Test the Vocabulary settings page** (`/settings/vocabulary`). Rename "Stage" → "Phase", verify it persists, click Reset to flip back.

## 🟢 NEW major workstream — Tracey as a multi-industry platform

Goal: hide WIP/WIPF/WIPP/Finished-Good terminology from end users, let each tenant rename labels in plain language, and prove every BOM with a one-click "Test this product" cascade. This makes Tracey approachable for bakeries, cosmetics manufacturers, coffee roasters, cheesemakers, etc., not just butchery.

Rollout plan in `/tracey-rollout-plan.md`. Designed mockup in `/tracey-setup-mockup.html`.

- [x] **Phase 0 — foundation (May 8 batch)**
  - Migration 108: `bom_lines.percentage` becomes the source of truth for cascade math (auto-recompute trigger on save). `items.consumed_in_weight` self-maintained from `items.unit`. Five cascade functions (explode_mrp + sisters) refactored to read percentage / `bl.unit='kg'` instead of the old item flag.
  - Net effect: cascade math no longer depends on item-level flags; the 2032 Costco Tasty Juicy bug class can't recur. Existing data backfilled.
- [x] **Phase 1 — vocabulary system (DB + frontend)**
  - Migration 109: `label_canonical_keys` reference table + `tenant_labels` per-tenant override + `get_tenant_labels` / `set_tenant_label` / `reset_tenant_label` RPCs (admin-only via RLS).
  - Frontend: `useTenantLabels()` hook (`src/lib/hooks/use-tenant-labels.ts`) and Vocabulary settings page (`/settings/vocabulary`).
  - Status: live, but labels aren't yet threaded through existing screens — renaming "Stage" doesn't visibly change Item Master / BOM editor / etc. yet. That's Phase 2.5.
- [x] **Phase 2 — Test this product (DB + frontend)**
  - Migration 110: `test_product_cascade(item_id, qty, uom)` RPC returning JSONB with cascade + shopping list + totals.
  - Frontend: ▷ Test this product button on the item detail page, opens a draggable modal with UOM tabs, equivalents strip, summary cards, cascade table, shopping list.
- [ ] **Phase 2.5 — thread `t()` through existing screens**
  - Wire `useTenantLabels()` into Item Master, BOM editor, plan editor, demand modal, scheduling kanbans, RM schedule, settings nav. Mechanical but tedious. Once done, renaming a label on the Vocabulary page actually changes the wording across the app.
- [ ] **Phase 3 — Product canvas (visual cascade on item detail)**
  - Replace the current item-master detail layout with a visual cascade flow diagram (Mix → Fill → Pack → Label as clickable cards), traffic-light readiness pills (Costing / Planning / QA / Purchasing / Dispatch), persistent Test-this-product button. Underlying data unchanged; just a layout refactor.
- [ ] **Phase 4 — Setup wizard + archetype templates**
  - Pick-type entry flow (Resold / 1-step / Multi-step / Clone existing). Archetype JSON templates for common chain shapes. Guided question-per-screen wizard that ends with the Phase-2 sanity-check screen as final confirmation.
- [ ] **Phase 5 — Collapse item types to 4 user-facing concepts**
  - View-layer collapse: `raw_material → ingredient`, `wip/wipf/wipp → step`, `finished_good → product`, `packaging/consumable → supply`. Database keeps original column unchanged. UI hides WIP/WIPF/WIPP terminology entirely.
- [ ] **Phase 6 — Marketing site + industry archetype catalogue**
  - Public homepage with industry toggle (Butcher / Bakery / Cosmetics / Coffee / Cheese / etc.). Live demo with vocabulary + sample products per industry.

## 🟢 Active workstream — Plan publishing flow (Generate → Schedule → Lock)

Operational pain point: today "Generate All Orders & Lock" does Generate + Lock in one click, with date allocation as an awkward optional pre-step. Operators want to Generate first (orders bucketed under WC Monday), drag-drop within each dept's calendar to spread across days, then Lock & Publish to the floor.

- [ ] **Phase 1 — split Generate from Lock**
  Rename "Generate All Orders & Lock" → "Generate Orders" (no auto-lock). Add separate "Lock & Publish" button that becomes available once orders exist. Plan stays in `draft` between the two steps.
- [ ] **Phase 2 — drag-drop calendar per dept**
  Each dept modal shows Mon–Sun columns + an "Unscheduled" pile. Drag `production_orders` rows between days to set `production_date`. Red-dot indicator when dept has unscheduled orders.
- [ ] **Phase 3 — Lock & Publish gate**
  Lock & Publish enabled only when scheduling done (or operator explicitly OK with some on Monday default). Floor screens filter to only show published orders.
- [ ] **Polish — pre-Generate validation banner** (catches missing `items.department` BEFORE you click Generate, so we never see fake `wip`/`finished_good` buckets again).
- [ ] **Polish — make `items.department` required** for items where `procurement_type = 'produce'`. Root-cause fix.

## 🟡 Active workstream — Option B (variable pack hierarchy)

Phase 1 ✅ shipped (catalogue table, items.pack_levels jsonb, sync trigger, Settings UI).

- [ ] **Phase 2 — dynamic pack-level inputs in item form**
  Replace hard-coded Pieces/Inner + Inners/Outer + Outers/Pallet trio with one input per active row in `tenant_pack_level_defs`. Form writes to `items.pack_levels` (jsonb); the migration-074 trigger keeps the legacy columns in sync so explode_mrp / BOM / demand modal continue to work unchanged.
- [ ] **Phase 3 — demand modal reads pack_levels**
  Add-Item modal's multi-unit grid columns (Pieces / Inners / Outers / Pallets / Kg) become one column per defined level, dynamically rendered from `items.pack_levels`.

## 🟢 Next major workstream — Option β (production routes)

Replace the hard-coded WIP→Fill→Pack→Dispatch flow with named, ordered, tenant-defined routes. Builds on top of Option B.

- [ ] **Phase 1 — schema**
  Migration: `production_stages` (tenant catalogue: cutting / filling / cooking / smoking / pasteurise / blast_freeze / packing / labelling / dispatch), `production_routes` (named, ordered), `production_route_steps`, `items.production_route_id` FK. Seed German Butchery defaults so existing items get a sensible route assignment.
- [ ] **Phase 2 — MRP + Generate Orders walk routes**
  `explode_mrp` and `generateProductionOrders` walk the route to spawn one `production_orders` row per step (with `route_step_id`). Existing per-item-per-dept orders still work via a default route that mirrors today's flow.
- [ ] **Phase 3 — UI + settings**
  Plan-editor's dept cards become stage cards built dynamically from routes used by items in the plan. Settings page `/settings/production-routes` for tenant catalogue + route editing. Feature flag so existing tenants stay on the legacy hardcoded flow until they opt in.

## 🟡 Quick wins / polish

- [ ] **Adaptive (faceted) filters in Item Master**
  Each filter dropdown shows only values present in the currently filtered subset, with counts (e.g. selecting type=WIP shrinks the Department dropdown to just departments that have WIPs).
- [ ] **BOM-derived components on Filling / Packing cards**
  Show casings/clips/labels/cartons from the active BOM on the item detail view's Filling Attributes and Packing Attributes cards. Operator can see what consumables are wired in.
- [ ] **Fix `basis = null` BOM rows for packaging components**
  Surfaced by the Phase 2 test feature: rows like "Tasty Juicy box" and "Plain label" have `basis = null` and fall through to legacy `qty/1000` math, producing nonsense quantities (1.68 boxes for 33,600 hot dogs). Need to set `basis = 'per_outer'` for boxes, `basis = 'per_piece'` for labels, etc. Possibly automate via a one-time data fix script.

## 🔵 Backlog / nice-to-have

- [ ] Auto-recalc notification when a parent's value changes (children silently start showing the new inherited value today; we could surface a "review affected children" panel)
- [ ] Bulk re-MRP across multiple plans (single trigger)
- [ ] Production-order calendar view (drag orders between days)
- [ ] Export production orders to Excel for floor printing
- [ ] Multi-week / rolling demand plan templates

---

## ✅ Recently shipped (last few sessions)

Reverse chronological. Anything below this line is in `main` and live on Vercel.

### 2026-05-09 — Multi-industry platform foundation (Phase 0/1/2)

- ✅ **Migration 108** — `bom_lines.percentage` is now the source of truth for cascade math. Save trigger on `bom_lines` auto-recomputes percentages from `qty_per_batch / SUM(weight rows) * 100`. `items.consumed_in_weight` derives automatically from `items.unit` via a `BEFORE INSERT/UPDATE` trigger. Five cascade functions (`explode_mrp`, `get_plan_dept_materials`, `get_plan_dept_materials_by_day`, `get_po_suggestions`, `get_rm_parent_breakdown`) refactored to read `bl.percentage` first, falling back to the legacy weight-share math. Item-level flags no longer load-bearing for cascade routing.
- ✅ **Fixed** — Costco Tasty Juicy 2032 cascade was producing 1.68 kg at every upstream level instead of 1,680 kg. Root cause: `2032.050.20.consumed_in_weight = false` (out of step with the other 29 WIPP items) made the function fall through to a fallback that divided by 1000. Now self-corrected by the new triggers.
- ✅ **Migration 109** — Vocabulary system. `label_canonical_keys` reference table + `tenant_labels` per-tenant override table. Three RPCs: `get_tenant_labels()` (returns merged view), `set_tenant_label(key, label)` (admin-only), `reset_tenant_label(key)` (admin-only). RLS aligned with existing `my_tenant_id()` + `is_admin_or_above()` pattern. Seeded with 8 canonical keys: `step`, `ingredient`, `product`, `supply`, `department`, `process_loss`, `giveaway`, `tare`.
- ✅ **Migration 110** — `test_product_cascade(item_id, qty, uom)` RPC. Takes a hypothetical order and runs it through the BOM cascade without persisting anything. Returns JSONB with cascade stages, shopping list with costs, and totals. Verified consistent across all 5 UOMs.
- ✅ **Frontend: Vocabulary settings page** (`/settings/vocabulary`, admin-only). Inline-edit table — type, blur or Enter saves; ESC reverts; customised entries get a badge + Reset button.
- ✅ **Frontend: Test this product button** on item detail page. Draggable modal with UOM toggle, equivalents strip, summary cards (cost, cost/unit, cost/kg), cascade table, shopping list with suppliers and costs.
- ✅ **Frontend: `useTenantLabels()` hook** (`src/lib/hooks/use-tenant-labels.ts`). 5-min cache, returns `t(key)` function. Not yet threaded through existing screens — that's Phase 2.5.
- ✅ **Mockup + rollout plan** (`tracey-setup-mockup.html`, `tracey-rollout-plan.md`). 5 industries (Butcher / Bakery / Cosmetics / Coffee / Cheese) with full vocabulary swapping. 6-phase rollout plan with rollback per phase.

### 2026-05 — earlier batch

- ✅ **Migration 076** — definitively flipped `target_weight_g` to per-piece. Data fix divided 14 items' values by `units_per_inner`. Reverted `explode_mrp` formulas to per-piece interpretation. UI labels, form math, demand modal, items table all updated to match.
- ✅ **Item Master row → sized popup window** + refresh banner reminding operator to Ctrl+F5 after edits.
- ✅ **Form ghost-text inheritance** + "Use parent's values" buttons in Filling and Packing sections.
- ✅ **Migration 075** — `v_items_inherited_attrs` view: walks each item's parent chain and exposes inherited fill / target / pack-hierarchy values for grid display.
- ✅ **Item grid columns** — added Carton (kg) and Pallet (kg) from `item_pallet_config`; Actual Fill Wt + Target Piece Wt with parent-chain inheritance shown via "↑" prefix in muted italic.
- ✅ **Multi-select filters** for Type / Category / Subcategory / Department in Item Master.
- ✅ **DataTable resize** — starts from rendered width; min/max width pinned so columns honour the user's drag.
- ✅ **Migrations 073 + 074** — Option B Phase 1: `tenant_pack_level_defs` catalogue + `items.pack_levels jsonb` + sync trigger + Settings page `/settings/pack-levels`.
- ✅ **Demand-grid sortable headers**, **3-state Active/Inactive/Both filter**, **Build Family Tree picker**, **Migration 068** (items.sort_order + product-tree grid + reorder ↑↓ + promote ↰), **Migration 069** (delete-draft-plan RLS, admin-only).
- ✅ **Demand-entry modal** — multi-row grid with Tab-to-new-row, multi-unit qty (Pieces / Inners / Outers / Pallets / Kg), WIP/FG type filter chips, focus-jump after item pick, dropdown overflow fix, auto-save on Add & Close.
- ✅ **Item Master form** — weight_mode visible on every item type, UOM dropdowns wired, parent-item dropdown row cap fixed.
- ✅ **Migration 071** — `get_plan_dept_materials` RPC for per-department materials cards.

---

_Last updated by Claude on the multi-industry platform foundation session (2026-05-09)._
