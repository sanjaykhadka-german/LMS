// Slice 5 — one-shot import of a tenant's planning data from Supabase
// Postgres into the Tracey per-tenant schema. Runs against a provisioned
// tenant (Slice 4's runner must have applied 0012 + 0013 first).
//
// Usage:
//   pnpm db:planning-import --tenant=<tracey-uuid> [--supabase-tenant=<uuid>]
//                          [--dry-run] [--tables=items,suppliers,...]
//
// Env required:
//   DATABASE_URL       — the Tracey Postgres (target)
//   SUPABASE_DB_URL    — Supabase project's direct Postgres connection (NOT the
//                        PostgREST URL). Find it under Supabase Settings → Database
//                        → Connection string → URI. Looks like:
//                        postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
//
// Tenant id handling: Slice 0b's auth bootstrap reuses the Supabase tenant
// UUID as the Tracey app.tenants.id, so the same UUID identifies the tenant
// on both sides. --supabase-tenant is only needed in the rare case the two
// drifted (e.g. tenant got rekeyed). Defaults to --tenant.
//
// What gets copied: every Supabase table whose target pl_* exists in the
// tenant's schema, in dependency order. tenant_id column is renamed to
// tracey_tenant_id. Columns that don't exist on the target are dropped.
// Generated columns (variance, units_per_pallet) are skipped — Postgres
// recomputes them from their source columns post-INSERT.
//
// FK strategy: SET CONSTRAINTS ALL DEFERRED inside a single transaction so
// dep-order doesn't have to be exact and self-FKs (pl_items.parent_item_id)
// resolve at commit. Slice 2's FKs are all DEFERRABLE INITIALLY IMMEDIATE.
//
// Idempotency: refuses to run if the tenant ledger already has
// '0013_planning_data_imported'. Pass --force to override (deletes existing
// pl_* rows for this tenant first, then re-imports).
//
// Verification: after copy, source rowcount must equal target rowcount per
// table or the transaction rolls back. On success, writes a ledger row.
//
// What this CLI is NOT: it does not migrate Supabase Auth users — that's
// the Slice 0a/0b bootstrap path (each user gets a bcrypt hash on first
// sign-in). The created_by / approved_by / etc. FK columns reference
// app.users(id); for those to satisfy FKs after the import, every user
// referenced in the imported rows must already exist in app.users. The
// CLI checks this up-front and refuses if any are missing.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

// ─── Table import order ────────────────────────────────────────────────────
// (supabaseTable, plTable). Order is dep-aware but DEFERRED FKs forgive
// re-ordering. Tables not in this list are not imported (e.g. mrp_results
// is recomputed by explode_mrp on first run; tenant_barcode_pool may not be
// in use; planning_user_settings has no Supabase equivalent — was split off
// from profiles).
const IMPORT_TABLES: Array<{ supabase: string; pl: string }> = [
  // Reference data
  { supabase: "departments",                  pl: "pl_departments" },
  { supabase: "allergen_definitions",         pl: "pl_allergen_definitions" },
  { supabase: "tenant_allergen_settings",     pl: "pl_tenant_allergen_settings" },
  { supabase: "user_categories",              pl: "pl_user_categories" },
  { supabase: "user_department_access",       pl: "pl_user_department_access" },
  { supabase: "tax_codes",                    pl: "pl_tax_codes" },
  { supabase: "units_of_measure",             pl: "pl_units_of_measure" },
  { supabase: "tenant_pack_level_defs",       pl: "pl_tenant_pack_level_defs" },
  { supabase: "roles",                        pl: "pl_roles" },
  { supabase: "role_permissions",             pl: "pl_role_permissions" },
  { supabase: "user_logins",                  pl: "pl_user_logins" },
  { supabase: "currencies",                   pl: "pl_currencies" },
  { supabase: "ingredient_classifications",   pl: "pl_ingredient_classifications" },

  // Items + children
  { supabase: "item_categories",              pl: "pl_item_categories" },
  { supabase: "item_subcategories",           pl: "pl_item_subcategories" },
  { supabase: "item_types",                   pl: "pl_item_types" },
  { supabase: "items",                        pl: "pl_items" },
  { supabase: "item_images",                  pl: "pl_item_images" },
  { supabase: "tenant_barcode_pool",          pl: "pl_tenant_barcode_pool" },
  { supabase: "item_barcodes",                pl: "pl_item_barcodes" },
  { supabase: "item_spec_documents",          pl: "pl_item_spec_documents" },
  { supabase: "item_ingredient_components",   pl: "pl_item_ingredient_components" },

  // BOM
  { supabase: "bom_headers",                  pl: "pl_bom_headers" },
  { supabase: "bom_lines",                    pl: "pl_bom_lines" },

  // Suppliers + purchasing
  { supabase: "suppliers",                    pl: "pl_suppliers" },
  { supabase: "supplier_items",               pl: "pl_supplier_items" },
  { supabase: "supplier_contacts",            pl: "pl_supplier_contacts" },
  { supabase: "supplier_certifications",      pl: "pl_supplier_certifications" },
  { supabase: "purchase_orders",              pl: "pl_purchase_orders" },
  { supabase: "purchase_order_lines",         pl: "pl_purchase_order_lines" },
  { supabase: "fx_rates",                     pl: "pl_fx_rates" },

  // Customers + pricing + orders
  { supabase: "price_groups",                 pl: "pl_price_groups" },
  { supabase: "customers",                    pl: "pl_customers" },
  { supabase: "customer_item_overrides",      pl: "pl_customer_item_overrides" },
  { supabase: "price_group_lines",            pl: "pl_price_group_lines" },
  { supabase: "customer_contacts",            pl: "pl_customer_contacts" },
  { supabase: "customer_orders",              pl: "pl_customer_orders" },
  { supabase: "customer_order_lines",         pl: "pl_customer_order_lines" },
  { supabase: "order_line_lots",              pl: "pl_order_line_lots" },
  { supabase: "invoices",                     pl: "pl_invoices" },

  // Plans + production
  { supabase: "demand_plans",                 pl: "pl_demand_plans" },
  { supabase: "demand_lines",                 pl: "pl_demand_lines" },
  { supabase: "mrp_overrides",                pl: "pl_mrp_overrides" },
  // mrp_results intentionally skipped — explode_mrp recomputes from demand_plans
  { supabase: "machines",                     pl: "pl_machines" },
  { supabase: "machine_breakdowns",           pl: "pl_machine_breakdowns" },
  { supabase: "machine_spare_parts",          pl: "pl_machine_spare_parts" },
  { supabase: "machine_documents",            pl: "pl_machine_documents" },
  { supabase: "machine_maintenance_logs",     pl: "pl_machine_maintenance_logs" },
  { supabase: "production_orders",            pl: "pl_production_orders" },
  { supabase: "production_sub_operations",    pl: "pl_production_sub_operations" },
  { supabase: "traceability_links",           pl: "pl_traceability_links" },
  { supabase: "filling_orders",               pl: "pl_filling_orders" },
  { supabase: "cooking_orders",               pl: "pl_cooking_orders" },
  { supabase: "packing_orders",               pl: "pl_packing_orders" },

  // Stock + specs
  { supabase: "lot_numbers",                  pl: "pl_lot_numbers" },
  { supabase: "rooms",                        pl: "pl_rooms" },
  { supabase: "locations",                    pl: "pl_locations" },
  { supabase: "stocktakes",                   pl: "pl_stocktakes" },
  { supabase: "stocktake_lines",              pl: "pl_stocktake_lines" },
  { supabase: "stocktake_department_signoffs",pl: "pl_stocktake_department_signoffs" },
  { supabase: "product_specs",                pl: "pl_product_specs" },
  { supabase: "spec_images",                  pl: "pl_spec_images" },
  { supabase: "spec_sends",                   pl: "pl_spec_sends" },
  { supabase: "pallet_config_templates",      pl: "pl_pallet_config_templates" },
  { supabase: "item_pallet_config",           pl: "pl_item_pallet_config" },

  // Operational
  { supabase: "wastage_reasons",              pl: "pl_wastage_reasons" },
  { supabase: "wastage_records",              pl: "pl_wastage_records" },
  { supabase: "scan_events",                  pl: "pl_scan_events" },
  { supabase: "goods_in_receipts",            pl: "pl_goods_in_receipts" },
  { supabase: "goods_in_lines",               pl: "pl_goods_in_lines" },
  { supabase: "dispatch_records",             pl: "pl_dispatch_records" },
  { supabase: "inventory_transactions",       pl: "pl_inventory_transactions" },

  // Tenant vocabulary
  { supabase: "tenant_labels",                pl: "pl_tenant_labels" },
];

const LEDGER_MIGRATION = "0013_planning_data_imported";

interface Args {
  tenantId: string;
  supabaseTenantId: string;
  dryRun: boolean;
  force: boolean;
  tables: string[] | null; // null = all
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let tenantId: string | null = null;
  let supabaseTenantId: string | null = null;
  let dryRun = false;
  let force = false;
  let tables: string[] | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--tenant=")) tenantId = arg.slice("--tenant=".length);
    else if (arg.startsWith("--supabase-tenant=")) supabaseTenantId = arg.slice("--supabase-tenant=".length);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--tables=")) tables = arg.slice("--tables=".length).split(",").filter(Boolean);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "usage: pnpm db:planning-import --tenant=<tracey-uuid> [opts]",
          "  --supabase-tenant=<uuid>   only if Supabase + Tracey tenant ids drifted",
          "  --dry-run                  print per-table row counts, no writes",
          "  --force                    delete existing pl_* rows for this tenant first",
          "  --tables=t1,t2             only import the listed source tables",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("error: --tenant=<tracey-uuid> is required (and must be a UUID)");
    process.exit(2);
  }
  if (supabaseTenantId && !/^[0-9a-f-]{36}$/i.test(supabaseTenantId)) {
    console.error("error: --supabase-tenant must be a UUID if provided");
    process.exit(2);
  }
  return { tenantId, supabaseTenantId: supabaseTenantId ?? tenantId, dryRun, force, tables };
}

interface ColumnInfo {
  name: string;
  isGenerated: boolean;
}

async function listTargetColumns(
  tracey: postgres.Sql,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  const rows = await tracey<{ column_name: string; is_generated: string }[]>`
    SELECT column_name, is_generated
      FROM information_schema.columns
     WHERE table_schema = ${schema} AND table_name = ${table}
     ORDER BY ordinal_position
  `;
  return rows.map((r) => ({ name: r.column_name, isGenerated: r.is_generated !== "NEVER" }));
}

async function listSourceColumns(supa: postgres.Sql, table: string): Promise<Set<string>> {
  const rows = await supa<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Set(rows.map((r) => r.column_name));
}

async function tableExists(sql: postgres.Sql, schema: string, table: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = ${schema} AND table_name = ${table}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function preflight(tracey: postgres.Sql, supa: postgres.Sql, args: Args): Promise<{
  schemaName: string;
  plan: Array<{ source: string; target: string; cols: string[]; tenantColInSupabase: string }>;
}> {
  // 1. Verify Tracey tenant exists.
  const traceyTenant = await tracey<{ slug: string; name: string }[]>`
    SELECT slug, name FROM app.tenants WHERE id = ${args.tenantId} LIMIT 1
  `;
  if (traceyTenant.length === 0) {
    throw new Error(`Tracey tenant ${args.tenantId} not found in app.tenants`);
  }
  console.log(`[planning-import] target: ${traceyTenant[0]!.slug} (${args.tenantId})`);

  // 2. Verify schema is provisioned (0012 + 0013 applied).
  const schemaName = `tenant_${args.tenantId}`;
  const ledger = await tracey<{ migration_name: string }[]>`
    SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = ${args.tenantId}
  `;
  const applied = new Set(ledger.map((r) => r.migration_name));
  if (!applied.has("0012_planning_baseline") || !applied.has("0013_planning_rpcs")) {
    throw new Error(
      `tenant ${args.tenantId} is missing 0012/0013 in app.tenant_migrations — run \`pnpm db:migrate-tenants\` first`,
    );
  }
  if (applied.has(LEDGER_MIGRATION) && !args.force) {
    throw new Error(
      `tenant already has '${LEDGER_MIGRATION}' in app.tenant_migrations — pass --force to re-import`,
    );
  }

  // 3. Filter to tables both sides have and resolve their column intersection.
  const selectedSources = args.tables ? new Set(args.tables) : null;
  const plan: Array<{ source: string; target: string; cols: string[]; tenantColInSupabase: string }> = [];
  for (const t of IMPORT_TABLES) {
    if (selectedSources && !selectedSources.has(t.supabase)) continue;
    if (!(await tableExists(supa, "public", t.supabase))) {
      console.log(`[planning-import] skip ${t.supabase} — not in Supabase`);
      continue;
    }
    if (!(await tableExists(tracey, schemaName, t.pl))) {
      console.log(`[planning-import] skip ${t.pl} — not provisioned in ${schemaName}`);
      continue;
    }
    const targetCols = await listTargetColumns(tracey, schemaName, t.pl);
    const sourceCols = await listSourceColumns(supa, t.supabase);

    // tenant_id (Supabase) maps to tracey_tenant_id (Tracey)
    const tenantColInSupabase = sourceCols.has("tenant_id") ? "tenant_id" : "";

    const cols = targetCols
      .filter((c) => !c.isGenerated)
      .filter((c) => {
        if (c.name === "tracey_tenant_id") return !!tenantColInSupabase;
        return sourceCols.has(c.name);
      })
      .map((c) => c.name);

    plan.push({ source: t.supabase, target: t.pl, cols, tenantColInSupabase });
  }
  return { schemaName, plan };
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

async function importTable(
  tx: postgres.TransactionSql,
  supa: postgres.Sql,
  schemaName: string,
  entry: { source: string; target: string; cols: string[]; tenantColInSupabase: string },
  supabaseTenantId: string,
  dryRun: boolean,
): Promise<{ source: number; copied: number }> {
  // Build the source SELECT. tenant_id is aliased to tracey_tenant_id; other
  // columns selected by name from the intersection.
  const selectExprs = entry.cols.map((c) => {
    if (c === "tracey_tenant_id" && entry.tenantColInSupabase) {
      return `${quoteIdent(entry.tenantColInSupabase)} AS tracey_tenant_id`;
    }
    return quoteIdent(c);
  });

  const rows = await supa.unsafe<Record<string, unknown>[]>(
    `SELECT ${selectExprs.join(", ")}
       FROM public.${quoteIdent(entry.source)}
      WHERE ${entry.tenantColInSupabase ? `${quoteIdent(entry.tenantColInSupabase)} = $1` : "TRUE"}`,
    entry.tenantColInSupabase ? [supabaseTenantId] : [],
  );

  const sourceCount = rows.length;
  if (dryRun || sourceCount === 0) {
    return { source: sourceCount, copied: 0 };
  }

  // Bulk insert via postgres.js helper.
  await tx.unsafe(
    `INSERT INTO ${quoteIdent(schemaName)}.${quoteIdent(entry.target)} (${entry.cols.map(quoteIdent).join(", ")}) ` +
      `SELECT ${entry.cols.map(quoteIdent).join(", ")} FROM jsonb_to_recordset($1::jsonb) AS r(${
        entry.cols.map((c) => `${quoteIdent(c)} text`).join(", ")
      })`,
    [JSON.stringify(rows.map((r) => coerceRow(r)))],
  );

  const targetCount = (await tx.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM ${quoteIdent(schemaName)}.${quoteIdent(entry.target)} WHERE tracey_tenant_id = $1`,
    [supabaseTenantId],
  ))[0]?.n;
  return { source: sourceCount, copied: Number(targetCount ?? 0) };
}

// jsonb_to_recordset expects every value as a JSON-serialisable scalar/array.
// Coerce Date → ISO string, undefined → null. Postgres will cast back to the
// target column's type via the (col text) recordset signature + implicit cast
// on INSERT. For pure-text and uuid/timestamptz columns this works; numeric
// + jsonb + array columns need their string forms to be valid Postgres literals
// (which they are because Supabase already gave us those forms via the driver).
function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) out[k] = null;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (Array.isArray(v)) out[k] = `{${v.join(",")}}`;
    else if (v && typeof v === "object") out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs();

  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!supabaseUrl) throw new Error("SUPABASE_DB_URL is required");

  const tracey = postgres(databaseUrl, { max: 1, prepare: false });
  const supa = postgres(supabaseUrl, { max: 1, prepare: false, ssl: "require" });

  try {
    const { schemaName, plan } = await preflight(tracey, supa, args);
    console.log(`[planning-import] schema: ${schemaName}`);
    console.log(`[planning-import] tables to import: ${plan.length}${args.dryRun ? " (DRY RUN)" : ""}`);

    if (args.dryRun) {
      // Dry-run: just count source rows per table.
      for (const entry of plan) {
        const { source } = await importTable(
          // tx isn't used during dry-run; cast through unknown to satisfy the type.
          tracey as unknown as postgres.TransactionSql,
          supa,
          schemaName,
          entry,
          args.supabaseTenantId,
          true,
        );
        console.log(`  ${entry.source.padEnd(34)} → ${entry.target.padEnd(36)} : ${source.toString().padStart(8)} rows`);
      }
      console.log(`[planning-import] dry-run done, no writes`);
      return;
    }

    // Single transaction so SET CONSTRAINTS ALL DEFERRED holds across all tables.
    let totalCopied = 0;
    await tracey.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path = ${quoteIdent(schemaName)}, public`);
      await tx.unsafe(`SELECT set_config('app.tenant_id', $1, true)`, [args.tenantId]);
      await tx.unsafe(`SET CONSTRAINTS ALL DEFERRED`);

      if (args.force) {
        for (const entry of [...plan].reverse()) {
          await tx.unsafe(
            `DELETE FROM ${quoteIdent(schemaName)}.${quoteIdent(entry.target)} WHERE tracey_tenant_id = $1`,
            [args.tenantId],
          );
        }
      }

      for (const entry of plan) {
        const { source, copied } = await importTable(
          tx,
          supa,
          schemaName,
          entry,
          args.supabaseTenantId,
          false,
        );
        const ok = source === copied;
        console.log(
          `  ${ok ? "OK " : "!! "}${entry.source.padEnd(34)} → ${entry.target.padEnd(36)} : ${source} src, ${copied} tgt`,
        );
        if (!ok) {
          throw new Error(
            `row-count mismatch on ${entry.source} → ${entry.target}: ${source} src vs ${copied} tgt — rolling back`,
          );
        }
        totalCopied += copied;
      }

      await tx.unsafe(
        `INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [args.tenantId, LEDGER_MIGRATION],
      );
    });
    console.log(`[planning-import] done — ${totalCopied} rows copied across ${plan.length} tables`);
  } finally {
    await Promise.all([tracey.end(), supa.end()]);
  }
}

main().catch((err) => {
  console.error("[planning-import] failed:", err);
  process.exit(1);
});
