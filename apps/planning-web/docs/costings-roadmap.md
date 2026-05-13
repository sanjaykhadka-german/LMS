# Costings Roadmap

_Living document — started May 2026 by Tino + Tracey._

## The big idea

Most ERPs do costing one of two ways and both are bad:

1. **Standard cost only** (SAP / Dynamics): set once a quarter, compared at month-end, the number planners see is 3 months stale.
2. **Activity-based costing** (academic): theoretically pure, practically unworkable — nobody fills in labour hours per WO.

What we're building is different: **live cost transparency, tied to the operations data we're already collecting**. We already capture planned_qty, batch_size, machine_id, run_sequence, department, production_date, yield_factor, supplier prices. From those alone we can compute a real, defendable per-kg cost without a single new manual input from operators. The cost moves the moment a supplier price changes, the moment yield drops, the moment a WO gets reassigned to a slower machine. That's the unfair advantage.

## Three cost layers

### Layer 1 — Variable cost (the cost of making one more kg)
- **RM cost** — already cascading through `v_item_cost_health.effective_cost` (mig 111/114)
- **Direct packaging** — films, casings, vac bags, labels (on the BOM)
- **Yield-loss cost** — the RM bought that didn't end up in the FG (falls out of `bom_headers.yield_factor`)
- **Direct labour at the machine** — kg throughput × dept's per-kg labour rate
- **Direct utilities at the machine** — cooking energy especially; gas/electricity per kg cooked

These costs would disappear if we produced zero kg this week. They cascade naturally up the BOM tree at every node.

### Layer 2 — Step-fixed per family-tree level ("cost for each child")
Each WIP carries the rolled-up Layer 1 cost from its components **plus** the conversion cost its own department adds. A Bratwurst FG carries: RM cost + Filling-dept conversion + Cooking-dept conversion + Packing-dept conversion + Labelling-dept conversion. Each conversion is `kg × dept_rate_per_kg`. Same recursive CTE we already use for RM.

### Layer 3 — Indirect / overhead (rent and rates)
The honest approach: pick **one driver** per cost pool and stop pretending we can do better.

Two cost pools at first:
- **Plant overhead** — rent, freezer running, maintenance, plant insurance. Allocated by kg produced.
- **G&A** — admin, finance, marketing, depreciation of non-production assets. Allocated by kg or by sales $.

Pick a period (weekly or monthly), enter the dollar amount once per period, the system divides by total kg produced and gives a per-kg loading. Added to every FG.

## Phased build plan

### Phase 1 — Make the RM cascade visible and trustworthy ✅ in progress
- `v_item_landed_cost_v1` view: recursive cost cascade for every item
- `/costings` page: sortable, filterable list of every FG / WIP with RM $/kg
- Traffic light: comparing to last week or to manual standard_cost override
- Click any row → opens the existing `test_product_cascade` drill-down modal

Surfaces data-quality issues (items with no cost, BOMs missing percentages, broken cascades) which we need to fix before deeper costing makes sense.

### Phase 2 — Conversion cost: dept rates
- New `dept_cost_rates` table: `(department_id, effective_from, labour_rate_per_kg, utilities_rate_per_kg, overhead_rate_per_kg)`
- `/costings/rates` admin page where Tino edits these
- Default values come from "monthly cost ÷ monthly kg" per dept (simple)
- Recursive cascade picks up conversion at every BOM node

### Phase 3 — Full landed cost per item
- Every FG: RM + per-dept conversion + plant overhead + G&A
- Horizontal stacked bar per item, click to drill down
- **The moneymaker** — moment Tino sees "Costco Hot Dog: $3.92/kg cost, sells $4.20/kg, 7% margin" he changes prices the same day

### Phase 4 — Margin per customer / per SKU
- Cross `customers.price_group` × dispatch data × landed cost
- Rank customers by realised margin %
- Floor margin → red flag below floor
- "Why is this customer below margin?" drill-down

### Phase 5 — Variance (actual vs standard)
- Once WOs are completed with actual yields recorded
- Compare actual RM consumed (traceability data) vs standard recipe consumption
- Dollar variance per WO — gold for catching trim leakage, weighing errors, recipe drift

## The disruptive home page (Phase 3+)

One screen, no scroll, four questions answered at a glance:

1. **What's making us money this week?** — top 5 FGs by realised margin $, bar chart
2. **What's bleeding?** — bottom 5 by margin $, with root cause flagged ("RM up 8% w/w", "Yield dropped 0.94 → 0.88")
3. **Where's our money going?** — donut: RM / Labour / Utilities / Packaging / Overhead of the week's production
4. **Live cost ticker** — current $/kg for each FG with 6-week sparkline; click for cascade drill-down

No other butchery-scale ERP shows this. SAP charges $400k for it, makes you wait until next quarter, and prints it as a 17-column PDF. We show it on one screen, updated every time underlying data moves.

## Things that need to exist before later phases work
- `cost_history` table (snapshot the effective cost per item per day) — enables sparklines and "RM up 8% w/w" attribution
- Cost categories taxonomy: protein, dairy, packaging, spices, casings, labour, utilities, overhead
- Actual yield capture per WO (already partially in production_orders, needs UI to record actual_qty on completion)
- `customer_prices` or `price_list_items` joined to dispatch data to compute realised price

## Open questions (decisions for Tino)
- **Cost period**: weekly or monthly? Suggests weekly for utilities/labour, monthly for plant overhead. Mixed is fine — each rate row has its own `effective_from`.
- **Currency**: assume AUD throughout, or multi-currency at the supplier line and convert to AUD at lookup time? Currently single AUD.
- **Yield-loss treatment**: bake into the RM line as a multiplier (`/yield_factor`), or break out as a separate "yield loss $" cost line so it's visible? Suggest the latter for transparency.
- **Pack labour**: usually flat per-unit (cost of packing into a 1kg vac bag). Model as a per-piece line on the FG's BOM with unit=$ instead of kg? Or as a separate `pack_labour_per_unit` on the item?
- **Customer floor margins**: store on `customer.price_group` or per-SKU? Suggest per-SKU because a Hot Dog floor is different from a Bratwurst floor even for the same customer.
