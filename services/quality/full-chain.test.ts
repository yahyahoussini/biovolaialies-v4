import { describe, expect, it } from "vitest";
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
import { verifyLedger } from "../ledger/ledger";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { buildLotTraceabilityChain } from "../traceability/chain";
import { createCollection } from "../traceability/collection";
import { createProduct } from "../traceability/product";
import { createShipment } from "../traceability/shipment";
import { createSlaughterBatch } from "../traceability/slaughter";
import { createTransformationBatch } from "../traceability/transformation";
import { activeHoldsOn, decideHold, getQualityCase, openHold } from "./holds";
import { buildRecallReport, recallReportToCsv } from "./recall";

const SIM = { dataStatus: "SIMULATION" as const, sourceType: "MANUEL" as const };

async function buildFullChain(suffix: string) {
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

describe("full chain: genetics → QR, hold propagation, recall", () => {
  it("links the hatchery chain into the farm lot's traceability graph", async () => {
    const c = await buildFullChain("g1");
    const chain = await buildLotTraceabilityChain(c.lot.id, c.admin);
    const types = new Set(chain.nodes.map((n) => n.type));
    for (const t of ["PARENT_FLOCK", "EGG_LOT", "HATCH_CYCLE", "CHICK_LOT", "LOT", "PRODUCT", "SHIPMENT", "DESTINATION"]) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  it("does not leak a sibling lot hatched from the same flock into a lot's chain", async () => {
    const c = await buildFullChain("sib");
    const eggs2 = await createEggLot({ code: "OAC-sib-2", parentFlockId: c.flock.id, collectedAt: "2026-06-10", quantity: 1000, ...SIM }, c.admin);
    const cycle2 = await createHatchCycle({ code: "INC-sib-2", buildingId: c.couvoir.id, incubatorRef: "Inc 5", setAt: "2026-06-12", allocations: [{ eggLotId: eggs2.id, quantity: 1000 }], ...SIM }, c.admin);
    await recordCandling({ cycleId: cycle2.id, candledAt: "2026-06-22", clearsRemoved: 100 }, c.admin);
    await recordHatch({ cycleId: cycle2.id, hatchedAt: "2026-07-03", chicksHatched: 850, unhatched: 50, culls: 0 }, c.admin);
    const chicks2 = await createChickLot({ code: "PSS-sib-2", hatchCycleId: cycle2.id, quantity: 800, grade: "A", dispatchedAt: "2026-07-03", ...SIM }, c.admin);
    const elevage = (await repositories.buildings.list()).find((b) => b.code === "ELV-sib")!;
    const sibling = await createLot({ code: "BU-sib-2", buildingId: elevage.id, species: "Poulet de chair", breed: "Ross 308", initialPopulation: 800, plannedStartAt: null, dataStatus: "SIMULATION" }, c.admin);
    await placeChicksIntoLot({ lotId: sibling.id, chickLotId: chicks2.id, quantity: 800 }, c.admin);

    const chain = await buildLotTraceabilityChain(sibling.id, c.admin);
    const codes = chain.nodes.map((n) => n.code);
    expect(codes).toContain("PF-sib");
    expect(codes).not.toContain("BU-sib");
    expect(codes).not.toContain("PRD-sib");
  });

  it("enforces hatchery balances (T31)", async () => {
    const c = await buildFullChain("g2");
    // 6000 eggs, 5000 already set → only 1000 left.
    await expect(
      createHatchCycle({ code: "INC-g2-b", buildingId: c.couvoir.id, incubatorRef: "Inc 4", setAt: "2026-06-04", allocations: [{ eggLotId: c.eggs.id, quantity: 1001 }], ...SIM }, c.admin)
    ).rejects.toThrow(/1000 œufs restent/);
    // 4250 hatched − 50 culls − 4200 dispatched = 0 left.
    await expect(createChickLot({ code: "PSS-g2-b", hatchCycleId: c.cycle.id, quantity: 1, grade: "B", dispatchedAt: "2026-06-25", ...SIM }, c.admin)).rejects.toThrow(/0 poussins/);
  });

  it("propagates a hold from an egg lot to every descendant and blocks derivations (T05)", async () => {
    const c = await buildFullChain("h1");
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "h1-tech");
    const qualityCase = await openHold({ rootType: "EGG_LOT", rootId: c.eggs.id, reason: "RESULTAT_LABORATOIRE", description: "Salmonelle suspectée sur le troupeau parental", scope: "DESCENDANTS", evidence: "LAB-2026-044" }, tech);

    expect(await activeHoldsOn("PRODUCT", c.product.id)).toHaveLength(1);
    expect(await activeHoldsOn("SHIPMENT", c.shipment.id)).toHaveLength(1);
    expect(await activeHoldsOn("PARENT_FLOCK", c.flock.id)).toHaveLength(0);

    await expect(
      createShipment({ code: "EXP-h1-b", productId: c.product.id, destinationId: c.destination.id, quantity: 10, unit: "kg", shippedAt: "2026-08-06", dataStatus: "SIMULATION" }, c.admin)
    ).rejects.toThrow(/blocage qualité/);

    const view = await getQualityCase(qualityCase.id, c.admin);
    expect(view.items.length).toBeGreaterThanOrEqual(8);
  });

  it("only lets a different, authorised person release, with evidence (R10, T06, T07)", async () => {
    const c = await buildFullChain("h2");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "h2-quality");
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "h2-tech");
    const qc = await openHold({ rootType: "PRODUCT", rootId: c.product.id, reason: "TEMPERATURE_HORS_LIMITE", description: "Rupture de froid en chambre 2", scope: "DESCENDANTS", evidence: "" }, quality);

    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Contrôle visuel conforme, enregistreur relu.", evidence: "ENR-7" }, tech)).rejects.toThrow(/responsable qualité/);
    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Contrôle visuel conforme, enregistreur relu.", evidence: "ENR-7" }, quality)).rejects.toThrow(/quatre yeux/);

    const otherQuality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "h2-quality-b");
    await expect(decideHold({ caseId: qc.id, decision: "LIBERE", justification: "trop court", evidence: "ENR-7" }, otherQuality)).rejects.toThrow(/20 caractères/);
    const released = await decideHold({ caseId: qc.id, decision: "LIBERE", justification: "Enregistreur relu : excursion de 12 min sous 4 °C, conforme.", evidence: "ENR-7; PV-QA-12" }, otherQuality);
    expect(released.status).toBe("LIBERE");
    expect(await activeHoldsOn("PRODUCT", c.product.id)).toHaveLength(0);

    await createShipment({ code: "EXP-h2-b", productId: c.product.id, destinationId: c.destination.id, quantity: 100, unit: "kg", shippedAt: "2026-08-07", dataStatus: "SIMULATION" }, c.admin);
    expect((await verifyLedger(c.admin)).ok).toBe(true);
  });

  it("builds an upstream + downstream recall with quantities (T03, T04, T13)", async () => {
    const c = await buildFullChain("r1");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "r1-quality");

    const down = await buildRecallReport("EGG_LOT", c.eggs.id, quality);
    expect(down.products.map((p) => p.code)).toEqual(["PRD-r1"]);
    expect(down.products[0]).toMatchObject({ quantity: 2500, shipped: 1000, onHand: 1500 });
    expect(down.shipments[0]).toMatchObject({ destinationCity: "Casablanca", quantity: 1000 });
    expect(down.totals.destinationCount).toBe(1);
    expect(down.durationMs).toBeLessThan(60_000);

    const up = await buildRecallReport("PRODUCT", c.product.id, quality);
    expect(up.upstream.some((n) => n.type === "PARENT_FLOCK" && n.code === "PF-r1")).toBe(true);
    expect(recallReportToCsv(up, "QC-TEST")).toContain("PF-r1");
  });

  it("keeps out-of-scope users away from holds and recalls", async () => {
    const c = await buildFullChain("s1");
    const other = await createTestSession("FARM_MANAGER", "FARM", "another-farm", "s1-fm");
    await expect(openHold({ rootType: "LOT", rootId: c.lot.id, reason: "AUTRE", description: "Tentative hors périmètre", scope: "OBJET_SEUL", evidence: "" }, other)).rejects.toThrow(/périmètre/);
    await expect(buildRecallReport("LOT", c.lot.id, other)).rejects.toThrow(/périmètre/);
  });
});
