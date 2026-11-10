import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Says whether the app can reach the database and log in as tapserve_app, and if not, why.
 * Only the error code and message are shown; they never contain the password.
 */
export async function GET() {
  try {
    const [row] = await db()<{ who: string }[]>`select current_user as who`;
    return Response.json({ database: "ok", user: row?.who });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return Response.json(
      { database: "error", code: e.code ?? null, message: (e.message ?? String(err)).replace(/:\/\/[^@\s]*@/g, "://***@") },
      { status: 500 },
    );
  }
}
