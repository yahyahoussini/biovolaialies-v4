import { apiRoute, json } from "@/services/api/http";
import { apiGetObject } from "@/services/api/operations";

/** API-02 — identity, quality status and lineage summary of any traceable object (by id, or by code with ?type=). */
export const GET = apiRoute<{ id: string }>("lots:read", async ({ request, correlationId }, { id }) => {
  const type = new URL(request.url).searchParams.get("type");
  return json(await apiGetObject(id, type), 200, correlationId);
});
