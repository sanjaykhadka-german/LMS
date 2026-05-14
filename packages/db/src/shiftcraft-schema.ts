// ShiftCraft tables — employee shift scheduling.
//
// Multi-tenant strategy: PER-TENANT POSTGRES SCHEMA (matches the LMS Phase 7
// pattern in per-tenant-schema.ts). The Drizzle table definitions below are
// declared as unqualified `pgTable("sc_*", ...)` so they emit unqualified
// table names in SQL. Two physical locations exist for each table:
//
//   1. `public.sc_*` — the source/template tables. Created by
//      `pnpm db:migrate-shiftcraft` from this file. App code never queries
//      these directly in tenant-scoped paths; they exist so Drizzle has a
//      stable home and so per-tenant provisioning can use `CREATE TABLE …
//      LIKE INCLUDING ALL` to make the per-tenant copies.
//
//   2. `tenant_<uuid>.sc_*` — the per-tenant copies. Created by the SQL
//      migration `packages/db/migrations/per-tenant/0009_shiftcraft_baseline.sql`
//      which the existing `pnpm db:migrate-tenants` runner applies inside
//      each tenant's schema (with `SET LOCAL search_path = "tenant_<uuid>",
//      public`).
//
// App-code queries go through `ctx.db.run(...)` (= `forTenant(tid).run(...)`)
// which sets `search_path` so unqualified `sc_*` references resolve to the
// per-tenant copy. RLS on each per-tenant table provides defence-in-depth.
//
// `tracey_tenant_id` column is kept on every table (mirroring the LMS
// pattern). Its DEFAULT is set per-tenant inside the baseline SQL so Drizzle
// INSERTs don't need to specify it explicitly.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// ─── Locations ───
//
// A physical site where shifts happen. Each tenant has 1..N locations.
// Timezone defaults to Australia/Sydney but can be overridden per site
// (e.g. a franchise with stores across timezones).

export const scLocations = pgTable(
  "sc_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Australia/Sydney"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_locations_tenant_idx").on(t.traceyTenantId),
    check("sc_locations_timezone_chk", sql`length(${t.timezone}) > 0`),
  ],
);

// ─── Shifts ───
//
// Lifecycle: draft → published → (optionally) cancelled.
// Drafts are visible only to managers/admins; published shifts can be offered
// to staff via shift_assignments.

export const scShifts = pgTable(
  "sc_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    role: text("role").notNull(), // e.g. "Butcher", "Cashier", "Cleaner"
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_shifts_tenant_starts_idx").on(t.traceyTenantId, t.startsAt),
    index("sc_shifts_location_starts_idx").on(t.locationId, t.startsAt),
    check(
      "sc_shifts_status_chk",
      sql`${t.status} in ('draft','published','cancelled')`,
    ),
    check("sc_shifts_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

// ─── Shift assignments ───
//
// One row per (shift, employee) offer. Status flows:
//   offered → accepted | declined
//                ↓
//             swapped (covered by another employee)
//                ↓
//             no_show (post-shift, if employee didn't turn up)

export const scShiftAssignments = pgTable(
  "sc_shift_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shiftId: uuid("shift_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("offered"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_shift_user_uq").on(t.shiftId, t.userId),
    index("sc_assignments_user_idx").on(t.userId),
    check(
      "sc_assignments_status_chk",
      sql`${t.status} in ('offered','accepted','declined','swapped','no_show')`,
    ),
  ],
);

// ─── Time-off requests ───

export const scTimeOffRequests = pgTable(
  "sc_time_off_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_time_off_tenant_idx").on(t.traceyTenantId, t.startDate),
    index("sc_time_off_user_idx").on(t.userId, t.startDate),
    check(
      "sc_time_off_status_chk",
      sql`${t.status} in ('pending','approved','denied','cancelled')`,
    ),
    check("sc_time_off_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

// FK note: scShifts.locationId → scLocations.id and
// scShiftAssignments.shiftId → scShifts.id are intentionally NOT declared via
// Drizzle .references() here. Both directions exist between sc_* tables, and
// the LIKE-based per-tenant provisioning recreates them inside each tenant
// schema (see migrations/per-tenant/0009_shiftcraft_baseline.sql). Declaring
// them in Drizzle would generate FK constraints in `public.sc_*` that point
// at `public.sc_*` siblings — which is fine for the template, but the same
// constraint name then collides when the per-tenant copy tries to recreate
// the FK pointing at its tenant-schema siblings. Keeping them as bare
// `uuid("...")` columns lets the per-tenant SQL own FK creation.

// ─── Shift swap / cover requests ───
//
// Employee A asks employee B to take a shift A is already assigned to (cover)
// or to trade shifts (swap). Status flows: pending → accepted | declined |
// cancelled. On accept the linked assignment row(s) mutate transactionally
// (the existing scAssignmentStatus enum already reserves 'swapped' for this).
//
// FKs to app.users and to the local sc_shift_assignments are added in the
// per-tenant baseline migration — same convention as scShiftAssignments.

export const scShiftSwapRequests = pgTable(
  "sc_shift_swap_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    initiatorUserId: uuid("initiator_user_id").notNull(),
    initiatorAssignmentId: uuid("initiator_assignment_id").notNull(),
    targetUserId: uuid("target_user_id").notNull(),
    // null = cover (one-way handoff); non-null = swap (two-way trade)
    targetAssignmentId: uuid("target_assignment_id"),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_swap_pending_unique")
      .on(t.initiatorAssignmentId)
      .where(sql`status = 'pending'`),
    index("sc_swap_tenant_idx").on(t.traceyTenantId, t.status, t.createdAt),
    index("sc_swap_target_idx").on(t.targetUserId, t.status),
    check(
      "sc_swap_status_chk",
      sql`${t.status} in ('pending','accepted','declined','cancelled')`,
    ),
    check(
      "sc_swap_distinct_users_chk",
      sql`${t.initiatorUserId} <> ${t.targetUserId}`,
    ),
  ],
);

// ─── Employees (HR-side roster) ───
//
// ShiftCraft-owned record of someone who can be assigned to shifts. Distinct
// from `app.users` (auth identity) and `app.members` (tenant access) so that
// labour-hire / contractor staff who never need a login still appear on the
// roster. Permanent and casual employees can be linked to their auth user
// (app_user_id) when they have one — for example after self-onboarding or
// when the LMS admin confirms the suggested learner record.
//
// `email` is nullable because labour-hire rows often have only a name +
// mobile. The partial unique index on (tracey_tenant_id, lower(email))
// prevents duplicate emails within a tenant while still allowing many
// null-email rows.
//
// `availability` is jsonb for now — kept flexible while we figure out the
// shape (initial form uses `{ mon: "09-17", tue: "...", ... }`).

export const scEmployees = pgTable(
  "sc_employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    mobile: text("mobile"),
    department: text("department"),
    availability: jsonb("availability"),
    employmentType: text("employment_type").notNull().default("permanent"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_employees_tenant_idx").on(t.traceyTenantId, t.isActive),
    index("sc_employees_app_user_idx").on(t.appUserId),
    uniqueIndex("sc_employees_tenant_email_uq")
      .on(t.traceyTenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check(
      "sc_employees_employment_type_chk",
      sql`${t.employmentType} in ('permanent','casual','labour_hire')`,
    ),
    check(
      "sc_employees_email_format_chk",
      sql`${t.email} is null or position('@' in ${t.email}) > 1`,
    ),
  ],
);

// ─── Clock events ───
//
// Append-only stream of clock punches. Each row is one transition:
//   in           — start of a work segment
//   break_start  — pause work (lunch / short break)
//   break_end    — resume work after a break
//   out          — end of work segment
//
// Derived state ("currently clocked in", "on break", "elapsed today",
// "hours this week") is computed by walking the stream — see
// apps/shiftcraft-web/lib/clock.ts. Keeping the table append-only means
// edits/corrections are themselves rows (a future slice can add
// `corrects_event_id` and `reason`) rather than mutating history.
//
// `location_id` is optional: kiosk/geofence integrations would populate
// it, but a phone-based clock-in might not know which location the user
// is at. No FK to sc_employees because clock events are keyed on
// app_user_id (the auth identity) — a labour-hire row without an auth
// user can't clock in anyway.

export const scClockEvents = pgTable(
  "sc_clock_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_clock_events_user_occurred_idx").on(t.appUserId, t.occurredAt),
    index("sc_clock_events_tenant_occurred_idx").on(
      t.traceyTenantId,
      t.occurredAt,
    ),
    check(
      "sc_clock_events_type_chk",
      sql`${t.eventType} in ('in','out','break_start','break_end')`,
    ),
    check(
      "sc_clock_events_source_chk",
      sql`${t.source} in ('manual','kiosk','geofence','admin_edit')`,
    ),
  ],
);

// ─── Inferred types ───

export type ScLocation = typeof scLocations.$inferSelect;
export type NewScLocation = typeof scLocations.$inferInsert;
export type ScShift = typeof scShifts.$inferSelect;
export type NewScShift = typeof scShifts.$inferInsert;
export type ScShiftAssignment = typeof scShiftAssignments.$inferSelect;
export type NewScShiftAssignment = typeof scShiftAssignments.$inferInsert;
export type ScTimeOffRequest = typeof scTimeOffRequests.$inferSelect;
export type NewScTimeOffRequest = typeof scTimeOffRequests.$inferInsert;
export type ScShiftSwapRequest = typeof scShiftSwapRequests.$inferSelect;
export type NewScShiftSwapRequest = typeof scShiftSwapRequests.$inferInsert;
export type ScEmployee = typeof scEmployees.$inferSelect;
export type NewScEmployee = typeof scEmployees.$inferInsert;
export type ScEmploymentType = "permanent" | "casual" | "labour_hire";
export type ScClockEvent = typeof scClockEvents.$inferSelect;
export type NewScClockEvent = typeof scClockEvents.$inferInsert;
export type ScClockEventType = "in" | "out" | "break_start" | "break_end";
export type ScClockEventSource = "manual" | "kiosk" | "geofence" | "admin_edit";
export type ScShiftStatus = "draft" | "published" | "cancelled";
export type ScAssignmentStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "swapped"
  | "no_show";
export type ScTimeOffStatus = "pending" | "approved" | "denied" | "cancelled";
export type ScSwapStatus = "pending" | "accepted" | "declined" | "cancelled";
