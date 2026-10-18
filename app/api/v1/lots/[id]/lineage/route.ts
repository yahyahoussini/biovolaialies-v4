import { ApiError, apiRoute, json } from "@/services/api/http";
import { apiGetLineage } from "@/services/api/operations";

/** API-04 — ancestors and/or descendants (optionally limited to ?depth=N), with explicit truncation. */
export const GET = apiRoute<{ id: string }>("lineage:read", async ({ request, correlationId }, { id }) => {
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction") ?? "both";
  if (direction !== "up" && direction !== "down" && direction !== "both") throw new ApiError(400, "INVALID_DIRECTION", "direction = up | down | both.");
  const depthParam = url.searchParams.get("depth");
  const depth = depthParam === null ? null : Number(depthParam);
  if (depth !== null && (!Number.isInteger(depth) || depth < 1 || depth > 50)) throw new ApiError(400, "INVALID_DEPTH", "depth = entier de 1 à 50.");
  return json(await apiGetLineage(id, url.searchParams.get("type"), direction, depth), 200, correlationId);
});
