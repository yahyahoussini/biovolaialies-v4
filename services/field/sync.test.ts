import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import type { FieldKind } from "../../domain/field/field";
import { ensureDefaultLines } from "../production/lines";
import { createTestSession } from "../production/test-support";
import { registerSubjects } from "../production/subjects";
import { dispatchTransfer } from "../production/transfers";
import type { Session } from "../auth/session";
import { buildFieldSnapshot } from "./snapshot";
import { resolveMortalityDiscrepancy, syncFieldOps } from "./sync";

async function world(suffix: string) {
  await ensureDefaultLines();
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `field-admin-${suffix}`);
  const org = await repositories.organizations.create({ name: `Terrain ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `TER-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const otherProducer = await repositories.producers.create({ cooperativeId: coop.id, name: `Autre ${suffix}`, contactPhone: null, contactEmail: null });
  const workerA = await createTestSession("PRODUCER", "PRODUCER", producer.id, `field-a-${suffix}`);
  const workerB = await createTestSession("PRODUCER", "PRODUCER", producer.id, `field-b-${suffix}`);
  const manager = await createTestSession("FARM_MANAGER", "FARM", farm.id, `field-mgr-${suffix}`);
  const outsider = await createTestSession("PRODUCER", "PRODUCER", otherProducer.id, `field-out-${suffix}`);
  const lot = await repositories.lots.create({ buildingId: building.id, code: `TER-LOT-${suffix}`, species: "Poulet", breed: "Beldi", status: "ACTIF", initialPopulation: 1000, currentPopulation: 1000, plannedStartAt: null, startedAt: "2026-06-01T00:00:00Z", endedAt: null, dataStatus: "SIMULATION", productionLine: null, purpose: "CHAIR", hatchedAt: "2026-06-01T00:00:00Z" });
  return { admin, workerA, workerB, manager, outsider, building, lot };
}

/** A phone: its own id, and a counter that never goes back. */
function phone(session: Session) {
  const deviceId = `phone-${randomUUID().slice(0, 8)}`;
  let seq = 0;
  return (kind: FieldKind, payload: Record<string, unknown>, extra: { lotId?: string; transferId?: string; capturedAt?: string } = {}) => ({
    opId: randomUUID(),
    deviceId,
    seq: ++seq,
    authorId: session.userId,
    kind,
    lotId: extra.lotId ?? null,
    transferId: extra.transferId ?? null,
    capturedAt: extra.capturedAt ?? new Date().toISOString(),
    payload,
  });
}

describe("field sync", () => {
  it("applies entries once: the same entry sent again changes nothing", async () => {
    const w = await world("once");
    const op = phone(w.workerA);
    const ops = [op("PESEE", { averageWeightKg: 1.42, sampleCount: 30 }, { lotId: w.lot.id }), op("ALIMENT", { quantityKg: 180, feedType: "Croissance" }, { lotId: w.lot.id }), op("EAU", { quantityL: 640 }, { lotId: w.lot.id })];
    const first = await syncFieldOps({ ops }, w.workerA);
    expect(first.results.map((r) => r.status)).toEqual(["APPLIQUEE", "APPLIQUEE", "APPLIQUEE"]);
    const again = await syncFieldOps({ ops }, w.workerA);
    expect(again.results.every((r) => r.replayed && r.status === "APPLIQUEE")).toBe(true);
    expect(await repositories.weightMeasurements.listByLot(w.lot.id)).toHaveLength(1);
    expect(await repositories.feedUsage.listByLot(w.lot.id)).toHaveLength(1);
    const [water] = await repositories.waterUsage.listByLot(w.lot.id);
    expect(water).toMatchObject({ quantity: 640, unit: "L", deviceId: ops[2].deviceId, measurementMethod: expect.stringContaining("Saisie terrain") });
  });

  it("keeps the phone's order even when the entries arrive shuffled, and keeps a refused one with its reason", async () => {
    const w = await world("order");
    const op = phone(w.workerA);
    const day = "2026-10-20";
    const a = op("MORTALITE", { count: 4 }, { lotId: w.lot.id, capturedAt: `${day}T07:00:00.000Z` });
    const bad = op("PESEE", { averageWeightKg: 40 }, { lotId: w.lot.id, capturedAt: `${day}T08:00:00.000Z` });
    const b = op("MORTALITE", { count: 6 }, { lotId: w.lot.id, capturedAt: `${day}T17:00:00.000Z` });
    const { results } = await syncFieldOps({ ops: [b, bad, a] }, w.workerA);
    expect(results.map((r) => [r.opId, r.status])).toEqual([
      [a.opId, "APPLIQUEE"],
      [bad.opId, "REFUSEE"],
      [b.opId, "APPLIQUEE"],
    ]);
    expect(results[1].message).toMatch(/15 kg/);
    // 4 in the morning, the day's total raised to 6 by the same person: 6 dead in all, not 10.
    expect((await repositories.lots.findById(w.lot.id))!.currentPopulation).toBe(994);
    const refused = await repositories.fieldEntries.findByOpId(bad.opId);
    expect(refused).toMatchObject({ status: "REFUSEE", authorId: w.workerA.userId });
  });

  it("never sends one person's entries under another's account, and refuses a phone clock in the future", async () => {
    const w = await world("who");
    const opA = phone(w.workerA);
    const fromA = opA("PESEE", { averageWeightKg: 1.2 }, { lotId: w.lot.id });
    const ahead = phone(w.workerB)("PESEE", { averageWeightKg: 1.2 }, { lotId: w.lot.id, capturedAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
    const { results } = await syncFieldOps({ ops: [fromA, ahead] }, w.workerB);
    expect(results.find((r) => r.opId === fromA.opId)?.status).toBe("AUTRE_COMPTE");
    expect(await repositories.fieldEntries.findByOpId(fromA.opId)).toBeNull();
    expect(results.find((r) => r.opId === ahead.opId)).toMatchObject({ status: "REFUSEE", message: expect.stringMatching(/horloge/) });
  });

  it("applies the same scope as the office: a lot outside it is refused", async () => {
    const w = await world("scope");
    const { results } = await syncFieldOps({ ops: [phone(w.outsider)("EAU", { quantityL: 100 }, { lotId: w.lot.id })] }, w.outsider);
    expect(results[0]).toMatchObject({ status: "REFUSEE", message: expect.stringMatching(/périmètre/) });
  });

  it("keeps two people's different counts, shows the latest, and waits for a manager", async () => {
    const w = await world("conflict");
    const day = "2026-10-21";
    await syncFieldOps({ ops: [phone(w.workerA)("MORTALITE", { count: 5 }, { lotId: w.lot.id, capturedAt: `${day}T07:00:00.000Z` })] }, w.workerA);
    const fromB = phone(w.workerB)("MORTALITE", { count: 8, cause: "Coup de chaleur" }, { lotId: w.lot.id, capturedAt: `${day}T09:00:00.000Z` });
    const { results } = await syncFieldOps({ ops: [fromB] }, w.workerB);
    expect(results[0]).toMatchObject({ status: "EN_ECART", message: expect.stringMatching(/Deux personnes/) });
    expect((await repositories.lots.findById(w.lot.id))!.currentPopulation).toBe(995);

    const [discrepancy] = (await repositories.fieldDiscrepancies.list()).filter((d) => d.lotId === w.lot.id);
    expect(discrepancy).toMatchObject({ status: "OUVERT", day });
    await expect(resolveMortalityDiscrepancy({ discrepancyId: discrepancy.id, count: 7, note: "Recompté avec les deux éleveurs" }, w.workerA)).rejects.toThrow(/responsable/);

    // The manager settles on 7: two more deaths recorded, dated on the disputed day.
    await resolveMortalityDiscrepancy({ discrepancyId: discrepancy.id, count: 7, note: "Recompté avec les deux éleveurs" }, w.manager);
    expect((await repositories.lots.findById(w.lot.id))!.currentPopulation).toBe(993);
    await expect(resolveMortalityDiscrepancy({ discrepancyId: discrepancy.id, count: 7, note: "Deuxième arbitrage" }, w.manager)).rejects.toThrow(/déjà été arbitré/);

    // Later, someone counts 7 again: it confirms the settled figure.
    const confirm = await syncFieldOps({ ops: [phone(w.workerB)("MORTALITE", { count: 7 }, { lotId: w.lot.id, capturedAt: `${day}T18:00:00.000Z` })] }, w.workerB);
    expect(confirm.results[0].status).toBe("CONFIRMEE");
  });

  it("gives birds back only through a manager's counter-entry", async () => {
    const w = await world("lower");
    const day = "2026-10-22";
    const op = phone(w.workerA);
    await syncFieldOps({ ops: [op("MORTALITE", { count: 9 }, { lotId: w.lot.id, capturedAt: `${day}T07:00:00.000Z` })] }, w.workerA);
    const { results } = await syncFieldOps({ ops: [op("MORTALITE", { count: 6 }, { lotId: w.lot.id, capturedAt: `${day}T16:00:00.000Z` })] }, w.workerA);
    expect(results[0]).toMatchObject({ status: "EN_ECART", message: expect.stringMatching(/inférieure/) });
    expect((await repositories.lots.findById(w.lot.id))!.currentPopulation).toBe(991);

    const [discrepancy] = (await repositories.fieldDiscrepancies.list()).filter((d) => d.lotId === w.lot.id);
    await resolveMortalityDiscrepancy({ discrepancyId: discrepancy.id, count: 6, note: "Trois sujets comptés deux fois au premier passage" }, w.manager);
    expect((await repositories.lots.findById(w.lot.id))!.currentPopulation).toBe(994);
    const records = await repositories.mortalityRecords.listByLot(w.lot.id);
    expect(records.map((r) => r.count).sort((a, b) => a - b)).toEqual([-3, 9]);
    expect(records.reduce((s, r) => s + r.count, 0)).toBe(6);
  });

  it("receives a transfer counted and signed on the phone", async () => {
    const w = await world("rcv");
    const growing = await repositories.buildings.create({ farmId: (await repositories.buildings.findById(w.building.id))!.farmId, code: "TER-CRO-rcv", name: "Croissance", capacity: 5000, zoneType: "ELEVAGE" });
    const source = await repositories.lots.create({ buildingId: growing.id, code: "TER-SRC-rcv", species: "Poulet", breed: "Beldi", status: "ACTIF", initialPopulation: 600, currentPopulation: 600, plannedStartAt: null, startedAt: "2026-07-01T00:00:00Z", endedAt: null, dataStatus: "SIMULATION", productionLine: null, purpose: "CHAIR", hatchedAt: "2026-07-01T00:00:00Z" });
    const adminName = (await repositories.users.findById(w.admin.userId))!.fullName;
    const transfer = await dispatchTransfer({ objectType: "LOT", objectId: source.id, destinationBuildingId: w.building.id, destinationLotCode: "TER-DST-rcv", quantity: 300, sentAt: new Date(Date.now() - 3600_000).toISOString(), signerName: adminName }, w.admin);

    const snapshot = await buildFieldSnapshot(w.workerA);
    expect(snapshot.receptions.map((r) => r.id)).toContain(transfer.id);
    expect(snapshot.codes.some((c) => c.kind === "TRANSFER" && c.id === transfer.id)).toBe(true);

    const nameA = (await repositories.users.findById(w.workerA.userId))!.fullName;
    const { results } = await syncFieldOps({ ops: [phone(w.workerA)("RECEPTION", { quantityReceived: 297, deadOnArrival: 3, signerName: nameA }, { transferId: transfer.id })] }, w.workerA);
    expect(results[0].status).toBe("APPLIQUEE");
    expect((await repositories.transfers.findById(transfer.id))?.status).not.toBe("EN_TRANSIT");
  });

  it("gives the phone its lots, the last values with their time, and the codes it can read", async () => {
    const w = await world("snap");
    await registerSubjects({ lotId: w.lot.id, taggedAt: "2026-06-02", dataStatus: "SIMULATION", subjects: [{ visualId: "R-77", rfidUid: "E2 80 11 AA", sex: "FEMELLE" }] }, w.admin);
    await syncFieldOps({ ops: [phone(w.workerA)("PESEE", { averageWeightKg: 1.9 }, { lotId: w.lot.id, capturedAt: "2026-10-25T06:30:00.000Z" })] }, w.workerA);
    const snapshot = await buildFieldSnapshot(w.workerA);
    const lot = snapshot.lots.find((l) => l.id === w.lot.id)!;
    expect(lot.latest.weightKg).toEqual({ at: "2026-10-25T06:30:00.000Z", value: 1.9 });
    expect(snapshot.codes.some((c) => c.kind === "LOT" && c.code === w.lot.code.toUpperCase())).toBe(true);
    expect(snapshot.codes.filter((c) => c.kind === "SUBJECT").map((c) => c.code)).toEqual(expect.arrayContaining(["R-77", "E28011AA"]));
    expect(snapshot.can).toEqual({ enter: true, care: true, receive: true });
    expect((await buildFieldSnapshot(w.outsider)).lots.some((l) => l.id === w.lot.id)).toBe(false);
  });
});
