import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { checkDigit, isValidBvuId, newBvuId, parseBvuId } from "../../domain/identity/bvu-id";
import { normalizePersonName, receptionOutcome, signatureMatches, tableEggCountError } from "../../domain/production/flow";
import { checkPhaseStart, DEFAULT_LINES, dueAction, months, planError, weeks } from "../../domain/production/lines";
import { createChickLot, createEggLot, createHatchCycle, importParentStock, recordCandling, recordHatch } from "../hatchery/hatchery";
import { resolveIdentifier } from "../identity/bvu-ids";
import { computeLotDataQuality } from "../quality/lot-quality";
import { createSlaughterBatch } from "../traceability/slaughter";
import { ensureDefaultLines } from "./lines";
import { getLotFlow, lotsDueForAction, startLotPhase } from "./phases";
import { changeSubjectStatus, recordSubjectEvent, registerSubjects, releaseSubjectRfid } from "./subjects";
import { createTableEggLot } from "./table-eggs";
import { createTestSession } from "./test-support";
import { cancelTransfer, dispatchTransfer, disputeTransfer, receiveTransfer } from "./transfers";

const SIM = { dataStatus: "SIMULATION" as const, sourceType: "MANUEL" as const };
const line = (code: string) => DEFAULT_LINES.find((l) => l.code === code)!;

describe("BIOVOLAILLES identifier", () => {
  it("carries a check digit that refuses a wrong digit and a swap of neighbours", () => {
    const id = newBvuId("SUBJECT");
    expect(id).toMatch(/^BVU-IND-[0-9A-F]{14}$/);
    expect(isValidBvuId(id)).toBe(true);
    const digits = id.slice(8);
    const oneWrong = `BVU-IND-${digits.slice(0, 5)}${((parseInt(digits[5], 16) + 1) % 16).toString(16).toUpperCase()}${digits.slice(6)}`;
    expect(isValidBvuId(oneWrong)).toBe(false);
    expect(checkDigit("0123456789ABC")).toHaveLength(1);
    const swapped = "BVU-IND-" + "1023456789ABC" + checkDigit("0123456789ABC");
    expect(isValidBvuId(swapped)).toBe(false);
    expect(parseBvuId("bvu-ind-" + digits.toLowerCase())?.valid).toBe(true);
    expect(parseBvuId("LOT-123")).toBeNull();
  });
});

describe("lines and phase plans (handwritten flow)", () => {
  it("judges a phase start against the line's age windows, without refusing it", () => {
    const breeders = line("REPRO_CHAIR");
    expect(checkPhaseStart(breeders, "DEMARRAGE_CAGE", 1)).toBe("CONFORME");
    expect(checkPhaseStart(breeders, "ELEVAGE_SOL", weeks(6))).toBe("CONFORME");
    expect(checkPhaseStart(breeders, "ELEVAGE_SOL", 20)).toBe("AVANT_PLAN");
    expect(checkPhaseStart(breeders, "ELEVAGE_SOL", 70)).toBe("APRES_PLAN");
    expect(checkPhaseStart(breeders, "PRODUCTION_OAC", months(7))).toBe("CONFORME");
    expect(checkPhaseStart(breeders, "PONTE", 300)).toBe("HORS_PLAN");
    expect(checkPhaseStart(null, "PONTE", 300)).toBe("SANS_PLAN");
    expect(checkPhaseStart(line("PONDEUSE_BLANC"), "REFORME", months(26))).toBe("CONFORME");
    expect(checkPhaseStart(line("CHAIR_FERMIER"), "REFORME", 200)).toBe("HORS_PLAN");
  });

  it("says what is due next — next phase, then slaughter or reform — and by how much it is late", () => {
    const fermier = line("CHAIR_FERMIER");
    expect(dueAction(fermier, "CROISSANCE", 20)).toBeNull();
    expect(dueAction(fermier, "CROISSANCE", 42)?.kind).toBe("PHASE_SUIVANTE");
    expect(dueAction(fermier, "ELEVAGE_PARTENAIRE", 150)).toBeNull();
    const exit = dueAction(fermier, "ELEVAGE_PARTENAIRE", 230)!;
    expect(exit.kind).toBe("SORTIE");
    expect(exit.overdueDays).toBe(230 - months(7) - 7);
    expect(dueAction(line("PONDEUSE_PISTACHE"), "PONTE", months(25))?.label).toMatch(/Réforme/);
  });

  it("refuses an incoherent plan", () => {
    expect(planError(line("REPRO_PONTE").phasePlan, null, months(30))).toBeNull();
    expect(planError([{ phase: "CROISSANCE", endsBetween: [50, 40] }, { phase: "PONTE", endsBetween: null }], null, null)).toMatch(/inversée/);
    expect(planError([{ phase: "CROISSANCE", endsBetween: null }, { phase: "PONTE", endsBetween: null }], null, null)).toMatch(/fenêtre de fin/);
    expect(planError([{ phase: "CROISSANCE", endsBetween: [42, 42] }, { phase: "PONTE", endsBetween: null }], 10, 30)).toMatch(/avant la fin/);
  });

  it("keeps both counts of a movement and names the gap", () => {
    expect(receptionOutcome(1000, 995, 5)).toEqual({ discrepancy: 0, status: "RECU_CONFORME" });
    expect(receptionOutcome(1000, 990, 4)).toEqual({ discrepancy: 6, status: "RECU_AVEC_ECART" });
    expect(receptionOutcome(1000, 1003, 0).discrepancy).toBe(-3);
    expect(signatureMatches("  youssef  el-amrani ", "Youssef El Amrani")).toBe(true);
    expect(signatureMatches("Hélène", "Helene")).toBe(true);
    expect(signatureMatches("Y. El Amrani", "Youssef El Amrani")).toBe(false);
    expect(normalizePersonName("Été  Ça")).toBe("ete ca");
    expect(tableEggCountError({ quantity: 100, saleable: 90, cracked: 5, dirty: 3, small: 2 })).toBeNull();
    expect(tableEggCountError({ quantity: 100, saleable: 90, cracked: 5, dirty: 3, small: 1 })).toMatch(/classé une fois/);
  });
});

async function world(suffix: string) {
  await ensureDefaultLines();
  const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, `flow-admin-${suffix}`);
  const org = await repositories.organizations.create({ name: `BV ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `BV Union ${suffix}`, region: "Fès-Meknès" });
  const producer = await repositories.producers.create({ cooperativeId: coop.id, name: `Biovolailles ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: producer.id, name: `Site BV ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const cages = await repositories.buildings.create({ farmId: farm.id, code: `CAG-${suffix}`, name: "Cages", capacity: 6000, zoneType: "ELEVAGE" });
  const floor = await repositories.buildings.create({ farmId: farm.id, code: `SOL-${suffix}`, name: "Sol", capacity: 6000, zoneType: "ELEVAGE" });
  const hatchery = await repositories.buildings.create({ farmId: farm.id, code: `COU-${suffix}`, name: "Couvoir", capacity: 50000, zoneType: "COUVOIR" });
  const growing = await repositories.buildings.create({ farmId: farm.id, code: `CRO-${suffix}`, name: "Croissance", capacity: 10000, zoneType: "ELEVAGE" });

  const partnerOrg = await repositories.organizations.create({ name: `Partenaire ${suffix}`, type: "COOPERATIVE" });
  const partnerCoop = await repositories.cooperatives.create({ organizationId: partnerOrg.id, name: `Coop Saïss ${suffix}`, region: "Fès-Meknès" });
  const partnerProducer = await repositories.producers.create({ cooperativeId: partnerCoop.id, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const partnerFarm = await repositories.farms.create({ producerId: partnerProducer.id, name: `Ferme partenaire ${suffix}`, city: "El Hajeb", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const partnerBuilding = await repositories.buildings.create({ farmId: partnerFarm.id, code: `PAR-${suffix}`, name: "Poulailler", capacity: 3000, zoneType: "ELEVAGE" });
  const partner = await createTestSession("PRODUCER", "PRODUCER", partnerProducer.id, `flow-partner-${suffix}`);
  const partnerUser = (await repositories.users.findById(partner.userId))!;
  const adminUser = (await repositories.users.findById(admin.userId))!;
  return { admin, adminName: adminUser.fullName, partner, partnerName: partnerUser.fullName, cages, floor, hatchery, growing, partnerBuilding, coop };
}

describe("production flow services", () => {
  it("imports day-old parent stock into its first phase, with our identifier and the supplier's code as an alias", async () => {
    const w = await world("imp");
    const flock = await importParentStock(
      { code: "REP-IMP-01", buildingId: w.cages.id, strain: "Hubbard JA57", geneticSupplier: "Hubbard", originCountry: "France", importReference: "DUM-2026-118", placedAt: "2026-01-12", hatchedAt: "2026-01-11", femaleCount: 4500, maleCount: 500, lineCode: "REPRO_CHAIR", supplierFlockCode: "HB-77812", ...SIM },
      w.admin
    );
    expect(flock.lotId).toBeTruthy();
    const lot = (await repositories.lots.findById(flock.lotId!))!;
    expect(lot).toMatchObject({ purpose: "REPRODUCTION", productionLine: "REPRO_CHAIR", initialPopulation: 5000, status: "ACTIF" });
    const view = await getLotFlow(lot.id, w.admin, "2026-02-01T00:00:00Z");
    expect(view.current?.phase).toBe("DEMARRAGE_CAGE");
    expect(view.current?.planCheck).toBe("CONFORME");
    expect(view.nextPhases).toEqual(["ELEVAGE_SOL", "PRODUCTION_OAC", "REFORME"]);

    const [byAlias] = await resolveIdentifier("HB-77812");
    expect(byAlias).toMatchObject({ objectType: "PARENT_FLOCK", objectId: flock.id, via: "ALIAS" });
    const [byBvu] = await resolveIdentifier(byAlias.bvuId!.toLowerCase());
    expect(byBvu.objectId).toBe(flock.id);
    await expect(resolveIdentifier(byAlias.bvuId!.slice(0, -1) + (byAlias.bvuId!.endsWith("0") ? "1" : "0"))).rejects.toThrow(/chiffre de contrôle/);

    // No hatching eggs from a flock still in rearing.
    await expect(createEggLot({ code: "OAC-IMP-0", parentFlockId: flock.id, collectedAt: "2026-03-01", quantity: 100, ...SIM }, w.admin)).rejects.toThrow(/pas en production/);

    // Cages → floor on another building of the same farm at 6 weeks; then laying at 7 months.
    const floorPhase = await startLotPhase({ lotId: lot.id, phase: "ELEVAGE_SOL", startedAt: "2026-02-22", buildingId: w.floor.id }, w.admin);
    expect(floorPhase.planCheck).toBe("CONFORME");
    expect((await repositories.lots.findById(lot.id))?.buildingId).toBe(w.floor.id);
    await expect(startLotPhase({ lotId: lot.id, phase: "DEMARRAGE_CAGE", startedAt: "2026-03-01" }, w.admin)).rejects.toThrow(/en arrière/);
    await expect(startLotPhase({ lotId: lot.id, phase: "PONTE", startedAt: "2026-03-01" }, w.admin)).rejects.toThrow(/ne prévoit pas/);
    await expect(startLotPhase({ lotId: lot.id, phase: "PRODUCTION_OAC", startedAt: "2026-04-01", buildingId: w.partnerBuilding.id }, w.admin)).rejects.toThrow(/transfert/);
    const laying = await startLotPhase({ lotId: lot.id, phase: "PRODUCTION_OAC", startedAt: "2026-08-12" }, w.admin);
    expect(laying.planCheck).toBe("CONFORME");
    const eggs = await createEggLot({ code: "OAC-IMP-1", parentFlockId: flock.id, collectedAt: "2026-08-20", quantity: 3000, ...SIM }, w.admin);
    expect(eggs.quantity).toBe(3000);
    const phases = await repositories.lotPhases.listByLot(lot.id);
    expect(phases.filter((p) => p.endedAt === null)).toHaveLength(1);
  });

  it("moves birds with two counts and two signatures, keeps the gap, and creates the partner's own lot", async () => {
    const w = await world("mov");
    const flock = await importParentStock({ code: "REP-MOV-01", buildingId: w.cages.id, strain: "Hubbard", geneticSupplier: "Hubbard", originCountry: "France", placedAt: "2026-01-05", hatchedAt: "2026-01-05", femaleCount: 900, maleCount: 100, lineCode: "REPRO_CHAIR", ...SIM }, w.admin);
    await startLotPhase({ lotId: flock.lotId!, phase: "ELEVAGE_SOL", startedAt: "2026-02-16" }, w.admin);
    await startLotPhase({ lotId: flock.lotId!, phase: "PRODUCTION_OAC", startedAt: "2026-08-05" }, w.admin);
    const eggLot = await createEggLot({ code: "OAC-MOV-1", parentFlockId: flock.id, collectedAt: "2026-08-10", quantity: 2000, storageBuildingId: w.cages.id, ...SIM }, w.admin);

    // Hatching eggs travel to the hatchery: counted out, counted in.
    const eggMove = await dispatchTransfer({ objectType: "EGG_LOT", objectId: eggLot.id, destinationBuildingId: w.hatchery.id, quantity: 2000, sentAt: "2026-08-11", signerName: w.adminName }, w.admin);
    await expect(createHatchCycle({ code: "INC-MOV-0", buildingId: w.hatchery.id, incubatorRef: "INC-1", setAt: "2026-08-12", allocations: [{ eggLotId: eggLot.id, quantity: 100 }], ...SIM }, w.admin)).rejects.toThrow(/en transit/);
    const hatcheryClerk = await createTestSession("FARM_MANAGER", "COOPERATIVE", w.coop.id, "flow-clerk-mov");
    const clerkName = (await repositories.users.findById(hatcheryClerk.userId))!.fullName;
    await receiveTransfer({ transferId: eggMove.id, quantityReceived: 1990, deadOnArrival: 10, receivedAt: "2026-08-11T16:00:00Z", signerName: clerkName }, { ...hatcheryClerk, role: "COOP_MANAGER" });
    expect((await repositories.eggLots.findById(eggLot.id))?.storageBuildingId).toBe(w.hatchery.id);
    await expect(createHatchCycle({ code: "INC-MOV-X", buildingId: w.hatchery.id, incubatorRef: "INC-1", setAt: "2026-08-12", allocations: [{ eggLotId: eggLot.id, quantity: 1995 }], ...SIM }, w.admin)).rejects.toThrow();
    const cycle = await createHatchCycle({ code: "INC-MOV-1", buildingId: w.hatchery.id, incubatorRef: "INC-1", setAt: "2026-08-12", allocations: [{ eggLotId: eggLot.id, quantity: 1990 }], ...SIM }, w.admin);
    await recordCandling({ cycleId: cycle.id, candledAt: "2026-08-30", clearsRemoved: 190 }, w.admin);
    await recordHatch({ cycleId: cycle.id, hatchedAt: "2026-09-02", chicksHatched: 1650, unhatched: 150, culls: 20 }, w.admin);
    const chicks = await createChickLot({ code: "PSS-MOV-1", hatchCycleId: cycle.id, quantity: 1600, grade: "A", dispatchedAt: "2026-09-02", ...SIM }, w.admin);

    // Day-old chicks to the growing farm: the line must be named, the receiver must be someone else.
    await expect(dispatchTransfer({ objectType: "CHICK_LOT", objectId: chicks.id, destinationBuildingId: w.growing.id, destinationLotCode: "CRO-MOV-1", phaseOnArrival: "CROISSANCE", quantity: 1600, sentAt: "2026-09-02", signerName: w.adminName }, w.admin)).rejects.toThrow(/ligne/);
    await expect(dispatchTransfer({ objectType: "CHICK_LOT", objectId: chicks.id, destinationBuildingId: w.growing.id, destinationLotCode: "CRO-MOV-1", destinationLineCode: "CHAIR_FERMIER", phaseOnArrival: "CROISSANCE", quantity: 1600, sentAt: "2026-09-02", signerName: "Quelqu'un d'autre" }, w.admin)).rejects.toThrow(/nom complet/);
    await expect(dispatchTransfer({ objectType: "CHICK_LOT", objectId: chicks.id, destinationBuildingId: w.growing.id, destinationLotCode: "CRO-MOV-1", destinationLineCode: "CHAIR_FERMIER", phaseOnArrival: "CROISSANCE", quantity: 1601, sentAt: "2026-09-02", signerName: w.adminName }, w.admin)).rejects.toThrow(/disponible/);
    const chickMove = await dispatchTransfer({ objectType: "CHICK_LOT", objectId: chicks.id, destinationBuildingId: w.growing.id, destinationLotCode: "CRO-MOV-1", destinationLineCode: "CHAIR_FERMIER", phaseOnArrival: "CROISSANCE", quantity: 1600, sentAt: "2026-09-02", documentRef: "BL-4471", transporter: "Transports Atlas", signerName: w.adminName }, w.admin);
    await expect(receiveTransfer({ transferId: chickMove.id, quantityReceived: 1600, deadOnArrival: 0, receivedAt: "2026-09-02T14:00:00Z", signerName: w.adminName }, w.admin)).rejects.toThrow(/contradictoire/);
    const received = await receiveTransfer({ transferId: chickMove.id, quantityReceived: 1592, deadOnArrival: 8, receivedAt: "2026-09-02T14:00:00Z", signerName: clerkName }, hatcheryClerk);
    expect(received.status).toBe("RECU_CONFORME");
    const growingLot = (await repositories.lots.findByCode("CRO-MOV-1"))!;
    expect(growingLot).toMatchObject({ initialPopulation: 1592, productionLine: "CHAIR_FERMIER", purpose: "CHAIR", hatchedAt: "2026-09-02T00:00:00.000Z" });
    expect((await repositories.lotPhases.current(growingLot.id))?.phase).toBe("CROISSANCE");
    expect((await repositories.relations.listFrom("LOT", growingLot.id)).some((r) => r.toType === "CHICK_LOT" && r.toId === chicks.id)).toBe(true);

    // At 6 weeks, part of the lot goes to a partner farm of another cooperative.
    const toPartner = await dispatchTransfer({ objectType: "LOT", objectId: growingLot.id, destinationBuildingId: w.partnerBuilding.id, destinationLotCode: "PAR-MOV-1", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: 1000, sentAt: "2026-10-14", signerName: clerkName }, hatcheryClerk);
    expect((await repositories.lots.findById(growingLot.id))?.currentPopulation).toBe(592);
    await expect(receiveTransfer({ transferId: toPartner.id, quantityReceived: 990, deadOnArrival: 4, receivedAt: "2026-10-14T15:00:00Z", signerName: w.partnerName }, w.partner)).rejects.toThrow(/Expliquez l'écart/);
    const partnerReceipt = await receiveTransfer({ transferId: toPartner.id, quantityReceived: 990, deadOnArrival: 4, receivedAt: "2026-10-14T15:00:00Z", discrepancyReason: "Six caisses comptées à 94 au lieu de 95", signerName: w.partnerName }, w.partner);
    expect(partnerReceipt).toMatchObject({ status: "RECU_AVEC_ECART", discrepancy: 6, receiverName: w.partnerName });
    expect(partnerReceipt.senderSignature).not.toBe(partnerReceipt.receiverSignature);
    const partnerLot = (await repositories.lots.findByCode("PAR-MOV-1"))!;
    expect(partnerLot).toMatchObject({ initialPopulation: 990, buildingId: w.partnerBuilding.id, productionLine: "CHAIR_FERMIER" });
    const ledger = await repositories.ledger.listByObject("TRANSFER", toPartner.id);
    expect(ledger.map((e) => e.eventType)).toEqual(expect.arrayContaining(["TRANSFER_DISPATCHED", "TRANSFER_RECEIVED"]));
    await expect(receiveTransfer({ transferId: toPartner.id, quantityReceived: 990, deadOnArrival: 4, receivedAt: "2026-10-14T15:00:00Z", discrepancyReason: "Deuxième réception", signerName: w.partnerName }, w.partner)).rejects.toThrow(/plus à réceptionner/);
    const disputed = await disputeTransfer({ transferId: toPartner.id, reason: "Le transporteur conteste le comptage des caisses" }, w.partner);
    expect(disputed.status).toBe("LITIGE");

    // The rest leaves too: the growing lot ends once its last birds are received.
    const rest = await dispatchTransfer({ objectType: "LOT", objectId: growingLot.id, destinationBuildingId: w.partnerBuilding.id, destinationLotCode: "PAR-MOV-2", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: 592, sentAt: "2026-10-15", signerName: clerkName }, hatcheryClerk);
    expect((await repositories.lots.findById(growingLot.id))?.status).toBe("EN_TRANSFERT");
    const cancelled = await cancelTransfer({ transferId: rest.id, reason: "Camion en panne, départ reporté" }, hatcheryClerk);
    expect(cancelled.status).toBe("ANNULE");
    expect(await repositories.lots.findById(growingLot.id)).toMatchObject({ status: "ACTIF", currentPopulation: 592 });
    const again = await dispatchTransfer({ objectType: "LOT", objectId: growingLot.id, destinationBuildingId: w.partnerBuilding.id, destinationLotCode: "PAR-MOV-2", phaseOnArrival: "ELEVAGE_PARTENAIRE", quantity: 592, sentAt: "2026-10-16", signerName: clerkName }, hatcheryClerk);
    await receiveTransfer({ transferId: again.id, quantityReceived: 592, deadOnArrival: 0, receivedAt: "2026-10-16T12:00:00Z", signerName: w.partnerName }, w.partner);
    expect(await repositories.lots.findById(growingLot.id)).toMatchObject({ status: "CLOTURE", currentPopulation: 0 });

    // Birds that left by transfer are accounted for: neither lot looks like it lost them.
    for (const id of [growingLot.id, partnerLot.id]) {
      expect((await computeLotDataQuality(id)).populationReconciliation.consistent).toBe(true);
    }

    // The partner sees its own lots and the transfers it took part in, nothing upstream of them.
    await expect(getLotFlow(growingLot.id, w.partner)).rejects.toThrow(/périmètre/);
    expect((await getLotFlow(partnerLot.id, w.partner, "2026-10-17T00:00:00Z")).current?.phase).toBe("ELEVAGE_PARTENAIRE");
  });

  it("collects table eggs only from laying hens, graded once, and sends spent hens to slaughter through reform", async () => {
    const w = await world("egg");
    const pullets = await repositories.lots.create({ buildingId: w.growing.id, code: "PON-EGG-1", species: "Poulet", breed: "Lohmann", status: "ACTIF", initialPopulation: 2000, currentPopulation: 2000, plannedStartAt: null, startedAt: "2024-03-01T00:00:00Z", endedAt: null, dataStatus: "SIMULATION", productionLine: "PONDEUSE_PISTACHE", purpose: "PONTE", hatchedAt: "2024-03-01T00:00:00Z" });
    await startLotPhase({ lotId: pullets.id, phase: "CROISSANCE", startedAt: "2024-03-01" }, w.admin);
    await expect(createTableEggLot({ code: "OEC-EGG-0", lotId: pullets.id, collectedOn: "2024-09-01", quantity: 10, saleable: 10, cracked: 0, dirty: 0, small: 0, ...SIM }, w.admin)).rejects.toThrow(/phase de ponte/);
    await startLotPhase({ lotId: pullets.id, phase: "ELEVAGE_PARTENAIRE", startedAt: "2024-04-12" }, w.admin);
    const ponte = await startLotPhase({ lotId: pullets.id, phase: "PONTE", startedAt: "2024-09-01" }, w.admin);
    expect(ponte.planCheck).toBe("CONFORME");
    const eggs = await createTableEggLot({ code: "OEC-EGG-1", lotId: pullets.id, collectedOn: "2025-01-10", quantity: 1820, saleable: 1700, cracked: 40, dirty: 50, small: 30, ...SIM }, w.admin);
    expect(eggs.eggType).toBe("PISTACHE");
    await expect(createTableEggLot({ code: "OEC-EGG-2", lotId: pullets.id, collectedOn: "2025-01-10T16:00:00Z", quantity: 10, saleable: 10, cracked: 0, dirty: 0, small: 0, ...SIM }, w.admin)).rejects.toThrow(/déjà enregistrée/);
    await expect(createTableEggLot({ code: "OEC-EGG-3", lotId: pullets.id, collectedOn: "2025-01-11", eggType: "BLANC", quantity: 10, saleable: 10, cracked: 0, dirty: 0, small: 0, ...SIM }, w.admin)).rejects.toThrow(/pistache/);
    await expect(createTableEggLot({ code: "OEC-EGG-4", lotId: pullets.id, collectedOn: "2025-01-12", quantity: 10, saleable: 9, cracked: 0, dirty: 0, small: 0, ...SIM }, w.admin)).rejects.toThrow(/classé une fois/);

    const due = await lotsDueForAction(w.admin, "2026-06-01T00:00:00Z");
    expect(due.find((d) => d.lot.id === pullets.id)?.due.kind).toBe("SORTIE");

    await expect(createSlaughterBatch({ code: "AB-EGG-1", sourceLotId: pullets.id, quantityIn: 1500, quantityOut: 1100, losses: 400, slaughteredAt: "2026-06-02", ...SIM }, w.admin)).rejects.toThrow(/réforme/);
    await startLotPhase({ lotId: pullets.id, phase: "REFORME", startedAt: "2026-06-01" }, w.admin);
    const spent = await createSlaughterBatch({ code: "AB-EGG-1", sourceLotId: pullets.id, quantityIn: 1500, quantityOut: 1100, losses: 400, slaughteredAt: "2026-06-02", ...SIM }, w.admin);
    expect(spent.sourceLotId).toBe(pullets.id);
  });

  it("identifies breeders one by one, refuses a reused ring or chip, and keeps a released chip in the bird's history", async () => {
    const w = await world("ind");
    const flock = await importParentStock({ code: "REP-IND-01", buildingId: w.cages.id, strain: "ISA", geneticSupplier: "Hendrix", originCountry: "Pays-Bas", placedAt: "2026-02-01", hatchedAt: "2026-02-01", femaleCount: 45, maleCount: 5, lineCode: "REPRO_PONTE", ...SIM }, w.admin);
    const lotId = flock.lotId!;
    const tagged = await registerSubjects({ lotId, taggedAt: "2026-02-02", dataStatus: "SIMULATION", subjects: [{ visualId: "b-0001", rfidUid: "e2 80 11 aa", sex: "FEMELLE" }, { visualId: "B-0002", sex: "MALE" }] }, w.admin);
    expect(tagged.map((s) => s.visualId)).toEqual(["B-0001", "B-0002"]);
    expect(tagged.every((s) => isValidBvuId(s.bvuId) && s.bvuId.startsWith("BVU-IND-"))).toBe(true);
    await expect(registerSubjects({ lotId, taggedAt: "2026-02-02", dataStatus: "SIMULATION", subjects: [{ visualId: "B-0001", sex: "FEMELLE" }] }, w.admin)).rejects.toThrow(/déjà portée/);
    await expect(registerSubjects({ lotId, taggedAt: "2026-02-02", dataStatus: "SIMULATION", subjects: [{ visualId: "B-0003", rfidUid: "E28011AA", sex: "FEMELLE" }] }, w.admin)).rejects.toThrow(/déjà attribuée/);
    await expect(registerSubjects({ lotId, taggedAt: "2026-02-02", dataStatus: "SIMULATION", subjects: Array.from({ length: 49 }, (_, i) => ({ visualId: `C-${i}`, sex: "FEMELLE" as const })) }, w.admin)).rejects.toThrow(/effectif/);

    const hen = tagged[0];
    await expect(recordSubjectEvent({ subjectId: hen.id, eventType: "PESEE", value: 1.9, occurredAt: "2026-03-01" }, w.admin)).rejects.toThrow(/donnée de lot/);
    const weighed = await recordSubjectEvent({ subjectId: hen.id, eventType: "PESEE", value: 1.9, occurredAt: "2026-03-01", attributionProof: "Puce lue à la station de pesée", deviceId: "SCALE-1" }, w.admin);
    expect(weighed.unit).toBe("KG");
    expect((await resolveIdentifier("E28011AA"))[0]).toMatchObject({ objectType: "SUBJECT", objectId: hen.id });

    await changeSubjectStatus({ subjectId: hen.id, status: "MORT", at: "2026-03-05", reason: "Trouvée morte" }, w.admin);
    await expect(changeSubjectStatus({ subjectId: hen.id, status: "ACTIF", at: "2026-03-06", reason: "Erreur" }, w.admin)).rejects.toThrow(/ne change plus/);
    await releaseSubjectRfid({ subjectId: hen.id, reason: "Puce récupérée sur un sujet mort" }, w.admin);
    const reused = await registerSubjects({ lotId, taggedAt: "2026-03-10", dataStatus: "SIMULATION", subjects: [{ visualId: "B-0003", rfidUid: "E28011AA", sex: "FEMELLE" }] }, w.admin);
    expect((await resolveIdentifier("E28011AA"))[0].objectId).toBe(reused[0].id);
    const history = await repositories.identifierAliases.listByBvuId(hen.bvuId);
    expect(history[0]).toMatchObject({ scheme: "RFID", value: "E28011AA" });
    expect(history[0].validTo).not.toBeNull();
  });
});
