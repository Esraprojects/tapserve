import { createSql, migrate, type Sql } from "@tapserve/db";

export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/tapserve_test";
const APP_PASSWORD = "tapserve_app_test";

/** Rebuild the test database from scratch and return an admin and an app (RLS-restricted) connection. */
export async function freshDatabase(): Promise<{ admin: Sql; app: Sql }> {
  const admin = createSql(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop schema public cascade; create schema public; grant all on schema public to public;");
  await migrate(admin, { appPassword: APP_PASSWORD });
  const url = new URL(ADMIN_URL);
  url.username = "tapserve_app";
  url.password = APP_PASSWORD;
  const app = createSql(url.toString(), { max: 4, onnotice: () => {} });
  return { admin, app };
}
