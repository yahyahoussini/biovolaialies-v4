import { traySchema } from "@/domain/marking/marking";
import { apiRoute, json, readBody } from "@/services/api/http";
import { packTray } from "@/services/marking/marking";

/** A tray packed at the end of the line (route B): its identifier, and the URL its QR label must carry. */
export const POST = apiRoute<{ runId: string }>("marking:write", async ({ request, session, principal, correlationId }, { runId }) => {
  const body = await readBody(request, traySchema);
  const { tray, bvuId, url, replayed } = await packTray(runId, body, session, { kind: "API", clientId: principal.clientId, name: principal.name });
  return json({ trayId: tray.id, bvuId, url, eggCount: tray.eggCount, firstSerial: tray.firstSerial, lastSerial: tray.lastSerial, replayed }, replayed ? 200 : 201, correlationId);
});
