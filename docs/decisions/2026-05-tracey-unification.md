# Tracey unification — Phase 0 assessment

**Date:** 2026-05-13
**Author:** Sanjay (with Claude pair)
**Status:** Phase 0 only — discovery and assessment. **No code changes in either repo as part of this ADR.**
**Decision boundary:** Stop here. Wait for explicit user approval before starting Phase 1.

---

## Context

Tracey is shipping three products on two different stacks:

| Product | Stack | Status |
| --- | --- | --- |
| LMS | This monorepo `LMS-1` — Next 16, Drizzle ORM, Postgres on Render, NextAuth v5 | Production since 2026-05-08 (Phase 6+7 cutover) |
| ShiftCraft | Same monorepo — same stack | Phase 1 just shipped (auth + app shell + sign-in/up + dashboard stub) |
| Planning / MRP | Sibling repo `tracey-planning-app-1` (GitHub: `TinoDees/tracey-planning-app`) — Next 16, Supabase (Postgres + Auth + Storage + RLS), Vercel | **In production at GB — Tino runs it daily** |

The end state is **one** Render Postgres, **one** NextAuth v5, **schema-per-tenant** for product data, per-product per-seat Stripe billing, SSO cookie scoped to `.tracey.app`. Seven phases, stop at each boundary.

This document is the Phase 0 deliverable: a full inventory of Planning's Supabase footprint, a mapping to the target schema-per-tenant shape, the shared-dimension reconciliation candidates, Storage migration options, the Stripe additions needed, a risk register, and per-phase effort estimates.

---

## (a) Planning DB inventory

Source: `tracey-planning-app-1/supabase/migrations/` — 139 numbered files (001–139, some gaps), most recent 2026-05.

### Tables — 59 core tables, grouped

| Category | Count | Representative tables |
| --- | --- | --- |
| Master data | 14 | `items`, `suppliers`, `supplier_items`, `customers`, `customer_item_overrides`, `departments`, `machines`, `item_subcategories`, `item_types`, `item_ingredient_components`, `ingredient_classifications`, `currencies` (global, no tenant_id), `price_groups`, `price_group_lines` |
| Production | 16 | `bom_headers`, `bom_lines`, `demand_plans`, `demand_lines`, `mrp_results`, `production_orders`, `lot_numbers`, `traceability_links`, `filling_orders`, `cooking_orders`, `packing_orders`, `dispatch_records`, `inventory_transactions`, `mrp_overrides` |
| Costings | 8 | `labour_rates`, `production_routings`, `dept_cost_rates` (dropped via 125), `overhead_actuals`, `overhead_week_kg`, `overhead_standard_rate`, `pricing_buffers`, `item_price_targets`, `item_price_target_history` |
| Shared/system | 11 | `tenants` (root), `profiles` (FK to auth.users), `roles`, `role_permissions`, `audit_log` (with old/new jsonb), `user_logins`, `user_invites`, `label_canonical_keys`, `tenant_labels` |
| Stocktakes | 3 | `stocktakes`, `stocktake_lines`, `stocktake_department_signoffs` |
| Locations | 2 | `locations`, `rooms` |
| Purchase orders & specs | 10 | `purchase_orders`, `purchase_order_lines`, `po_drafts`, `po_draft_lines`, `purchase_order_sends`, `supplier_contacts`, `customer_contacts`, `product_specs`, `spec_images`, `spec_sends`, `item_images` |
| Customer orders & invoices | 3 | `customer_orders`, `customer_order_lines`, `invoices` |
| Miscellaneous | 5 | `fx_rates`, `machine_maintenance_logs`, `machine_breakdowns`, `units_of_measure`, `item_pallet_config`, `pallet_config_templates` |
| Pack hierarchy | 2 | `tenant_pack_level_defs`, `items_pack_levels` |

**Every table except `currencies` and `label_canonical_keys` has a `tenant_id` column.**

### RPCs — ~20 with deeper coverage; 19 unique observed from app call sites

| Category | RPCs |
| --- | --- |
| MRP & demand | `explode_mrp`, `get_plan_dept_materials`, `get_plan_dept_materials_by_day`, `get_open_production_order_demand` |
| Costings | `cost_breakdown_v1`, `cost_breakdown_v2`, `get_rm_parent_breakdown`, `get_fx_rate` |
| Tree / traversal | `get_item_tree`, `get_bom_walk`, `get_consumer_tree`, `get_item_ancestors` |
| Testing / simulation | `test_product_cascade`, `test_product_cascade_v2` |
| Vocabulary | `get_tenant_labels`, `set_tenant_label`, `reset_tenant_label` |
| Helpers | `generate_batch_number`, `get_item_type_counts`, `get_po_suggestions`, `get_or_create_open_draft`, `recompute_bom_percentages_for_header` |
| RBAC | `has_permission(section, access)` |

Most are `SECURITY DEFINER` (run as the owning role; bypass RLS for cross-table fans). All reference `my_tenant_id()` (which reads `auth.uid()` → `profiles.tenant_id`). Rewrite implications in section (d).

### Views — 9+ core views

`v_item_landed_cost_v1`, `v_item_landed_cost_v2`, `v_item_landed_cost_v3` (current — recursive CTE: RM + labour + OH + buffers), `v_labour_rate_current`, `v_dept_cost_rates_current`, `v_bom_routing_cost`, `v_bom_routing_cost_summary`, `v_overhead_week_summary`, `v_overhead_standard_current`, `v_pricing_buffers_current`, `v_items_inherited_attrs`, `v_item_cost_health_*`. Most are tenant-implicit (rely on `my_tenant_id()` through joins).

### RLS policies — 84+ across 25+ tables

- **Tenant-id-based**: 40+ policies of shape `USING (tenant_id = my_tenant_id())`. Standard pattern.
- **Indirect via FK parent**: e.g. `bom_lines.bom_header_id → bom_headers.tenant_id`.
- **Role-gated**: `is_manager_or_above()`, `is_admin_or_above()` (mig 001 helpers, reference deprecated `profiles.role` enum). Mig 036 introduced dynamic roles + permissions tables with `has_permission(section, access)` RPC — newer code path.
- **`auth.uid()`-based**: `profiles.id = auth.uid()` for self-update; `tenants_select` for super-admin.
- **Super-permissive (`true`)**: `label_canonical_keys` (global read-only ref), `audit_log` INSERT (triggered, runs as table owner).

### Triggers — 50+

- ~30 `updated_at` auto-fill triggers (`BEFORE UPDATE`).
- 4 tenant-auto-populate triggers (`BEFORE INSERT` on `mrp_overrides`, `dept_cost_rates`, `production_routings`, etc. — derive `tenant_id` from FK parent).
- 4 code/barcode auto-gen triggers (`rooms`, `locations`×2, `machines`).
- 1 `on_auth_user_created` trigger on `auth.users` → `handle_new_user()` → creates `profiles` row, reading `tenant_id` from JWT metadata.
- 1 `fn_audit_log` SECURITY DEFINER trigger attached to multiple tables, captures `auth.uid()`.
- 2 BOM/pack recalc triggers (`bom_lines_pct_recompute`, `items_pack_qtys_trg`).
- 1 self-reference prevention trigger on `bom_lines`.
- 2 sequence-assignment triggers (`order_seq_number`, `invoice_sequence`).

### Supabase-specific objects

- `auth.users` FKs from `profiles.id`, `audit_log.user_id`, `user_logins.user_id`, `user_invites.invited_by`, `labour_rates.created_by`, `overhead_*.created_by`, and ~12 more "created_by/approved_by" columns.
- `auth.uid()` referenced in `my_tenant_id()`, role helpers, the audit-log trigger, and several policy `USING` clauses.
- No real-time channel configuration observed in migrations (real-time uses default).
- `handle_new_user()` reads `tenant_id` from `raw_user_meta_data` on signup — Supabase sets this from invite metadata.

---

## (b) Storage usage

5 buckets confirmed (Explore agent grep counted 18 call sites total):

| Bucket | Purpose | Operations | Source |
| --- | --- | --- | --- |
| `item-specs` | Item technical specs (PDF/DOC) | upload, signed URL (120s), remove | `app/items/_components/item-spec-docs-panel.tsx`, `item-suppliers-panel.tsx` |
| `item-images` | Item photographs | upload, getPublicUrl | `components/image-upload.tsx` |
| `spec-images` | Product spec images | upload, getPublicUrl, remove | `app/specs/_components/spec-editor.tsx` |
| `machine-docs` | Machine manuals, schematics | upload, signed URL (3600s), remove | `app/settings/machines/_components/machine-documents-panel.tsx` |
| `supplier-certs` | Supplier certifications (ISO, FSSC) | signed URL (300s) | `app/settings/suppliers/_components/supplier-certifications-panel.tsx` |
| `tenant-branding` | Tenant logos | upload, download, signed URL (3600s), remove | `app/settings/tenant/_components/logo-upload.tsx`, `app/api/invoices/[id]/pdf/route.ts` |

**Aggregate size: not visible from code.** Phase 0 needs a manual step: Tino fetches bucket sizes from the Supabase dashboard (Storage tab → per-bucket size).

---

## (c) Supabase Auth touch-points

### Sign-in / sign-up flows

- **Sign-in**: `src/lib/auth-actions.ts:signIn()` calls `supabase.auth.signInWithPassword({ email, password })`, redirects to `/dashboard`. Server action.
- **Sign-up**: not in app code — happens via Supabase invite flow (`/auth/accept-invite`).
- **Sign-out**: `src/lib/auth-actions.ts:signOut()` calls `supabase.auth.signOut()`.
- **Password reset**: `app/auth/reset-password/page.tsx` uses `verifyOtp(type:'recovery')` + `setSession()` + `updateUser({ password })`.
- **Magic link / OAuth**: `app/auth/callback/route.ts` uses `exchangeCodeForSession()` (server-side code-flow). OAuth providers not yet observed in migrations but the callback handler implies one is wired or planned.
- **Accept invite**: `app/auth/accept-invite/page.tsx` uses `verifyOtp(type:'invite')` then `updateUser` for password set.
- **Change password**: `app/auth/change-password/page.tsx` via `updateUser({ password })`.

### `getUser()` call sites

Multiple — `app/api/user-activity/route.ts`, `app/work-orders/[id]/page.tsx`, `app/api/send-password-reset/route.ts`, `app/api/resend-invite/route.ts`, `app/api/record-login/route.ts`, `app/api/delete-user/route.ts`, `app/api/clear-password-flag/route.ts`, plus data-fetching pages. Each will need to be swapped to `auth()` from NextAuth in Phase 2/6.

### `profiles` table — FK chains

- `auth.users.id` ←PK— `profiles.id` (ON DELETE CASCADE).
- `profiles.id` ←FK— `audit_log.user_id`, `production_orders.created_by`/`batch_recipe_approved_by`, `demand_plans.created_by`/`locked_by`, `invoices.created_by`, `customer_orders.created_by`/`confirmed_by`, `dispatch_records.created_by`, `inventory_transactions.created_by`, `machine_maintenance_logs.performed_by`, `machine_breakdowns.reported_by`/`resolved_by`, `stocktake_lines.counted_by`, `stocktake_department_signoffs.signed_off_by`, `tenant_labels.updated_by`, `bom_headers.created_by`/`approved_by`, `product_specs.approved_by`, `purchase_orders.created_by`, `po_drafts.created_by`, `item_price_target_history.changed_by`.

Every "who did this" reference goes through `profiles`. Phase 2 identity bridge needs to ensure: when a NextAuth user signs in to Planning during cohabitation, there's a matching `auth.users` row and a `profiles` row in the right tenant.

---

## (d) `public.<table>` → `tenant_<uuid>.pl_<table>` mapping

For every table in section (a), the target shape:

- **Same name, with `pl_` prefix**, in the per-tenant schema. Example: `public.items` → `tenant_<uuid>.pl_items`.
- **Drop `tenant_id` column** — the schema name IS the tenant. (Memory: LMS pattern keeps `tracey_tenant_id` as defence-in-depth column with RLS — we should do the same here. Decision deferred to Phase 6 design.)
- **FK rewriting**:
  - Within-tenant FKs (e.g. `bom_lines.bom_header_id → bom_headers.id`): point at the per-tenant copy. Use the same DEFERRABLE INITIALLY IMMEDIATE pattern as `per-tenant-schema.ts`.
  - FKs to `auth.users` or `profiles`: redirect to `app.users` (via the identity bridge).
  - FKs to `currencies` (global, no tenant_id): keep in `public.currencies` or promote to `app.currencies`.
- **`my_tenant_id()` and `auth.uid()` references** in RPCs / views / policies / triggers: rewrite to use `current_setting('app.tenant_id', true)` (the GUC set by `forTenant().run()`) and the NextAuth session UUID respectively.
- **`SECURITY DEFINER` RPCs**: need careful migration — they run as the table owner (bypassing RLS), but the search_path needs to be set inside the function body explicitly to hit the per-tenant schema. Mark each as a Phase 6 risk item.

### Cross-tenant query risk audit

App-side: queries that DO filter by `tenant_id` explicitly are tenant-safe by construction. Queries that DON'T filter (the majority) currently rely on RLS via `my_tenant_id()`. After migration, the same queries will rely on `search_path` resolution → tenant schema. Both isolation guarantees must hold simultaneously during the dual-write window.

**No cross-tenant fans observed in app code.** `audit_log` admin SELECT is tenant-scoped (`tenant_id = my_tenant_id() AND role = 'admin'`). Vocab/label tables are tenant-scoped except `label_canonical_keys` (global read-only).

---

## (e) Shared dimensions to promote to `app` schema

Candidates ranked by overlap × bundle-value:

| Dimension | LMS-1 today | Planning today | ShiftCraft (Phase 1) | Recommendation |
| --- | --- | --- | --- | --- |
| **Users / identity** | `app.users` + `app.members` (user × tenant join) | `auth.users` + `profiles.tenant_id` (one-tenant-per-user) | Reuses `app.users` | **Promote**: collapse Planning's `profiles` into `app.users` + per-tenant employee profile (Phase 5). Identity is single source of truth across products. |
| **`locations`** | LMS empty; `lms_*` per-tenant doesn't include locations | `public.locations` (per-tenant via `tenant_id`) | `sc_locations` drafted (Phase 1 work) | **Promote**: `app.locations` — column shape comparable (`name`, `code`, `barcode`, `room_id`, `sort_order`, `is_active`, plus `tenant_id` until schema-per-tenant). |
| **`departments`** | `lms_departments` (per-tenant; sequence-id) | `public.departments` (per-tenant; uuid-id, `code`, `description`, `sort_order`, `is_active`) | Not yet | **Investigate** (Phase 0 follow-up): IDs differ. Possibly promote `app.departments` with `app.lms_departments` retained for the legacy integer-id path until migrated. |
| **`positions`** | `lms_positions` (per-tenant; hierarchical) | Not in Planning | Not yet | **Keep LMS-only** for now. Promote later only if ShiftCraft needs job-title hierarchy. |
| **`machines`** | `lms_machines` | `public.machines` (with breakdowns + maintenance logs) | Not yet | **Per-tenant per product**: column shape is meaningfully different (Planning tracks breakdowns + service intervals — LMS just inventories for training association). Don't promote. |
| **`profiles` / employee extras** | LMS has nothing | Planning's `profiles` has `email`, `full_name`, `department`, `role_id` | None | **Promote selectively** (Phase 5): `app.users` keeps identity; per-tenant `*_employees` extension tables carry product-specific attributes (Planning's `department` reference, LMS's `position_id`, ShiftCraft's `hourly_rate` / `avatar_color`). |
| **`suppliers`, `customers`** | Not in LMS | Planning-only | Not in ShiftCraft | **Keep Planning-local** unless second use case emerges. |

Needs-deeper-inspection for Phase 5: column shapes of `locations` and `departments` across the apps before any promotion.

---

## (f) Storage migration — recommendation

| Option | Pros | Cons |
| --- | --- | --- |
| **Keep Supabase Storage standalone** | Zero disruption; URLs stay valid; signed-URL TTL behaviour unchanged | Two cloud providers in prod; ongoing Supabase cost; mixed auth (NextAuth elsewhere, Supabase here) |
| **Migrate to S3 or Cloudflare R2** | Single cloud surface; standard tooling; cheaper at scale | Migration effort across 6 buckets; URL rewrites across ~18 call sites; new infra + secret management |
| **Render disks** | Co-located with Postgres; cheapest if volume small | Free tier is ephemeral (memory `lms-project-stack`); persistent disks are paid; not suited to public URLs |

**Recommendation: keep Supabase Storage standalone through Phases 1–6.** Re-evaluate post-Phase 7. The Storage migration is independent of the auth + DB migration and can be sequenced separately. Forcing it in-band makes Phase 6 strictly riskier.

If Supabase Storage cost becomes a problem before the LMS-1 Postgres migration completes, S3 with Cloudflare R2 is the secondary option (cheaper bandwidth, S3-API-compatible — single env var swap from the `@aws-sdk/client-s3` perspective).

---

## (g) Stripe inventory + additions needed

### What exists in LMS-1 today

- `stripe` SDK in `apps/lms-web/package.json` (`^17.5.0`).
- 4 price env vars (`render.yaml:87-94`): `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`.
- Tier definitions in `apps/lms-web/lib/site-config.ts`: 3 tiers (Starter $19/seat/mo, Pro $39, Enterprise contact). 20% annual discount.
- `tenants.plan` column on `app.tenants` (`free | starter | pro | enterprise`).
- `tenants.stripeCustomerId`, `tenants.stripeSubscriptionId`, `tenants.currentPeriodEnd`, `tenants.cancelAtPeriodEnd`, `tenants.seatsPurchased` — single-product subscription model.
- `app.processed_stripe_events` — webhook idempotency.
- Cron `lms-stripe-reconcile` (render.yaml:111) runs `pnpm --filter lms-web run reconcile:stripe` daily at 03:00 UTC.
- Memory (`project_billing_live_on_prod`): "2026-05-11: full Stripe subscribe pipeline working on prod against sandbox keys. Live-mode flip deferred."

### What needs adding for 3-product per-seat

- **3 Stripe products**: `lms`, `shiftcraft`, `planning` (one Stripe Product each). Each with per-seat metered or per-seat fixed pricing — likely fixed unit price with `quantity` = member count.
- **Per-product per-seat price IDs**: at minimum 3 (one per product, monthly), more if annual cadences ship.
- **`price.metadata.product = 'lms'|'shiftcraft'|'planning'`** on every Stripe price — the webhook routes to the right `tenant_subscriptions` row by reading this tag.
- **`app.tenant_subscriptions`** table (Phase 3): one row per `(tenant_id, product)` with `status`, `stripe_subscription_id`, `current_period_end`, `seats_purchased`, `plan`, timestamps. Unique on `(tenant_id, product)`.
- **`app.members.deactivated_at`** (soft delete) — seat count = `members WHERE deactivated_at IS NULL` (vs the existing implicit-delete model).
- **Member-changed trigger / app-side hook**: when active members change, push the new quantity to Stripe via `subscriptions.update({ items: [{ id, quantity }] })`. Idempotent (Stripe accepts no-op updates).
- **Webhook handler extension**: recognize `price.metadata.product`, upsert into `app.tenant_subscriptions` keyed on `(tenant_id, product)` on `checkout.session.completed`, `customer.subscription.created/updated/deleted/`, `invoice.payment_succeeded/failed`. Keep `processed_stripe_events` idempotency.

### Existing Stripe wiring location

`apps/lms-web/app/api/billing/` doesn't exist (the Glob returned no files). Stripe code is presumably under another path. Phase 3 starts by locating it (likely `apps/lms-web/lib/billing/` or `apps/lms-web/scripts/reconcile-stripe.ts`).

---

## (h) Risk register

| Risk | Severity | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Break GB's live Planning during cutover | Critical | Med | Staging-first Phase 6 dry-run; reconciliation diff; dual-write window; 30-day Supabase read-only soak |
| Auth bridge fails — NextAuth user not synced to `auth.users` | High | Med | Idempotent bridge sync; explicit verify step in Phase 2; bridge-failure metric in `app.audit_events` |
| `SET search_path` session-wide leak through pgBouncer | Critical | Low | Strict `SET LOCAL` per tx; existing `client.ts` `forTenant().run()` pattern enforces; lint rule + code review |
| `SECURITY DEFINER` RPCs lose tenant scoping after migration | High | Med | Each RPC body sets `search_path` explicitly in its definition; Phase 6 dry-run validates with seeded test data per tenant |
| `auth.uid()` references in audit triggers + RLS lose binding | High | Med | Replace with `current_setting('app.user_id', true)` GUC set by NextAuth middleware per-request; covered in Phase 2/6 sub-phases |
| Stripe webhook duplicate processing | High | Med | Existing `processed_stripe_events` idempotency; reuse; verify after Phase 3 product tag extension |
| 139 Planning migrations contain bugs that surface only at scale | High | Med | Section (a) inventory flags suspicious migrations (e.g. 124 dropped via 125 — gap in numbering); Phase 6 reconciliation diff catches data drift |
| Storage URL rewrites if (f) recommends a move | Med | Low | Defer Storage migration until post-Phase 7 per recommendation |
| RBAC + RLS rewrite explosion in Phase 6 (hundreds of queries) | High | High | Phase 6 has its own staging-first sub-phase + reconciliation; budget extra 5–10 days |
| Cookie domain mismatch on local dev (localhost ports don't share `.tracey.app`) | Low | High | Document a `*.tracey.local` `/etc/hosts` recipe in this ADR's Phase 2 sub-section |
| `profiles` one-tenant-per-user vs `app.members` multi-tenant model | Med | Med | Identity bridge maps Tino's GB Planning user to a single membership initially; multi-tenant via `members` joins arrives later |
| Real-time Supabase subscriptions silently break if any UI uses them | Med | Low | Phase 0 follow-up: grep `supabase.channel(`, `realtime`. If found, plan a NextAuth-side substitute or accept polling for Phase 1–6 |
| Tino removes `.git/index.lock` from PowerShell — bash can't | Low | High | Documented in Planning's CLAUDE.md already; carry forward when working in the Planning repo |
| Numbering collision between LMS-1 manual migrations and Planning's | Low | Med | LMS-1 already at `0009`/`0010`; new shiftcraft baseline parked at `0011`. Pre-allocate `0012`+ for Phase 6 backfill migrations |
| `processed_stripe_events` table fills unbounded over years | Low | Low | Add a TTL-based cleanup cron post-Phase 3; current memory `feedback_stripe_api_version_drift` notes Stripe types lie — keep idOf() helper |

---

## (i) Phase plan with effort estimates

Estimates are person-days for one engineer working full time on it. Coarse; pending Phase 0 confirmation.

| Phase | Deliverable | Estimate |
| --- | --- | --- |
| 0 | **This ADR.** Discovery only. | 0.5 day (in progress; near complete) |
| 1 | Planning integrated as `apps/planning-web/` (still on Supabase). Added to pnpm workspaces, turbo, root tsconfig, render.yaml as port :4300 web service. APPS.planning added to hub-web. GB users see no change. | 2–3 days |
| 2 | Identity bridge: one-way NextAuth → Supabase `auth.users` sync; `app.tenants.tenant_external_id` column linking to Planning's `tenants.id`; existing GB Supabase auth keeps working. `*.tracey.local` dev hostfile recipe documented. | 3–5 days |
| 3 | `app.tenant_subscriptions` schema. `app.members.deactivated_at` soft-delete. 3 Stripe products + per-seat prices with `metadata.product`. Webhook extension. Entitlement middleware in lms-web, shiftcraft-web, planning-web. Backfill GB tenant with active rows for `lms` + `planning`. | 5–7 days |
| 4 | ShiftCraft retire-and-replace: delete `packages/db/src/shiftcraft-schema.ts`, `drizzle.config.shiftcraft.ts`, `migrate-shiftcraft.ts`, `db:generate-shiftcraft`/`db:migrate-shiftcraft` scripts, `public.sc_*` template tables, `migrations-shiftcraft/0000_white_forge.sql`. Move SC tables into `per-tenant-schema.ts` as `SHIFTCRAFT_TABLES_WITH_ID` + FK list. Drop the `shiftcraft` Postgres schema if it exists. | 3–5 days |
| 5 | Promote `app.locations` (and possibly `app.departments`). Migrate LMS + ShiftCraft + (planning, still on Supabase) data into the shared table. Defer cross-product joins until each app's data layer is updated. | 5–7 days |
| 6 | Planning data migration. Staging-first. For every Planning tenant: create `tenant_<uuid>` schema in Render Postgres (if not present); translate `public.<table>` rows into `tenant_<uuid>.pl_<table>` (drop tenant_id, recreate FKs to `app.users`, rewrite views/RPCs to be schema-aware). Storage stays on Supabase per (f). Rewrite planning-web's data layer; switch reads via feature flag; dual-write for N days; then cut writes. Keep Supabase project read-only for 30 days. | 10–15 days |
| 7 | Decommission Supabase post-soak. Remove `@supabase/ssr`, `@supabase/supabase-js` from planning-web. Remove identity bridge from Phase 2. Archive Supabase project. | 2–3 days |

**Total:** 30–46 person-days of active work, plus a 30-day Supabase read-only soak between 6 and 7.

---

## Summary

The Planning app is a **mature, ~140-migration, ~60-table Supabase-native ERP/MRP** with deep auth.users coupling (every "who did this" goes through `profiles`), 84+ RLS policies, ~40 RPCs (several `SECURITY DEFINER` with recursive CTEs), 5 Storage buckets, and a dynamic RBAC model (mig 036) layered on top of an older `user_role` enum. Migrating it into LMS-1's schema-per-tenant model is the **dominant scope of the unification** — every other phase is preparatory or supporting.

The two patterns to preserve: (1) **identity stays unified** through NextAuth from Phase 2 onward; (2) **product entitlement is enforced in middleware on every request** via `app.tenant_subscriptions`. The pattern to retire: **`my_tenant_id()` + `auth.uid()` everywhere** gets replaced by **`current_setting('app.tenant_id')` + NextAuth session UUID** during Phase 6.

**No code lands as part of this ADR.** Phases 1–7 each get their own ADR at the boundary, and explicit user approval is required before any phase starts.

---

## Stop here

Phase 0 deliverable complete. **Wait for explicit user approval before starting Phase 1.**
