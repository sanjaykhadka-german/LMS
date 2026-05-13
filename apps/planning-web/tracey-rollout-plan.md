# Tracey rollout plan

A staged plan to take the design we've agreed on from sketch to shipped, with each phase
independently shippable, independently rollback-able, and independently valuable.

The plan deliberately puts user-visible value first and saves the bigger structural changes
for later, when they're already de-risked by the work that came before.

---

## Phase 0 — Foundation (already shipped this session)

The math layer that everything else stands on. **Risk level: zero**, this is done.

- `items.consumed_in_weight` derives automatically from `items.unit` via a trigger; can no longer drift out of sync.
- `bom_lines.percentage` recomputes automatically on save via a trigger on `bom_lines`; the user types absolute quantities, the system computes the percentage.
- `explode_mrp` and the four sister functions (`get_plan_dept_materials`, `get_plan_dept_materials_by_day`, `get_po_suggestions`, `get_rm_parent_breakdown`) all read `bl.percentage` as the source of truth and `bl.unit = 'kg'` to identify weight-cascade rows.
- `item_type` (`wip`/`wipf`/`wipp`/`finished_good`) is no longer load-bearing for cascade math. Functions don't read it for routing — they only use it for filtering leaf components in shopping lists.
- All four data outliers self-corrected on backfill.

**What this unlocks:** every later phase can simplify the user-visible vocabulary without touching the math.

---

## Phase 1 — Vocabulary system (1–2 weeks)

The single most leveraged feature. Every later screen uses it.

**What ships**

- New table `tenant_labels(tenant_id, canonical_key, display_label)`.
- Label-loading endpoint that returns the full label map for the current tenant.
- Frontend reads labels into a singleton at app load; every label rendering goes through `t('canonical_key')`.
- Settings → Vocabulary admin page (table editor with 8 default canonical keys: `step`, `ingredient`, `product`, `supply`, `department`, `process_loss`, `giveaway`, `tare`).
- Inline edit on hover for admin users — click any label, edit in place, save on blur. Uses Supabase realtime to push the new label to other tabs/users immediately.

**Migration**

- Pure addition. No existing data changes. New tenants get sensible English defaults.
- Frontend gracefully falls back to hardcoded English if the API fails.

**Rollback**

- Drop the table. Frontend continues working with the hardcoded fallback.

**Risk**: Low. Worst case: labels look slightly different from before; nothing breaks.

---

## Phase 2 — Sanity check / test order feature (2 weeks)

The keystone feature. Build it on top of existing item master, so it benefits today's users immediately without waiting for any other UX work.

**What ships**

- "Test this product" button on each existing item master page.
- Modal/page that takes a quantity in any UOM (units / kg / inner / outer / pallet) and runs the cascade against a temporary in-memory plan.
- Reuses existing `explode_mrp` + cost computation; nothing new server-side except a small RPC that wraps "test against this product/qty without persisting."
- Output: cascade table, shopping list, cost breakdown, margin, earliest start.
- "Yes / something's off" verify bar; "something's off" links straight to the suspected field.

**Migration**

- Pure feature addition. No data changes.

**Rollback**

- Hide the button.

**Risk**: Very low. The math is the same math `explode_mrp` already produces every plan build.

**Why this phase early**: The day this ships, every existing user can verify their setup is correct. It pays back the trust we've spent and de-risks every BOM edit going forward.

---

## Phase 3 — Product canvas (2 weeks)

Replaces the current item-master detail screen with the visual cascade canvas + traffic lights.

**What ships**

- Cascade flow diagram on the product detail page (each stage is a clickable card).
- Click-to-edit nodes opens the existing item master form (no new editor needed).
- Traffic light readiness pills at the top: Costing / Planning / QA / Purchasing / Dispatch.
- Persistent "Test this product" button (pulls in the Phase 2 feature).
- Cost breakdown and process snapshot panels at the bottom.

**Migration**

- Layout change. Underlying data unchanged.

**Rollback**

- Feature flag the new view; toggle back to the classic item master.

**Risk**: Low. Data model untouched.

**Why this matters**: it's the first screen where the user stops thinking in WIP/WIPF/WIPP and starts thinking in their own stage names. Vocabulary phase pays off here.

---

## Phase 4 — Setup wizard + archetype templates (3 weeks)

The "average Joe can drive Tracey" promise. Hides the data model entirely behind a guided flow.

**What ships**

- Pick-type entry screen ("Resold / 1-step / Multi-step / Clone existing").
- Archetype JSON templates that define starter fields and chain shapes:
  - `resold_item` (no production)
  - `1_step_recipe` (single mix → product)
  - `multi_step_recipe_2` / `_3` / `_4` / `custom` (configurable cascade depth)
  - Optional industry archetypes that pre-fill the chain naming (sausage, hand cream, espresso, sourdough, etc.) — just defaults, fully editable.
- Guided wizard with question-per-screen flow, ending in the Phase 2 sanity check screen as the final confirmation.
- Smart defaults per archetype.

**Migration**

- New code path. The Phase 3 expert form remains as the alternative for power users (toggle in the header).

**Rollback**

- Hide the wizard. Expert form is unchanged.

**Risk**: Low. The wizard is just a UI layer on top of the same item/BOM tables.

---

## Phase 5 — Item-type collapse to four concepts (3 weeks + careful testing)

The structural cleanup. Removes the last user-visible WIP/WIPF/WIPP terminology.

**What ships**

- A view (or generated column) that collapses the existing seven `item_type` values to four UI categories:
  - `raw_material` → `ingredient`
  - `wip` / `wipf` / `wipp` → `step`
  - `finished_good` → `product`
  - `packaging` / `consumable` → `supply`
- Frontend lists, filters, badges, and reports use the four-category view.
- Database keeps the original column unchanged (no destructive migration); the view layer is the only thing that changes.
- The user's stage names (from the cascade tree) are what's shown everywhere a "step" appears — never `wipf` or `wipp`.

**Migration**

- Pure view-layer addition. Data layer untouched.

**Rollback**

- Drop the view, frontend reverts to original taxonomy.

**Risk**: Medium for the frontend (lots of touch points), low for the backend.

**Why last among the structural changes**: by this point the user-visible UX (Phase 1–4) has been live for weeks; we know the four-concept model works in practice before we commit to it as the canonical taxonomy. Also, every place this change has to land is already calling through the labels system from Phase 1, so the rename is mostly "edit the default value of one canonical key."

---

## Phase 6 — Marketing site + industry archetypes (1–2 weeks)

The sales win that turns the architecture into market positioning.

**What ships**

- Public homepage with the live industry toggle (Butcher / Bakery / Cosmetics / Coffee roaster / Restaurant / Brewery / Cheesemaker / Deli / etc.).
- The toggle changes the live screenshots, sample products and vocabulary on the page.
- "Try it" flow that drops the visitor straight into a Phase-4 wizard pre-loaded with the chosen industry's archetype.
- One-pager per industry: "Tracey for [industry] — set up in 20 minutes, no consultant required."

**Migration**

- Separate site. No production app changes.

**Risk**: None to the product.

---

## Time + sequencing summary

| Phase | Length | Cumulative | User-visible win |
|-------|--------|------------|------------------|
| 0 — Foundation | done | done | Cascade math is correct & self-maintaining |
| 1 — Vocabulary system | 1–2 wk | 2 wk | Tenants name things their own way |
| 2 — Sanity check | 2 wk | 4 wk | "Test this product" button — biggest single trust win |
| 3 — Product canvas | 2 wk | 6 wk | Visual flow replaces form-driven item master |
| 4 — Setup wizard | 3 wk | 9 wk | Average-Joe self-service onboarding |
| 5 — Item-type collapse | 3 wk | 12 wk | WIP/WIPF/WIPP terminology gone from UI |
| 6 — Marketing site | 1–2 wk | 13–14 wk | Industry-toggle live on homepage |

Each phase is independently shippable. If we have to pause after any phase, the system is in a coherent state.

---

## Cross-cutting concerns

**Feature flags**: every phase ships behind a per-tenant flag. Early-access tenants can opt in. We don't force a big-bang rollout on the existing user base.

**Data backups before any phase touching production**: full DB snapshot before Phase 5 specifically, since that one touches the most surface area.

**Documentation**: each phase ships with a short user-facing release note in plain language. No more than one screen of text. Examples:
- Phase 1: "You can now rename system labels to match how your team talks."
- Phase 2: "Every product now has a Test this product button."
- Phase 5: "Items in Tracey are now Ingredients, Stages, Products, or Supplies — same items, clearer names."

**Tracking**: instrument the wizard (Phase 4) and sanity check (Phase 2) so we know which fields trip people up and which UOMs they actually use. That telemetry feeds the next iteration.

---

## Open questions for next session

1. Do you want me to write the Phase 1 migration (vocabulary table + first labels API endpoint) as the first concrete step?
2. Are there industries beyond the four in the mockup that should be in the Phase 6 launch set? (Off the top of my head: deli/charcuterie, cheese, brewery, distillery, condiment manufacturer, ready-meals, juice. Easy to add.)
3. For the wizard archetype templates in Phase 4 — do you want to define the first 3–5 ourselves, or wait until we have a few real customers to base them on?
