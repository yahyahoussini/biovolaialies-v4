/**
 * A field gateway, simulated, talking to a running platform over HTTP exactly as real hardware
 * would: it reads its channel list from the platform, sends one message per 2-minute report
 * period, and during an outage keeps its messages in a buffer that it resends — same seq —
 * once the link is back. Every message is marked `simulated`, so the platform stores SIMULATION.
 *
 *   npm run gateway:simulate -- --url http://localhost:3000 --key bvu_… [--hours 6] [--outage 30] [--live]
 *
 * --hours N   back-fill the last N hours first (sent in batches of 250 messages)
 * --outage M  then hold the next M minutes in the buffer and resend them at once
 * --live      then keep sending every 2 minutes until stopped
 */
import { simulateGateway, type SimChannel, type SimDevice } from "../services/telemetry/simulator";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const key = arg("key") ?? process.env.BVU_GATEWAY_KEY;
const hours = Number(arg("hours") ?? 2);
const outage = Number(arg("outage") ?? 0);
const live = process.argv.includes("--live");
const MIN = 60_000;

async function call(method: "GET" | "POST", body?: unknown) {
  const res = await fetch(`${url}/api/v1/telemetry/gateway`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  if (!key) throw new Error("Clé API requise (--key ou BVU_GATEWAY_KEY), droit telemetry:write, liée à la passerelle.");
  const config = await call("GET");
  const channels: SimChannel[] = config.channels.map((c: { code: string; ref: string; type: SimChannel["type"]; position: string | null; zone: string | null }) => ({ code: c.code, ref: c.ref, type: c.type, position: c.position, zoneCode: c.zone }));
  const devices: SimDevice[] = config.devices.filter((d: { ref: string | null }) => d.ref).map((d: { code: string; ref: string }) => ({ code: d.code, ref: d.ref }));
  console.log(`Passerelle ${config.gateway} : ${channels.length} voies, ${devices.length} équipements.`);

  let seq = Math.floor(Date.now() / 120_000);
  const lotStartedAt = Date.now() - 50 * 24 * 60 * MIN;
  const make = (from: number, to: number) => {
    const out = simulateGateway({ gateway: config.gateway, channels, devices, from, to, lotStartedAt, population: 4000, scenarios: [], startSeq: seq });
    seq += out.length;
    return out;
  };
  const send = async (messages: ReturnType<typeof make>) => {
    for (let i = 0; i < messages.length; i += 250) {
      const part = messages.slice(i, i + 250).map((m) => ({ ...m, sentAt: new Date().toISOString() }));
      const { results } = await call("POST", { messages: part });
      const sum = (k: "accepted" | "duplicates" | "rejected") => results.reduce((n: number, r: { readings: Record<string, number> }) => n + r.readings[k], 0);
      console.log(`  ${part.length} message(s) : ${sum("accepted")} mesures acceptées, ${sum("duplicates")} doublons, ${sum("rejected")} rejetées`);
    }
  };

  const now = Date.now();
  if (hours > 0) {
    console.log(`Rattrapage des ${hours} dernières heures…`);
    await send(make(now - hours * 60 * MIN, now));
  }
  if (outage > 0) {
    console.log(`Coupure simulée : ${outage} min en tampon…`);
    await new Promise((r) => setTimeout(r, outage * MIN));
    await send(make(now, Date.now()));
    // A second resend of the same buffer is recognised and not re-applied.
  }
  if (live) {
    let last = Date.now();
    console.log("En direct, un message toutes les 2 minutes (Ctrl+C pour arrêter).");
    for (;;) {
      await new Promise((r) => setTimeout(r, 2 * MIN));
      const t = Date.now();
      await send(make(last, t));
      last = t;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
