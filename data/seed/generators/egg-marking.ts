import { shellCode } from "../../../domain/marking/marking";
import type { Session } from "../../../services/auth/session";
import { closeMarkingRun, createMarkingLine, liftReadStop, packTray, recordCandlingRejects, simulateMarking, startMarkingRun } from "../../../services/marking/marking";
import { repositories } from "../../repositories";

/**
 * The egg-marking line (document 3, lot 15), through the real services:
 *  - route B at Ferme Fassi (white eggs) and Ferme El Amrani ("Pistache"): the graded collections of
 *    the last days marked, read back by the camera and packed in 30-egg trays;
 *  - one Fassi run where the head clogs: the guard stops the line within two hundred eggs of the
 *    clog, the farmer cleans the head, says so, and the line restarts;
 *  - the "Pistache" collections laid during the treatment's egg withdrawal are never marked;
 *  - the last Fassi run left stopped by the guard, for the presenter to restart;
 *  - route A at the breeder egg store: the hatching eggs of OAC-2026-0920 marked at collection, and
 *    at candling of INC-2026-38 the clears named by their code.
 * Every record is SIMULATION data, like the collections it marks.
 */

async function sessionFor(email: string): Promise<Session> {
  const user = await repositories.users.findByEmail(email);
  if (!user) throw new Error(`Utilisateur de démonstration absent : ${email}`);
  return { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: user.scopeId, isDemoSwitch: false };
}

async function buildingOf(farmName: string, code: string): Promise<string> {
  const farm = (await repositories.farms.list()).find((f) => f.name === farmName);
  const building = farm ? (await repositories.buildings.listByFarm(farm.id)).find((b) => b.code === code) : undefined;
  if (!building) throw new Error(`Bâtiment de démonstration absent : ${farmName} ${code}`);
  return building.id;
}

const later = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000);

/** Packs the last, partial tray of a run: the eggs read back after the last full tray. */
async function packLeftover(runId: string, session: Session, at: Date): Promise<void> {
  const run = (await repositories.marking.findRun(runId))!;
  const [lastTray] = await repositories.marking.listTrays(run.id, 1);
  const first = lastTray ? lastTray.lastSerial + 1 : run.firstSerial!;
  if (run.lastSerial === null || first > run.lastSerial) return;
  const rejected = await repositories.marking.listExceptionsInRange(run.id, { firstSerial: first, lastSerial: run.lastSerial }, "ILLISIBLE");
  if (run.lastSerial - first + 1 - rejected.length > 0) await packTray(run.id, { firstSerial: first, lastSerial: run.lastSerial, packedAt: at.toISOString() }, session, undefined, at);
}

export async function seedEggMarking(input: { adminSession: Session }): Promise<void> {
  const admin = input.adminSession;
  const rachid = await sessionFor("partenaire.fassi@biovolailles.demo");
  const nadia = await sessionFor("partenaire.elamrani@biovolailles.demo");

  const fassiLine = await createMarkingLine(
    { code: "LM-FAS-01", name: "Marqueuse jet d'encre et caméra — salle d'œufs", buildingId: await buildingOf("Ferme Fassi", "BAT-01"), routes: ["B_CONSOMMATION"], shellPrefix: "FA", readThreshold: 0.98, readWindow: 500, trayCapacity: 30, protocol: "Liaison série — jeu de commandes à obtenir du fournisseur" },
    admin
  );
  const elAmraniLine = await createMarkingLine(
    { code: "LM-ELA-01", name: "Marqueuse jet d'encre et caméra — salle d'œufs", buildingId: await buildingOf("Ferme El Amrani", "BAT-01"), routes: ["B_CONSOMMATION"], shellPrefix: "EA", readThreshold: 0.98, readWindow: 500, trayCapacity: 30, protocol: "Liaison série — jeu de commandes à obtenir du fournisseur" },
    admin
  );
  const breederLine = await createMarkingLine(
    { code: "LM-REP-01", name: "Marquage au ramassage — œufs à couver", buildingId: await buildingOf("Couvoir Al Baraka", "REPRO-01"), routes: ["A_COUVER"], shellPrefix: "RP", readThreshold: 0.98, readWindow: 500, trayCapacity: 30, protocol: "Liaison Ethernet — jeu de commandes à obtenir du fournisseur" },
    admin
  );

  // --- Route B: a week of white eggs at Fassi, three days of "Pistache" before the treatment -------
  const plan: { line: typeof fassiLine; session: Session; code: string; clog?: number; leaveStopped?: boolean }[] = [
    ...["20261012", "20261013", "20261014", "20261015", "20261016", "20261017"].map((d) => ({ line: fassiLine, session: rachid, code: `OEB-${d}`, clog: d === "20261016" ? 1200 : undefined })),
    { line: fassiLine, session: rachid, code: "OEB-20261018", clog: 700, leaveStopped: true },
    ...["20261011", "20261012", "20261013"].map((d) => ({ line: elAmraniLine, session: nadia, code: `OEP-${d}` })),
  ];
  for (const step of plan) {
    const eggs = await repositories.tableEggLots.findByCode(step.code);
    if (!eggs) throw new Error(`Collecte de démonstration absente : ${step.code}`);
    const start = later(eggs.collectedOn, 45);
    const run = await startMarkingRun({ lineId: step.line.id, route: "B_CONSOMMATION", sourceId: eggs.id }, step.session, start);
    const total = step.leaveStopped ? 900 : eggs.saleable;
    const first = await simulateMarking(run.id, { eggs: total, failRate: 0.003, clogAfter: step.clog ?? null, clogRate: 0.1, startAt: later(eggs.collectedOn, 46).toISOString(), eggsPerHour: 3000 }, step.session);
    if (step.leaveStopped) continue;
    let end = later(eggs.collectedOn, 46 + (first.printed / 3000) * 60);
    if (first.status === "ARRET_LECTURE") {
      const lift = later(end.toISOString(), 18);
      await liftReadStop({ runId: run.id, note: "Tête d'impression nettoyée, buse 2 débouchée ; essai sur 20 œufs, tous relus" }, step.session, lift);
      const rest = total - first.printed;
      await simulateMarking(run.id, { eggs: rest, failRate: 0.003, startAt: later(lift.toISOString(), 2).toISOString(), eggsPerHour: 3000 }, step.session);
      end = later(lift.toISOString(), 2 + (rest / 3000) * 60);
    }
    await packLeftover(run.id, step.session, later(end.toISOString(), 1));
    await closeMarkingRun({ runId: run.id }, step.session, later(end.toISOString(), 5));
  }

  // --- Route A: hatching eggs marked at collection, clears named at candling --------------------
  const eggLot = await repositories.eggLots.findByCode("OAC-2026-0920");
  const cycle = await repositories.hatchCycles.findByCode("INC-2026-38");
  if (!eggLot || !cycle) throw new Error("Lot d'œufs à couver OAC-2026-0920 ou cycle INC-2026-38 absent.");
  const collected = eggLot.collectedAt;
  const hatchingRun = await startMarkingRun({ lineId: breederLine.id, route: "A_COUVER", sourceId: eggLot.id, notes: "Marquage au ramassage, avant la salle d'œufs" }, admin, new Date(collected));
  await simulateMarking(hatchingRun.id, { eggs: eggLot.quantity, failRate: 0.004, startAt: later(collected, 1).toISOString(), eggsPerHour: 2000, batchSize: 250 }, admin);
  await closeMarkingRun({ runId: hatchingRun.id }, admin, later(collected, 1 + (eggLot.quantity / 2000) * 60 + 5));

  // 510 clears removed at candling: 497 named by their code, 13 whose code no longer reads.
  const run = (await repositories.marking.findRun(hatchingRun.id))!;
  const unreadable = new Set((await repositories.marking.listExceptions(run.id, "ILLISIBLE", 10_000)).map((e) => e.serial));
  const clears: string[] = [];
  for (let s = run.firstSerial! + 5; clears.length < 497 && s <= run.lastSerial!; s += 13) if (!unreadable.has(s)) clears.push(shellCode(breederLine.shellPrefix, s));
  await recordCandlingRejects({ cycleId: cycle.id, codes: clears.join("\n") }, admin, new Date(cycle.candledAt ?? "2026-10-02T08:00:00.000Z"));
}
