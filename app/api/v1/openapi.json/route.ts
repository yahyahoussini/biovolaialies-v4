import { env } from "@/lib/env";
import { correlationIdOf } from "@/services/api/http";
import { buildOpenApiDocument } from "@/services/api/openapi";

/** Public contract document — describes the API, exposes no data. */
export function GET(request: Request) {
  return Response.json(buildOpenApiDocument(env.APP_URL), {
    headers: { "Cache-Control": "public, max-age=300", "X-Correlation-ID": correlationIdOf(request) },
  });
}
