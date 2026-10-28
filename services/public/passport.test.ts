import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import type { LotStatus } from "../../domain/shared/enums";
import { createLot } from "../production/lot";
import { createTestSession } from "../production/test-support";
import { createCollection } from "../traceability/collection";
import { createProduct } from "../traceability/product";
import { createLotQrToken, createProductQrToken, revokeQrToken } from "../traceability/qr-tokens";
import { createSlaughterBatch } from "../traceability/slaughter";
import { createTransformationBatch } from "../traceability/transformation";
import { openHold } from "../quality/holds";
import { resolvePublicPassport } from "./passport";

type TestSession = Awaited<ReturnType<typeof createTestSession>>;

const PRIVATE_FARM_LAT = 34.261;
const PRIVATE_FARM_LNG = -6.5802;

async function seedLot(suffix: string, session: TestSession) {
  const org = await repositories.organizations.create({ name: `Org ${suffix}`, type: "COOPERATIVE" });
  const coop = await repositories.cooperatives.create({ organizationId: org.id, name: `Coop ${suffix}`, region: "R" });
  const producer = await repositories.producers.create({
    cooperativeId: coop.id,
    name: `Producer ${suffix}`,
    contactPhone: "+212600000000",
    contactEmail: `contact.${suffix}@private.local`,
  });
  const farm = await repositories.farms.create({
    producerId: producer.id,
    name: `Ferme ${suffix}`,
    city: "Kénitra",
    region: "R",
    geoLat: PRIVATE_FARM_LAT,
    geoLng: PRIVATE_FARM_LNG,
  });
  const building = await repositories.buildings.create({ farmId: farm.id, code: `BAT-${suffix}`, name: "Building", capacity: 5000, zoneType: "ELEVAGE" });
  const lot = await createLot(
    { code: `LOT-${suffix}`, buildingId: building.id, species: "Poulet", breed: "Ross 308", initialPopulation: 1000, plannedStartAt: null, dataStatus: "SIMULATION" },
    session
  );
  return { org, coop, producer, farm, building, lot };
}

async function seedChain(suffix: string, lotId: string, session: TestSession) {
  await repositories.weightMeasurements.create({
    lotId,
    occurredAt: "2026-08-01T00:00:00.000Z",
    averageWeight: 2,
    unit: "KG",
    sampleCount: 10,
    sourceType: "MANUEL",
    dataStatus: "SIMULATION",
    sourceId: null,
    actorId: null,
    measurementMethod: "Pesée",
    deviceId: null,
    documentId: null,
    validationStatus: null,
  });
  const collection = await createCollection(
    { code: `COL-${suffix}`, lotId, quantity: 1000, unit: "KG", collectedAt: "2026-08-02T00:00:00.000Z", dataStatus: "SIMULATION", sourceType: "MANUEL", measurementMethod: "Pesée" },
    session
  );
  const slaughter = await createSlaughterBatch(
    { code: `AB-${suffix}`, sourceLotId: lotId, sourceCollectionId: collection.id, quantityIn: 1000, quantityOut: 700, losses: 300, slaughteredAt: "2026-08-03T00:00:00.000Z", dataStatus: "SIMULATION", sourceType: "MANUEL", measurementMethod: "Registre" },
    session
  );
  const transformation = await createTransformationBatch(
    { code: `TR-${suffix}`, upstreamType: "SLAUGHTER_BATCH", upstreamId: slaughter.id, processType: "Découpe", inputQuantity: 700, outputQuantity: 600, losses: 100, rejects: 0, occurredAt: "2026-08-04T00:00:00.000Z", dataStatus: "SIMULATION", sourceType: "MANUEL", measurementMethod: "Bon" },
    session
  );
  const product = await createProduct(
    { code: `PRD-${suffix}`, name: "Poulet découpé", category: "Frais", transformationBatchId: transformation.id, packagingDate: "2026-08-05T00:00:00.000Z", dataStatus: "SIMULATION", sourceType: "MANUEL", measurementMethod: "Étiquette" },
    session
  );
  return { collection, slaughter, transformation, product };
}

/** Forces a lot into a target status without walking the whole transition table — this suite is about what the PUBLIC sees per status, not about the lifecycle rules (already covered in lot-lifecycle.test.ts). */
async function forceStatus(lotId: string, status: LotStatus) {
  await repositories.lots.updateStatus(lotId, status, {});
}

describe("resolvePublicPassport — token validity", () => {
  it("resolves a valid, active LOT token", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP1");
    const { lot, farm } = await seedLot("PP1", admin);
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport).not.toBeNull();
    expect(passport!.scope).toBe("LOT");
    expect(passport!.lotCode).toBe(lot.code);
    expect(passport!.originFarmName).toBe(farm.name);
    expect(passport!.originCity).toBe("Kénitra");
  });

  it("returns null for a token that never existed", async () => {
    expect(await resolvePublicPassport("totally-made-up-token-value-here")).toBeNull();
  });

  it("returns null for empty / too-short input", async () => {
    expect(await resolvePublicPassport("")).toBeNull();
    expect(await resolvePublicPassport("abc")).toBeNull();
  });

  it("returns null for a revoked token", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP2");
    const { lot } = await seedLot("PP2", admin);
    const token = await createLotQrToken(lot.id, admin);

    expect(await resolvePublicPassport(token.token)).not.toBeNull();
    await revokeQrToken(token.id, admin);
    expect(await resolvePublicPassport(token.token)).toBeNull();
  });

  it("returns null for an expired token, but resolves one whose expiry is still in the future", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP3");
    const { lot } = await seedLot("PP3", admin);

    const expired = await createLotQrToken(lot.id, admin, "2020-01-01T00:00:00.000Z");
    expect(await resolvePublicPassport(expired.token)).toBeNull();

    const future = await createLotQrToken(lot.id, admin, new Date(Date.now() + 86_400_000).toISOString());
    expect(await resolvePublicPassport(future.token)).not.toBeNull();
  });
});

describe("resolvePublicPassport — public/private separation", () => {
  it("never exposes internal UUIDs or private fields anywhere in the serialized DTO", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP4");
    const { org, coop, producer, farm, building, lot } = await seedLot("PP4", admin);
    const { collection, slaughter, transformation, product } = await seedChain("PP4", lot.id, admin);
    const token = await createProductQrToken(product.id, lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    const serialized = JSON.stringify(passport);

    // Not one internal id may appear — not the lot's, not the farm's, not the token row's,
    // and not any downstream stage's. This is the check that would catch a future refactor
    // accidentally spreading a raw entity into the DTO.
    for (const id of [
      org.id,
      coop.id,
      producer.id,
      farm.id,
      building.id,
      lot.id,
      collection.id,
      slaughter.id,
      transformation.id,
      product.id,
      token.id,
      admin.userId,
    ]) {
      expect(serialized).not.toContain(id);
    }

    // Private business data that exists on the underlying rows but must never surface.
    expect(serialized).not.toContain(String(PRIVATE_FARM_LAT));
    expect(serialized).not.toContain(String(PRIVATE_FARM_LNG));
    expect(serialized).not.toContain(producer.contactEmail!);
    expect(serialized).not.toContain(producer.contactPhone!);
    expect(serialized).not.toContain(building.code);
    expect(serialized).not.toContain("1000"); // initial population / collected quantity
    expect(serialized).not.toContain("Registre"); // internal measurementMethod
    expect(serialized.toLowerCase()).not.toContain("geolat");
    expect(serialized.toLowerCase()).not.toContain("actorid");
    expect(serialized.toLowerCase()).not.toContain("sourcetype");
  });

  it("exposes exactly the approved top-level keys and nothing more", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP5");
    const { lot } = await seedLot("PP5", admin);
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(Object.keys(passport!).sort()).toEqual(
      [
        "bvuId",
        "certifications",
        "geneticOrigin",
        "isDemoData",
        "qualityHold",
        "lineage",
        "originCity",
        "originFarmName",
        "lotCode",
        "period",
        "publicProductCode",
        "publicStatus",
        "productName",
        "scope",
        "timeline",
        "verified",
      ].sort()
    );
  });
});

describe("resolvePublicPassport — status logic", () => {
  it("never marks an ACTIF lot as verified", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP6");
    const { lot } = await seedLot("PP6", admin);
    await forceStatus(lot.id, "ACTIF");
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport!.verified).toBe(false);
    expect(passport!.publicStatus).toBe("En cours de production");
  });

  it("marks a LIBERE lot as verified", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP7");
    const { lot } = await seedLot("PP7", admin);
    await forceStatus(lot.id, "LIBERE");
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport!.verified).toBe(true);
  });

  it("a BLOQUE lot is never presented as released or verified", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP8");
    const { lot } = await seedLot("PP8", admin);
    await forceStatus(lot.id, "BLOQUE");
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport!.verified).toBe(false);
    expect(passport!.publicStatus).toContain("non vérifié");
  });

  it("a SUSPENDU lot clearly indicates a restricted state", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP9");
    const { lot } = await seedLot("PP9", admin);
    await forceStatus(lot.id, "SUSPENDU");
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport!.verified).toBe(false);
    expect(passport!.publicStatus.toLowerCase()).toContain("suspendu");
  });

  it("a product whose origin lot has since been BLOQUE stops reading as verified", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP10");
    const { lot } = await seedLot("PP10", admin);
    const { product } = await seedChain("PP10", lot.id, admin);
    const token = await createProductQrToken(product.id, lot.id, admin);

    await forceStatus(lot.id, "BLOQUE");
    const passport = await resolvePublicPassport(token.token);
    expect(passport!.verified).toBe(false);
    expect(passport!.publicStatus).toContain("Restreint");
  });
});

describe("resolvePublicPassport — product passport, lineage and data status", () => {
  it("builds the simplified public lineage from the real chain, without the internal graph", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP11");
    const { lot, farm } = await seedLot("PP11", admin);
    const { product } = await seedChain("PP11", lot.id, admin);
    const token = await createProductQrToken(product.id, lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    expect(passport!.productName).toBe("Poulet découpé");
    expect(passport!.publicProductCode).toBe("PRD-PP11");
    // What the consumer reads is our identifier, with its check digit — not the internal product code.
    expect(passport!.bvuId).toMatch(/^BVU-PRO-[0-9A-F]{14}$/);
    expect(passport!.lineage.map((s) => s.name)).toEqual([
      `${farm.name}, Kénitra`,
      lot.code,
      "Collecte",
      "Abattage",
      "Transformation",
      "Poulet découpé",
    ]);
  });

  it("builds a public timeline that starts at Origine and ends at the current status", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP12");
    const { lot } = await seedLot("PP12", admin);
    await seedChain("PP12", lot.id, admin);
    const token = await createLotQrToken(lot.id, admin);

    const passport = await resolvePublicPassport(token.token);
    const labels = passport!.timeline.map((e) => e.label);
    expect(labels[0]).toBe("Origine");
    expect(labels[labels.length - 1]).toBe("Statut actuel");
    expect(labels).toContain("Collecte");
    expect(labels).toContain("Abattage");
    expect(labels).toContain("Transformation");
    expect(labels).toContain("Conditionnement");
  });

  it("flags SIMULATION data as demo, and does not flag REEL data", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP13");
    const { lot } = await seedLot("PP13", admin);
    const simulated = await createLotQrToken(lot.id, admin);
    expect((await resolvePublicPassport(simulated.token))!.isDemoData).toBe(true);

    const { lot: realLot } = await seedLot("PP14", admin);
    await repositories.lots.update(realLot.id, { dataStatus: "REEL" });
    const real = await createLotQrToken(realLot.id, admin);
    expect((await resolvePublicPassport(real.token))!.isDemoData).toBe(false);
  });

  it("never fabricates certifications (no certification module exists in this MVP)", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP15");
    const { lot } = await seedLot("PP15", admin);
    const token = await createLotQrToken(lot.id, admin);
    expect((await resolvePublicPassport(token.token))!.certifications).toEqual([]);
  });

  it("is strictly read-only — resolving a passport mutates nothing (phase-9 brief §16)", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PP16");
    const { lot } = await seedLot("PP16", admin);
    await seedChain("PP16", lot.id, admin);
    const token = await createLotQrToken(lot.id, admin);

    const auditBefore = (await repositories.auditLog.list(5000)).length;
    const lotBefore = JSON.stringify(await repositories.lots.findById(lot.id));
    const tokenBefore = JSON.stringify(await repositories.qrTokens.findById(token.id));

    await resolvePublicPassport(token.token);
    await resolvePublicPassport(token.token);

    expect((await repositories.auditLog.list(5000)).length).toBe(auditBefore);
    expect(JSON.stringify(await repositories.lots.findById(lot.id))).toBe(lotBefore);
    expect(JSON.stringify(await repositories.qrTokens.findById(token.id))).toBe(tokenBefore);
  });

  it("never reads as verified while a quality hold covers the product", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "PPHOLD");
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "PPHOLDQ");
    const { lot } = await seedLot("PPHOLD", admin);
    const { product } = await seedChain("PPHOLD", lot.id, admin);
    const token = await createProductQrToken(product.id, lot.id, admin);

    await openHold({ rootType: "PRODUCT", rootId: product.id, reason: "RECLAMATION_CLIENT", description: "Réclamation client sur l'odeur", scope: "OBJET_SEUL", evidence: "REC-1" }, quality);
    const passport = await resolvePublicPassport(token.token);
    expect(passport!.qualityHold).toBe(true);
    expect(passport!.verified).toBe(false);
    expect(passport!.publicStatus).toMatch(/contrôle qualité/);
  });
});
