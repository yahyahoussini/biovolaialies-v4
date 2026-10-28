/**
 * An egg-marking line controller, simulated, talking to a running platform over HTTP exactly as
 * the real one will (document 3, lot 15): it finds the run open on its line, draws blocks of codes,
 * "prints" them, reports what the camera read back, and declares the full trays. When the guard
 * stops the line it stops printing and waits for a person to restart it in the application.
 *
 *   npm run marking:simulate -- --url http://localhost:3000 --key bvu_… --line LM-FAS-01 [--eggs 600] [--fail 0.004] [--clog-after 300]
 *
 * --eggs N        eggs to pass under the head (default 600)
 * --fail R        share of eggs the camera cannot read (default 0.004)
 * --clog-after N  the head clogs after N eggs: from then on 1 egg in 8 is unreadable
 * --batch N       eggs per block of codes and per camera report (default 100)
 */
import { randomUUID } from "node:crypto";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const key = arg("key") ?? process.env.BVU_MARKING_KEY;
const lineCode = arg("line") ?? "LM-FAS-01";
const eggs = Number(arg("eggs") ?? 600);
const failRate = Number(arg("fail") ?? 0.004);
const clogAfter = arg("clog-after") === undefined ? null : Number(arg("clog-after"));
const batchSize = Number(arg("batch") ?? 100);

class Refused extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const res = await fetch(`${url}/api/v1/marking${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (res.status === 409) throw new Refused(data.error?.code ?? "CONFLICT", data.error?.message ?? "Refus");
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stopped by the guard: print nothing until a person restarts the line in the application. */
async function waitForRestart(runId: string): Promise<boolean> {
  console.log("  ⏸  Ligne arrêtée par le contrôle de lecture : nettoyez la tête, puis levez l'arrêt dans l'application (Marquage des œufs).");
  for (;;) {
    await sleep(5000);
    const run = await call("GET", `/runs/${runId}`);
    if (run.status === "EN_COURS") {
      console.log("  ▶  Arrêt levé : reprise de l'impression.");
      return true;
    }
    if (run.status === "CLOS") return false;
  }
}

async function main() {
  if (!key) throw new Error("Clé API requise (--key ou BVU_MARKING_KEY), droit marking:write.");
  const { line, openRun } = await call("GET", `/lines/${encodeURIComponent(lineCode)}`);
  if (!openRun) throw new Error(`Aucune campagne ouverte sur ${line.code} : démarrez-en une dans l'application.`);
  console.log(`Ligne ${line.code} (préfixe ${line.prefix}), campagne ${openRun.code} — seuil ${line.readThreshold * 100} % sur ${line.readWindow} œufs.`);

  let done = 0;
  let trayStart: number | null = null;
  let filled = 0;
  let pending: { firstSerial: number; lastSerial: number; codes: string[] } | null = null;
  while (done < eggs) {
    if (!pending) {
      try {
        pending = await call("POST", `/runs/${openRun.id}/codes`, { count: Math.min(batchSize, eggs - done), requestRef: `codes-${randomUUID()}` });
      } catch (error) {
        if (error instanceof Refused && error.code === "READ_STOP" && (await waitForRestart(openRun.id))) continue;
        throw error;
      }
    }
    const block = pending!;
    const failed: number[] = [];
    for (let s = block.firstSerial; s <= block.lastSerial; s++) {
      const rate = clogAfter !== null && done + (s - block.firstSerial) >= clogAfter ? 0.125 : failRate;
      if (Math.random() < rate) failed.push(s);
    }
    const read = await call("POST", `/runs/${openRun.id}/reads`, { batchRef: `reads-${randomUUID()}`, firstSerial: block.firstSerial, lastSerial: block.lastSerial, readAt: new Date().toISOString(), failed });
    console.log(`  ${block.codes[0]} → ${block.codes[block.codes.length - 1]} : ${read.ok} relus, ${read.ko} rejetés — relecture ${read.rate === null ? "—" : `${(read.rate * 100).toFixed(1)} %`} sur ${read.considered} œufs`);
    done += block.lastSerial - block.firstSerial + 1;
    pending = null;

    const rejected = new Set(failed);
    for (let s = block.firstSerial; s <= block.lastSerial; s++) {
      trayStart ??= s;
      if (!rejected.has(s)) filled++;
      if (filled === line.trayCapacity) {
        const tray = await call("POST", `/runs/${openRun.id}/trays`, { trayRef: `tray-${randomUUID()}`, firstSerial: trayStart, lastSerial: s });
        console.log(`    plateau ${tray.bvuId} (${tray.eggCount} œufs) — QR : ${tray.url}`);
        trayStart = null;
        filled = 0;
      }
    }
    if (read.stopped && !(await waitForRestart(openRun.id))) break;
  }
  if (trayStart !== null && filled > 0) {
    const run = await call("GET", `/runs/${openRun.id}`);
    console.log(`Reste ${filled} œuf(s) hors plateau complet. Campagne : ${run.printed} imprimés, ${run.readOk} relus, ${run.readKo} rejetés.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Refused ? `Refus ${error.code} : ${error.message}` : error);
  process.exit(1);
});
