import type { Session } from "../../../services/auth/session";
import {
  createChickLot,
  createEggLot,
  createHatchCycle,
  createParentFlock,
  placeChicksIntoLot,
  recordCandling,
  recordHatch,
} from "../../../services/hatchery/hatchery";
import { decideHold, openHold } from "../../../services/quality/holds";
import { createShipment } from "../../../services/traceability/shipment";
import { repositories } from "../../repositories";

/**
 * The upstream half of the client's chain (genetics → parent flock → eggs → hatchery → chicks)
 * for the two demonstrable farm lots, plus commercial shipments and one closed quality case.
 * Written through the normal services only, like every other generator.
 *
 * Figures are simulated but internally exact: every egg set is accounted for (clear +
 * unhatched + hatched), chicks placed never exceed chicks dispatched, and shipments never
 * exceed the packaged quantity. Hatch rates (~85 % of eggs set) sit in the usual range for a
 * broiler parent flock; they are demonstration values, not a breed-standard claim.
 * The hatchery is a separate site owned by the hero producer, so the hero farm's own
 * buildings are unchanged; the breeder flock is carried by its own lot on the hatchery site.
 */
export async function seedUpstreamChain(input: {
  heroProducerId: string;
  heroLotId: string;
  verifiedLotId: string;
  heroProductId: string;
  verifiedProductId: string;
  adminSession: Session;
}): Promise<void> {
  const { adminSession: admin } = input;

  const hatcheryFarm = await repositories.farms.create({
    producerId: input.heroProducerId,
    name: "Couvoir Al Baraka",
    city: "Kénitra",
    region: "Rabat-Salé-Kénitra",
    geoLat: null,
    geoLng: null,
  });
  const reproBuilding = await repositories.buildings.create({ farmId: hatcheryFarm.id, code: "REPRO-01", name: "Reproducteurs", capacity: 10000, zoneType: "ELEVAGE" });
  const hatcheryBuilding = await repositories.buildings.create({ farmId: hatcheryFarm.id, code: "COUV-01", name: "Salle d'incubation", capacity: 60000, zoneType: "COUVOIR" });

  const flock = await createParentFlock(
    {
      code: "PF-2025-02",
      buildingId: reproBuilding.id,
      lineCode: "REPRO_CHAIR",
      hatchedAt: "2024-09-14T00:00:00.000Z",
      strain: "Ross 308 PS",
      geneticSupplier: "Aviagen",
      originCountry: "Royaume-Uni",
      importReference: "IMP-DEMO-2025-014",
      placedAt: "2025-04-15T08:00:00.000Z",
      femaleCount: 8200,
      maleCount: 820,
      dataStatus: "VALIDE",
      sourceType: "MANUEL",
      documentId: "Certificat sanitaire d'import (démo)",
    },
    admin
  );

  // --- Verified lot BU-2025-010: 11 000 chicks placed on 2025-12-02 ---------------------------
  const eggsVerified = await createEggLot({ code: "OAC-2025-1105", parentFlockId: flock.id, collectedAt: "2025-11-05T07:00:00.000Z", quantity: 13600, storageBuildingId: hatcheryBuilding.id, dataStatus: "VALIDE", sourceType: "MANUEL" }, admin);
  const cycleVerified = await createHatchCycle({ code: "INC-2025-46", buildingId: hatcheryBuilding.id, incubatorRef: "Incubateur 2", setAt: "2025-11-11T08:00:00.000Z", allocations: [{ eggLotId: eggsVerified.id, quantity: 13400 }], dataStatus: "VALIDE", sourceType: "MANUEL" }, admin);
  await recordCandling({ cycleId: cycleVerified.id, candledAt: "2025-11-21T09:00:00.000Z", clearsRemoved: 940 }, admin);
  await recordHatch({ cycleId: cycleVerified.id, hatchedAt: "2025-12-02T04:00:00.000Z", chicksHatched: 11410, unhatched: 1050, culls: 160 }, admin);
  const chicksVerified = await createChickLot({ code: "PSS-2025-46A", hatchCycleId: cycleVerified.id, quantity: 11100, grade: "A", dispatchedAt: "2025-12-02T05:00:00.000Z", dataStatus: "VALIDE", sourceType: "MANUEL" }, admin);
  await placeChicksIntoLot({ lotId: input.verifiedLotId, chickLotId: chicksVerified.id, quantity: 11000 }, admin);

  // --- Hero lot BU-2026-001: 12 000 chicks placed on 2026-07-21 -------------------------------
  const eggsA = await createEggLot({ code: "OAC-2026-0624", parentFlockId: flock.id, collectedAt: "2026-06-24T07:00:00.000Z", quantity: 8000, storageBuildingId: hatcheryBuilding.id, dataStatus: "SIMULATION", sourceType: "MANUEL" }, admin);
  const eggsB = await createEggLot({ code: "OAC-2026-0627", parentFlockId: flock.id, collectedAt: "2026-06-27T07:00:00.000Z", quantity: 7500, storageBuildingId: hatcheryBuilding.id, dataStatus: "SIMULATION", sourceType: "MANUEL" }, admin);
  const cycleHero = await createHatchCycle(
    {
      code: "INC-2026-27",
      buildingId: hatcheryBuilding.id,
      incubatorRef: "Incubateur 3",
      setAt: "2026-06-30T08:00:00.000Z",
      allocations: [
        { eggLotId: eggsA.id, quantity: 8000 },
        { eggLotId: eggsB.id, quantity: 6800 },
      ],
      dataStatus: "SIMULATION",
      sourceType: "MANUEL",
    },
    admin
  );
  await recordCandling({ cycleId: cycleHero.id, candledAt: "2026-07-10T09:00:00.000Z", clearsRemoved: 1036 }, admin);
  await recordHatch({ cycleId: cycleHero.id, hatchedAt: "2026-07-21T03:00:00.000Z", chicksHatched: 12620, unhatched: 1144, culls: 180 }, admin);
  const chicksHero = await createChickLot({ code: "PSS-2026-27A", hatchCycleId: cycleHero.id, quantity: 12200, grade: "A", dispatchedAt: "2026-07-21T04:00:00.000Z", dataStatus: "SIMULATION", sourceType: "MANUEL" }, admin);
  await placeChicksIntoLot({ lotId: input.heroLotId, chickLotId: chicksHero.id, quantity: 12000 }, admin);

  // --- Shipments --------------------------------------------------------------------------------
  const destinations = await repositories.destinations.list();
  const byCode = new Map(destinations.map((d) => [d.code, d]));
  const casablanca = byCode.get("DEST-2025-010")!;
  const kenitra = byCode.get("DEST-2026-001")!;
  await createShipment({ code: "EXP-2026-0116", productId: input.verifiedProductId, destinationId: casablanca.id, quantity: 9000, unit: "kg", shippedAt: "2026-01-16T06:00:00.000Z", dataStatus: "VALIDE" }, admin);
  await createShipment({ code: "EXP-2026-0118", productId: input.verifiedProductId, destinationId: casablanca.id, quantity: 6120, unit: "kg", shippedAt: "2026-01-18T06:00:00.000Z", dataStatus: "VALIDE" }, admin);
  await createShipment({ code: "EXP-2026-0816", productId: input.heroProductId, destinationId: kenitra.id, quantity: 3200, unit: "kg", shippedAt: "2026-08-16T20:00:00.000Z", dataStatus: "SIMULATION" }, admin);

  // --- One closed quality case: opened by the administrator, released by quality ---------------
  // Shows the four-eyes rule in the demo data: the person who opens a hold cannot lift it.
  const quality = await repositories.users.findByEmail("qualite@biovolailles.demo");
  if (quality) {
    const qualitySession: Session = { userId: quality.id, role: quality.role, scopeType: quality.scopeType, scopeId: quality.scopeId, isDemoSwitch: false };
    const qc = await openHold(
      {
        rootType: "EGG_LOT",
        rootId: eggsVerified.id,
        reason: "TEMPERATURE_HORS_LIMITE",
        description: "Revue rétrospective : salle de stockage des œufs relevée à 21 °C pendant 3 h le 06/11/2025 (consigne 16–18 °C).",
        scope: "DESCENDANTS",
        evidence: "Relevé enregistreur ENR-COUV-07",
      },
      admin
    );
    await decideHold(
      {
        caseId: qc.id,
        decision: "LIBERE",
        justification: "Excursion courte ; mirage à J10 conforme (taux de clairs 7,0 %) et éclosion dans la norme du troupeau.",
        evidence: "ENR-COUV-07; PV-MIRAGE-INC-2025-46",
      },
      qualitySession
    );
  }
}
