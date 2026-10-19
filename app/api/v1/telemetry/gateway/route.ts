import { z } from "@/lib/zod";
import { apiRoute, json, readBody } from "@/services/api/http";
import { gatewayConfiguration, ingestGatewayBatch } from "@/services/telemetry/ingest";

/** Up to 250 buffered messages per request: a 30-day backlog goes up in a few hundred requests. */
const bodySchema = z.union([
  z.object({ messages: z.array(z.unknown()).min(1).max(250) }),
  z.object({ gateway: z.string() }).passthrough(),
]);

/**
 * Field gateway uplink (document 3, ingestion layer). One message, or a batch of buffered ones
 * after an outage. `sentAt` is the transmission time (used to measure the gateway clock);
 * each reading keeps its own capture time. Replays are recognised and not re-applied.
 */
export const POST = apiRoute("telemetry:write", async ({ request, principal, correlationId }) => {
  const body = await readBody(request, bodySchema);
  const messages: unknown[] = "messages" in body && Array.isArray(body.messages) ? body.messages : [body];
  const results = await ingestGatewayBatch(messages, principal);
  const rejected = results.filter((r) => r.status === "rejected").length;
  const status = rejected === 0 ? 200 : rejected === results.length ? 422 : 207;
  return json({ results }, status, correlationId);
});

/**
 * The gateway's own configuration: the channel codes it must send, with the acquisition
 * interval of each (document 2). A key bound to a gateway gets its gateway; an unbound
 * integration key names it with ?gateway=CODE.
 */
export const GET = apiRoute("telemetry:write", async ({ request, principal, correlationId }) => {
  const code = new URL(request.url).searchParams.get("gateway");
  return json(await gatewayConfiguration(principal, code), 200, correlationId);
});
