# ADR — BOM data model uses natural-language entry

**Date**: 2026-05-11. **Decision by**: Tino + Claude. **Status**: in flight (mig 122 applied).

## Context

Operators are entering BOM lines like `0.000125` (rolls of TW film per inner) and `0.0035` (clips per kg). They don't understand the numbers, can't remember how they were calculated, and can't update them when relationships change. The data drifts; the cascade math depends on these numbers being correct; costing therefore can't be trusted.

Tino's framing: "no one wants to start calculating a roll of film to be used as 0.0035 or 0.0008 clips per kg. No one understands that."

## Decision

BOM lines are stored as the triple **(N, M, scope)** that matches how operators speak:

| Operator says | Stored |
|---|---|
| 1 cartridge per 20 000 inners | N=1, M=20000, scope=per_inner |
| 1 bin liner per 500 kg | N=1, M=500, scope=per_kg |
| 2 clips per 1 unit (log) | N=2, M=1, scope=per_unit |

Storage shape:
- `bom_lines.qty_per_batch` = **N / M** (the per-1-of-scope rate — unchanged from today)
- `bom_lines.basis` = scope enum (`per_kg / per_unit / per_inner / per_outer / per_pallet`)
- **new**: `bom_lines.consume_per_qty` = **M** (mig 122)
- For ingredient lines: `percentage` field as today; CHECK constraint forces `consume_per_qty=1`.

Display reconstructs N = qty_per_batch × consume_per_qty.

## Alternatives considered

1. **Add a single `display_pattern` jsonb column** — `{"qty": 1, "per": 500, "of": "kg"}`. Rejected because it duplicates qty_per_batch + basis and makes the cascade more complex.
2. **Store N, M, scope literally; deprecate qty_per_batch** — rejected because every cascade query, RPC, view, and report reads qty_per_batch. Backward compatibility wins.
3. **Just rebuild the form UI to do the arithmetic and write the awkward decimal** — rejected because reload-edit then displays "0.000125 per inner" again. No memory of what the operator originally typed.

## Why two columns (qty_per_batch + consume_per_qty) wins

- Zero math changes across the codebase. Every existing cascade keeps working.
- Display has all the information it needs to render the natural form.
- Edit cycle is round-trippable: save (1, 8000, per_inner), reload, see "1 per 8000 inner", edit to "1 per 9000", save (1, 9000, per_inner). qty_per_batch updates from 0.000125 to 0.000111 automatically.
- Old data still works as-is until re-edited. Gradual migration via UI use, not big-bang.

## Consequences

**Required follow-on work**:
- Item edit page gets a "Filling section" panel capturing `target_weight_g` + `fill_weight_g` (needed for `per_unit / per_inner / per_outer / per_pallet` math).
- BOM-line entry form is rebuilt as `N × Item per M [scope]`.
- Display everywhere a BOM line appears (BOM table, work-order recipe, run-sheet print, test modal) needs the new format.
- `v_item_landed_cost_v1` v2 — extend cascade to handle `per_unit / per_inner / per_outer / per_pallet` (joins target_weight_g + units_per_*) so packaging contributes to landed cost.
- Backfill helper UI for legacy lines.

**Vocabulary**: scope "per_unit" displays using tenant vocab (log / sausage / tray / piece etc).

**"Per kg of WIP" vs "per kg of output"**: scope is always relative to **this BOM's output**. yield_factor on the header handles input→output shrink. Most filling stages have yield=1.0 so this is academic in practice but documented to keep future-us honest.

## How to verify it's working

Six weeks from now:
- A new packaging line entered through the form should produce a friendly display on reload.
- Editing an old line should re-base it to friendly (N, M) automatically once saved.
- The cascade still produces the same numerical answers it does today (regression check).
- `v_item_landed_cost_v1` v2 picks up packaging cost (verified manually on at least one FG — total landed cost matches an independently-calculated number).
