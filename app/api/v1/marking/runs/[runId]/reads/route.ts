import { readBatchSchema } from "@/domain/marking/marking";
import { apiRoute, json, readBody } from "@/services/api/http";
import { recordReadBatch } from "@/services/marking/marking";

/**
 * What the camera read back: a range of printed serials and those it could not read. The answer
 * carries the run's status; `stopped: true` means the guard has stopped the line — stop printing.
 */
export const POST = apiRoute<{ runId: string }>("marking:write", async ({ request, session, principal, correlationId }, { runId }) => {
  const body = await readBody(request, readBatchSchema);
  return json(await recordReadBatch(runId, body, session, { kind: "API", clientId: principal.clientId, name: principal.name }), 200, correlationId);
});
