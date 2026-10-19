import { createServer, type AddressInfo, type Server } from "node:net";
import { Aedes } from "aedes";
import mqtt from "mqtt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBridge } from "./mqtt-bridge";

let broker: Aedes;
let server: Server;
let url = "";

beforeAll(async () => {
  broker = await Aedes.createBroker();
  server = createServer(broker.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => broker.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function waitFor<T>(fn: () => T | undefined, ms = 4000): Promise<T> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const v = fn();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > ms) return reject(new Error("timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("MQTT bridge", () => {
  it("forwards a gateway message and acknowledges only what the platform accepted", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    let status = 200;
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ results: [{ status: "accepted" }] }), { status });
    }) as typeof fetch;
    const bridge = startBridge({ mqttUrl: url, platformUrl: "https://bvu.example", key: "bvu_bridge", fetchImpl: fakeFetch, log: () => {} });
    await waitFor(() => (bridge.connected ? true : undefined));

    const gateway = mqtt.connect(url, { clientId: "gw-test" });
    const acks: unknown[] = [];
    await new Promise<void>((resolve) => gateway.on("connect", () => resolve()));
    await gateway.subscribeAsync("bvu/GW-BEL01/ack", { qos: 1 });
    gateway.on("message", (_t, p) => acks.push(JSON.parse(p.toString())));
    await new Promise((r) => setTimeout(r, 100));

    const message = { gateway: "GW-BEL01", seq: 7, sentAt: new Date().toISOString(), readings: [] };
    await gateway.publishAsync("bvu/GW-BEL01/up", JSON.stringify(message), { qos: 1 });
    await waitFor(() => (acks.length === 1 ? true : undefined));
    expect(calls[0].url).toBe("https://bvu.example/api/v1/telemetry/gateway");
    expect(calls[0].auth).toBe("Bearer bvu_bridge");
    expect(calls[0].body).toEqual(message);
    expect(acks[0]).toMatchObject({ status: 200 });

    // Platform down: no ack, so the gateway keeps the message in its buffer.
    status = 503;
    await gateway.publishAsync("bvu/GW-BEL01/up", JSON.stringify({ ...message, seq: 8 }), { qos: 1 });
    await waitFor(() => (calls.length === 2 ? true : undefined));
    await new Promise((r) => setTimeout(r, 200));
    expect(acks).toHaveLength(1);

    await gateway.endAsync();
    await bridge.endAsync();
  });
});
