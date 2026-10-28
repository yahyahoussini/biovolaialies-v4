import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { ensureDefaultLines } from "../production/lines";
import { startLotPhase } from "../production/phases";
import { createTableEggLot } from "../production/table-eggs";
import { createTestSession } from "../production/test-support";
import { createSlaughterBatch } from "../traceability/slaughter";
import { getLotHealth, recordObservation, recordTreatment, recordVaccination, reviewObservation } from "./health";

const SIM = { dataStatus: "SIMULATION" as const, sourceType: "MANUEL" as const };

async function world(suffix: string) {
  await ensureDefaultLines();
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `health-admin-${suffix}`);
  const org = await repositories.organizations.create({ name: `Santé ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `SAN-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const farmer = await createTestSession("PRODUCER", "PRODUCER", producer.id, `health-farmer-${suffix}`);
  const technician = await createTestSession("TECHNICIAN", "PRODUCER", producer.id, `health-tech-${suffix}`);
  const outsider = await createTestSession("PRODUCER", "PRODUCER", (await repositories.producers.create({ cooperativeId: coop.id, name: `Autre ${suffix}`, contactPhone: null, contactEmail: null })).id, `health-out-${suffix}`);
  return { admin, farmer, technician, outsider, building };
}

async function layerLot(w: Awaited<ReturnType<typeof world>>, code: string) {
  const lot = await repositories.lots.create({ buildingId: w.building.id, code, species: "Poulet", breed: "Lohmann", status: "ACTIF", initialPopulation: 2000, currentPopulation: 2000, plannedStartAt: null, startedAt: "2025-01-01T00:00:00Z", endedAt: null, dataStatus: "SIMULATION", productionLine: "PONDEUSE_BLANC", purpose: "PONTE", hatchedAt: "2025-01-01T00:00:00Z" });
  await startLotPhase({ lotId: lot.id, phase: "CROISSANCE", startedAt: "2025-01-01" }, w.admin);
  await startLotPhase({ lotId: lot.id, phase: "ELEVAGE_PARTENAIRE", startedAt: "2025-02-12" }, w.admin);
  await startLotPhase({ lotId: lot.id, phase: "PONTE", startedAt: "2025-07-01" }, w.admin);
  return lot;
}

const eggs = (code: string, lotId: string, collectedOn: string) => ({ code, lotId, collectedOn, quantity: 100, saleable: 100, cracked: 0, dirty: 0, small: 0, ...SIM });

describe("health acts", () => {
  it("lets the farmer record a vaccination in scope, dated when it was given", async () => {
    const w = await world("vac");
    const lot = await layerLot(w, "SAN-VAC-1");
    const event = await recordVaccination(lot.id, { vaccine: "Nobilis ND Clone 30", disease: "Newcastle", route: "EAU_DE_BOISSON", administeredAt: "2025-03-01T07:00:00Z", headcount: 2000 }, w.farmer);
    expect(event).toMatchObject({ eventType: "VACCINATION", occurredAt: "2025-03-01T07:00:00.000Z" });
    await expect(recordVaccination(lot.id, { vaccine: "Nobilis ND", disease: "Newcastle", route: "EAU_DE_BOISSON", administeredAt: "2025-03-01" }, w.outsider)).rejects.toThrow(/périmètre/);
    await expect(recordVaccination(lot.id, { vaccine: "Nobilis ND", disease: "Newcastle", route: "EAU_DE_BOISSON", administeredAt: "2024-06-01" }, w.farmer)).rejects.toThrow(/précéder/);
    const health = await getLotHealth(lot.id, w.farmer);
    expect(health.vaccinations).toHaveLength(1);
    expect(health.canRecord).toBe(true);
    expect(health.canReview).toBe(false);
  });

  it("takes eggs laid in a treatment's egg window off sale, and keeps later ones on sale", async () => {
    const w = await world("egg");
    const lot = await layerLot(w, "SAN-EGG-1");
    const before = await createTableEggLot(eggs("SAN-OE-1", lot.id, "2025-08-03"), w.admin);
    const inside = await createTableEggLot(eggs("SAN-OE-2", lot.id, "2025-08-06"), w.admin);
    await expect(recordTreatment(lot.id, { product: "Oxytétracycline", indication: "Mycoplasmose", route: "EAU_DE_BOISSON", startedAt: "2025-08-04T08:00:00Z", durationDays: 5, withdrawalMeatDays: 7 }, w.farmer)).rejects.toThrow(/délai d'attente œufs/);

    const result = await recordTreatment(lot.id, { product: "Oxytétracycline", indication: "Mycoplasmose", route: "EAU_DE_BOISSON", startedAt: "2025-08-04T08:00:00Z", durationDays: 5, withdrawalMeatDays: 7, withdrawalEggDays: 3 }, w.farmer);
    expect(result.eggClearAt).toBe("2025-08-12T08:00:00.000Z");
    expect(result.withdrawnCollections.map((e) => e.id)).toEqual([inside.id]);
    expect((await repositories.tableEggLots.findById(before.id))?.status).toBe("EN_STOCK");

    // A collection entered later for a day inside the window is withdrawn at once…
    const late = await createTableEggLot(eggs("SAN-OE-3", lot.id, "2025-08-10"), w.admin);
    expect(late.status).toBe("RETIRE");
    // …the last day of the window counts, the next one does not.
    expect((await createTableEggLot(eggs("SAN-OE-4", lot.id, "2025-08-12"), w.admin)).status).toBe("RETIRE");
    expect((await createTableEggLot(eggs("SAN-OE-5", lot.id, "2025-08-13"), w.admin)).status).toBe("EN_STOCK");
  });

  it("refuses slaughter inside the meat withdrawal window", async () => {
    const w = await world("meat");
    const lot = await repositories.lots.create({ buildingId: w.building.id, code: "SAN-MEAT-1", species: "Poulet", breed: "Beldi", status: "ACTIF", initialPopulation: 1000, currentPopulation: 1000, plannedStartAt: null, startedAt: "2025-01-01T00:00:00Z", endedAt: null, dataStatus: "SIMULATION", productionLine: null, purpose: "CHAIR", hatchedAt: "2025-01-01T00:00:00Z" });
    await recordTreatment(lot.id, { product: "Enrofloxacine", indication: "Colibacillose", route: "EAU_DE_BOISSON", startedAt: "2025-04-01T08:00:00Z", durationDays: 3, withdrawalMeatDays: 8 }, w.farmer);
    await expect(createSlaughterBatch({ code: "SAN-AB-1", sourceLotId: lot.id, quantityIn: 900, quantityOut: 800, losses: 100, slaughteredAt: "2025-04-10", ...SIM }, w.admin)).rejects.toThrow(/Délai d'attente viande en cours jusqu'au 12\/04\/2025/);
    const batch = await createSlaughterBatch({ code: "SAN-AB-1", sourceLotId: lot.id, quantityIn: 900, quantityOut: 800, losses: 100, slaughteredAt: "2025-04-13", ...SIM }, w.admin);
    expect(batch.sourceLotId).toBe(lot.id);
  });

  it("has an observation reviewed by someone other than the observer", async () => {
    const w = await world("obs");
    const lot = await layerLot(w, "SAN-OBS-1");
    const { observation } = await recordObservation(lot.id, { status: "SURVEILLANCE", signs: "Plumes ébouriffées, baisse de consommation d'eau", affectedCount: 40, observedAt: "2025-09-01T09:00:00Z" }, w.farmer);
    expect(observation.validationStatus).toBe("EN_ATTENTE");
    await expect(reviewObservation({ observationId: observation.id, decision: "VALIDE" }, w.farmer)).rejects.toThrow(/technicien/);
    const reviewed = await reviewObservation({ observationId: observation.id, decision: "VALIDE", comment: "Confirmé à la visite" }, w.technician);
    expect(reviewed).toMatchObject({ validationStatus: "VALIDE", validatedBy: w.technician.userId });
    await expect(reviewObservation({ observationId: observation.id, decision: "REJETE" }, w.technician)).rejects.toThrow(/déjà été examinée/);
    const health = await getLotHealth(lot.id, w.technician);
    expect(health.observations[0]).toMatchObject({ review: "VALIDE", reviewerName: expect.stringContaining("health-tech") });
  });

  it("refuses an act on a lot with no live birds", async () => {
    const w = await world("dead");
    const lot = await repositories.lots.create({ buildingId: w.building.id, code: "SAN-DEAD-1", species: "Poulet", breed: "Beldi", status: "ABATTU", initialPopulation: 100, currentPopulation: 0, plannedStartAt: null, startedAt: "2025-01-01T00:00:00Z", endedAt: "2025-05-01T00:00:00Z", dataStatus: "SIMULATION", productionLine: null, purpose: "CHAIR", hatchedAt: null });
    await expect(recordVaccination(lot.id, { vaccine: "Vaccin", disease: "Gumboro", route: "EAU_DE_BOISSON", administeredAt: "2025-02-01" }, w.admin)).rejects.toThrow(/plus d'animaux vivants/);
  });
});
