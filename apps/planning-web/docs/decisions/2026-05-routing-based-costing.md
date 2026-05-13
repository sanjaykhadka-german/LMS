# Routing-based costing (vs flat per-dept rates)

_Decision date: 2026-05-11. Owner: Tino + Claude. Status: shipped (rebuild in progress)._

## Context

Phase 2 of the Costings module needs to add conversion cost (labour, utilities, overhead) on top of the RM cost the cascade already computes. The original `costings-roadmap.md` proposed a `dept_cost_rates` table: one row per (department, effective_from) carrying flat `labour_rate_per_kg`, `utilities_rate_per_kg`, `overhead_rate_per_kg`. Pass 1 shipped that on 2026-05-11 (mig 124).

Tino, on seeing it, articulated his actual mental model:

- **Direct labour is per-PRODUCT, not per-dept.** Each product has a routing — a list of steps inside each dept with (people, minutes, throughput basis). E.g. a bratwurst Filling step might be "2 people 120 min per 1000 kg"; a small chipolata at "1 person 60 min per 1000 kg". Same dept, very different time profile.
- **Standard hourly rate**, applied to all departments to start. Later split per dept if needed.
- **Overheads** are tenant-level, with weekly actuals tracked in a dedicated screen and a standard $/kg used in costing display (overridable, with audit).

A flat per-dept rate cannot represent the per-product time difference, which is the whole point of accurate costing — two products in the same dept can be 2-4x apart on labour cost.

## Decision

Scrap `dept_cost_rates` (mig 125 drops it) and build the routing-based model:

1. **`labour_rates`** (mig 126): one tenant-level standard $/hour, effective-dated. UI is a single input on `/costings/rates`.
2. **`production_routings`** (mig TBD): per-BOM list of (department_id, step_name, people_count, std_minutes, reference_qty, reference_basis, sort_order). UI is a per-BOM editor that looks like Tino's example table (Batching/Mixing/Filling/Cutting/Thermoforming/etc).
3. **Overheads module** (mig TBD): `overhead_actuals` for weekly actuals + `overhead_standard_rate` singleton for costing display, with override audit.
4. **`v_item_landed_cost_v3`** (mig TBD): cascade joins labour rate + routings + standard OH; emits `rm_cost_per_unit`, `labour_cost_per_unit`, `overhead_cost_per_unit`, `total_cost_per_unit`.

## Rationale

- **Accuracy.** Step-level routings let two products in the same dept have wildly different conversion costs, matching reality. Flat per-dept rates would average everything to the wrong number.
- **Operator-natural.** Tino already thinks in (people, minutes, kg). The schema mirrors his mental model — no translation tax.
- **Forward-compatible.** Per-dept hourly-rate overrides (when cleaning labour costs differ from filling labour) just means adding a nullable `department_id` to `labour_rates`; the rest of the math is unchanged.
- **Audit + history baked in.** Effective-dated rows are non-negotiable for Phase 5 variance work and for "why did this cost change" debugging.

## Trade-offs

- More tables / more UI than the flat-per-dept approach. Roughly 3-4 migrations + 2-3 new screens vs 1 + 1.
- Routings need to be entered per product. For a tenant with hundreds of FGs that's real data-entry work — but it's the work that already exists informally in operator heads, and it only happens once.
- We lose the simple "the whole tenant has one rate per dept" mental model. But that simplicity was a liability — it would have produced wrong costs and been thrown away within weeks.

## Migrations affected

- 124: created dept_cost_rates (now dropped, kept in repo for replayability)
- 125: drops dept_cost_rates
- 126: creates labour_rates + v_labour_rate_current
- TBD: production_routings + editor
- TBD: overhead_actuals + overhead_standard_rate
- TBD: v_item_landed_cost_v3

## Status

- 125, 126: shipped 2026-05-11.
- /costings/rates page rebuilt around labour rate.
- Routings + overheads + v3 cascade: pending. Tino sets the hourly rate first; routings UI next.
