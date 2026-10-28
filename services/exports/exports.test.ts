import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { createTestSession } from "../production/test-support";
import { datasetsFor, produceExport, sha256, verifyExport } from "./exports";

async function farmOf(coopId: string, suffix: string) {
  const producer = await repositories.producers.create({ cooperativeId: coopId, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `EXP-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await repositories.lots.create({ buildingId: building.id, code: `EXP-LOT-${suffix}`, species: "Poulet", breed: "Beldi", status: "ACTIF", initialPopulation: 900, currentPopulation: 880, plannedStartAt: null, startedAt: "2026-09-01T00:00:00Z", endedAt: null, dataStatus: "REEL", productionLine: null, purpose: "CHAIR", hatchedAt: "2026-08-20T00:00:00Z" });
  return { producer, lot, farmer: await createTestSession("PRODUCER", "PRODUCER", producer.id, `exp-${suffix}`) };
}

describe("exports", () => {
  it("exports what the reader may see, registered with the fingerprint of the exact file served", async () => {
    const org = await repositories.organizations.create({ name: "Exports", type: "INTERNAL" });
    const coop = await repositories.cooperatives.create({ organizationId: org.id, name: "Coop exports", region: "Fès-Meknès" });
    const mine = await farmOf(coop.id, "a");
    const theirs = await farmOf(coop.id, "b");

    const { record, body } = await produceExport("lots", mine.farmer, new Date("2026-10-29T10:00:00.000Z"));
    const text = new TextDecoder().decode(body);
    expect(text).toContain(mine.lot.code);
    expect(text).not.toContain(theirs.lot.code);
    expect(text.split("\r\n")[0]).toContain("Identifiant BIOVOLAILLES");
    expect(record).toMatchObject({ dataset: "lots", sha256: sha256(body), bytes: body.byteLength, createdBy: mine.farmer.userId });
    expect(record.filename).toMatch(/^biovolailles-lots-202610291000-[0-9a-f]{8}\.csv$/);
    const ledger = await repositories.ledger.listAll();
    expect(ledger.some((e) => e.eventType === "EXPORT" && e.objectId === record.id)).toBe(true);

    // The file as served is recognised; the same file with one character changed is not.
    expect(await verifyExport(record.sha256.toUpperCase())).toMatchObject({ status: "IDENTIQUE", record: { id: record.id, rows: record.rows } });
    const tampered = new TextEncoder().encode(text.replace("880", "980"));
    expect(await verifyExport(sha256(tampered))).toEqual({ status: "INCONNU" });
    await expect(verifyExport("pas une empreinte")).rejects.toThrow(/64 caractères/);
  });

  it("opens the audit trail to audit only, and refuses an unknown dataset", async () => {
    const farmer = await createTestSession("PRODUCER", "PRODUCER", null, "exp-rights-farmer");
    const auditor = await createTestSession("AUDITOR", "GLOBAL", null, "exp-rights-auditor");
    expect(datasetsFor(farmer)).not.toContain("audit");
    expect(datasetsFor(auditor)).toContain("audit");
    await expect(produceExport("audit", farmer)).rejects.toThrow(/droits/);
    await expect(produceExport("tout", auditor)).rejects.toThrow(/introuvable/);
    const { body } = await produceExport("audit", auditor);
    expect(new TextDecoder().decode(body).split("\r\n")[0]).toContain("Avant");
  });
});
