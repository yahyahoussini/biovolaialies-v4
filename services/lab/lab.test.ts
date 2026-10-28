import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { createTestSession } from "../production/test-support";
import { recordObservation } from "../sanitary/health";
import { createSample, getLabSample, labRecordForLot, listLabSamples, markSampleSent, recordResults, reviewResult } from "./lab";

async function world(suffix: string) {
  const vet = await createTestSession("VETERINARIAN", "GLOBAL", null, `lab-vet-${suffix}`);
  const org = await repositories.organizations.create({ name: `Labo ${suffix}`, type: "INTERNAL" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "Fès-Meknès" });
  const mine = await repositories.producers.create({ cooperativeId: coop.id, name: `Éleveur ${suffix}`, contactPhone: null, contactEmail: null });
  const theirs = await repositories.producers.create({ cooperativeId: coop.id, name: `Voisin ${suffix}`, contactPhone: null, contactEmail: null });
  const farm = await repositories.farms.create({ producerId: mine.id, name: `Ferme ${suffix}`, city: "Meknès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const otherFarm = await repositories.farms.create({ producerId: theirs.id, name: `Ferme voisine ${suffix}`, city: "Fès", region: "Fès-Meknès", geoLat: null, geoLng: null });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `LB-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const otherBuilding = await repositories.buildings.create({ farmId: otherFarm.id, code: `LV-${suffix}`, name: "Poulailler", capacity: 5000, zoneType: "ELEVAGE" });
  const lotOf = (buildingId: string, code: string) =>
    repositories.lots.create({ buildingId, code, species: "Poule", breed: "Beldi", status: "ACTIF", initialPopulation: 1000, currentPopulation: 1000, plannedStartAt: null, startedAt: "2026-05-01T00:00:00Z", endedAt: null, dataStatus: "REEL", productionLine: null, purpose: "PONTE", hatchedAt: "2026-01-01T00:00:00Z" });
  const lot = await lotOf(building.id, `LAB-L-${suffix}`);
  const otherLot = await lotOf(otherBuilding.id, `LAB-V-${suffix}`);
  const farmer = await createTestSession("PRODUCER", "PRODUCER", mine.id, `lab-farmer-${suffix}`);
  const neighbour = await createTestSession("PRODUCER", "PRODUCER", theirs.id, `lab-neighbour-${suffix}`);
  const technician = await createTestSession("TECHNICIAN", "FARM", farm.id, `lab-tech-${suffix}`);
  return { vet, farmer, neighbour, technician, lot, otherLot, building };
}

const sampleOn = (lotId: string, extra: Record<string, unknown> = {}) => ({ objectType: "LOT", objectId: lotId, matrix: "ECOUVILLON", reason: "SUSPICION", sampledAt: "2026-10-13T09:30:00.000Z", sampleCount: 10, laboratory: "Laboratoire d'analyses vétérinaires (test)", ...extra });

describe("laboratory", () => {
  it("follows a sample from the farm to the laboratory and back, results kept as written", async () => {
    const w = await world("cycle");
    const sample = await createSample(sampleOn(w.lot.id), w.technician);
    expect(sample).toMatchObject({ status: "PRELEVE", code: expect.stringMatching(/^LAB-2026-\d{4}$/) });
    expect(await repositories.bvuIds.findByObject("SAMPLE", sample.id)).not.toBeNull();
    await expect(markSampleSent({ sampleId: sample.id, sentAt: "2026-10-12T10:00:00.000Z" }, w.technician)).rejects.toThrow(/précéder/);
    await markSampleSent({ sampleId: sample.id, sentAt: "2026-10-13T14:00:00.000Z" }, w.technician);
    // The technician takes samples; recording what the laboratory found is not his.
    await expect(recordResults({ sampleId: sample.id, complete: true, results: [] }, w.technician)).rejects.toThrow(/vétérinaire ou au responsable qualité/);
    const recorded = await recordResults(
      {
        sampleId: sample.id,
        complete: true,
        results: [
          { analyte: "Mycoplasma gallisepticum", method: "PCR", value: "Détecté", interpretation: "POSITIF", resultAt: "2026-10-16T11:00:00.000Z", reportRef: "RA-2026-1187" },
          { analyte: "Mycoplasma synoviae", method: "PCR", value: "Non détecté", interpretation: "NEGATIF", resultAt: "2026-10-16T11:00:00.000Z", reportRef: "RA-2026-1187" },
        ],
      },
      w.vet
    );
    expect(recorded).toMatchObject({ sample: { status: "RESULTAT" }, toReview: 1 });
    const positive = recorded.results.find((r) => r.interpretation === "POSITIF")!;
    await expect(reviewResult({ resultId: positive.id, note: "vu" }, w.vet)).rejects.toThrow(/découle/);
    await reviewResult({ resultId: positive.id, note: "Mycoplasmose confirmée : traitement maintenu, œufs retirés jusqu'à la fin du délai d'attente" }, w.vet);
    await expect(reviewResult({ resultId: positive.id, note: "Deuxième lecture du même résultat" }, w.vet)).rejects.toThrow(/déjà été examiné/);
    const detail = await getLabSample(sample.id, w.farmer);
    expect(detail).toMatchObject({ toReview: 0, adverse: 1, can: { record: false, review: false } });
  });

  it("refuses a result dated before the sample, and an observation from another lot", async () => {
    const w = await world("rules");
    const sample = await createSample(sampleOn(w.lot.id), w.vet);
    await expect(recordResults({ sampleId: sample.id, complete: false, results: [{ analyte: "Salmonella spp.", value: "Non détectée", interpretation: "NEGATIF", resultAt: "2026-10-01T00:00:00.000Z" }] }, w.vet)).rejects.toThrow(/précéder/);
    const elsewhere = await recordObservation(w.otherLot.id, { status: "SURVEILLANCE", signs: "Plumes ébouriffées sur quelques sujets", observedAt: "2026-10-12T08:00:00.000Z" }, w.vet);
    await expect(createSample(sampleOn(w.lot.id, { observationId: elsewhere.observation.id }), w.vet)).rejects.toThrow(/autre lot/);
  });

  it("shows a farm's samples to that farm only, even when asked by their id", async () => {
    const w = await world("scope");
    const mine = await createSample(sampleOn(w.lot.id), w.vet);
    const theirs = await createSample(sampleOn(w.otherLot.id), w.vet);
    const water = await createSample({ ...sampleOn(w.building.id), objectType: "BUILDING", matrix: "EAU", reason: "AUTOCONTROLE" }, w.vet);
    const seen = (await listLabSamples(w.farmer)).map((s) => s.id);
    expect(seen).toEqual(expect.arrayContaining([mine.id, water.id]));
    expect(seen).not.toContain(theirs.id);
    await expect(getLabSample(theirs.id, w.farmer)).rejects.toThrow(/périmètre/);
    await expect(createSample(sampleOn(w.otherLot.id), w.technician)).rejects.toThrow(/périmètre/);
    expect((await labRecordForLot(w.lot.id, w.farmer)).map((s) => s.id)).toEqual([mine.id]);
    expect((await listLabSamples(w.neighbour)).map((s) => s.id)).toEqual([theirs.id]);
  });
});
