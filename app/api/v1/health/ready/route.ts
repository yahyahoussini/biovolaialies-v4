import { dbClient } from "@/data/db/client";
import { API_VERSION, correlationIdOf } from "@/services/api/http";

/** API-09 — readiness without secrets or business data. Unauthenticated by design (monitoring). */
export async function GET(request: Request) {
  let database: "ok" | "down" = "ok";
  try {
    await dbClient.execute("SELECT 1");
  } catch {
    database = "down";
  }
  return Response.json(
    { status: database === "ok" ? "ready" : "degraded", version: API_VERSION, dependencies: { database } },
    { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlationIdOf(request) } }
  );
}
