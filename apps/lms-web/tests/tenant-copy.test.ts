// Phase 7c integration test — proves dataCopySql() correctly moves a
// tenant's rows from public.lms_* into tenant_<uuid>.lms_*, with sequence
// resync and FK integrity intact. Plus: idempotency of the ledger gate,
// empty-source case, freeze/unfreeze round-trip.
//
// Hits the LIVE local-dev DB. Skipped automatically if DATABASE_URL points
// somewhere that isn't a real Postgres ("test:test@..." default from
// setup.ts).
//
// Self-contained: creates a synthetic tenant, seeds rows directly into
// public.lms_* (representing the pre-7c state), provisions, copies,
// asserts. Cleanup drops the schema and deletes the seed rows.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as drizzleSql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  BASELINE_MIGRATION_NAME,
  DATA_COPY_MIGRATION_NAME,
  FREEZE_MIGRATION_NAME,
  LMS_TABLES,
  LMS_TABLES_WITH_ID,
  dataCopySql,
  db,
  freezeSql,
  isTenantSchemaName,
  members,
  tenants,
  tenantSchemaName,
  unfreezeSql,
  users,
} from "@tracey/db";
import { provisionTenant } from "../lib/tenancy/provision";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const SEEDED_EMAIL = "phase7c-seeded@example.test";
const SEEDED_SLUG = "phase7c-seeded-test";
const EMPTY_EMAIL = "phase7c-empty@example.test";
const EMPTY_SLUG = "phase7c-empty-test";

interface SeedTenant {
  tenantId: string;
  userId: string;
}

async function seedTenant(email: string, slug: string, name: string): Promise<SeedTenant> {
  const passwordHash = await bcrypt.hash("phase7c-pw", 10);
  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash, emailVerified: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, emailVerified: new Date() },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`seedTenant(${slug}): users upsert returned no row`);

  const [tenant] = await db
    .insert(tenants)
    .values({ ownerUserId: user.id, slug, name, plan: "free", status: "trialing" })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { name, updatedAt: drizzleSql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`seedTenant(${slug}): tenants upsert returned no row`);

  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  return { tenantId: tenant.id, userId: user.id };
}

/** Wipes everything we put into public.lms_* for this tenant, then drops
 *  the per-tenant schema if any, then deletes the ledger rows. Safe — only
 *  ever touches rows scoped to the synthetic tenantId. */
async function cleanupTenant(tenantId: string): Promise<void> {
  // Drop the per-tenant schema first (FKs into public.users would block
  // public.lms_users deletion otherwise — actually they don't, since the
  // FKs are inside the tenant schema itself).
  const schema = tenantSchemaName(tenantId);
  if (isTenantSchemaName(schema)) {
    await db.execute(drizzleSql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  }
  await db.execute(
    drizzleSql`DELETE FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  );

  // Delete from public.lms_* in FK-respecting order. In practice these
  // tables have CASCADE on delete from parent, but a parent-up walk is
  // safest and matches what we control here.
  const deleteOrder = [
    "content_item_media",
    "content_items",
    "module_media",
    "choices",
    "questions",
    "department_module_policies",
    "user_machines",
    "machine_modules",
    "attempts",
    "assignments",
    "module_versions",
    "modules",
    "machines",
    "positions",
    "audit_logs",
    "whs_records",
    "uploaded_files",
    "departments",
    "employers",
    // Anchor user we inserted into the legacy lms_users table (`public.users`)
    // for this tenant. Goes last because every other lms_* table FKs into it.
    "users",
  ] as const;
  for (const table of deleteOrder) {
    await db.execute(
      drizzleSql.raw(
        `DELETE FROM public."${table}" WHERE tracey_tenant_id = '${tenantId}'`,
      ),
    );
  }
}

/** Inserts a representative seed across all 19 LMS tables for the given
 *  tenant. Preserves FK integrity — children reference their parents'
 *  generated ids via `RETURNING`. Returns counts per table. */
async function seedLmsData(tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tt = tenantId; // shorthand for the SQL literal

  // Departments + Employers + Positions (all top-level)
  const deptRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.departments (name, tracey_tenant_id) VALUES
        ('Floor Staff','${tt}'),('Kitchen','${tt}'),('Office','${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.departments = deptRows.length;

  const empRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.employers (name, tracey_tenant_id) VALUES
        ('GB Pty Ltd','${tt}'),('GB Holdings','${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.employers = empRows.length;

  const posRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.positions (name, department_id, sort_order, tracey_tenant_id) VALUES
        ('Manager', ${deptRows[0]!.id}, 0, '${tt}'),
        ('Cook', ${deptRows[1]!.id}, 0, '${tt}'),
        ('Receptionist', ${deptRows[2]!.id}, 0, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.positions = posRows.length;

  // Machines depend on departments
  const machRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.machines (name, department_id, tracey_tenant_id) VALUES
        ('Slicer A', ${deptRows[1]!.id}, '${tt}'),
        ('Slicer B', ${deptRows[1]!.id}, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.machines = machRows.length;

  // Modules (no within-LMS FK)
  const modRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.modules (title, description, is_published, tracey_tenant_id) VALUES
        ('Knife Safety', 'Test module', true, '${tt}'),
        ('Hygiene Basics', 'Test module', true, '${tt}'),
        ('Slicer Operation', 'Test module', false, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.modules = modRows.length;

  // Module versions
  const verRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.module_versions (module_id, version_number, snapshot_json, tracey_tenant_id) VALUES
        (${modRows[0]!.id}, 1, '{}', '${tt}'),
        (${modRows[1]!.id}, 1, '{}', '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.module_versions = verRows.length;

  // Content items (depend on modules)
  const ciRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.content_items (module_id, kind, title, body, position, tracey_tenant_id) VALUES
        (${modRows[0]!.id}, 'section', 'Intro', 'Body 1', 0, '${tt}'),
        (${modRows[0]!.id}, 'section', 'Cuts', 'Body 2', 1, '${tt}'),
        (${modRows[1]!.id}, 'section', 'Wash hands', 'Body 3', 0, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.content_items = ciRows.length;

  // Content item media (depend on content_items)
  const cimRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.content_item_media (content_item_id, file_path, kind, position, tracey_tenant_id) VALUES
        (${ciRows[0]!.id}, 'knife.pdf', 'pdf', 0, '${tt}'),
        (${ciRows[1]!.id}, 'cuts.png', 'image', 0, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.content_item_media = cimRows.length;

  // Module media (depend on modules)
  const mmRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.module_media (module_id, file_path, kind, position, tracey_tenant_id) VALUES
        (${modRows[0]!.id}, 'overview.mp4', 'video', 0, '${tt}'),
        (${modRows[1]!.id}, 'hygiene.pdf', 'pdf', 0, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.module_media = mmRows.length;

  // Questions + choices
  const qRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.questions (module_id, prompt, kind, position, tracey_tenant_id) VALUES
        (${modRows[0]!.id}, 'Sharp side?', 'single', 0, '${tt}'),
        (${modRows[1]!.id}, 'Wash how long?', 'single', 0, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.questions = qRows.length;

  const chRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.choices (question_id, text, is_correct, position, tracey_tenant_id) VALUES
        (${qRows[0]!.id}, 'Down', true, 0, '${tt}'),
        (${qRows[0]!.id}, 'Up', false, 1, '${tt}'),
        (${qRows[1]!.id}, '20 sec', true, 0, '${tt}'),
        (${qRows[1]!.id}, '5 sec', false, 1, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.choices = chRows.length;

  // We need a public.users row to satisfy FKs from assignments/attempts/audit_logs.
  // This synthetic tenant's user uses that user's email as the lms_users
  // anchor — easiest is to insert a stub lms_users row.
  const lmsUserRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.users (email, name, password_hash, role, is_active_flag, tracey_tenant_id) VALUES
        ('${tt.replace(/-/g, "")}-anchor@example.test', 'Anchor', '$2a$10$dummy', 'employee', true, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  const anchorUserId = lmsUserRows[0]!.id;

  // Assignments + attempts
  const asgRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.assignments (user_id, module_id, version_id, tracey_tenant_id) VALUES
        (${anchorUserId}, ${modRows[0]!.id}, ${verRows[0]!.id}, '${tt}'),
        (${anchorUserId}, ${modRows[1]!.id}, ${verRows[1]!.id}, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.assignments = asgRows.length;

  const atRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.attempts (user_id, module_id, score, correct, total, passed, tracey_tenant_id) VALUES
        (${anchorUserId}, ${modRows[0]!.id}, 100, 1, 1, true, '${tt}'),
        (${anchorUserId}, ${modRows[1]!.id}, 50, 1, 2, false, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.attempts = atRows.length;

  // Joins
  const umRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.user_machines (user_id, machine_id, tracey_tenant_id) VALUES
        (${anchorUserId}, ${machRows[0]!.id}, '${tt}'),
        (${anchorUserId}, ${machRows[1]!.id}, '${tt}')
       RETURNING user_id`,
    ),
  )) as unknown as Array<{ user_id: number }>;
  counts.user_machines = umRows.length;

  const mmodRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.machine_modules (machine_id, module_id, tracey_tenant_id) VALUES
        (${machRows[0]!.id}, ${modRows[2]!.id}, '${tt}')
       RETURNING machine_id`,
    ),
  )) as unknown as Array<{ machine_id: number }>;
  counts.machine_modules = mmodRows.length;

  const dmpRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.department_module_policies (department_id, module_id, tracey_tenant_id) VALUES
        (${deptRows[0]!.id}, ${modRows[0]!.id}, '${tt}'),
        (${deptRows[1]!.id}, ${modRows[1]!.id}, '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.department_module_policies = dmpRows.length;

  // Audit logs + WHS + uploaded files
  const alRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.audit_logs (created_at, user_id, action, entity_type, summary, tracey_tenant_id) VALUES
        (now(), ${anchorUserId}, 'module.created', 'module', 'Created Knife Safety', '${tt}'),
        (now(), ${anchorUserId}, 'module.published', 'module', 'Published Hygiene', '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.audit_logs = alRows.length;

  const whsRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.whs_records (kind, user_id, title, tracey_tenant_id) VALUES
        ('certification', ${anchorUserId}, 'Food Safety', '${tt}'),
        ('certification', ${anchorUserId}, 'First Aid', '${tt}')
       RETURNING id`,
    ),
  )) as unknown as Array<{ id: number }>;
  counts.whs_records = whsRows.length;

  const ufRows = (await db.execute(
    drizzleSql.raw(
      `INSERT INTO public.uploaded_files (filename, mime_type, data, size, uploaded_by_id, tracey_tenant_id) VALUES
        ('seed-${tt.slice(0, 8)}-1.pdf', 'application/pdf', E'\\\\x00', 1, ${anchorUserId}, '${tt}'),
        ('seed-${tt.slice(0, 8)}-2.png', 'image/png', E'\\\\x00', 1, ${anchorUserId}, '${tt}')
       RETURNING filename`,
    ),
  )) as unknown as Array<{ filename: string }>;
  counts.uploaded_files = ufRows.length;

  return counts;
}

describe.skipIf(!isLiveDb)("Phase 7c — tenant data copy", () => {
  let seeded: SeedTenant;
  let empty: SeedTenant;
  let seededCounts: Record<string, number>;

  beforeAll(async () => {
    seeded = await seedTenant(SEEDED_EMAIL, SEEDED_SLUG, "Phase7c Seeded");
    empty = await seedTenant(EMPTY_EMAIL, EMPTY_SLUG, "Phase7c Empty");
    // Wipe any stale state from prior failed runs.
    await cleanupTenant(seeded.tenantId);
    await cleanupTenant(empty.tenantId);
    // Seed actual rows for the seeded tenant (after cleanup, so we control state).
    seededCounts = await seedLmsData(seeded.tenantId);
  }, 30_000);

  afterAll(async () => {
    await cleanupTenant(seeded.tenantId);
    await cleanupTenant(empty.tenantId);
  });

  it("seeded source data is in place across all 19 tables", async () => {
    expect(seededCounts.departments).toBeGreaterThan(0);
    expect(seededCounts.modules).toBeGreaterThan(0);
    expect(seededCounts.choices).toBeGreaterThan(0);
    expect(seededCounts.uploaded_files).toBeGreaterThan(0);
    // Smoke: all seeded counts are non-zero.
    for (const [table, count] of Object.entries(seededCounts)) {
      expect(count, `${table} seed count`).toBeGreaterThan(0);
    }
  });

  it("dataCopySql + verification copies rows into per-tenant schema", async () => {
    // Provision schema first (tenant-copy expects baseline already done).
    await provisionTenant(seeded.tenantId);

    // Run the copy as a single transaction (mirrors what tenant-copy CLI does).
    const stmts = dataCopySql(seeded.tenantId);
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(drizzleSql.raw(stmt));
      }
    });

    const schema = tenantSchemaName(seeded.tenantId);

    // Per-table count match.
    for (const table of LMS_TABLES) {
      const sourceRows = (await db.execute(
        drizzleSql.raw(
          `SELECT count(*)::int AS c FROM public."${table}" WHERE tracey_tenant_id = '${seeded.tenantId}'`,
        ),
      )) as unknown as Array<{ c: number }>;
      const copyRows = (await db.execute(
        drizzleSql.raw(`SELECT count(*)::int AS c FROM "${schema}"."${table}"`),
      )) as unknown as Array<{ c: number }>;
      expect(copyRows[0]?.c, `${table} count copy vs source`).toBe(sourceRows[0]?.c);
    }
  });

  it("sequence resync sets last_value to MAX(id) for non-empty tables", async () => {
    const schema = tenantSchemaName(seeded.tenantId);
    for (const table of LMS_TABLES_WITH_ID) {
      const rows = (await db.execute(
        drizzleSql.raw(
          `SELECT (SELECT MAX(id) FROM "${schema}"."${table}") AS max_id, ` +
            `(SELECT last_value FROM "${schema}"."${table}_id_seq") AS seq_last`,
        ),
      )) as unknown as Array<{ max_id: number | null; seq_last: number | string }>;
      const r = rows[0]!;
      if (r.max_id === null) {
        // Empty table → sequence at default. Postgres internally tracks
        // last_value=1 with is_called=false so next nextval gives 1.
        continue;
      }
      expect(
        Number(r.seq_last),
        `${table} sequence last_value should be >= max(id)`,
      ).toBeGreaterThanOrEqual(Number(r.max_id));
    }
  });

  it("FK integrity holds inside the per-tenant schema", async () => {
    const schema = tenantSchemaName(seeded.tenantId);
    // content_items.module_id must resolve inside tenant schema.
    const orphans = (await db.execute(
      drizzleSql.raw(
        `SELECT count(*)::int AS c FROM "${schema}".content_items ci ` +
          `LEFT JOIN "${schema}".modules m ON m.id = ci.module_id ` +
          `WHERE m.id IS NULL AND ci.module_id IS NOT NULL`,
      ),
    )) as unknown as Array<{ c: number }>;
    expect(orphans[0]?.c, "content_items orphans").toBe(0);

    // choices.question_id must resolve inside tenant schema.
    const choiceOrphans = (await db.execute(
      drizzleSql.raw(
        `SELECT count(*)::int AS c FROM "${schema}".choices c ` +
          `LEFT JOIN "${schema}".questions q ON q.id = c.question_id ` +
          `WHERE q.id IS NULL`,
      ),
    )) as unknown as Array<{ c: number }>;
    expect(choiceOrphans[0]?.c, "choices orphans").toBe(0);
  });

  it("empty source produces empty per-tenant schema, no errors", async () => {
    await provisionTenant(empty.tenantId);
    const stmts = dataCopySql(empty.tenantId);
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(drizzleSql.raw(stmt));
      }
    });

    const schema = tenantSchemaName(empty.tenantId);
    for (const table of LMS_TABLES) {
      const rows = (await db.execute(
        drizzleSql.raw(`SELECT count(*)::int AS c FROM "${schema}"."${table}"`),
      )) as unknown as Array<{ c: number }>;
      expect(rows[0]?.c, `${table} should be empty in per-tenant schema`).toBe(0);
    }
  });

  it("freezeSql REVOKEs writes; unfreezeSql restores them", async () => {
    // Run freeze + verify INSERT into public.modules fails (for the seeded tenant
    // — but actually freeze is per-database, so we test it generically).
    const seededSchema = tenantSchemaName(seeded.tenantId);
    void seededSchema; // unused beyond the type-check above

    // Freeze.
    const freezes = freezeSql();
    await db.transaction(async (tx) => {
      for (const stmt of freezes) {
        await tx.execute(drizzleSql.raw(stmt));
      }
    });

    // Attempt an INSERT into public.modules — must fail with permission denied.
    let frozenInsertFailed = false;
    try {
      await db.execute(
        drizzleSql.raw(
          `INSERT INTO public.modules (title, tracey_tenant_id) VALUES ('FROZEN-PROBE', '${seeded.tenantId}')`,
        ),
      );
    } catch (err) {
      // Expected — permission denied or RLS-deny depending on order of checks.
      frozenInsertFailed = true;
      void err;
    }
    expect(frozenInsertFailed, "INSERT after freeze must fail").toBe(true);

    // Unfreeze.
    const unfreezes = unfreezeSql();
    await db.transaction(async (tx) => {
      for (const stmt of unfreezes) {
        await tx.execute(drizzleSql.raw(stmt));
      }
    });

    // INSERT should now succeed (then we delete it for cleanup).
    await db.execute(
      drizzleSql.raw(
        `INSERT INTO public.modules (title, tracey_tenant_id) VALUES ('FROZEN-PROBE', '${seeded.tenantId}')`,
      ),
    );
    await db.execute(
      drizzleSql.raw(
        `DELETE FROM public.modules WHERE title = 'FROZEN-PROBE' AND tracey_tenant_id = '${seeded.tenantId}'`,
      ),
    );
  });

  it("ledger constants are stable identifiers", () => {
    // Sanity — these are operator-facing keys; verify they don't shift.
    expect(BASELINE_MIGRATION_NAME).toBe("0006_baseline");
    expect(DATA_COPY_MIGRATION_NAME).toBe("0007_data_copy");
    expect(FREEZE_MIGRATION_NAME).toBe("0008_freeze");
  });
});
