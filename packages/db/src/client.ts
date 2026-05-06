import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForPostgres = globalThis as unknown as {
  __traceyPostgres?: postgres.Sql;
};

const sql =
  globalForPostgres.__traceyPostgres ??
  postgres(databaseUrl, {
    max: 10,
    prepare: false,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.__traceyPostgres = sql;
}

export const db = drizzle(sql, { schema, logger: process.env.NODE_ENV === "development" });
export { sql as pg };
export * from "./schema.js";
