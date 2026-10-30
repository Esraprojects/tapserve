import { createSql } from "./client";
import { migrate } from "./migrate";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Set DATABASE_ADMIN_URL (see .env.example)");
  process.exit(1);
}
const sql = createSql(url, { max: 1, onnotice: () => {} });
try {
  const applied = await migrate(sql, { appPassword: process.env.APP_DB_PASSWORD });
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
} finally {
  await sql.end();
}
