import { apiRoute, json, readBody } from "@/services/api/http";
import { idempotencyKeyOf, withIdempotency } from "@/services/api/idempotency";
import { apiOpenHold, holdBodySchema } from "@/services/api/operations";

/** API-05 — place an object (and by default its descendants) on quality hold. Idempotency-Key required. */
export const POST = apiRoute("quality:hold", async ({ request, session, principal, correlationId }) => {
  const key = idempotencyKeyOf(request, true)!;
  const body = await readBody(request, holdBodySchema);
  const { result, replayed } = await withIdempotency(principal, "POST /quality/holds", key, body, () => apiOpenHold(body, session, principal));
  return json({ ...result, replayed }, replayed ? 200 : 201, correlationId);
});
