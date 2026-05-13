# BOM data model — natural-language entry

_Decision date: 2026-05-11. Owner: Tino + Claude. Status: in flight._

## The problem

The current BOM editor forces operators to enter packaging consumption as decimals:

- `0.0035` clips per kg
- `0.000125` rolls per inner
- `0.002` bin liners per kg

Nobody thinks in those numbers. Operators say things like:

- "1 cartridge per 20 000 inners"
- "1 bin liner per 500 kg"
- "2 clips per 8 kg log"
- "1 label per outer"

When a relationship changes ("we now get 25 000 inners per cartridge"), nobody knows how to update `0.00004` to `0.00005`. The data drifts, costing breaks, and trust in the system goes with it.

## The fix

Store every BOM line as the triple **(N, M, scope)** captured in the operator's own words:

| Operator says | Stored as |
|---|---|
| 1 cartridge **per 20 000** inners | N=1, M=20000, scope=`per_inner` |
| 1 bin liner **per 500** kg | N=1, M=500, scope=`per_kg` |
| 2 clips **per 1** unit (log) | N=2, M=1, scope=`per_unit` |
| 1 label **per 1** outer | N=1, M=1, scope=`per_outer` |
| 1 cling-wrap roll **per 30** pallets | N=1, M=30, scope=`per_pallet` |
| 1 liner **per 50** units (logs) | N=1, M=50, scope=`per_unit` |

The math the cascade needs is unchanged — it's still "rate per 1 of scope". So storage stays as:
- `bom_lines.qty_per_batch` = **N / M** (the per-1-of-scope rate)
- `bom_lines.basis` = the scope enum
- **new**: `bom_lines.consume_per_qty` = **M** (so we can reconstruct N on display)

### Why two columns instead of three?

We could store N, M, scope literally. But the cascade math already uses qty_per_batch = rate-per-1-of-scope. Storing N/M directly preserves backward compatibility for every cascade query, RPC, view and report. Only the entry/display layer reasons about (N, M).

### Why not just store the ratio "1/20000" as a string?

The cascade needs to do `qty_per_batch × total_kg` (or whatever scope dictates). Strings can't multiply. Two numerics is simpler than parsing a fraction at every query site.

## The vocabulary

Scope enum: `per_kg`, `per_unit`, `per_inner`, `per_outer`, `per_pallet`, `percentage`.

- **percentage** — for ingredient (recipe) lines. Has no M. The constraint `bom_lines_consume_per_qty_ingredient_check` enforces `consume_per_qty=1` for ingredient lines.
- **per_kg** — random-weight scope; "per X kg of this BOM's output". Most common for FG-level packaging.
- **per_unit** — fixed-weight scope; "per X units (pieces)". Requires the item to have `target_weight_g` set so the cascade can compute "units per kg".
- **per_inner / per_outer / per_pallet** — pack-hierarchy scopes. Require `target_weight_g + units_per_inner / units_per_outer / units_per_pallet` on the item.

The word "unit" is the technical token. The vocabulary table lets each tenant render it as **log**, **sausage**, **tray**, **bag**, **piece**, etc. The dropdown shows e.g. "unit (log)" so the operator sees both the technical scope and their tenant's word.

## "Per kg of WIP" vs "per kg of output"

Tino's instinct: "1 net per 100 kg of WIP" (input mass).

Storage convention: scope is **always** relative to the **output of THIS BOM**. The yield_factor on the BOM header handles input→output shrink (1.0 = no shrink). So if 100 kg of WIP yields 100 kg of WIPF (yield_factor=1.0), "1 net per 100 kg of WIP" stores as `per_kg, qty=0.01, M=100`. If there were shrink (say yield=0.95), the operator would mentally adjust to "per 95 kg of WIPF output". 99% of the time yield in filling is 1.0, so the distinction is academic — but documenting it here keeps future-us honest.

## The fill-section editor

For any WIPF / WIPP / FG item, the item edit page shows a "Filling section" panel asking two questions:

1. **Target weight per unit** (`items.target_weight_g`) — what one finished log / sausage / tray weighs. E.g. 8000 for a 4×4 Ham log, 75 for a Bratwurst.
2. **Fill weight per unit before cooking** (`items.fill_weight_g`) — what one unit fills at before cook loss. E.g. 8500 for the ham (overfilling to land at 8 kg after cook).

The panel shows a live preview of derived numbers:

```
1 kg of FG = 1000 / 8000 = 0.125 units
1 unit fills at 8500 g (cook yield 94.1%, process loss 5.9%)
```

This is the data the cascade needs for `per_unit` / `per_inner` / `per_outer` / `per_pallet` math. Without it, those scopes can't compute and the editor warns "set target weight first".

## Save-side math

When the user submits a non-ingredient line with (N, M, scope):

```ts
qty_per_batch = N / M          // the per-1-of-scope rate the cascade reads
consume_per_qty = M            // for display reconstruction
basis = scope                  // per_kg / per_unit / per_inner / per_outer / per_pallet
unit = (read from the chosen item's unit)
percentage = null              // not an ingredient line
```

For ingredient lines:

```ts
percentage = (user-entered %)
consume_per_qty = 1            // enforced by CHECK constraint
qty_per_batch = (auto, computed by trigger to keep mig 108 invariant happy)
basis = null
```

## Display-side math

```ts
N = qty_per_batch × consume_per_qty
display = `${N} × ${item.name} per ${consume_per_qty} ${scope_label(basis, item)}`
```

Where `scope_label` returns the tenant's vocab word for the scope:
- `per_kg` → "kg"
- `per_unit` → tenant's word ("log" / "sausage" / etc), or "unit" as fallback
- `per_inner` → "inner" (tenant-renameable)
- etc.

If `consume_per_qty === 1`, render as `1 × Item per scope` (drop the "per 1").

For legacy lines (consume_per_qty defaulted to 1 on insert, qty_per_batch is the awkward decimal), the display will show e.g. "0.000125 × Item per inner" — clearly wrong-feeling, which is what nudges the operator to re-edit the line through the new form. After re-edit, it displays correctly as "1 × Item per 8000 inner".

## Cascade math impact

The cascade (`v_item_landed_cost_v1`, `test_product_cascade`, `explode_mrp`) keeps reading `qty_per_batch` as today. **Zero math changes for `per_kg` and `percentage` scopes.**

For `per_unit / per_inner / per_outer / per_pallet`, the cascade needs the parent item's `target_weight_g` and `units_per_*`. Today `v_item_landed_cost_v1` skips those scopes entirely (packaging not yet contributing to landed cost). v2 will join the columns and do the math — separate task, see active-threads.md.

## Migration & backfill

Migration 122 adds the column with `default 1`, so every existing row gets `consume_per_qty=1` automatically. Math is unchanged for those rows.

A separate **backfill helper** UI (later step) lists every legacy line with `consume_per_qty=1` and a non-trivial `qty_per_batch` (e.g. < 0.5 for packaging lines) and suggests a friendly (N, M) — usually by inverting: if qty_per_batch=0.000125, suggest "1 per 8000". Operator confirms with one click; the line is rewritten as `qty_per_batch=0.000125, consume_per_qty=8000`.

## Why this is hard to get wrong

- `qty_per_batch` is still authoritative for the math. No cascade query, RPC, view, or report needs to change.
- The CHECK constraint guarantees ingredient lines can't accidentally pick up a denominator.
- The display formula is pure: `N = qty_per_batch × consume_per_qty`. No edge cases.
- Old data + new data live happily side by side. Migration is gradual and observable.
- The fill-section editor is item-level data, separate concern from BOM lines.
