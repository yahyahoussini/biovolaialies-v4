import { apiRoute, json, readBody } from "@/services/api/http";
import { idempotencyKeyOf } from "@/services/api/idempotency";
import { apiAppendEvent, eventBodySchema } from "@/services/api/operations";

/**
 * API-03 — append-only traceability event. Offline terminals replay safely: the same
 * Idempotency-Key (header or body) on the same event returns the original (200), on a
 * different event a 409.
 */
export const POST = apiRoute("events:write", async ({ request, principal, correlationId }) => {
  const headerKey = idempotencyKeyOf(request, false);
  const body = await readBody(request, eventBodySchema);
  const result = await apiAppendEvent({ ...body, idempotencyKey: headerKey ?? body.idempotencyKey }, principal);
  return json({ ...result, accepted: true }, result.duplicate ? 200 : 201, correlationId);
});
