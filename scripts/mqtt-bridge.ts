/**
 * MQTT → platform bridge (document 2 ch. 6: gateways publish over the mobile network).
 * Subscribes to `bvu/<gateway>/up`, forwards each message (or batch) to the HTTPS ingestion
 * endpoint, and publishes the platform's verdict on `bvu/<gateway>/ack` — QoS 1 both ways. A
 * gateway deletes a message from its 30-day buffer only once its ack has arrived, so a dropped
 * link or a bridge restart loses nothing; a resend is recognised by the platform and not re-applied.
 *
 *   BVU_URL=https://… BVU_BRIDGE_KEY=bvu_… MQTT_URL=mqtts://broker:8883 npm run mqtt:bridge
 *
 * The key needs the telemetry:write scope and must NOT be bound to one gateway (it speaks for all).
 */
import mqtt from "mqtt";

export interface BridgeOptions {
  mqttUrl: string;
  platformUrl: string;
  key: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export function startBridge(opts: BridgeOptions) {
  const log = opts.log ?? ((line: string) => console.log(line));
  const doFetch = opts.fetchImpl ?? fetch;
  const client = mqtt.connect(opts.mqttUrl, { username: opts.username, password: opts.password, clean: false, clientId: "bvu-bridge", reconnectPeriod: 5000 });
  client.on("connect", () => {
    client.subscribe("bvu/+/up", { qos: 1 });
    log("Pont MQTT connecté, abonné à bvu/+/up");
  });
  client.on("message", async (topic, payload) => {
    const gateway = topic.split("/")[1];
    let body: unknown;
    try {
      body = JSON.parse(payload.toString("utf8"));
    } catch {
      client.publish(`bvu/${gateway}/ack`, JSON.stringify({ error: "JSON invalide" }), { qos: 1 });
      return;
    }
    try {
      const res = await doFetch(`${opts.platformUrl.replace(/\/+$/, "")}/api/v1/telemetry/gateway`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      // 5xx or network error: no ack, so the gateway keeps the message and resends it later.
      if (res.status >= 500) {
        log(`${gateway} : plateforme indisponible (HTTP ${res.status}), message laissé en tampon`);
        return;
      }
      client.publish(`bvu/${gateway}/ack`, JSON.stringify({ status: res.status, ...JSON.parse(text || "{}") }), { qos: 1 });
      log(`${gateway} : HTTP ${res.status}`);
    } catch (error) {
      log(`${gateway} : plateforme injoignable (${error instanceof Error ? error.message : error}), message laissé en tampon`);
    }
  });
  return client;
}

if (require.main === module) {
  const { MQTT_URL, BVU_URL, BVU_BRIDGE_KEY, MQTT_USERNAME, MQTT_PASSWORD } = process.env;
  if (!MQTT_URL || !BVU_URL || !BVU_BRIDGE_KEY) {
    console.error("MQTT_URL, BVU_URL et BVU_BRIDGE_KEY sont requis.");
    process.exit(1);
  }
  startBridge({ mqttUrl: MQTT_URL, platformUrl: BVU_URL, key: BVU_BRIDGE_KEY, username: MQTT_USERNAME, password: MQTT_PASSWORD });
}
