# Active threads

_Last updated: 2026-05-11 (Tino & Claude pair)._

## In flight

**BOM data model overhaul — natural-language entry**
> The big one. Operators currently enter `0.000125` of a roll; we're moving to "1 × Item per M [scope]" everywhere.
> - [x] Migration 122 — `bom_lines.consume_per_qty` (the M denominator). Applied 2026-05-11.
> - [x] Step 2: guided filling-section preview on item edit page — "What this means" panel under Filling Attributes shows units/kg + cook yield + invitation to use "per unit" in BOM lines. Live-recomputes as fill/target/loss change.
> - [x] Step 3: BOM-line entry redesign. Table now reads as `Component · Qty(N) · Unit · "per" · M · Scope · Grind · Comment`. Packaging lines (consumed_in_weight=false) show the N × per M flow; ingredient lines keep their % field. Save-side recomputes qty_per_batch = N/M and writes consume_per_qty = M. Edit cycle round-trips.
> - [x] Step 6: basis-aware cascade. Migration 123 ships `v_item_landed_cost_v2` + `test_product_cascade_v2`. Both walk the explosion path to inherit `target_weight_g` + `units_per_inner/outer/pallet` from the nearest ancestor (typically the FG). Replaces the v1 silent `qty * qty_per_batch / 1000` fall-through with NULL + `hierarchy_missing` flag. Continental Frankfurter (R) verified: BW HB 175 went from 0.000 roll to 0.0893 roll for 100 kg of FG. /costings + Test Product modal switched to v2. Surfaces `leaves_missing_hierarchy` chip in Health column and "? no pack" in qty cell.
> - [ ] Step 4 — tenant vocabulary plumbing so "unit" renders as "log" / "sausage" / "tray" per item type or tenant. Today the scope dropdown shows "unit (piece / log / sausage)" as a hint; goal is full vocab swap.
> - [ ] Step 5: display update — work-order recipe page, run-sheet print, BOM list table, test modal — all show natural-language form.
> - [ ] Step 7: backfill helper — list legacy lines with `consume_per_qty=1`, suggest friendly (N, M), one-click confirm.
>
> Design + decisions: `docs/bom-data-model.md` and `docs/decisions/2026-05-bom-natural-language.md`.

## Pending / not yet started

- **BOM data audit — packaging entry typos exposed by v2 cascade**. v1 cascade silently dropped per_piece/per_inner/per_outer/per_pallet packaging lines whose containing item lacked pack hierarchy. v2 fixes that, but in doing so surfaces a pile of historically-wrong N/M entries. Concrete: Chorizo Chipolata FG has "Printed colour GB label" stored as `qty_per_batch=4000, basis=per_piece` — reads as "4000 labels per single sausage", which inflates landed cost to ~$3.9M/kg. Several Chipolata-family WIPFs share an identical $26,622/kg delta (same root-cause shared component). Approach: walk top-of-list on /costings, drill in via test modal, click-to-edit the offending line, fix N/M. Rinse and repeat until /costings is honest.
- **Costings Phase 3** — full landed cost per item (RM + conversion + plant overhead + G&A).
- **Costings Phase 4** — margin per customer / per SKU, floor-margin red flags.
- **Costings Phase 5** — variance: actual vs standard, per WO.
- **Disruptive costing home page** — top makers / bleeders / where money goes / sparklines.
- **Guided item & BOM setup rethink** (#56, longstanding) — for non-technical users.
- **Cost history snapshot table** — enables sparklines and "RM up 8% w/w" attribution.
- **Customer prices / price list joined to dispatch data** — needed for realised margin.

## In flight (cont'd)

**Costings Phase 2 — routing-based conversion costs**
> Replaces the original flat-per-dept Pass 1 (mig 124 dropped via mig 125). Tino's actual mental model is per-product step routings (e.g. "Filling: 2 people 120 min per 1000 kg") × hourly labour rate, plus a tenant-level standard overhead $/kg with weekly actuals tracked separately. See decisions log for the rationale.
> - [x] Mig 125 — drop the wrong-shape `dept_cost_rates` table.
> - [x] Mig 126 — `labour_rates` table (tenant-level standard $/hour, effective-dated) + `v_labour_rate_current` view.
> - [x] `/costings/rates` admin page rebuilt as the labour-rate editor: single $/hour input + notes, Save UPSERTs today's row, History expand below.
> - [x] Mig 127 — `production_routings` table (per-BOM list of steps with people / minutes / ref qty / ref basis) + `v_bom_routing_cost` and `v_bom_routing_cost_summary` views. Basis-aware: 'kg' / 'unit' / 'inner' / 'outer' / 'pallet' all convert to $/kg using the BOM owning item's pack hierarchy. Surfaces `hierarchy_missing` when pack data is incomplete.
> - [x] `/bom/[id]/routing` editor — per-BOM table with Add/Reorder/Delete steps, live $/kg per step using the current hourly rate, total + per-dept breakdown at the bottom. "⚙ Routing" link added to the BOM detail page header.
> - [ ] **NEXT — Tino**: (a) set the hourly rate on `/costings/rates` if not done, (b) populate routings on a few key BOMs to validate the math.
> - [x] Mig 128 — `overhead_actuals` + `overhead_week_kg` + `overhead_standard_rate` (effective-dated, with `previous_rate` snapshot + `override_reason` for audit) + `v_overhead_week_summary` (real $/kg per week) + `v_overhead_standard_current` (cascade joins this).
> - [x] `/costings/overheads` page with two cards: Standard rate (with "use 4-week derived average" shortcut + history) + Weekly tracker (week picker, line items by category with suggestions, kg-produced denominator, recent-weeks mini-trend).
> - [x] Mig 129 — `v_item_landed_cost_v3`. Same recursive cascade as v2 + per-node labour cost (joins `v_bom_routing_cost_summary`, summed up the BOM tree) + root-level overhead (joins `v_overhead_standard_current`, only for producible item types so we don't double-count). Variance now compares against TOTAL, not just RM.
> - [x] `/costings` page switched to v3, four cost columns added: RM / Labour / OH / Total. Tooltips on each. `⚠` icon on Labour cell when pack hierarchy is missing on a routing step. "Avg total/unit" replaces "Avg cost/unit" in the KPI bar.
> - **Phase 2 shipped end-to-end** ✅. Verified on Costco Tasty Juicy Hot Dogs Domestic: RM $2.91 + Labour $3.55 (cascaded through WIP $0.17 → WIPF $2.37 → WIPP $3.16 → FG $3.55) = $6.46/kg total. NZ variant of same product: $5.50/kg (different routing). Setting an OH standard rate will add a $0.XX/kg layer across all producibles.

## Recently shipped (last 2 weeks)

- Migration 134: cost_breakdown_v2 RPC republished — each stage now carries its own losses object + process_loss_pct. Breakdown page walks the cascade to find each loss at its natural stage: production at WIP/WIPF, cooking at WIPF (falls back to that stage's process_loss_pct if cooking_loss_pct is null), packing at WIPP, open_pack at FG, giveaway at WIPP/FG. Tenant default is the final fallback. Each line in the Pricing card tags its source (e.g. "WIPF (process)", "tenant default").
- Admin-only "💰 Cost summary" card on `/items/[id]` showing Direct + Indirect = COGS → +Losses → +Markups = Loaded cost → +Margin = MIN SELL PRICE, with a link to the full /costings/[id] sheet. Gated on viewerRole in super_admin/admin/manager.
- Compounded losses on the breakdown page Pricing card (mig and cooking_loss_pct stay in place — cooking is still an item-level override on top of the Filling Attributes process_loss_pct fallback).
- Migration 133: per-item losses. Five nullable columns on `items` (production_loss_pct, cooking_loss_pct, packing_loss_pct, open_pack_pct, giveaway_pct — last was pre-existing from mig 060). Same set added as tenant defaults on `pricing_buffers`. `cost_breakdown_v2` RPC now surfaces item losses in the response. Loss panel on item edit page (between Filling and Packing Attributes). Breakdown page Pricing card uses item value → tenant default → 0, with a "per-item" / "tenant default" hint per line. /costings/pricing admin extended with the 4 new tenant default fields + live-preview rows.
- DataTable: new `ColumnDef.footer` callback. Sums rendered as a `<tfoot>` row that's sticky-on-scroll when stickyHeader is on. Used on /costings (sums RM/Labour/OH/Total across filtered rows) and on every breakdown stage RM + Labour table (sums line $ and contribution).
- Migration 132: `pricing_buffers` table (tenant-wide, effective-dated) — production_loss / depreciation / sample / product_dev / error / target_margin percentages. `/costings/pricing` admin page with live preview (sample COGS $10 builds up to min sell). Header link added.
- Migration 131: `cost_breakdown_v2(item_id)` RPC — groups RM and labour BY BOM stage so the breakdown page can render a stacked cost sheet (FG → WIPP → WIPF → WIP). Each stage carries its DIRECT RM (leaves attributed to their direct parent BOM) and its labour. Plus a `cost_centres` array (labour by department across all stages).
- `/costings/[item_id]` rebuilt as a stacked cost sheet: Totals card + Cost-centre chip strip + one card per BOM stage (RM + labour DataTables with sort/resize/sticky/column-toggle for free) + Overhead card + Pricing buildup (COGS → +buffers → loaded → +margin = MINIMUM SELL PRICE).
- Migration 130: `cost_breakdown_v1(item_id)` RPC + `/costings/[item_id]` audit page. Itemised RM lines, labour lines, overhead card. Every line clicks through to its source (item edit / BOM routing). `/costings` row click changed from Test Product modal to this page. *(Superseded by v2 but the v1 RPC kept for safety.)*
- Migration 129: `v_item_landed_cost_v3` — full landed cost = RM + Labour (cascaded routings) + Overhead (root-level standard). `/costings` now shows four cost columns. Phase 2 complete.
- Migration 128: overheads — `overhead_actuals` (weekly lines), `overhead_week_kg` (denominator), `overhead_standard_rate` (effective-dated standard $/kg with override audit) + `v_overhead_week_summary` + `v_overhead_standard_current`. `/costings/overheads` page with Standard rate card (4-week derived-average shortcut) + Weekly tracker card (week navigator, recent-weeks mini-trend).
- Migration 127: `production_routings` (per-BOM steps) + `v_bom_routing_cost` + `v_bom_routing_cost_summary`. Per-BOM `/bom/[id]/routing` editor with live $/kg, per-dept breakdown, basis-aware (kg/unit/inner/outer/pallet).
- Migration 126: `labour_rates` table (tenant-level standard $/hour, effective-dated) + `v_labour_rate_current` view. `/costings/rates` admin rebuilt around it — single $/hour input + notes + history.
- Migration 125: dropped `dept_cost_rates` (Phase 2 Pass 1, scrapped — wrong shape vs Tino's actual routing-based model).
- Migration 124: `dept_cost_rates` (later dropped by mig 125). Kept in repo for replayability.
- Migration 123: basis-aware cascade (`v_item_landed_cost_v2` + `test_product_cascade_v2`) — see step 6 in the in-flight BOM thread above for the gory details. /costings page + Test Product modal switched to v2.
- Test-product modal: click any buy-list row to open that item's edit page in a new tab — fix supplier/cost/BOM, switch back, hit Refresh to re-cascade. Spotted while inspecting the German Bratwurst 75 cascade where a Plain label line was showing $146 against a $148 total — exactly the kind of anomaly the click-to-edit unblocks.
- DraggableModal v2: viewport-capped (`maxHeight: calc(100vh - 1.5rem)`) so tall modals can't disappear off-screen, body always scrolls inside, custom resize grip in bottom-right (browser `resize:both` was hidden by `.card` border-radius), and the cap rebases on `pos.y` once dragged so the bottom edge stays on screen (was the "scrolling dies after I move it" bug). Backdrop close switched from onClick to onMouseDown with `target===currentTarget` so resizing the corner outward (mousedown on handle, mouseup on backdrop) no longer accidentally closes the modal. Affects Test Product, run-order-board, dept-scheduler, work-order-client. `flexBody` prop kept for back-compat but is now a no-op.
- Test Product buy list: new "Cost / unit" column next to "Total" so per-piece anomalies (e.g. a $21 label price hiding inside a $146 line total) jump out. Plus a Columns ⌄ selector — Supplier / Lead / Cost / unit / Total are toggleable, persisted per-browser in localStorage. Code / Item / Qty / Unit are always shown.
- Costings Phase 1: `v_item_landed_cost_v1` view + `/costings` page (mig 121).
- Calendar (P1) cards rebuilt to match machine (P2) cards (same layout, same buttons, cleaner drag).
- Run-sheet print: stable sort + column resize + saved layout per dept + batch # split-style (year+day highlighted).
- Run-sheet print: one page per machine summary, one page per recipe.
- Run-sheet print: unit-aware fmt (kg→3 dp, others→integer); recipe default sort by total desc.
- Run-sheet print: fix React key collision causing duplicate ingredient rows.
- Run-order: per-machine kg total + drag-to-date-chip + finalise-by-day; batch-size chip on cards; DraggableModal batch sizing.
- Split production orders across days (mig 118), per-day materials RPC, fix DELETE silent-fail (no RLS).
- MRP overrides per-item per-dept (mig 117).
- BOM cascade math fixes — 9004 hocks, 5001 chicken frankfurter; trigger preventing self-reference (mig 116).
- Inventory list rebuild: filters, sortable, real cost, sticky totals, stickyHeaderOffset.
- Purchasing dashboard with 5 tabs, KPI cards, Need-now, Quick-fix modal, Order by item, split modal, multi-lingual search.
- Vocabulary (tenant labels) system (mig phase 1) + Test product modal with readiness pills.
- Item wizard (multi-step + RM + BOM variants).

## Decisions log highlights

- 2026-05: BOM data model moves to natural-language (N, M, scope). Storage backwards-compat. See ADR.
- 2026-05: Costing built as 3 layers — variable / step-fixed per family / overhead. Five-phase delivery. See `costings-roadmap.md`.
- 2026-05: Run order is its own page (`/dept/{slug}/run-order`), not a tab inside the floor view — separates planner activity from floor execution.
- 2026-04/05: `bom_lines.percentage` is canonical for ingredients (mig 108); auto-recompute trigger keeps `qty_per_batch` in sync.
- 2026-04: `items.consumed_in_weight` self-maintained from `items.unit` (no manual flag).
