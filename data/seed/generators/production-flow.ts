import { randomUUID } from "node:crypto";
import type { FieldKind } from "../../../domain/field/field";
import type { Session } from "../../../services/auth/session";
import { syncFieldOps } from "../../../services/field/sync";
import { recordObservation, recordTreatment, recordVaccination, reviewObservation } from "../../../services/sanitary/health";
import { createChickLot, createEggLot, createHatchCycle, createParentFlock, importParentStock, recordCandling, recordHatch } from "../../../services/hatchery/hatchery";
import { transitionLotStatus } from "../../../services/production/lot-lifecycle";
import { createLot } from "../../../services/production/lot";
import { createMortalityRecord, createWeightMeasurementRecord } from "../../../services/production/data-records";
import { startLotPhase } from "../../../services/production/phases";
import { changeSubjectStatus, recordSubjectEvent, registerSubjects } from "../../../services/production/subjects";
import { createTableEggLot } from "../../../services/production/table-eggs";
import { dispatchTransfer, disputeTransfer, receiveTransfer } from "../../../services/production/transfers";
import { createCollection } from "../../../services/traceability/collection";
import { createSlaughterBatch } from "../../../services/traceability/slaughter";
import { hashPassword } from "../../../lib/password";
import { repositories } from "../../repositories";
import { DEMO_ACCOUNT_EMAIL, DEMO_PASSWORD, type SeededHierarchy } from "./hierarchy";

/**
 * The client's handwritten flow, end to end, through the real services:
 *  - imported day-old parent stock reared in cages, then on the floor, then laying (REPRO_PONTE);
 *  - hatching eggs moved to the hatchery and counted on both sides;
 *  - chicks to Biovolailles' growing centre, then at 6 weeks to partner farms of the
 *    cooperatives — counted and signed at departure and again by the partner at arrival;
 *  - poulet fermier lots growing on partner farms (one overdue for slaughter);
 *  - layers of white and "Pistache" table eggs with two weeks of graded collections;
 *  - an old layer flock gone through reform to the slaughterhouse;
 *  - individually ringed breeders, one weighed with its attribution proof;
 *  - one delivery of chicks still in transit, waiting for the producer's count.
 * Every record is SIMULATION data.
 */

const SIM = { dataStatus: "SIMULATION" as const, sourceType: "MANUEL" as const };

async function sessionFor(email: string): Promise<{ session: Session; name: string }> {
  const user = await repositories.users.findByEmail(email);
  if (!user) throw new Error(`Utilisateur de démonstration absent : ${email}`);
  return { session: { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: user.scopeId, isDemoSwitch: false }, name: user.fullName };
}

/** A partner farmer's own account — the person who counts and signs at arrival on their farm. */
async function partnerAccount(email: string, fullName: string, producerId: string): Promise<{ session: Session; name: string }> {
  const user = await repositories.users.create({ email, passwordHash: hashPassword(DEMO_PASSWORD), fullName, role: "PRODUCER", scopeType: "PRODUCER", scopeId: producerId, active: true });
  return { session: { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: user.scopeId, isDemoSwitch: false }, name: user.fullName };
}

function building(hierarchy: SeededHierarchy, farm: string, code: string): { buildingId: string; producerId: string } {
  const entry = hierarchy.farmsByKey.get(farm);
  const buildingId = entry?.buildingIds.get(code);
  if (!entry || !buildingId) throw new Error(`Bâtiment de démonstration absent : ${farm} ${code}`);
  return { buildingId, producerId: entry.producerId };
}

async function hatch(
  admin: Session,
  input: { flockId: string; hatcheryId: string; storageId: string; suffix: string; collectedAt: string; setAt: string; candledAt: string; hatchedAt: string; eggs: number; set: number; clears: number; unhatched: number; culls: number }
) {
  const hatched = input.set - input.clears - input.unhatched;
  const eggLot = await createEggLot({ code: `OAC-${input.suffix}`, parentFlockId: input.flockId, collectedAt: input.collectedAt, quantity: input.eggs, storageBuildingId: input.storageId, ...SIM }, admin);
  const cycle = await createHatchCycle({ code: `INC-${input.suffix}`, buildingId: input.hatcheryId, incubatorRef: "Incubateur 4", setAt: input.setAt, allocations: [{ eggLotId: eggLot.id, quantity: input.set }], ...SIM }, admin);
  await recordCandling({ cycleId: cycle.id, candledAt: input.candledAt, clearsRemoved: input.clears }, admin);
  await recordHatch({ cycleId: cycle.id, hatchedAt: input.hatchedAt, chicksHatched: hatched, unhatched: input.unhatched, culls: input.culls }, admin);
  return { eggLot, cycle, available: hatched - input.culls };
}

export async function seedProductionFlow(input: { hierarchy: SeededHierarchy; adminSession: Session; heroProducerId: string }): Promise<void> {
  const { hierarchy, adminSession: admin } = input;
  const coop = await sessionFor(DEMO_ACCOUNT_EMAIL.COOP_MANAGER);
  const producer = await sessionFor(DEMO_ACCOUNT_EMAIL.PRODUCER);
  const adminName = (await repositories.users.findById(admin.userId))!.fullName;

  // Sites of Biovolailles: the hatchery farm seeded by the upstream chain, and a growing centre.
  const farms = await repositories.farms.list();
  const hatcheryFarm = farms.find((f) => f.name === "Couvoir Al Baraka");
  if (!hatcheryFarm) throw new Error("Le couvoir de démonstration doit être créé avant le flux de production.");
  const hatcheryBuildings = await repositories.buildings.listByFarm(hatcheryFarm.id);
  const hatchery = hatcheryBuildings.find((b) => b.code === "COUV-01")!;
  const breederStore = hatcheryBuildings.find((b) => b.code === "REPRO-01")!;
  const cages = await repositories.buildings.create({ farmId: hatcheryFarm.id, code: "REPRO-02", name: "Poussinière reproducteurs (cages)", capacity: 6000, zoneType: "ELEVAGE" });
  const floor = await repositories.buildings.create({ farmId: hatcheryFarm.id, code: "REPRO-03", name: "Élevage au sol reproducteurs", capacity: 6000, zoneType: "ELEVAGE" });
  const growingFarm = await repositories.farms.create({ producerId: input.heroProducerId, name: "Centre de croissance Biovolailles", city: "Sidi Kacem", region: "Rabat-Salé-Kénitra", geoLat: 34.2214, geoLng: -5.7078 });
  const growing = await repositories.buildings.create({ farmId: growingFarm.id, code: "CRO-01", name: "Poussinière de croissance", capacity: 20000, zoneType: "ELEVAGE" });

  // Partner farms of the cooperatives, and the farmer who signs at arrival on each.
  const ouazzani = building(hierarchy, "Ferme Ouazzani", "BAT-01");
  const cherkaoui = building(hierarchy, "Ferme Cherkaoui", "BAT-02");
  const fassi = building(hierarchy, "Ferme Fassi", "BAT-01");
  const elAmrani = building(hierarchy, "Ferme El Amrani", "BAT-01");
  const salma = await partnerAccount("partenaire.ouazzani@biovolailles.demo", "Salma Ouazzani", ouazzani.producerId);
  const karim = await partnerAccount("partenaire.cherkaoui@biovolailles.demo", "Karim Cherkaoui", cherkaoui.producerId);
  const rachid = await partnerAccount("partenaire.fassi@biovolailles.demo", "Rachid Fassi", fassi.producerId);
  const nadia = await partnerAccount("partenaire.elamrani@biovolailles.demo", "Nadia El Amrani", elAmrani.producerId);

  // --- Layer breeders already laying since November 2024: source of the 2025 layer chicks -------
  const layerFlock = await createParentFlock(
    { code: "PF-2024-11", buildingId: breederStore.id, lineCode: "REPRO_PONTE", strain: "Dekalb White PS", geneticSupplier: "Hendrix Genetics", originCountry: "Pays-Bas", importReference: "DUM-2024-0418", hatchedAt: "2024-04-05T00:00:00.000Z", placedAt: "2024-11-04T08:00:00.000Z", femaleCount: 5200, maleCount: 480, documentId: "Certificat sanitaire d'import (démo)", ...SIM },
    admin
  );

  // --- Day-old parent stock imported in March 2026: cages, floor at 6 weeks, laying at 7 months ---
  const imported = await importParentStock(
    { code: "REP-2026-03", buildingId: cages.id, lineCode: "REPRO_PONTE", strain: "Dekalb White PS", geneticSupplier: "Hendrix Genetics", originCountry: "Pays-Bas", importReference: "DUM-2026-0311", supplierFlockCode: "HG-PS-55871", hatchedAt: "2026-03-09T00:00:00.000Z", placedAt: "2026-03-10T09:00:00.000Z", femaleCount: 4950, maleCount: 450, documentId: "Certificat sanitaire d'import (démo)", ...SIM },
    coop.session
  );
  await createMortalityRecord(imported.lotId!, { occurredAt: "2026-03-17T07:00:00.000Z", count: 61, suspectedCause: "Mortalité de démarrage", ...SIM }, coop.session);
  await recordVaccination(imported.lotId!, { vaccine: "Nobilis Ma5 + Clone 30", disease: "Newcastle et bronchite infectieuse", route: "NEBULISATION", batchNumber: "A091B11", headcount: 5400, administeredAt: "2026-03-16T07:00:00.000Z" }, admin);
  await recordVaccination(imported.lotId!, { vaccine: "Nobilis Gumboro 228E", disease: "Gumboro", route: "EAU_DE_BOISSON", batchNumber: "G228-0326", headcount: 5380, administeredAt: "2026-03-24T07:00:00.000Z" }, admin);
  await startLotPhase({ lotId: imported.lotId!, phase: "ELEVAGE_SOL", startedAt: "2026-04-21T08:00:00.000Z", buildingId: floor.id, notes: "Sortie des cages à 6 semaines" }, coop.session);
  await startLotPhase({ lotId: imported.lotId!, phase: "PRODUCTION_OAC", startedAt: "2026-10-08T08:00:00.000Z", notes: "Début de ponte à 7 mois" }, coop.session);
  const ringed = await registerSubjects(
    {
      lotId: imported.lotId!,
      taggedAt: "2026-04-21T09:00:00.000Z",
      dataStatus: "SIMULATION",
      subjects: [
        ...Array.from({ length: 20 }, (_, i) => ({ visualId: `R26-${String(i + 1).padStart(4, "0")}`, sex: "FEMELLE" as const })),
        ...Array.from({ length: 4 }, (_, i) => ({ visualId: `R26-M${String(i + 1).padStart(3, "0")}`, rfidUid: `E2003412000${i + 1}`, sex: "MALE" as const })),
      ],
    },
    coop.session
  );
  const male = ringed.find((s) => s.visualId === "R26-M001")!;
  await recordSubjectEvent({ subjectId: male.id, eventType: "PESEE", value: 2.38, unit: "KG", occurredAt: "2026-10-12T08:30:00.000Z", attributionProof: "Puce lue à la station de pesée", deviceId: "SCALE-REP-03", notes: "Contrôle de poids des coqs" }, coop.session);
  const lame = ringed.find((s) => s.visualId === "R26-0007")!;
  await changeSubjectStatus({ subjectId: lame.id, status: "OBSERVATION", at: "2026-10-14T09:00:00.000Z", reason: "Boiterie patte gauche — suivi individuel 7 jours" }, coop.session);

  // --- Layer chicks of March 2025: white and "Pistache" branches -----------------------------------
  const layers = await hatch(admin, { flockId: layerFlock.id, hatcheryId: hatchery.id, storageId: hatchery.id, suffix: "2025-10", collectedAt: "2025-03-01T07:00:00.000Z", setAt: "2025-03-03T08:00:00.000Z", candledAt: "2025-03-21T08:00:00.000Z", hatchedAt: "2025-03-24T04:00:00.000Z", eggs: 6000, set: 5800, clears: 520, unhatched: 400, culls: 40 });
  const whiteChicks = await createChickLot({ code: "PSP-2025-10A", hatchCycleId: layers.cycle.id, quantity: 2400, grade: "A", dispatchedAt: "2025-03-24T05:00:00.000Z", ...SIM }, admin);
  const pistacheChicks = await createChickLot({ code: "PSP-2025-10B", hatchCycleId: layers.cycle.id, quantity: 2400, grade: "A", dispatchedAt: "2025-03-24T05:00:00.000Z", ...SIM }, admin);

  const toGrowingWhite = await dispatchTransfer({ objectType: "CHICK_LOT", objectId: whiteChicks.id, destinationBuildingId: growing.id, destinationLotCode: "CRO-2025-PB1", destinationLineCode: "PONDEUSE_BLANC", phaseOnArrival: "CROISSANCE", quantity: 2400, sentAt: "2025-03-24T05:30:00.000Z", documentRef: "BL-C-2025-0312", transporter: "Couvoir Al Baraka — camion climatisé", crates: 24, signerName: coop.name }, coop.session);
  await receiveTransfer({ transferId: toGrowingWhite.id, quantityReceived: 2396, deadOnArrival: 4, receivedAt: "2025-03-24T09:10:00.000Z", signerName: producer.name }, producer.session);
  const toGrowingPistache = await dispatchTransfer({ objectType: "CHICK_LOT", objectId: pistacheChicks.id, destinationBuildingId: growing.id, destinationLotCode: "CRO-2025-PP1", destinationLineCode: "PONDEUSE_PISTACHE", phaseOnArrival: "CROISSANCE", quantity: 2400, sentAt: "2025-03-24T05:30:00.000Z", documentRef: "BL-C-2025-0313", transporter: "Couvoir Al Baraka — camion climatisé", crates: 24, signerName: coop.name }, coop.session);
  await receiveTransfer({ transferId: toGrowingPistache.id, quantityReceived: 2400, deadOnArrival: 0, receivedAt: "2025-03-24T09:20:00.000Z", signerName: producer.name }, producer.session);

  const growingWhite = (await repositories.lots.findByCode("CRO-2025-PB1"))!;
  const growingPistache = (await repositories.lots.findByCode("CRO-2025-PP1"))!;
  const toFassi = await dispatchTransfer({ objectType: "LOT", objectId: growingWhite.id, destinationBuildingId: fassi.buildingId, destinationLotCode: "FAS-2025-PB1", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: growingWhite.currentPopulation, sentAt: "2025-05-05T06:00:00.000Z", documentRef: "BL-P-2025-0088", transporter: "Transports Souss Avicole", vehicle: "45812-A-33", crates: 60, signerName: producer.name }, producer.session);
  await receiveTransfer({ transferId: toFassi.id, quantityReceived: 2388, deadOnArrival: 3, receivedAt: "2025-05-05T15:40:00.000Z", discrepancyReason: "Cinq poulettes manquantes au déchargement — recomptage des caisses 14 et 15 demandé au transporteur", signerName: rachid.name }, rachid.session);
  const toElAmrani = await dispatchTransfer({ objectType: "LOT", objectId: growingPistache.id, destinationBuildingId: elAmrani.buildingId, destinationLotCode: "ELA-2025-PP1", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: growingPistache.currentPopulation, sentAt: "2025-05-06T06:00:00.000Z", documentRef: "BL-P-2025-0091", transporter: "Transports Chaouia", vehicle: "11207-B-6", crates: 60, signerName: producer.name }, producer.session);
  await receiveTransfer({ transferId: toElAmrani.id, quantityReceived: 2398, deadOnArrival: 2, receivedAt: "2025-05-06T11:15:00.000Z", signerName: nadia.name }, nadia.session);

  const white = (await repositories.lots.findByCode("FAS-2025-PB1"))!;
  const pistache = (await repositories.lots.findByCode("ELA-2025-PP1"))!;
  await startLotPhase({ lotId: white.id, phase: "PONTE", startedAt: "2025-09-08T07:00:00.000Z", notes: "Entrée en ponte, parcours plein air" }, rachid.session);
  await startLotPhase({ lotId: pistache.id, phase: "PONTE", startedAt: "2025-09-15T07:00:00.000Z", notes: "Entrée en ponte, parcours plein air" }, nadia.session);
  await createMortalityRecord(white.id, { occurredAt: "2026-06-10T07:00:00.000Z", count: 96, suspectedCause: "Mortalité cumulée en ponte", ...SIM }, rachid.session);
  await createMortalityRecord(pistache.id, { occurredAt: "2026-06-12T07:00:00.000Z", count: 121, suspectedCause: "Mortalité cumulée en ponte", ...SIM }, nadia.session);

  // Two weeks of graded collections: ~86 % lay for the white flock, ~78 % for "Pistache".
  for (let d = 0; d < 14; d++) {
    const day = new Date(Date.parse("2026-10-05T17:00:00.000Z") + d * 86_400_000).toISOString();
    const stamp = day.slice(0, 10).replaceAll("-", "");
    for (const [lot, session, prefix, rate] of [
      [white, rachid.session, "OEB", 0.86],
      [pistache, nadia.session, "OEP", 0.78],
    ] as const) {
      const hens = lot.currentPopulation - (lot.id === white.id ? 96 : 121);
      const quantity = Math.round(hens * (rate + 0.01 * Math.sin(d * 1.7)));
      const cracked = Math.round(quantity * (0.012 + 0.002 * (d % 3)));
      const dirty = Math.round(quantity * 0.018);
      const small = Math.round(quantity * (lot.id === white.id ? 0.011 : 0.024));
      await createTableEggLot({ code: `${prefix}-${stamp}`, lotId: lot.id, collectedOn: day, quantity, saleable: quantity - cracked - dirty - small, cracked, dirty, small, ...SIM }, session);
    }
  }

  // A respiratory alert on the "Pistache" flock, confirmed, then treated: the eggs laid inside the
  // egg withdrawal window come off sale (five collections), the later ones stay on sale.
  const alarm = await recordObservation(pistache.id, { status: "ALERTE", signs: "Râles respiratoires sur plusieurs groupes, chute de ponte de 6 % en trois jours", affectedCount: 180, observedAt: "2026-10-13T08:30:00.000Z" }, nadia.session);
  await reviewObservation({ observationId: alarm.observation.id, decision: "VALIDE", comment: "Confirmé à la visite ; prélèvements envoyés au laboratoire" }, admin);
  await recordTreatment(pistache.id, { product: "Oxytétracycline 20 %", activeSubstance: "Oxytétracycline", indication: "Mycoplasmose respiratoire suspectée", prescriptionRef: "ORD-2026-0952", prescriber: "Dr Hicham Alaoui", route: "EAU_DE_BOISSON", dose: "40 mg/kg/j", startedAt: "2026-10-14T08:00:00.000Z", durationDays: 5, withdrawalMeatDays: 7, withdrawalEggDays: 7, headcount: 1650 }, nadia.session);
  await recordVaccination(white.id, { vaccine: "Nobilis IB 4-91", disease: "Bronchite infectieuse (rappel)", route: "NEBULISATION", batchNumber: "A118C02", headcount: 2300, administeredAt: "2026-09-02T07:30:00.000Z" }, rachid.session);

  // --- Spent hens: a 2024 white flock reformed at 29.8 months, slaughtered through a collection ----
  const old = await createLot({ code: "FAS-2024-PB0", buildingId: building(hierarchy, "Ferme Fassi", "BAT-01").buildingId, species: "Poulet", breed: "Dekalb White", initialPopulation: 2100, plannedStartAt: "2024-05-13", dataStatus: "SIMULATION", productionLine: "PONDEUSE_BLANC", hatchedAt: "2024-04-01T00:00:00.000Z" }, admin);
  await transitionLotStatus(old.id, "CREE", admin);
  await transitionLotStatus(old.id, "ACTIF", admin, "Mise en place chez le partenaire", "2024-05-13T07:00:00.000Z");
  await startLotPhase({ lotId: old.id, phase: "ELEVAGE_PARTENAIRE", startedAt: "2024-05-13T07:00:00.000Z" }, admin);
  await startLotPhase({ lotId: old.id, phase: "PONTE", startedAt: "2024-09-16T07:00:00.000Z" }, admin);
  await createMortalityRecord(old.id, { occurredAt: "2026-08-30T07:00:00.000Z", count: 150, suspectedCause: "Mortalité cumulée en ponte", ...SIM }, rachid.session);
  await startLotPhase({ lotId: old.id, phase: "REFORME", startedAt: "2026-09-25T07:00:00.000Z", notes: "Fin de ponte économique, réforme vers l'abattoir" }, rachid.session);
  await createWeightMeasurementRecord(old.id, { occurredAt: "2026-09-26T07:00:00.000Z", averageWeight: 1.62, unit: "KG", sampleCount: 60, measurementMethod: "Pesée d'échantillon avant enlèvement", ...SIM }, rachid.session);
  // Treated three weeks before reform: both withdrawal windows closed before the slaughter date.
  await recordTreatment(old.id, { product: "Amoxicilline 70 %", activeSubstance: "Amoxicilline", indication: "Colibacillose en fin de ponte", prescriptionRef: "ORD-2026-0871", prescriber: "Dr Hicham Alaoui", route: "EAU_DE_BOISSON", dose: "15 mg/kg/j", startedAt: "2026-09-01T07:00:00.000Z", durationDays: 5, withdrawalMeatDays: 10, withdrawalEggDays: 7, headcount: 1950 }, rachid.session);
  const pickup = await createCollection({ code: "COL-2026-REF1", lotId: old.id, quantity: 3150, unit: "KG", collectedAt: "2026-09-28T05:00:00.000Z", measurementMethod: "Pont-bascule", ...SIM }, admin);
  await createSlaughterBatch({ code: "AB-2026-REF1", sourceLotId: old.id, sourceCollectionId: pickup.id, quantityIn: 3150, quantityOut: 2140, losses: 1010, slaughteredAt: "2026-09-28T10:00:00.000Z", measurementMethod: "Registre d'abattage", ...SIM }, admin);
  await transitionLotStatus(old.id, "ABATTU", admin, "Poules de réforme abattues (AB-2026-REF1)", "2026-09-28T10:00:00.000Z");

  // --- Poulet fermier: chicks of June 2026 through the growing centre to two partner farms ---------
  const breederFlock = (await repositories.parentFlocks.findByCode("PF-2025-02"))!;
  const fermier = await hatch(admin, { flockId: breederFlock.id, hatcheryId: hatchery.id, storageId: hatchery.id, suffix: "2026-22", collectedAt: "2026-06-01T07:00:00.000Z", setAt: "2026-06-03T08:00:00.000Z", candledAt: "2026-06-13T08:00:00.000Z", hatchedAt: "2026-06-24T04:00:00.000Z", eggs: 5200, set: 5000, clears: 400, unhatched: 350, culls: 50 });
  const fermierChicks = await createChickLot({ code: "PSC-2026-22A", hatchCycleId: fermier.cycle.id, quantity: 4200, grade: "A", dispatchedAt: "2026-06-24T05:00:00.000Z", ...SIM }, admin);
  const toGrowingFermier = await dispatchTransfer({ objectType: "CHICK_LOT", objectId: fermierChicks.id, destinationBuildingId: growing.id, destinationLotCode: "CRO-2026-CF1", destinationLineCode: "CHAIR_FERMIER", phaseOnArrival: "CROISSANCE", quantity: 4200, sentAt: "2026-06-24T05:30:00.000Z", documentRef: "BL-C-2026-0644", crates: 42, signerName: coop.name }, coop.session);
  await receiveTransfer({ transferId: toGrowingFermier.id, quantityReceived: 4188, deadOnArrival: 12, receivedAt: "2026-06-24T09:00:00.000Z", signerName: producer.name }, producer.session);
  const growingFermier = (await repositories.lots.findByCode("CRO-2026-CF1"))!;
  const toOuazzani = await dispatchTransfer({ objectType: "LOT", objectId: growingFermier.id, destinationBuildingId: ouazzani.buildingId, destinationLotCode: "OUA-2026-CF1", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: 2000, sentAt: "2026-08-05T05:30:00.000Z", documentRef: "BL-P-2026-0412", transporter: "Transports Gharb", vehicle: "30914-A-7", crates: 50, signerName: producer.name }, producer.session);
  await receiveTransfer({ transferId: toOuazzani.id, quantityReceived: 1994, deadOnArrival: 2, receivedAt: "2026-08-05T09:45:00.000Z", discrepancyReason: "Quatre sujets de moins que le bon de livraison — caisse 31 incomplète", signerName: salma.name }, salma.session);
  await disputeTransfer({ transferId: toOuazzani.id, reason: "Le transporteur affirme avoir chargé 50 caisses pleines : comptage contesté, vidéo du quai demandée" }, salma.session);

  // Field app (document 3, ch. 05): three days of entries from two phones on the Ouazzani farm,
  // sent in one batch when the network came back. The farmer and her farm hand counted the same
  // day's dead differently: both declarations are kept and the day waits for a manager.
  const hamid = await partnerAccount("aide.ouazzani@biovolailles.demo", "Hamid Ouazzani", ouazzani.producerId);
  const ouazzaniLot = (await repositories.lots.findByCode("OUA-2026-CF1"))!;
  const fieldPhone = (who: { session: Session }, deviceId: string) => {
    let seq = 0;
    return (kind: FieldKind, capturedAt: string, payload: Record<string, unknown>) => ({ opId: randomUUID(), deviceId, seq: ++seq, authorId: who.session.userId, kind, lotId: ouazzaniLot.id, transferId: null, capturedAt, payload });
  };
  const salmaPhone = fieldPhone(salma, "tel-demo-salma-ouazzani");
  const hamidPhone = fieldPhone(hamid, "tel-demo-hamid-ouazzani");
  await syncFieldOps(
    {
      ops: [
        salmaPhone("MORTALITE", "2026-10-25T07:20:00.000Z", { count: 3, cause: "Inconnue" }),
        salmaPhone("PESEE", "2026-10-25T08:05:00.000Z", { averageWeightKg: 1.64, sampleCount: 40 }),
        salmaPhone("ALIMENT", "2026-10-25T08:30:00.000Z", { quantityKg: 205, feedType: "Finition" }),
        salmaPhone("EAU", "2026-10-25T18:00:00.000Z", { quantityL: 655 }),
        salmaPhone("MORTALITE", "2026-10-26T07:15:00.000Z", { count: 2 }),
        salmaPhone("ALIMENT", "2026-10-26T08:20:00.000Z", { quantityKg: 210, feedType: "Finition" }),
        salmaPhone("EAU", "2026-10-26T18:05:00.000Z", { quantityL: 672 }),
        salmaPhone("MORTALITE", "2026-10-27T07:10:00.000Z", { count: 4, cause: "Chaleur" }),
      ],
    },
    salma.session
  );
  await syncFieldOps(
    {
      ops: [
        hamidPhone("MORTALITE", "2026-10-27T09:40:00.000Z", { count: 6, cause: "Chaleur" }),
        hamidPhone("PESEE", "2026-10-27T10:10:00.000Z", { averageWeightKg: 17.2, sampleCount: 30 }),
        hamidPhone("PESEE", "2026-10-27T10:12:00.000Z", { averageWeightKg: 1.72, sampleCount: 30 }),
      ],
    },
    hamid.session
  );
  const toCherkaoui = await dispatchTransfer({ objectType: "LOT", objectId: growingFermier.id, destinationBuildingId: cherkaoui.buildingId, destinationLotCode: "CHE-2026-CF1", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: growingFermier.currentPopulation - 2000, sentAt: "2026-08-05T06:15:00.000Z", documentRef: "BL-P-2026-0413", transporter: "Transports Gharb", vehicle: "30914-A-7", crates: 55, signerName: producer.name }, producer.session);
  await receiveTransfer({ transferId: toCherkaoui.id, quantityReceived: growingFermier.currentPopulation - 2000, deadOnArrival: 0, receivedAt: "2026-08-05T11:30:00.000Z", signerName: karim.name }, karim.session);

  // A fermier lot that should have gone to slaughter by now: the plan flags it as overdue.
  const late = await createLot({ code: "OUA-2026-CF0", buildingId: ouazzani.buildingId, species: "Poulet", breed: "Poulet fermier", initialPopulation: 1800, plannedStartAt: "2026-04-03", dataStatus: "SIMULATION", productionLine: "CHAIR_FERMIER", hatchedAt: "2026-02-20T00:00:00.000Z" }, salma.session);
  await transitionLotStatus(late.id, "CREE", salma.session);
  await transitionLotStatus(late.id, "ACTIF", salma.session, "Mise en place", "2026-04-03T08:00:00.000Z");
  await startLotPhase({ lotId: late.id, phase: "ELEVAGE_PARTENAIRE", startedAt: "2026-04-03T08:00:00.000Z" }, salma.session);
  await recordVaccination(late.id, { vaccine: "Avinew", disease: "Newcastle", route: "EAU_DE_BOISSON", batchNumber: "L2604A", headcount: 1800, administeredAt: "2026-04-05T07:00:00.000Z" }, salma.session);
  await recordTreatment(late.id, { product: "Toltrazuril 2,5 %", activeSubstance: "Toltrazuril", indication: "Coccidiose", prescriptionRef: "ORD-2026-0410", prescriber: "Dr Hicham Alaoui", route: "EAU_DE_BOISSON", dose: "7 mg/kg/j", startedAt: "2026-05-12T07:00:00.000Z", durationDays: 2, withdrawalMeatDays: 14, headcount: 1770 }, salma.session);
  await recordObservation(late.id, { status: "SURVEILLANCE", signs: "Boiteries sur quelques sujets âgés, litière humide près des abreuvoirs", affectedCount: 25, observedAt: "2026-10-20T09:00:00.000Z" }, salma.session);

  // --- Hatching eggs counted on both sides, and chicks of this week still on the road ----------------
  const recent = await createEggLot({ code: "OAC-2026-0920", parentFlockId: breederFlock.id, collectedAt: "2026-09-20T07:00:00.000Z", quantity: 6500, storageBuildingId: breederStore.id, ...SIM }, admin);
  const eggMove = await dispatchTransfer({ objectType: "EGG_LOT", objectId: recent.id, destinationBuildingId: hatchery.id, quantity: 6500, sentAt: "2026-09-21T06:00:00.000Z", documentRef: "BL-O-2026-0920", crates: 18, signerName: coop.name }, coop.session);
  await receiveTransfer({ transferId: eggMove.id, quantityReceived: 6480, deadOnArrival: 20, receivedAt: "2026-09-21T08:00:00.000Z", signerName: adminName }, admin);
  const cycle = await createHatchCycle({ code: "INC-2026-38", buildingId: hatchery.id, incubatorRef: "Incubateur 4", setAt: "2026-09-22T08:00:00.000Z", allocations: [{ eggLotId: recent.id, quantity: 6400 }], ...SIM }, admin);
  await recordCandling({ cycleId: cycle.id, candledAt: "2026-10-02T08:00:00.000Z", clearsRemoved: 510 }, admin);
  await recordHatch({ cycleId: cycle.id, hatchedAt: "2026-10-13T04:00:00.000Z", chicksHatched: 5440, unhatched: 450, culls: 40 }, admin);
  const newChicks = await createChickLot({ code: "PSC-2026-38A", hatchCycleId: cycle.id, quantity: 3000, grade: "A", dispatchedAt: "2026-10-13T05:00:00.000Z", ...SIM }, admin);
  await dispatchTransfer({ objectType: "CHICK_LOT", objectId: newChicks.id, destinationBuildingId: growing.id, destinationLotCode: "CRO-2026-CF2", destinationLineCode: "CHAIR_FERMIER", phaseOnArrival: "CROISSANCE", quantity: 3000, sentAt: "2026-10-18T05:00:00.000Z", documentRef: "BL-C-2026-1018", transporter: "Couvoir Al Baraka — camion climatisé", crates: 30, signerName: coop.name }, coop.session);
}
