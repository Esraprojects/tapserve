import { createSql, type Sql } from "@tapserve/db";

const globalForDb = globalThis as unknown as { tapserveSql?: Sql };

/** One shared pool, using the restricted tapserve_app role (subject to row-level security). */
export function db(): Sql {
  if (!globalForDb.tapserveSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    globalForDb.tapserveSql = createSql(url);
  }
  return globalForDb.tapserveSql;
}
