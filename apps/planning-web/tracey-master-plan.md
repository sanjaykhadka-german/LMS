# Tracey master plan — building Tracey to become a market leader

**Living strategic document.** Captures the why, the where-we're-headed, the
who-we-compete-with, and the things we know we'll need to build. Anything new
that comes up gets jotted in section 8 (Captured ideas) via `/jot` — we sort
into the right section later.

This doc is the **strategic** layer.
For the **tactical / sprint-level** view, see `ROADMAP.md`.

_Last updated: 2026-05-09._

---

## 1. Vision — what Tracey is

> **A modern, integrated ERP for SMB food manufacturers, built so a non-technical operator can drive it after watching one tutorial video — at a fraction of the price and complexity of enterprise ERPs.**

Tracey replaces the painful "Tier 2 inventory tool + QA bolt-on + T&A bolt-on
+ accounting connector + integration glue" stack that today's SMB food
manufacturers cobble together. One product, one login, one bill, one UX —
where the cascade math, costing, traceability, QA / QC workflows, time and
attendance, and accounting integration all live as native features rather
than bolted-on services.

The bet: SMB food manufacturers want enterprise-grade depth without
enterprise-grade implementation cost or consultant lock-in. Nobody at the
SMB tier ships an integrated solution today — Tracey is that.

---

## 2. Beachhead market

**DACH SMB food manufacturers (Germany / Austria / Switzerland), 5–50 staff,
currently using spreadsheets + accountant exports to DATEV.**

Why this segment first:
- Too small for CSB-System / Aptean / SAP B1 to bother with.
- Too compliance-heavy for Katana / Cin7 / Unleashed to serve well.
- They speak German.
- DATEV-native integration is non-negotiable for them — and most international
  SaaS skips DATEV because it's German-tax-specific. A real moat.
- Strong word-of-mouth in the meat / bakery / cheese trades — referrals
  compound once we have 3–5 reference customers.

Expansion ladder from DACH:
1. **Phase 1**: DACH SMB food (12–18 months to 50 paying customers).
2. **Phase 2**: UK + Australia + NZ + Netherlands (English-language food SMB).
3. **Phase 3**: Other regulated SMB manufacturing — cosmetics, supplements,
   coffee roasters, craft beverages. Same engine, different vocabulary.
4. **Phase 4**: Mid-market manufacturers (50–250 staff) — only after we
   have SOC 2 / ISO 27001 and a customer success function.

---

## 3. Competitive landscape

Three tiers Tracey will be compared against. Honest assessment per tier.

### Tier 1 — Enterprise food ERPs

**Aptean Food & Beverage** (formerly Ross Systems / JustFood / Made4Net),
**Deacom (ECI)**, **BatchMaster**, **CSB-System** (German, meat-specific),
**Plex Smart Manufacturing**, **SAP Business One + food add-ons**,
**Microsoft D365 + industry pack**.

- Cover almost every functional box Tracey covers, plus deep features Tracey
  doesn't yet have (custom reports, multi-warehouse, regulatory submissions).
- Implementation is consultant-driven, $50k–$500k+ upfront, 6–18 months.
- UX is dated, not approachable for a non-technical operator.
- CSB is the dominant DACH meat-and-dairy player — serious local competitor
  but old-school stack.
- **Tracey's wedge against them**: implementation in days, not months;
  pricing transparency; modern UX; self-service onboarding; same-engine
  for any food vertical.

### Tier 2 — Modern SMB inventory + MRP

**Katana, Unleashed, Cin7 (which now owns DEAR), Fishbowl, MRPeasy, Odoo
Manufacturing.**

- Multi-level BOMs, basic MRP, Xero/MYOB/QuickBooks integration.
- Industry-agnostic — no food-specific QA / QC / FSANZ allergens / micro
  testing / GS1 barcoding / PIF / spec-sheet workflow.
- None speak DATEV.
- Katana has the closest UX to Tracey's modern feel; Odoo is the
  open-source dark horse.
- **Tracey's wedge against them**: native food-industry features that no
  Tier 2 tool has, plus DATEV.

### Tier 3 — QA / traceability platforms (typically layered on top of an ERP)

**TraceGains** (supplier docs + spec management),
**FoodLogiQ** (traceability),
**Safefood 360, FoodReady, SafetyChain** (HACCP, audits, QA workflows),
**Trustwell** (formerly ESHA / Genesis — nutrition labelling),
**Deputy / Tanda / Connecteam / UKG / Kronos** (T&A — always separate).

- These are excellent at what they do but they're not ERPs.
- Customer ends up with 4–6 disconnected systems and a janky integration
  layer between them.
- Total stack cost rivals Tier 1.
- **Tracey's wedge against them**: integrated. One product. The "why are
  we paying for 5 different SaaS platforms" question we want every
  customer to ask.

---

## 4. Defensible moats

In honest order of strength.

1. **The setup UX.** Pick-type wizard, sanity check ("Test this product"),
   vocabulary remap, traffic-light readiness with click-through fixes. No
   competitor — including the modern ones — lets a non-technical operator
   self-onboard at this level. Enterprise ERPs structurally can't copy
   this; their consulting revenue depends on the complexity.

2. **Vocabulary remap.** Same engine, every industry's words. CSB locks
   to meat terminology; Katana to generic manufacturing; Tracey lets
   each tenant call it "Stage" / "Phase" / "Process step" / "Make stage".
   This is how one product can serve butchers, bakers, cosmetics, coffee
   roasters, cheesemakers — without forking.

3. **Integrated stack.** BOMs + costing + smart purchasing + traceability
   + QA + T&A + native accounting integration under one roof, at SMB
   pricing. Doesn't exist today.

4. **DATEV native.** Real moat in DACH. Most international SaaS skips it
   ("not enough demand"). If we ship native DATEV export from day one
   we have a feature competitors will need 12+ months to replicate (if
   they even bother).

5. **Multi-language + multi-currency from day one.** Often retrofitted
   poorly. Tracey gets this right early.

---

## 5. Required capabilities — what we must build to compete

What's in production today is in `ROADMAP.md` (Recently shipped section).
This list captures the bigger structural pieces still to come, so we don't
lose sight of the long arc.

### 5.1 Core MRP / planning (mostly done)
- ✅ Multi-level BOM with percentage-driven cascade
- ✅ Self-maintaining `consumed_in_weight`
- ✅ Save-driven percentage recompute
- ✅ Test-this-product RPC + UI
- ✅ Vocabulary system (DB + initial UI)
- 🟡 Vocabulary threaded through every existing screen (Phase 2.5)
- 🟡 Product canvas (visual cascade view)
- 🟡 Setup wizard + archetype templates
- 🟡 Item-type collapse to user-facing four concepts

### 5.2 Costing
- 🟡 Standard cost vs. supplier cost reconciliation
- 🟡 Recipe-based cost rollup (cascade brings it for free)
- 🟡 Margin watchlist — alert when ingredient cost moves a margin below threshold
- 🟡 Multi-currency cost handling (FX rates)
- 🔵 Activity-based costing (labour + overhead allocations)

### 5.3 Smart purchasing
- ✅ `get_po_suggestions` RPC live
- 🟡 PO approval workflow
- 🟡 Lead-time aware ordering windows (don't order what won't arrive in time)
- 🟡 Min-order-qty + multipack rounding
- 🟡 Supplier consolidation suggestions (combine into single PO)
- 🔵 Forecast-driven purchasing (rolling demand)

### 5.4 Traceability
- 🟡 Lot tracking deep dive (one-up / one-down within minutes)
- 🟡 Mass-balance reports (incoming vs. outgoing per lot)
- 🟡 Recall simulation (which customers got which lots)
- 🟡 GS1 SSCC pallet labelling
- 🔵 Block-level traceability for high-risk lots (chilled / frozen)

### 5.5 QA / QC
- 🟡 PIF generation from spec
- 🟡 Customer-spec auto-fill from internal spec
- 🟡 HACCP plan templates + CCP monitoring
- 🟡 Pre-op / sanitation checklists with electronic sign-off
- 🟡 In-process QA checks (temperature, weight, visual)
- 🟡 Non-conformance / corrective action register
- 🟡 Supplier approval workflow (cert expiry alerts)
- 🟡 Allergen control (FSANZ + EU 1169 + FDA 21 CFR pre-loaded)
- 🔵 Audit prep mode (one-click audit trail export)

### 5.6 Time & attendance
- 🟡 Clock in / out with optional kiosk + mobile + biometric
- 🟡 Roster / shift planning per department
- 🟡 Break / overtime / public holiday rules per jurisdiction
- 🟡 Payroll export (ADP / Paychex / Xero Payroll / DATEV LODAS)

### 5.7 Accounting integrations
- 🟡 **Xero** (AU/NZ/UK/US)
- 🟡 **MYOB** (AU/NZ)
- 🟡 **QuickBooks Online** (US/CA/UK)
- 🟡 **DATEV** (DE/AT) — including Buchungsstapel + Sachkonten + Kostenstellen
- 🔵 **Sage** (UK/EU)
- 🔵 **Lexware / SevDesk** (DE small-biz)

### 5.8 Compliance & certifications
- 🟡 SOC 2 Type 2
- 🟡 ISO 27001
- 🟡 GDPR readiness (data export, right-to-be-forgotten)
- 🟡 HACCP / FSSC 22000 audit-trail mode
- 🔵 BRC / IFS / SQF audit prep mode
- 🔵 FDA 21 CFR Part 11 (electronic records / signatures) — for US export
- 🔵 Halal / Kosher / Organic certification tracking

### 5.9 Reporting / BI
- 🟡 Custom report builder (drag-drop)
- 🟡 Saved views / scheduled email exports
- 🟡 Dashboards per role (operator / planner / GM / accountant)
- 🟡 Cost variance / yield variance / labour variance reports
- 🔵 Sales-forecast integration

### 5.10 Mobile & floor experience
- 🟡 Mobile floor app (scan, weigh, sign-off, QA check)
- 🟡 Offline-first scanning for goods-in / dispatch
- 🟡 Tablet-friendly recipe view for production rooms
- 🔵 Voice input for hands-busy QA recording

### 5.11 Internationalisation
- ✅ Multi-language framework in code (`lib/i18n.tsx`)
- 🟡 Languages: EN / DE / NL / FR / ES (priority)
- 🟡 Currency + tax engine per country
- 🟡 Date / number formatting per locale
- 🔵 Right-to-left support (Arabic / Hebrew) — only if a customer asks

### 5.12 Platform / ops
- 🟡 Tenant data export / import (for migrations away or backups)
- 🟡 Audit log retention + filtering
- 🟡 Per-tenant feature flags
- 🟡 Sandbox / dev tenant cloning
- 🔵 White-label option (resellers)

Legend: ✅ shipped · 🟡 planned within 12 months · 🔵 12+ months

---

## 6. Strategic decisions still open

- [ ] **Pricing model**: per-user / per-tenant / per-volume / hybrid?
  Likely: tiered SaaS (Starter / Standard / Pro) by feature + user count.
- [ ] **Self-service signup vs. sales-led for first 50 customers?**
  Recommend sales-led to learn pain points; self-service from customer 51 on.
- [ ] **Open-source angle** — release the engine? Risk of competitors
  forking; benefit of community + trust. Probably no, but revisit at year 2.
- [ ] **First non-DACH market?** UK, Australia, or Netherlands first?
- [ ] **Hosted-only vs. self-hosted option?** Hosted-only simpler; self-hosted
  unlocks enterprise customers with data-residency mandates. Defer until
  someone explicitly asks.
- [ ] **AI / automation positioning** — assist on-onboarding (already planned),
  predict demand, auto-suggest BOMs. How loud do we get about this?

---

## 7. North-star metrics

What we'd track if we were operating at scale (placeholder targets — refine
once we have real customers):

- **Time from signup to first published demand plan**: < 2 hours.
- **% of customers that hit "Test this product" on a product within first
  week of using Item Master**: > 80%.
- **% of new customer onboarding done without a Tracey staff call**: > 50%.
- **NPS at month 3 of new customer**: > 50.
- **Annual churn**: < 8%.

---

## 8. 📥 Captured ideas (unsorted)

> New ideas land here via `/jot <idea>` (see section 9). Periodically I
> review and re-file into the right structural section above.

- **[2026-05-09]** **Inventory: lot/batch detail modal on row click.** Clicking an inventory row should open a modal showing per-lot data: lot number, UBD (use-by date), lot quantity, actual purchase cost (from goods-in receipts when scanning is wired) vs standard cost, total value per lot, and aging. For now without scanned receipts, just show standard cost everywhere. When scanned-receipt actual cost lands, the modal becomes the place where you see the difference between actual and standard side by side. Needs a join across `items` + `lot_numbers` + `goods_in_lines` + `inventory_transactions`.
- **[2026-05-09]** **BOM wizard "+ create new item" affordance.** While building a recipe in the BOM wizard, if the user finds an ingredient that doesn't exist yet, they should be able to click a button to spawn the Raw Material wizard right there — without losing the BOM-wizard state. Open in a new tab or as an inline modal. After save, the new item should be selectable in the BOM line picker straight away. Same pattern would help in the existing BOM editor too.
- **[2026-05-09]** **Raw materials should not set items.department.** RMs are bought, not produced — setting department on them confuses demand planning and creates fake per-department buckets. RM wizard now uses items.room (storage location) instead. Future audit: scan existing RMs in the DB and clear items.department where item_type ∈ ('raw_material', 'packaging', 'consumable').
- **[2026-05-10]** **Multilingual search across supplier_items.** Wired into /purchasing search box (matches canonical code/name + every supplier_items.supplier_item_code/name). Still TODO on /items list and /goods-in scan box: same predicate. The big idea: ONE canonical item per logical SKU, but every search surface understands every supplier's dialect. Avoids duplicate-item-creation chaos when each supplier has their own naming.
- **[2026-05-10]** **Order-by-item flow (Phase 1 shipped).** /purchasing → "Order by item" tab. One row per item, click "Order…" → split modal across multiple suppliers, including +Add new supplier inline that writes to supplier_items. Lines persist in po_drafts + po_draft_lines (migration 113). Submit currently just marks draft submitted — TODO: actually create purchase_orders + po_lines per supplier on submit. Needs schema confirmation on po_lines shape first.
- **[2026-05-10]** **Stocktake-driven actual current stock.** Today items.current_stock is a running balance from inventory_transactions. Tino wants the Quick-fix modal "Current stock" to reflect ACTUAL counted stock when a detailed stocktake has been done — i.e. system identifies what's still on the floor by lot/batch and rolls that up. Needs (a) a stocktake feature that captures counted qty per lot, (b) reconciliation that posts variance transactions, (c) a UI hint "as-of <stocktake date>" so operators trust the number. For now Quick-fix shows the running balance.

---

## 9. Using this doc

- **Want to add an idea fast**: type `/jot <your idea>` in any Cowork
  session. It appends to the **Captured ideas** section above with today's
  date. No need to open the file.
- **Want to add structurally** (i.e. to a specific section): tell Claude
  "add this to the master plan under Costing" or wherever, and it'll do it.
- **Want to review and re-file ideas**: ask Claude to "tidy up the master
  plan" or "re-file the captured ideas into the right sections".

The doc is intentionally long-form so anyone joining the project later can
get the full picture in one read. It's also the place to argue with
yourself in writing — disagreements between you and Claude get captured
and revisited rather than lost in chat.
