import { apiRoute, json } from "@/services/api/http";
import { getLineForController } from "@/services/marking/marking";

/** The line controller at start-up: its line's settings and the run it should print for, if one is open. */
export const GET = apiRoute<{ code: string }>("marking:write", async ({ session, correlationId }, { code }) => {
  return json(await getLineForController(decodeURIComponent(code), session), 200, correlationId);
});
