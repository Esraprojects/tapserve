/**
 * Demo data for local testing: one owner with a demo café and a demo hotel.
 * Run after migrations: pnpm db:seed (uses DATABASE_URL, the RLS-restricted app role).
 */
import { completeOnboarding, createSql, onboardBusiness, signUpWithEmail, loginWithEmail, AuthError } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (see .env.example)");
  process.exit(1);
}

const DEMO_EMAIL = "demo@tapserve.et";
const DEMO_PASSWORD = "demo-pass-123";

const sql = createSql(url, { max: 2 });
try {
  let user;
  try {
    user = await signUpWithEmail(sql, { email: DEMO_EMAIL, password: DEMO_PASSWORD, fullName: "Demo Owner", locale: "am" });
  } catch (err) {
    if (!(err instanceof AuthError && err.code === "email_taken")) throw err;
    console.log("Demo data already exists.");
    user = await loginWithEmail(sql, DEMO_EMAIL, DEMO_PASSWORD);
    process.exit(0);
  }
  const base = { city: "Addis Ababa", locale: "am" as const };
  const cafe = await onboardBusiness(sql, user.id, { ...base, name: "Buna House Café", businessType: "cafe", subCity: "Bole", branchName: "Bole" });
  const hotel = await onboardBusiness(sql, user.id, { ...base, name: "Entoto View Hotel", businessType: "hotel_restaurant", subCity: "Gullele", branchName: "Main" });
  for (const tenantId of [cafe, hotel]) await completeOnboarding(sql, { tenantId, userId: user.id });
  console.log(`Seeded. Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
} finally {
  await sql.end();
}
