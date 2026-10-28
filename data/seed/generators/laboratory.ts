import type { Session } from "../../../services/auth/session";
import { createSample, markSampleSent, recordResults, reviewResult } from "../../../services/lab/lab";
import { repositories } from "../../repositories";
import { DEMO_ACCOUNT_EMAIL } from "./hierarchy";

/**
 * The laboratory, through the real services: official and routine salmonella controls (negative),
 * the water of a laying house (conforming), the respiratory alert on the "Pistache" flock confirmed
 * as mycoplasmosis and read by the veterinarian, a table-egg control, and two carcasses from a
 * lame fermier flock still at the laboratory. Every sample is SIMULATION data.
 */

const SIM = { dataStatus: "SIMULATION" as const };
const LAB_MEKNES = "Laboratoire d'analyses vétérinaires — Meknès (démo)";
const LAB_KENITRA = "Laboratoire vétérinaire régional — Kénitra (démo)";

async function sessionFor(email: string): Promise<Session> {
  const user = await repositories.users.findByEmail(email);
  if (!user) throw new Error(`Utilisateur de démonstration absent : ${email}`);
  return { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: user.scopeId, isDemoSwitch: false };
}

async function lotId(code: string): Promise<string> {
  const lot = await repositories.lots.findByCode(code);
  if (!lot) throw new Error(`Lot de démonstration absent : ${code}`);
  return lot.id;
}

export async function seedLaboratory(): Promise<void> {
  const vet = await sessionFor(DEMO_ACCOUNT_EMAIL.VETERINARIAN);
  const quality = await sessionFor(DEMO_ACCOUNT_EMAIL.QUALITY_MANAGER);

  // Official salmonella control of the meat breeders, at the hatchery site.
  const breeders = await repositories.parentFlocks.findByCode("PF-2025-02");
  if (!breeders) throw new Error("Troupeau PF-2025-02 absent.");
  const official = await createSample({ objectType: "PARENT_FLOCK", objectId: breeders.id, matrix: "CHIFFONNETTES", reason: "CONTROLE_OFFICIEL", sampledAt: "2026-10-05T09:00:00.000Z", sampleCount: 5, laboratory: LAB_KENITRA, ...SIM }, vet);
  await markSampleSent({ sampleId: official.id, sentAt: "2026-10-05T15:00:00.000Z" }, vet);
  const officialResults = await recordResults(
    {
      sampleId: official.id,
      complete: true,
      results: [
        { analyte: "Salmonella Enteritidis", method: "ISO 6579-1", value: "Non détectée", interpretation: "NEGATIF", resultAt: "2026-10-09T10:00:00.000Z", reportRef: "RA-2026-1102" },
        { analyte: "Salmonella Typhimurium", method: "ISO 6579-1", value: "Non détectée", interpretation: "NEGATIF", resultAt: "2026-10-09T10:00:00.000Z", reportRef: "RA-2026-1102" },
      ],
    },
    vet,
    new Date("2026-10-09T11:00:00.000Z")
  );
  for (const r of officialResults.results) await reviewResult({ resultId: r.id, note: null }, vet, new Date("2026-10-09T12:00:00.000Z"));

  // Routine salmonella surveillance of the white layers, and the water of their house.
  const white = await lotId("FAS-2025-PB1");
  const routine = await createSample({ objectType: "LOT", objectId: white, matrix: "CHIFFONNETTES", reason: "SURVEILLANCE", sampledAt: "2026-10-06T08:00:00.000Z", sampleCount: 2, laboratory: LAB_MEKNES, ...SIM }, vet);
  await markSampleSent({ sampleId: routine.id, sentAt: "2026-10-06T13:00:00.000Z" }, vet);
  await recordResults({ sampleId: routine.id, complete: true, results: [{ analyte: "Salmonella spp.", method: "ISO 6579-1", value: "Non détectée", interpretation: "NEGATIF", resultAt: "2026-10-09T09:00:00.000Z", reportRef: "RA-2026-1104" }] }, vet, new Date("2026-10-09T09:30:00.000Z"));

  const whiteHouse = (await repositories.lots.findById(white))!.buildingId;
  const water = await createSample({ objectType: "BUILDING", objectId: whiteHouse, matrix: "EAU", reason: "AUTOCONTROLE", sampledAt: "2026-10-01T07:30:00.000Z", sampleCount: 1, laboratory: LAB_MEKNES, notes: "Robinet de fin de ligne d'abreuvement", ...SIM }, vet);
  await markSampleSent({ sampleId: water.id, sentAt: "2026-10-01T09:00:00.000Z" }, vet);
  await recordResults(
    {
      sampleId: water.id,
      complete: true,
      results: [
        { analyte: "Coliformes totaux", method: "NF EN ISO 9308-1", value: "0 UFC/100 mL", numericValue: 0, unit: "UFC/100 mL", interpretation: "CONFORME", resultAt: "2026-10-03T10:00:00.000Z", reportRef: "RE-2026-0381" },
        { analyte: "Escherichia coli", method: "NF EN ISO 9308-1", value: "0 UFC/100 mL", numericValue: 0, unit: "UFC/100 mL", interpretation: "CONFORME", resultAt: "2026-10-03T10:00:00.000Z", reportRef: "RE-2026-0381" },
        { analyte: "Entérocoques intestinaux", method: "NF EN ISO 7899-2", value: "0 UFC/100 mL", numericValue: 0, unit: "UFC/100 mL", interpretation: "CONFORME", resultAt: "2026-10-03T10:00:00.000Z", reportRef: "RE-2026-0381" },
      ],
    },
    vet,
    new Date("2026-10-03T11:00:00.000Z")
  );

  // The respiratory alert on the "Pistache" flock: swabs taken the same morning, mycoplasmosis confirmed.
  const pistache = await lotId("ELA-2025-PP1");
  const alarm = (await repositories.sanitaryObservations.listByLot(pistache)).find((o) => o.status === "ALERTE");
  const swabs = await createSample({ objectType: "LOT", objectId: pistache, matrix: "ECOUVILLON", reason: "SUSPICION", observationId: alarm?.id ?? null, sampledAt: "2026-10-13T09:30:00.000Z", sampleCount: 10, laboratory: LAB_MEKNES, notes: "Écouvillons trachéaux sur dix poules présentant des râles", ...SIM }, vet);
  await markSampleSent({ sampleId: swabs.id, sentAt: "2026-10-13T14:00:00.000Z" }, vet);
  const respiratory = await recordResults(
    {
      sampleId: swabs.id,
      complete: true,
      results: [
        { analyte: "Mycoplasma gallisepticum", method: "PCR", value: "Détecté", interpretation: "POSITIF", resultAt: "2026-10-16T11:00:00.000Z", reportRef: "RA-2026-1187" },
        { analyte: "Mycoplasma synoviae", method: "PCR", value: "Non détecté", interpretation: "NEGATIF", resultAt: "2026-10-16T11:00:00.000Z", reportRef: "RA-2026-1187" },
      ],
    },
    vet,
    new Date("2026-10-16T11:30:00.000Z")
  );
  const positive = respiratory.results.find((r) => r.interpretation === "POSITIF")!;
  await reviewResult(
    { resultId: positive.id, note: "Mycoplasmose à M. gallisepticum confirmée : traitement à l'oxytétracycline maintenu, œufs retirés de la vente jusqu'à la fin du délai d'attente, contrôle sérologique à J+30." },
    vet,
    new Date("2026-10-16T12:00:00.000Z")
  );

  // A product control on a day of white eggs, entered by the quality manager.
  const eggs = await repositories.tableEggLots.findByCode("OEB-20261015");
  if (eggs) {
    const control = await createSample({ objectType: "TABLE_EGG_LOT", objectId: eggs.id, matrix: "OEUFS", reason: "AUTOCONTROLE", sampledAt: "2026-10-16T08:00:00.000Z", sampleCount: 12, laboratory: LAB_MEKNES, ...SIM }, vet);
    await markSampleSent({ sampleId: control.id, sentAt: "2026-10-16T10:00:00.000Z" }, vet);
    await recordResults({ sampleId: control.id, complete: true, results: [{ analyte: "Salmonella spp. (coquille et contenu)", method: "ISO 6579-1", value: "Non détectée dans 25 g", interpretation: "NEGATIF", resultAt: "2026-10-20T09:00:00.000Z", reportRef: "RA-2026-1201" }] }, quality, new Date("2026-10-20T09:30:00.000Z"));
  }

  // Lameness on the overdue fermier flock: two carcasses sent, results not back yet.
  const fermier = await lotId("OUA-2026-CF0");
  const watch = (await repositories.sanitaryObservations.listByLot(fermier)).find((o) => o.status === "SURVEILLANCE");
  const carcasses = await createSample({ objectType: "LOT", objectId: fermier, matrix: "ORGANES", reason: "SUSPICION", observationId: watch?.id ?? null, sampledAt: "2026-10-21T09:00:00.000Z", sampleCount: 2, laboratory: LAB_MEKNES, notes: "Deux sujets boiteux euthanasiés : recherche bactériologique articulaire", ...SIM }, vet);
  await markSampleSent({ sampleId: carcasses.id, sentAt: "2026-10-21T11:00:00.000Z" }, vet);
}
