import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { AppError } from "../../domain/shared/errors";
import type { Session } from "../auth/session";
import { getRoleFocus } from "../dashboard/role-focus";
import { getFieldActivity } from "../field/activity";
import { buildFieldSnapshot } from "../field/snapshot";
import { syncFieldOps } from "../field/sync";
import { createSample, getLabSample, listLabSamples } from "../lab/lab";
import { allocateCodes, createMarkingLine, getMarkingOverview, getMarkingRun, startMarkingRun } from "../marking/marking";
import { createTestSession } from "../production/test-support";
import { listTableEggLots } from "../production/table-eggs";
import { getLotHealth } from "../sanitary/health";
import { assignBvuId } from "./bvu-ids";
import { resolveIdentifierInScope } from "./resolve-scoped";

/**
 * Document 3, ch. 07: "Un éleveur coopérateur ne peut pas voir les lots d'un autre, même en
 * modifiant l'adresse dans son navigateur." Two farmers of the same cooperative; each read service
 * is asked, with one farmer's session, for the other's objects by id and by code — the answer must
 * be a refusal or nothing, never the object.
 */

async function farmOf(coopId: string, suffix: string) {
  const producer = await repositories.producers.create({ cooperativeId: coopId, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `ISO-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await repositories.lots.create({ buildingId: building.id, code: `ISO-LOT-${suffix}`, species: "Poule", breed: "Beldi", status: "ACTIF", initialPopulation: 1000 + suffix.length, currentPopulation: 1000 + suffix.length, plannedStartAt: null, startedAt: "2026-05-01T00:00:00Z", endedAt: null, dataStatus: "REEL", productionLine: null, purpose: "PONTE", hatchedAt: "2026-01-01T00:00:00Z" });
  const farmer = await createTestSession("PRODUCER", "PRODUCER", producer.id, `iso-${suffix}`);
  const eggs = await repositories.tableEggLots.create({ code: `ISO-OE-${suffix}`, lotId: lot.id, collectedOn: "2026-10-27T17:00:00.000Z", eggType: "BLANC", quantity: 900, saleable: 860, cracked: 10, dirty: 20, small: 10, status: "EN_STOCK", sourceType: "MANUEL", sourceId: null, actorId: farmer.userId, dataStatus: "REEL", measurementMethod: null, deviceId: null, documentId: null, validationStatus: null });
  return { producer, farm, building, lot, farmer, eggs, bvu: await assignBvuId("LOT", lot.id) };
}

async function refused(task: Promise<unknown>): Promise<boolean> {
  try {
    await task;
    return false;
  } catch (error) {
    return error instanceof AppError && (error.kind === "AUTHORIZATION" || error.kind === "NOT_FOUND");
  }
}

describe("isolation between farms", () => {
  it("never hands one farmer another farmer's objects, by id or by code", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "iso-admin");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "iso-quality");
    const vet = await createTestSession("VETERINARIAN", "GLOBAL", null, "iso-vet");
    const org = await repositories.organizations.create({ name: "Isolation", type: "INTERNAL" });
    const coop = await repositories.cooperatives.create({ organizationId: org.id, name: "Coop isolation", region: "Fès-Meknès" });
    const a = await farmOf(coop.id, "a");
    const b = await farmOf(coop.id, "bb");

    // The neighbour's farm carries a marking line, a run, a lab sample and field entries.
    const line = await createMarkingLine({ code: "LM-ISO-B", name: "Ligne B", buildingId: b.building.id, routes: ["B_CONSOMMATION"], shellPrefix: "QB", readThreshold: 0.98, readWindow: 200, trayCapacity: 30 }, quality);
    const run = await startMarkingRun({ lineId: line.id, route: "B_CONSOMMATION", sourceId: b.eggs.id }, b.farmer);
    const block = await allocateCodes(run.id, { count: 10, requestRef: "iso-block-1" }, b.farmer);
    const sample = await createSample({ objectType: "LOT", objectId: b.lot.id, matrix: "FIENTES", reason: "SURVEILLANCE", sampledAt: "2026-10-20T08:00:00.000Z", laboratory: "Laboratoire (test)" }, vet);
    const op = { opId: randomUUID(), deviceId: "iso-phone-b", seq: 1, authorId: b.farmer.userId, kind: "PESEE" as const, lotId: b.lot.id, transferId: null, capturedAt: new Date().toISOString(), payload: { averageWeightKg: 1.6, sampleCount: 20 } };
    await syncFieldOps({ ops: [op] }, b.farmer);

    const reader: Session = a.farmer;
    // Codes typed in the identifiers search: the neighbour's lot code, its identifier, a shell code.
    expect(await resolveIdentifierInScope(b.lot.code, reader)).toEqual([]);
    expect(await resolveIdentifierInScope(b.bvu, reader)).toEqual([]);
    expect(await resolveIdentifierInScope(block.codes[0], reader)).toEqual([]);
    expect((await resolveIdentifierInScope(a.lot.code, reader)).map((r) => r.objectId)).toEqual([a.lot.id]);
    expect((await resolveIdentifierInScope(b.lot.code, admin)).map((r) => r.objectId)).toEqual([b.lot.id]);

    // Objects asked for by their id: refused.
    expect(await refused(getLotHealth(b.lot.id, reader))).toBe(true);
    expect(await refused(getMarkingRun(run.id, reader))).toBe(true);
    expect(await refused(getLabSample(sample.id, reader))).toBe(true);

    // Lists: the neighbour's rows are not in them.
    expect((await listTableEggLots(reader)).map((e) => e.id)).not.toContain(b.eggs.id);
    expect((await getMarkingOverview(reader)).lines.map((l) => l.id)).not.toContain(line.id);
    expect((await listLabSamples(reader)).map((s) => s.id)).not.toContain(sample.id);
    expect((await getFieldActivity(reader)).entries.map((e) => e.opId)).not.toContain(op.opId);
    expect((await buildFieldSnapshot(reader)).lots.map((l) => l.id)).toEqual([a.lot.id]);

    // The farmer's first screen counts his own birds only.
    const focus = await getRoleFocus(reader);
    expect(focus.view).toBe("ELEVEUR");
    expect(focus.tiles.find((t) => t.label === "Mes sujets")?.value).toBe((1001).toLocaleString("fr-FR"));
  });
});
