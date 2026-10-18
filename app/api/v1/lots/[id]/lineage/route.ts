import { ApiError, apiRoute, json } from "@/services/api/http";
import { apiGetLineage } from "@/services/api/operations";

/** API-04 — ancestors and/or descendants, with explicit truncation. */
export const GET = apiRoute<{ id: string }>("lineage:read", async ({ request, correlationId }, { id }) => {
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction") ?? "both";
  if (direction !== "up" && direction !== "down" && direction !== "both") throw new ApiError(400, "INVALID_DIRECTION", "direction = up | down | both.");
  return json(await apiGetLineage(id, url.searchParams.get("type"), direction), 200, correlationId);
});
