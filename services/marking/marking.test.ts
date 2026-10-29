import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { SHELL_ALPHABET, shellCode } from "../../domain/marking/marking";
import { createTestSession } from "../production/test-support";
import { resolvePublicEgg } from "../public/egg";
import { openHold } from "../quality/holds";
import { createRelation } from "../traceability/relations";
import {
  allocateCodes,
  closeMarkingRun,
  createMarkingLine,
  getCycleMarking,
  liftReadStop,
  MarkingRefusal,
  packTray,
  recordCandlingRejects,
  recordReadBatch,
  simulateMarking,
  startMarkingRun,
  unreadable,
} from "./marking";

let lines = 0;
const nextPrefix = () => {
  lines++;
  return `${SHELL_ALPHABET[10 + Math.floor(lines / 32)]}${SHELL_ALPHABET[lines % 32]}`;
};

async function world(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `mk-admin-${suffix}`);
  const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, `mk-q-${suffix}`);
  const org = await repositories.organizations.create({ name: `Marquage ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const otherProducer = await repositories.producers.create({ cooperativeId: coop.id, name: `Autre ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `MQ-${suffix}`, name: "Salle d'œufs", capacity: 5000, zoneType: "ELEVAGE" });
  const farmer = await createTestSession("PRODUCER", "PRODUCER", producer.id, `mk-farmer-${suffix}`);
  const outsider = await createTestSession("PRODUCER", "PRODUCER", otherProducer.id, `mk-out-${suffix}`);
  const lot = await repositories.lots.create({ buildingId: building.id, code: `PON-${suffix}`, species: "Poule", breed: "Beldi", status: "ACTIF", initialPopulation: 1200, currentPopulation: 1200, plannedStartAt: null, startedAt: "2026-03-01T00:00:00Z", endedAt: null, dataStatus: "REEL", productionLine: null, purpose: "PONTE", hatchedAt: "2025-10-01T00:00:00Z" });
  const eggs = await repositories.tableEggLots.create({ code: `OE-${suffix}`, lotId: lot.id, collectedOn: "2026-10-27T17:00:00.000Z", eggType: "BLANC", quantity: 1000, saleable: 950, cracked: 20, dirty: 20, small: 10, status: "EN_STOCK", sourceType: "MANUEL", sourceId: null, actorId: admin.userId, dataStatus: "REEL", measurementMethod: null, deviceId: null, documentId: null, validationStatus: null });
  const line = await createMarkingLine({ code: `LM-${suffix}`, name: "Ligne de test", buildingId: building.id, routes: ["B_CONSOMMATION", "A_COUVER"], shellPrefix: nextPrefix(), readThreshold: 0.98, readWindow: 200, trayCapacity: 30 }, quality);
  return { admin, quality, farmer, outsider, building, lot, eggs, line };
}

const at = (minutes: number) => new Date(Date.parse("2026-10-28T08:00:00.000Z") + minutes * 60_000);

describe("egg marking", () => {
  it("hands out codes that never repeat, and the same block again when the controller retries", async () => {
    const w = await world("codes");
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(0));
    const first = await allocateCodes(run.id, { count: 100, requestRef: "block-0001" }, w.farmer, undefined, at(1));
    const retry = await allocateCodes(run.id, { count: 100, requestRef: "block-0001" }, w.farmer, undefined, at(1));
    const second = await allocateCodes(run.id, { count: 50, requestRef: "block-0002" }, w.farmer, undefined, at(2));
    expect(retry).toMatchObject({ firstSerial: first.firstSerial, lastSerial: first.lastSerial, replayed: true });
    expect(second.firstSerial).toBe(first.lastSerial + 1);
    expect(first.codes[0]).toBe(shellCode(w.line.shellPrefix, first.firstSerial));
    expect(new Set([...first.codes, ...second.codes]).size).toBe(150);
    expect((await repositories.marking.findRun(run.id))?.allocated).toBe(150);
    // One open run per line; another farm's producer cannot drive this line.
    await expect(startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(3))).rejects.toThrow(/encore ouverte/);
    await expect(allocateCodes(run.id, { count: 10, requestRef: "block-0003" }, w.outsider)).rejects.toThrow(/périmètre/);
  });

  it("stops the line when the camera stops reading, and restarts it only when a person says what was done", async () => {
    const w = await world("guard");
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(0));
    const block = await allocateCodes(run.id, { count: 400, requestRef: "block-guard" }, w.farmer, undefined, at(1));
    const clean = await recordReadBatch(run.id, { batchRef: "reads-0001", firstSerial: block.firstSerial, lastSerial: block.firstSerial + 199, readAt: at(5).toISOString(), failed: [block.firstSerial + 7] }, w.farmer, undefined, at(5));
    expect(clean).toMatchObject({ status: "EN_COURS", stopped: false, ok: 199, ko: 1 });
    // The head clogs: 12 of the next 100 eggs unreadable.
    const failed = Array.from({ length: 12 }, (_, i) => block.firstSerial + 200 + i * 8);
    const clogged = await recordReadBatch(run.id, { batchRef: "reads-0002", firstSerial: block.firstSerial + 200, lastSerial: block.firstSerial + 299, readAt: at(8).toISOString(), failed }, w.farmer, undefined, at(8));
    expect(clogged).toMatchObject({ status: "ARRET_LECTURE", stopped: true });
    await expect(allocateCodes(run.id, { count: 10, requestRef: "block-after" }, w.farmer, undefined, at(9))).rejects.toMatchObject({ code: "READ_STOP" });
    // Eggs already printed are still read and accounted for while the line is stopped.
    await expect(recordReadBatch(run.id, { batchRef: "reads-0003", firstSerial: block.firstSerial + 300, lastSerial: block.firstSerial + 349, readAt: at(9).toISOString(), failed: [] }, w.farmer, undefined, at(9))).resolves.toMatchObject({ status: "ARRET_LECTURE" });
    await expect(liftReadStop({ runId: run.id, note: "ok" }, w.farmer, at(20))).rejects.toThrow(/10 caractères/);
    await liftReadStop({ runId: run.id, note: "Tête nettoyée, buse 2 débouchée, essai sur 20 œufs relus" }, w.farmer, at(20));
    // A fresh window: the bad eggs before the cleaning no longer count against the line.
    const after = await recordReadBatch(run.id, { batchRef: "reads-0004", firstSerial: block.firstSerial + 350, lastSerial: block.lastSerial, readAt: at(22).toISOString(), failed: [] }, w.farmer, undefined, at(22));
    expect(after).toMatchObject({ status: "EN_COURS", rate: 1 });
    const [stop] = await repositories.marking.listStops(run.id);
    expect(stop).toMatchObject({ liftedBy: w.farmer.userId, liftNote: expect.stringContaining("buse 2") });
    expect((await repositories.marking.findRun(run.id))).toMatchObject({ printed: 400, readOk: 387, readKo: 13 });
  });

  it("plays the line just now without stamping a read in the future, even right after a restart", async () => {
    const w = await world("demo");
    const now = new Date();
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, new Date(now.getTime() - 60_000));
    // A head that stops printing altogether after 120 eggs: the guard must stop the line, every time.
    const clogged = await simulateMarking(run.id, { eggs: 400, failRate: 0, clogAfter: 120, clogRate: 1 }, w.farmer, now);
    expect(clogged.status).toBe("ARRET_LECTURE");
    await liftReadStop({ runId: run.id, note: "Tête nettoyée, essai sur 20 œufs relus" }, w.farmer, now);
    const clean = await simulateMarking(run.id, { eggs: 600, failRate: 0 }, w.farmer, now);
    expect(clean).toMatchObject({ printed: 600, status: "EN_COURS" });
    const reads = await repositories.marking.listRecentBatches(run.id, "", 100);
    expect(reads.every((b) => Date.parse(b.readAt) <= now.getTime())).toBe(true);
  });

  it("spreads the simulated unreadable eggs evenly instead of in bursts", () => {
    // 20 000 consecutive eggs at 0.4 %: about 80 unreadable, and never 5 in one window of 100.
    // Without the finaliser, the three demonstration lines below get 5 to 7 in one window.
    for (const lineCode of ["LM-FAS-01", "LM-ELA-01", "LM-REP-01"]) {
      const failures = Array.from({ length: 20_000 }, (_, s) => unreadable(lineCode, s, 0.004));
      const total = failures.filter(Boolean).length;
      expect(total).toBeGreaterThan(50);
      expect(total).toBeLessThan(115);
      for (let i = 0; i < failures.length; i += 100) expect(failures.slice(i, i + 100).filter(Boolean).length).toBeLessThan(5);
    }
  });

  it("refuses reads of codes never handed out, reported twice, or stamped in the future", async () => {
    const w = await world("reads");
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(0));
    const block = await allocateCodes(run.id, { count: 100, requestRef: "block-reads" }, w.farmer, undefined, at(1));
    await expect(recordReadBatch(run.id, { batchRef: "reads-out", firstSerial: block.firstSerial, lastSerial: block.lastSerial + 1, readAt: at(2).toISOString() }, w.farmer, undefined, at(2))).rejects.toThrow(/pas été attribués/);
    const ok = { batchRef: "reads-ok-1", firstSerial: block.firstSerial, lastSerial: block.firstSerial + 49, readAt: at(2).toISOString(), failed: [] };
    await recordReadBatch(run.id, ok, w.farmer, undefined, at(2));
    await expect(recordReadBatch(run.id, ok, w.farmer, undefined, at(3))).resolves.toMatchObject({ replayed: true });
    await expect(recordReadBatch(run.id, { ...ok, batchRef: "reads-ok-2" }, w.farmer, undefined, at(3))).rejects.toThrow(/déjà été déclarée/);
    await expect(recordReadBatch(run.id, { batchRef: "reads-late", firstSerial: block.firstSerial + 50, lastSerial: block.lastSerial, readAt: at(120).toISOString() }, w.farmer, undefined, at(3))).rejects.toThrow(/futur/);
  });

  it("packs trays of codes read back, minus the rejected eggs, each with its identifier and public page", async () => {
    const w = await world("trays");
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(0));
    const block = await allocateCodes(run.id, { count: 100, requestRef: "block-trays" }, w.farmer, undefined, at(1));
    const rejected = block.firstSerial + 3;
    await recordReadBatch(run.id, { batchRef: "reads-trays", firstSerial: block.firstSerial, lastSerial: block.firstSerial + 59, readAt: at(2).toISOString(), failed: [rejected] }, w.farmer, undefined, at(2));
    const packed = await packTray(run.id, { firstSerial: block.firstSerial, lastSerial: block.firstSerial + 30, trayRef: "tray-00001" }, w.farmer, undefined, at(3));
    expect(packed.tray).toMatchObject({ eggCount: 30, packedBy: `user:${w.farmer.userId}` });
    expect(packed.bvuId).toMatch(/^BVU-PKG-/);
    expect(packed.url).toContain(`/tracabilite/oeuf/${packed.bvuId}`);
    await expect(packTray(run.id, { firstSerial: block.firstSerial + 30, lastSerial: block.firstSerial + 59 }, w.farmer, undefined, at(3))).rejects.toThrow(/autre plateau/);
    await expect(packTray(run.id, { firstSerial: block.firstSerial + 40, lastSerial: block.firstSerial + 69 }, w.farmer, undefined, at(3))).rejects.toThrow(/pas été imprimés/);

    const page = await resolvePublicEgg(packed.bvuId);
    expect(page).toMatchObject({ status: "FOUND", egg: { kind: "PLATEAU", tone: "ok", title: "Origine vérifiée" } });
    const egg = await resolvePublicEgg(shellCode(w.line.shellPrefix, block.firstSerial + 10).toLowerCase());
    expect(egg).toMatchObject({ status: "FOUND", egg: { kind: "OEUF", tone: "ok" } });
    if (egg.status === "FOUND") expect(egg.egg.facts).toContainEqual({ label: "Ferme d'origine", value: "Ferme trays" });
    expect(await resolvePublicEgg(shellCode(w.line.shellPrefix, rejected))).toMatchObject({ egg: { tone: "critical", title: expect.stringMatching(/rejeté/) } });
    expect(await resolvePublicEgg(shellCode(w.line.shellPrefix, block.firstSerial + 80))).toMatchObject({ egg: { tone: "warning", title: "Marquage non vérifié" } });
    const typo = [...shellCode(w.line.shellPrefix, block.firstSerial + 10)];
    typo[5] = typo[5] === "7" ? "8" : "7";
    expect(await resolvePublicEgg(typo.join(""))).toEqual({ status: "MISREAD" });
  });

  it("prints nothing on eggs withdrawn from sale or under a quality hold, even in the middle of a run", async () => {
    const w = await world("blocked");
    const retired = await repositories.tableEggLots.create({ ...w.eggs, id: undefined, code: "OE-blocked-retire", status: "RETIRE" } as never);
    await expect(startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: retired.id }, w.farmer, at(0))).rejects.toThrow(/retirés de la vente/);
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: w.eggs.id }, w.farmer, at(0));
    await allocateCodes(run.id, { count: 30, requestRef: "block-before" }, w.farmer, undefined, at(1));
    await openHold({ rootType: "LOT", rootId: w.lot.id, reason: "SUSPICION_SANITAIRE", description: "Suspicion de salmonelle sur prélèvement de fientes", scope: "OBJET_SEUL" }, w.admin);
    await expect(allocateCodes(run.id, { count: 30, requestRef: "block-during" }, w.farmer, undefined, at(2))).rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
    await expect(allocateCodes(run.id, { count: 30, requestRef: "block-during" }, w.farmer, undefined, at(2))).rejects.toBeInstanceOf(MarkingRefusal);
  });

  it("closes a run with more eggs read than declared only with an explanation", async () => {
    const w = await world("close");
    const small = await repositories.tableEggLots.create({ ...w.eggs, id: undefined, code: "OE-close-small", quantity: 60, saleable: 40, cracked: 10, dirty: 5, small: 5 } as never);
    const run = await startMarkingRun({ lineId: w.line.id, route: "B_CONSOMMATION", sourceId: small.id }, w.farmer, at(0));
    await simulateMarking(run.id, { eggs: 60, failRate: 0, startAt: at(1).toISOString(), eggsPerHour: 3600, batchSize: 30 }, w.farmer);
    await expect(closeMarkingRun({ runId: run.id }, w.farmer, at(10))).rejects.toThrow(/60 œufs relus pour 40/);
    const closed = await closeMarkingRun({ runId: run.id, note: "Vingt œufs de la veille repassés sur la ligne par erreur" }, w.farmer, at(10));
    expect(closed).toMatchObject({ status: "CLOS", readOk: 60 });
    await expect(allocateCodes(run.id, { count: 10, requestRef: "block-closed" }, w.farmer)).rejects.toMatchObject({ code: "RUN_CLOSED" });
  });

  it("names each egg removed at candling by its code, and traces it to its parent flock", async () => {
    const w = await world("hatch");
    const flock = await repositories.parentFlocks.create({ code: "GEN-hatch", buildingId: w.building.id, strain: "Fermier", geneticSupplier: "Sasso", originCountry: "France", importReference: null, placedAt: "2026-01-10T00:00:00Z", femaleCount: 3000, maleCount: 300, sourceType: "MANUEL", sourceId: null, actorId: w.admin.userId, dataStatus: "REEL", measurementMethod: null, deviceId: null, documentId: null, validationStatus: null });
    const eggLot = await repositories.eggLots.create({ code: "OAC-hatch", parentFlockId: flock.id, collectedAt: "2026-10-20T07:00:00Z", quantity: 300, storageBuildingId: w.building.id, sourceType: "MANUEL", sourceId: null, actorId: w.admin.userId, dataStatus: "REEL", measurementMethod: null, deviceId: null, documentId: null, validationStatus: null });
    const run = await startMarkingRun({ lineId: w.line.id, route: "A_COUVER", sourceId: eggLot.id }, w.admin, new Date("2026-10-20T07:00:00Z"));
    await simulateMarking(run.id, { eggs: 300, failRate: 0, startAt: "2026-10-20T07:00:00.000Z", eggsPerHour: 600, batchSize: 100 }, w.admin);
    const cycle = await repositories.hatchCycles.create({ code: "INC-hatch", buildingId: w.building.id, incubatorRef: "Incubateur 1", setAt: "2026-10-23T08:00:00.000Z", eggsSet: 300, status: "EN_INCUBATION", candledAt: null, clearsRemoved: null, hatchedAt: null, chicksHatched: null, unhatched: null, culls: null, sourceType: "MANUEL", sourceId: null, actorId: w.admin.userId, dataStatus: "REEL", measurementMethod: null, deviceId: null, documentId: null, validationStatus: null });
    await createRelation({ fromType: "HATCH_CYCLE", fromId: cycle.id, relationType: "PROVIENT_DE", toType: "EGG_LOT", toId: eggLot.id, metadata: { quantity: 300 }, actorId: w.admin.userId });
    const first = (await repositories.marking.findRun(run.id))!.firstSerial!;
    const codes = [first + 4, first + 90, first + 211].map((s) => shellCode(w.line.shellPrefix, s));

    await expect(recordCandlingRejects({ cycleId: cycle.id, codes: `${codes.join("\n")}\n${shellCode(w.line.shellPrefix, first + 999)}` }, w.admin)).rejects.toThrow(/jamais attribué/);
    expect(await recordCandlingRejects({ cycleId: cycle.id, codes: codes.join("\n") }, w.admin)).toEqual({ recorded: 3, alreadyKnown: 0 });
    expect(await recordCandlingRejects({ cycleId: cycle.id, codes: codes[0] }, w.admin)).toEqual({ recorded: 0, alreadyKnown: 1 });
    const marking = await getCycleMarking(cycle.id, w.admin);
    expect(marking?.rejectsByFlock).toEqual([{ flockCode: "GEN-hatch", eggLotCode: "OAC-hatch", identified: 3, loaded: 300 }]);
    // Marked between 7:00 and 7:30 on the 20th, set on the 23rd at 8:00: three days in the egg room, every one of them.
    expect(marking?.storage).toEqual([{ days: 3, eggs: 300 }]);
    expect(await resolvePublicEgg(codes[1])).toMatchObject({ egg: { title: "Œuf à couver", tone: "neutral" } });
  });
});
