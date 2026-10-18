import { apiRoute, json, readBody } from "@/services/api/http";
import { apiRecordMeasurement, measurementBodySchema } from "@/services/api/operations";

/** API-07 — a sensor reading with provenance; goes through the same data-quality checks as manual input. */
export const POST = apiRoute("measurements:write", async ({ request, session, correlationId }) => {
  const body = await readBody(request, measurementBodySchema);
  return json(await apiRecordMeasurement(body, session), 201, correlationId);
});
