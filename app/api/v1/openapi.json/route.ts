import { env } from "@/lib/env";
import { buildOpenApiDocument } from "@/services/api/openapi";

/** Public contract document — describes the API, exposes no data. */
export function GET() {
  return Response.json(buildOpenApiDocument(env.APP_URL), { headers: { "Cache-Control": "public, max-age=300" } });
}
