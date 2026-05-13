# Tracey — master plan

_Started 2026-04. Living doc. Updated by Tino + Claude._

## What we're building

**Tracey** is a multi-industry food-manufacturing ERP/MRP for small-to-mid producers. The promise: a system that an actual production planner can use without an SAP consultant. Live, transparent, cheap, and tuned to how food factories actually work — recipes, batches, machines, casings, packing hierarchies, traceability.

The design partner is **German Butchery** (Tino's company, Sydney). The work is happening on real production data, and once it's robust the same product ships to other small food manufacturers: cheesemakers, coffee roasters, cosmetics, ready meals.

## Why this can win

Existing options are either:
- **Too big** (SAP, NetSuite, Dynamics) — $200-400k year-one, 9-month implementations, designed for $50M+ businesses.
- **Too small** (spreadsheets, generic Xero) — no MRP, no traceability, no multi-stage cascade, no dispatch margin.
- **Half-built food specialists** (Aptean, BatchMaster, etc.) — single-industry, dated UX, no SaaS, no live cost.

Tracey's wedge:
1. **Live data, no quarterly stand-stills.** Cost moves the second a supplier price changes. Margin moves the second a yield drops. No "month-end reporting".
2. **Multi-industry vocabulary system.** A butcher calls it a "log", a cheesemaker calls it a "wheel", a coffee roaster calls it a "batch". One codebase, tenant-renameable nouns.
3. **Operator-shaped UX.** Operators enter "1 net per 100 kg of WIP", not "0.01". They drag cards, they don't fill timesheets.
4. **SaaS pricing.** Multi-tenant Supabase, per-tenant cost ≈ $0. Sustainable at $200-500/month per tenant.

## Three-month horizon (May → August 2026)

### Now (May)
- ✅ Planning / MRP / run order — stable and used in production at GB.
- ✅ Inventory, purchasing, work orders, BOM editor — feature-complete first pass.
- 🔄 **BOM data model overhaul** — natural-language entry (see `bom-data-model.md`).
- 🔄 **Costings Phase 1** — live RM cost cascade (shipped, see `costings-roadmap.md`).

### Next (June)
- **Costings Phase 2-3** — dept conversion rates + full landed cost per item.
- **Disruptive cost home page** — top makers / bleeders / where money goes / sparklines.
- **Cost history snapshot** — per-day per-item, enables time-series.

### Then (July-August)
- **Customer margin** (Phase 4) — realised margin per customer/SKU, floor flags.
- **Variance** (Phase 5) — actual vs standard per WO.
- **Multi-industry harden** — first paid pilot tenant outside GB (cheese or coffee).

## Long-term direction

- **B2B customer portal** — separate Supabase project (`german-butchery-portal`), live. Customers log in, see their account, place orders. Goes Tracey-multi-tenant once GB is stable.
- **Mobile-first floor view** — operators run WOs on a tablet, weigh on a scale, scan a barcode, record yields. Already partially in `/dept/{slug}` floor view.
- **AI-suggested recipe optimisations** — once cost history exists, Claude can flag "Bratwurst margin dropped 4% over 4 weeks, root cause pork 75/25 supplier #1 up 8%". Cheap with Haiku at scale.
- **Compliance & traceability** — full forward/backward trace, recall in under 60 seconds, allergen audit, batch certificates auto-generated.

## What success looks like

- Tino runs German Butchery on Tracey end-to-end, no spreadsheets.
- A second tenant (cheese or coffee) is onboarded in under a week.
- Live cost is trusted enough that pricing decisions are made on it daily.
- The codebase is documented enough that a new engineer / agent can pick it up in 30 minutes.

## What success doesn't look like

- Trying to compete with SAP on feature count.
- Optimising for tenants over 50 staff before the first 5 are happy.
- Building features without an operator using them by Friday.

## The unfair advantage

We're building this with Tino actively at the keyboard, against real production every day. Most ERPs are designed by people who've never run a factory. Every feature in Tracey has either solved a real GB problem or has a GB use case waiting for it. That's why the BOM editor cares about clips and casings, why the run-sheet print has a "planner notes" box, why batch numbers get the first 5 chars highlighted (year+day, which is what GB's labelling uses).

The system reflects the operator's mental model rather than the developer's. That's the bar.
