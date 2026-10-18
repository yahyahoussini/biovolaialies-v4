import { apiRoute, json, readBody } from "@/services/api/http";
import { apiOpenHold, holdBodySchema } from "@/services/api/operations";

/** API-05 — place an object (and by default its descendants) on quality hold. */
export const POST = apiRoute("quality:hold", async ({ request, session, principal, correlationId }) => {
  const body = await readBody(request, holdBodySchema);
  return json(await apiOpenHold(body, session, principal), 201, correlationId);
});
