import { repositories } from "../../data/repositories";
import {
  createChickLot,
  createEggLot,
  createHatchCycle,
  createParentFlock,
  placeChicksIntoLot,
  recordCandling,
  recordHatch,
} from "../hatchery/hatchery";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { createCollection } from "../traceability/collection";
import { createProduct } from "../traceability/product";
import { createShipment } from "../traceability/shipment";
import { createSlaughterBatch } from "../traceability/slaughter";
import { createTransformationBatch } from "../traceability/transformation";

/** Test-only: a complete genetics → shipment chain with every step going through the real services. */
export const SIM = { dataStatus: "SIMULATION" as const, sourceType: "MANUEL" as const };

export async function buildFullChain(suffix: string) {
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `chain-admin-${suffix}`);
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Prod ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const repro = await repositories.buildings.create({ farmId: farm.id, code: `REP-${suffix}`, name: "Reproducteurs", capacity: 6000, zoneType: "ELEVAGE" });
  const couvoir = await repositories.buildings.create({ farmId: farm.id, code: `COUV-${suffix}`, name: "Couvoir", capacity: 20000, zoneType: "COUVOIR" });
  const elevage = await repositories.buildings.create({ farmId: farm.id, code: `ELV-${suffix}`, name: "Élevage", capacity: 6000, zoneType: "ELEVAGE" });

  const flock = await createParentFlock({ code: `PF-${suffix}`, buildingId: repro.id, strain: "Ross 308 PS", geneticSupplier: "Aviagen", originCountry: "Royaume-Uni", importReference: "IMP-1", placedAt: "2026-01-10", femaleCount: 5000, maleCount: 500, ...SIM }, admin);
  const eggs = await createEggLot({ code: `OAC-${suffix}`, parentFlockId: flock.id, collectedAt: "2026-06-01", quantity: 6000, ...SIM }, admin);
  const cycle = await createHatchCycle({ code: `INC-${suffix}`, buildingId: couvoir.id, incubatorRef: "Incubateur 3", setAt: "2026-06-03", allocations: [{ eggLotId: eggs.id, quantity: 5000 }], ...SIM }, admin);
  await recordCandling({ cycleId: cycle.id, candledAt: "2026-06-21", clearsRemoved: 400 }, admin);
  await recordHatch({ cycleId: cycle.id, hatchedAt: "2026-06-24", chicksHatched: 4250, unhatched: 350, culls: 50 }, admin);
  const chicks = await createChickLot({ code: `PSS-${suffix}`, hatchCycleId: cycle.id, quantity: 4200, grade: "A", dispatchedAt: "2026-06-24", ...SIM }, admin);

  const lot = await createLot({ code: `BU-${suffix}`, buildingId: elevage.id, species: "Poulet de chair", breed: "Ross 308", initialPopulation: 4200, plannedStartAt: null, dataStatus: "SIMULATION" }, admin);
  await placeChicksIntoLot({ lotId: lot.id, chickLotId: chicks.id, quantity: 4200 }, admin);

  await repositories.weightMeasurements.create({ lotId: lot.id, occurredAt: "2026-07-30", averageWeight: 2.2, unit: "KG", sampleCount: 50, sourceType: "MANUEL", dataStatus: "SIMULATION", sourceId: null, actorId: null, measurementMethod: "Pesée", deviceId: null, documentId: null, validationStatus: null });
  const collection = await createCollection({ code: `COL-${suffix}`, lotId: lot.id, quantity: 4000, unit: "KG", collectedAt: "2026-08-01", ...SIM, measurementMethod: "Pesée" }, admin);
  const slaughter = await createSlaughterBatch({ code: `AB-${suffix}`, sourceLotId: lot.id, sourceCollectionId: collection.id, quantityIn: 4000, quantityOut: 2800, losses: 1200, slaughteredAt: "2026-08-02", ...SIM, measurementMethod: "Registre" }, admin);
  const transformation = await createTransformationBatch({ code: `TR-${suffix}`, upstreamType: "SLAUGHTER_BATCH", upstreamId: slaughter.id, processType: "Découpe", inputQuantity: 2800, outputQuantity: 2500, losses: 300, rejects: 0, occurredAt: "2026-08-03", ...SIM, measurementMethod: "Bon" }, admin);
  const product = await createProduct({ code: `PRD-${suffix}`, name: "Filets de poulet", category: "Frais", transformationBatchId: transformation.id, packagingDate: "2026-08-04", quantity: 2500, unit: "kg", ...SIM, measurementMethod: "Étiquette" }, admin);
  const destination = await repositories.destinations.create({ code: `DST-${suffix}`, name: "Grossiste Derb Omar", type: "GROSSISTE", city: "Casablanca" });
  const shipment = await createShipment({ code: `EXP-${suffix}`, productId: product.id, destinationId: destination.id, quantity: 1000, unit: "kg", shippedAt: "2026-08-05", dataStatus: "SIMULATION" }, admin);

  return { admin, flock, eggs, cycle, chicks, lot, product, destination, shipment, couvoir };
}

