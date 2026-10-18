import { apiRoute, json, readBody } from "@/services/api/http";
import { apiIngest, ingestBodySchema } from "@/services/api/operations";

/** API-08 — normalised batch from an ERP/MES/WMS/edge gateway, with per-record results. */
export const POST = apiRoute("ingest:write", async ({ request, principal, correlationId }) => {
  const body = await readBody(request, ingestBodySchema);
  const result = await apiIngest(body, principal);
  return json(result, result.rejected > 0 && result.accepted + result.duplicates === 0 ? 422 : 207, correlationId);
});
