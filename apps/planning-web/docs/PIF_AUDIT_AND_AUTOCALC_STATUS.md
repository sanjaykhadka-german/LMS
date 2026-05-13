# PIF audit + auto-calc status

_Tino — May 7 2026._
_Owner: Tracey / German Butchery Planning App._
_Status: review draft. Mark up directly in this file (or in chat) and we'll iterate._

---

## 1. Where we are right now (TL;DR)

| Capability                             | Status                        | Notes |
|----------------------------------------|-------------------------------|-------|
| Spec sheet preview (`/specs/[id]/preview`) | Live, light-themed, print-ready | Used today by you for the chorizo test. |
| Spec sheet email (Resend + PDF)        | **Live** as of Phase 3I.4      | Short body + PDF attachment, auto-Cc to sender + qa_email. |
| Bulk send specs                        | **Live** as of Phase 3I.3      | "Send N selected" on `/specs`. |
| PIF preview (`/specs/[id]/pif`)        | Live but **legacy layout**     | 9 sections, identical fields to V5 but no logo, no per-component CoO, no compound ingredients. |
| Spec auto-calc from BOM                | Live for: ingredients statement, allergens, nutrition (per-component coverage warning), packaging hint | Not yet wired: country of origin, target weight pulled, casings/processing aids handling, per-component % normalisation. |
| PIF auto-calc                          | **Mostly inherits from spec** — no PIF-specific fields beyond what spec already covers | The legacy `/pif` page is just a different layout over the same `product_specs` row. |
| Country-of-Origin auto-calc            | **Not built**. Field exists in DB (`product_specs.country_of_origin`) and on the spec form, but it's free-text only. | Phase 3H.5 in the queue — will compute summary + per-component breakdown from `item_ingredient_components.country_of_origin` (mig 098). |
| Chemical residual tests / Schedule 27 micro panel | Not built |
| BOM walk grouping by class (Phase 3H.4)| Not built |

---

## 2. PIF V5 vs V6 — what we know vs what we need from you

> I don't have V5 or V6 of your specific PIF on file. The notes below are
> the standard AFGC / FSANZ-aligned PIF structure that most Australian
> wholesale customers expect. **Please drop the actual V5 and V6 PDFs
> into `/uploads` (or share them in chat) so I can do a field-level diff
> and build the v6 layout exactly.**

### 2.1 Standard PIF V5 (AFGC, current widely-used template)

The AFGC PIF v5 covers the following sections — most of which already map
cleanly to fields we have today:

1. **Supplier details** — company name, ABN, contact, QA contact, address.
   Today: pulled from `tenants` row. Already on PDF header.
2. **Product identification** — name, internal code, GTIN/EAN, brand,
   category, GS1 Trade Item Type, customer SKU.
   Today: name + code from `items`; barcode comes from `item_barcodes` (active+primary). Brand and customer SKU not yet stored.
3. **Description / function** — short marketing description and
   functional description.
   Today: `items.description` exists but we don't expose a PIF-specific
   marketing description.
4. **Composition / ingredient statement** — declared ingredients in
   descending order with FSANZ class names + E numbers in brackets.
   Today: built by the BOM walk into `product_specs.ingredients_statement`. The new `item_ingredient_components` schema (mig 098) means compound inputs like Opti Form ACE S61 expand correctly. Class/E-number rendering happens at print time once we wire 3H.4.
5. **Allergen declaration** — full PEAL list (Std 1.2.3) with
   "contains / may contain / processed in a facility that handles".
   Today: `items.allergens` (text\[\]) + `product_specs.allergens` overrides. We use codes like `FSANZ_SOY` post-3H.X normalisation. The "may contain" / "processed in a facility" tiers are **not** yet modelled — they're flat declared-only. **Need from you:** which sub-tiers your customers ask for.
6. **Physical & chemical specification** — fat %, protein %, moisture %,
   pH, aw, drained weight, target / min / max.
   Today: stored as free text on `product_specs.spec_fat_content` etc. Shown on PIF. Not numerically validated, not auto-calculated.
7. **Microbiological specification** — TPC, E. coli, coliforms,
   Listeria, Salmonella, Staph, etc. with limits + n + c + m + M.
   Today: only a single free-text `spec_micro` field. **No per-organism schema.** This is one of the biggest V5→V6 gaps.
8. **Nutrition information panel (NIP)** — energy, protein, fat
   (saturated / trans), carbs (sugars), fibre, sodium, optional
   per-serving column.
   Today: live, both manual and lab-tested modes (mig 095 added the
   `nutrition_lab_tested` flag), per-100g + per-serving columns, indented
   sub-rows for saturated / sugars.
9. **Country of Origin** — summary statement plus per-component
   breakdown.
   Today: **summary statement only**, free text. The mig 098 components
   table holds per-component country, but we don't auto-build the
   statement yet. Toggle `product_specs.show_coo_detail` exists.
10. **Storage & shelf life** — storage class (chilled / frozen /
    ambient), temperature, total shelf life, MLOR (min life on
    receival), stability after opening.
    Today: live. Storage class radio + temperature override + shelf life
    + `min_life_on_receival_days` (mig 091).
11. **Packaging & labelling** — primary, secondary, tertiary pack
    descriptions, materials, recyclability, Australian Recycling Label
    (ARL).
    Today: free text. ARL not modelled.
12. **Heating / preparation instructions** — RTE flag + heating
    instructions for items not RTE.
    Today: `items.is_rte` + `product_specs.heating_instructions` (mig 091).
13. **Pack hierarchy & weights** — units per inner, per outer, per
    pallet, Ti×Hi, gross/net.
    Today: live via `item_pallet_config` + `items.units_per_inner` etc.
14. **HACCP / process flow** — high-level process steps for the
    finished good.
    Today: not modelled. Could be derived from BOM + work-instruction
    fields if we add them.
15. **Authority approval block** — QA signature, date, version, internal
    notes.
    Today: live (`approved_by`, `approved_at`, `version_label`).

### 2.2 What V6 typically adds over V5

Based on AFGC PIF v6 release notes circulating in early 2026 (this is
informed-guess until I see your actual V6 — please share it):

- **Animal welfare / sourcing claims** — RSPCA-approved, free-range,
  pasture-raised, certified organic with cert number.
- **Sustainability section** — recyclability of each pack layer using
  the ARL framework, carbon footprint disclosure (optional), water use
  disclosure (optional).
- **Halal / Kosher / Faith-based certification block** with cert body +
  cert number + expiry.
- **Genetic modification statement** — "contains GM ingredients"
  / "produced from GM-source" / "GM-free" per ingredient.
- **Non-conformance / withdrawal contact** — explicit 24/7 recall
  contact distinct from QA contact.
- **Tighter micro section** — n / c / m / M sampling plan per organism
  rather than free text.
- **Chemical / pesticide / heavy-metal residual disclosure** — usually
  with a tested-vs-non-detected indication and the standard reference
  (Schedule 20 / MRL).
- **Environmental allergen risk** — declaration that the production
  environment has cleaning validation between allergen-bearing batches.
- **Updated GS1 fields** — GTIN, GLN, batch / serial format used,
  variable measure indicator.

**To deliver V6 properly we need to add tables for: micro-organism
sampling plans, certifications (halal/kosher/organic/welfare), GM
declarations, and per-pack ARL.** None of these are built yet.

---

## 3. Auto-calc status — field-by-field

Legend: 🟢 fully auto · 🟡 partial / coverage gaps · 🔴 manual only.

### Spec sheet auto-calc

| Field                         | Status | Source                                    | Gaps |
|-------------------------------|--------|-------------------------------------------|------|
| Ingredients statement         | 🟢 | BOM walk (`get_bom_walk` RPC) + ingredients normaliser | Class grouping (3H.4) still pending. |
| Allergens                     | 🟢 | Union of all leaf items' allergens         | "May contain" tier not modelled. |
| Energy / protein / fat / etc. | 🟡 | Weighted from leaf-item NIP values        | Coverage warning shows when leaves are missing values; no manual fallback when only one leaf has data. |
| Pack hierarchy                | 🟢 | `items.units_per_inner` / `_outer` + `item_pallet_config` |  |
| Storage temp                  | 🟡 | Storage class radio sets canonical text; free text override available | No auto-derivation from item type yet. |
| Shelf life                    | 🔴 | Manual on item, manual override on spec   | Could be auto-suggested from `items.min_shelf_life_days` once we wire it. |
| Country of origin (summary)   | 🔴 | Free text                                  | Phase 3H.5 — see below. |
| Country of origin (per-component) | 🔴 | Components table (mig 098) ready for it | Render not built. |
| Barcode                       | 🟢 | `item_barcodes` (active+primary)          |  |
| Net weight / target weight    | 🟢 | `items.target_weight_g`                   |  |
| Casings / processing aids     | 🟡 | Marked `is_processing_aid` on components  | Not yet hidden by default in render. |

### PIF auto-calc

The PIF page reads the same `product_specs` row as the spec sheet — so
**every field above auto-fills the PIF too**. The PIF is essentially a
different print layout, not a different data model.

PIF-specific gaps that aren't on the spec sheet:

- **Process flow / HACCP block** — not modelled.
- **Micro sampling plan** — free text only.
- **Certifications block** (halal etc.) — not modelled.
- **Animal welfare / sourcing** — not modelled.

### Country of Origin auto-calc (Phase 3H.5 design — not yet built)

Plan, for sign-off:

1. Walk the BOM down to leaves (already done by `get_bom_walk`).
2. For each leaf, take `item_ingredient_components.country_of_origin` if
   set; otherwise fall back to `tenants.billing_country` for items the
   operator has marked as locally sourced.
3. Compute three statements:
   - **Australian content %** by mass of declared-as-Australian leaves.
   - **Summary statement** following the FSC CoOL mandatory-mark rules:
     "Made in Australia from at least X% Australian ingredients", or
     "Packed in Australia from imported ingredients", or
     "Made in Australia from Australian and imported ingredients", etc.
   - **Per-component table** when `product_specs.show_coo_detail = TRUE`.
4. Write the summary into `product_specs.country_of_origin` on auto-fill;
   the operator can override.

Want me to ship this as the next phase?

---

## 4. Concrete next-up queue

In rough priority order (rearrange as you like):

1. **Phase 3H.4** — BOM walk grouping by ingredient class (so "Mineral
   Salt: 325, 262(i), 262(ii); Antioxidant: 316; ..." renders correctly
   in the ingredients statement).
2. **Phase 3H.5** — Country of Origin auto-calc + show_coo_detail render.
3. **Phase 3H.2** — `/settings/ingredient-classifications` register page
   (so QA can curate the FSANZ class list per tenant).
4. **Phase 3H.3** — Item Master sub-grid editor for `item_ingredient_components`
   (multi-row composition editor for Opti Form ACE S61 etc.).
5. **PIF V6 layout** — once you share V5/V6 PDFs we'll diff field by
   field and migrate the legacy `/pif` page onto the new schema +
   PDF generator.
6. **Micro sampling plan schema** (if your customers actually demand
   n/c/m/M instead of free text — confirm before we build).
7. **Certifications block** (halal / kosher / RSPCA / organic) if
   customer demand exists.
8. **Resend test deliverability** — set up `tenants.qa_email` for German
   Butchery and verify the May 7 spec sends are landing in QA's inbox
   too.

---

## 5. Things we need from you

1. **The actual PIF V5 and V6 PDFs.** Without them I'm working from the
   AFGC standard. Drop them in `/uploads` or attach in chat.
2. **Decision on micro section.** Do customers really demand
   n/c/m/M sampling plans, or is the current free-text `spec_micro`
   field enough?
3. **Decision on certifications.** Which certifications do you need to
   surface on the PIF? Halal? RSPCA? Organic? Each becomes a small
   table with cert body + number + expiry.
4. **Decision on V6 priority vs the rest of the planning workflow.** The
   pending Phase 2/3/4 items in the planner queue are also still open
   (multi-select Finalise, bulk-edit panel, dnd-kit P4). Which side wins
   the next push?
