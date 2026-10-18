import { apiRoute, json, readBody } from "@/services/api/http";
import { apiAppendEvent, eventBodySchema } from "@/services/api/operations";

/**
 * API-03 — append-only traceability event. Offline terminals replay safely: the same
 * Idempotency-Key (header or body) with the same payload returns the original event (200),
 * with a different payload a 409.
 */
export const POST = apiRoute("events:write", async ({ request, principal, correlationId }) => {
  const body = await readBody(request, eventBodySchema);
  const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
  const result = await apiAppendEvent({ ...body, idempotencyKey: idempotencyKey ?? undefined }, principal);
  return json({ ...result, accepted: true }, result.duplicate ? 200 : 201, correlationId);
});
