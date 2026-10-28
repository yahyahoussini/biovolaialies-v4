import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { createSample, recordResults, reviewResult } from "../lab/lab";
import { createTestSession } from "../production/test-support";
import { recordObservation } from "../sanitary/health";
import { getRoleFocus } from "./role-focus";

describe("role views", () => {
  it("puts in front of the veterinarian what waits for him, and takes it away once done", async () => {
    const vet = await createTestSession("VETERINARIAN", "GLOBAL", null, "focus-vet");
    const org = await repositories.organizations.create({ name: "Vues", type: "INTERNAL" });
    const coop = await repositories.cooperatives.create({ organizationId: org.id, name: "Coop vues", region: "Fès-Meknès" });
    const producer = await repositories.producers.create({ cooperativeId: coop.id, name: "Éleveur vues", contactPhone: null, contactEmail: null });
    const farm = await repositories.farms.create({ producerId: producer.id, name: "Ferme vues", city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
    const building = await repositories.buildings.create({ farmId: farm.id, code: "VUE-01", name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
    const lot = await repositories.lots.create({ buildingId: building.id, code: "VUE-LOT", species: "Poule", breed: "Beldi", status: "ACTIF", initialPopulation: 800, currentPopulation: 800, plannedStartAt: null, startedAt: "2026-05-01T00:00:00Z", endedAt: null, dataStatus: "REEL", productionLine: null, purpose: "PONTE", hatchedAt: "2026-01-01T00:00:00Z" });
    const farmer = await createTestSession("PRODUCER", "PRODUCER", producer.id, "focus-farmer");
    const now = new Date("2026-10-28T10:00:00.000Z");

    await recordObservation(lot.id, { status: "ALERTE", signs: "Râles et chute de ponte sur un tiers du bâtiment", observedAt: "2026-10-27T08:00:00.000Z" }, farmer);
    const sample = await createSample({ objectType: "LOT", objectId: lot.id, matrix: "ECOUVILLON", reason: "SUSPICION", sampledAt: "2026-10-27T09:00:00.000Z", laboratory: "Laboratoire (test)" }, vet);
    const { results } = await recordResults({ sampleId: sample.id, complete: true, results: [{ analyte: "Mycoplasma gallisepticum", method: "PCR", value: "Détecté", interpretation: "POSITIF", resultAt: "2026-10-28T08:00:00.000Z" }] }, vet, now);

    const before = await getRoleFocus(vet, now);
    expect(before.view).toBe("VETERINAIRE");
    const tile = (label: string) => before.tiles.find((t) => t.label === label)?.value;
    expect(tile("Résultats à lire")).toBe("1");
    expect(before.lists[0].items.some((i) => i.label.includes(sample.code))).toBe(true);
    expect(before.lists[0].items.some((i) => i.label.includes("VUE-LOT"))).toBe(true);

    await reviewResult({ resultId: results[0].id, note: "Confirmé : traitement et retrait des œufs" }, vet, now);
    const after = await getRoleFocus(vet, now);
    expect(after.lists[0].items.some((i) => i.label.includes(sample.code))).toBe(false);
    expect(after.lists[0].items.some((i) => i.label.includes("VUE-LOT"))).toBe(true);

    // The farmer who made the observation sees his own first screen, not the veterinarian's queue.
    expect((await getRoleFocus(farmer, now)).view).toBe("ELEVEUR");
  });
});
