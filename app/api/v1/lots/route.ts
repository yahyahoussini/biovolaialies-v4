import { apiRoute, json, readBody } from "@/services/api/http";
import { apiCreateLot, createLotBodySchema } from "@/services/api/operations";

/** API-01 — create an egg lot, chick lot or farm lot. */
export const POST = apiRoute("lots:write", async ({ request, session, correlationId }) => {
  const body = await readBody(request, createLotBodySchema);
  return json(await apiCreateLot(body, session), 201, correlationId);
});
