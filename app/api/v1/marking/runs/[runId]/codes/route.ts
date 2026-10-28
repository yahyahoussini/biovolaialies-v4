import { allocateSchema } from "@/domain/marking/marking";
import { apiRoute, json, readBody } from "@/services/api/http";
import { allocateCodes } from "@/services/marking/marking";

/**
 * The next block of codes to print. `requestRef` makes a retry harmless: the same reference returns
 * the same block. 409 READ_STOP, SOURCE_BLOCKED or RUN_CLOSED: stop printing.
 */
export const POST = apiRoute<{ runId: string }>("marking:write", async ({ request, session, principal, correlationId }, { runId }) => {
  const body = await readBody(request, allocateSchema);
  const block = await allocateCodes(runId, body, session, { kind: "API", clientId: principal.clientId, name: principal.name });
  return json(block, block.replayed ? 200 : 201, correlationId);
});
