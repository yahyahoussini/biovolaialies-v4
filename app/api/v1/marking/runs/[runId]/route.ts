import { apiRoute, json } from "@/services/api/http";
import { getRunForController } from "@/services/marking/marking";

/** A run's state, polled by the controller while the line is stopped: printing resumes when it reads EN_COURS again. */
export const GET = apiRoute<{ runId: string }>("marking:write", async ({ session, correlationId }, { runId }) => {
  return json(await getRunForController(runId, session), 200, correlationId);
});
