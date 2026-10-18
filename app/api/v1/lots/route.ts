import { apiRoute, json, readBody } from "@/services/api/http";
import { idempotencyKeyOf, withIdempotency } from "@/services/api/idempotency";
import { apiCreateLot, createLotBodySchema } from "@/services/api/operations";

/** API-01 — create an egg lot, chick lot or farm lot. Idempotency-Key required; a replay returns the first result. */
export const POST = apiRoute("lots:write", async ({ request, session, principal, correlationId }) => {
  const key = idempotencyKeyOf(request, true)!;
  const body = await readBody(request, createLotBodySchema);
  const { result, replayed } = await withIdempotency(principal, "POST /lots", key, body, () => apiCreateLot(body, session));
  return json({ ...result, replayed }, replayed ? 200 : 201, correlationId);
});
