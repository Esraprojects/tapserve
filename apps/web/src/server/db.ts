import { createSql, type Sql } from "@tapserve/db";

const globalForDb = globalThis as unknown as { tapserveSql?: Sql };

/**
 * One shared pool, using the restricted tapserve_app role (subject to row-level security).
 * On Vercel each function instance keeps only a few connections. Supabase's transaction pooler
 * (port 6543) does not support prepared statements, so they are turned off there.
 */
export function db(): Sql {
  if (!globalForDb.tapserveSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    const pooled = new URL(url).port === "6543";
    globalForDb.tapserveSql = createSql(url, pooled ? { max: 3, prepare: false } : {});
  }
  return globalForDb.tapserveSql;
}
