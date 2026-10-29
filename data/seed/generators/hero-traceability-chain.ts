import { repositories } from "../../repositories";
import { transitionLotStatus } from "../../../services/production/lot-lifecycle";
import { createCollection } from "../../../services/traceability/collection";
import { createDestination } from "../../../services/traceability/destination";
import { createProduct } from "../../../services/traceability/product";
import { createSlaughterBatch } from "../../../services/traceability/slaughter";
import { createTransformationBatch } from "../../../services/traceability/transformation";
import type { Session } from "../../../services/auth/session";

/**
 * The Phase-7 hero scenario (brief §17): BU-2026-001 → COL-2026-001 → AB-2026-001 →
 * TR-2026-001 → BVU-PROD-2026-001 → DEST-2026-001. Every quantity below is a clean integer
 * so the exact-equality checks in domain/production/quantity-integrity.ts (reused, not
 * re-implemented) pass with no floating-point surprises. This is the natural conclusion of
 * the lot's own lifecycle (ACTIF → ABATTU → TRANSFORME → CLOTURE via the existing,
 * validated transition table) — not a status fabricated for the demo. Each change is dated when
 * it happens in the scenario (16 August), not when the seed runs.
 */
export async function seedHeroTraceabilityChain(
  heroLotId: string,
  adminSession: Session
): Promise<{ productId: string }> {
  // One more real weight measurement — the lot's growth curve continued to its slaughter
  // weight. Dated the day AFTER the Phase-6 hero anomaly's last weighing (2026-08-15 /
  // 1.18kg) and, critically, in the past: the data-quality engine rejects a future-dated
  // pesée, so a chain dated ahead of "now" would leave the hero lot permanently failing its
  // own quality check. 1.12 → 1.15kg is one day of the depressed late-cycle gain this lot is
  // flagged for — deliberately below the Ross 308 standard of ~1.40kg at day 26, which is
  // what the PERFORMANCE_DECLINE anomaly on this lot is about.
  await repositories.weightMeasurements.create({
    lotId: heroLotId,
    occurredAt: "2026-08-16T05:00:00.000Z",
    averageWeight: 1.15,
    unit: "KG",
    sampleCount: 50,
    sourceType: "SIMULATEUR",
    dataStatus: "SIMULATION",
    sourceId: null,
    actorId: null,
    measurementMethod: "Pesée manuelle — échantillon de 50 sujets",
    deviceId: null,
    documentId: null,
    validationStatus: null,
  });

  await transitionLotStatus(heroLotId, "ABATTU", adminSession, "Fin de cycle — départ vers abattage.", "2026-08-16T10:00:00.000Z");

  // Quantity is tracked in kg of live weight from the collection onward (11920 sujets × 1.15kg
  // = 13708) — one consistent unit through Collection → Slaughter → Transformation, so
  // validateTransferQuantity/validateProcessingYield (Phase 3, reused) compare like with like
  // instead of birds vs. kg. Every stage is dated in the past, in strict order, so the
  // chronology and quality checks pass on real grounds rather than by exemption.
  const collection = await createCollection(
    {
      code: "COL-2026-001",
      lotId: heroLotId,
      quantity: 13708,
      unit: "KG",
      collectedAt: "2026-08-16T07:00:00.000Z",
      dataStatus: "SIMULATION",
      sourceType: "MANUEL",
      measurementMethod: "Comptage et pesée à l'enlèvement (11 920 sujets)",
    },
    adminSession
  );

  // 70% carcass yield: 9596 + 4112 = 13708 exactly, so validateProcessingYield's
  // exact-equality check passes without floating-point slack.
  const slaughterBatch = await createSlaughterBatch(
    {
      code: "AB-2026-001",
      sourceLotId: heroLotId,
      sourceCollectionId: collection.id,
      quantityIn: 13708,
      quantityOut: 9596,
      losses: 4112,
      slaughteredAt: "2026-08-16T10:00:00.000Z",
      dataStatus: "SIMULATION",
      sourceType: "MANUEL",
      measurementMethod: "Registre d'abattage",
    },
    adminSession
  );

  await transitionLotStatus(heroLotId, "TRANSFORME", adminSession, "Lot transformé après abattage.", "2026-08-16T14:00:00.000Z");

  // 90% output / 10% rejects: 8636 + 0 + 960 = 9596 exactly.
  const transformationBatch = await createTransformationBatch(
    {
      code: "TR-2026-001",
      upstreamType: "SLAUGHTER_BATCH",
      upstreamId: slaughterBatch.id,
      processType: "Découpe et conditionnement",
      inputQuantity: 9596,
      outputQuantity: 8636,
      losses: 0,
      rejects: 960,
      occurredAt: "2026-08-16T14:00:00.000Z",
      dataStatus: "SIMULATION",
      sourceType: "MANUEL",
      measurementMethod: "Bon de production",
    },
    adminSession
  );

  const destination = await createDestination(
    { code: "DEST-2026-001", name: "Marché Central Kénitra", type: "MARCHE", city: "Kénitra" },
    adminSession
  );

  const product = await createProduct(
    {
      code: "BVU-PROD-2026-001",
      name: "Poulet découpé — Ross 308",
      category: "Volaille fraîche découpée",
      transformationBatchId: transformationBatch.id,
      packagingDate: "2026-08-16T16:00:00.000Z",
      quantity: 8636,
      unit: "kg",
      destinationId: destination.id,
      dataStatus: "SIMULATION",
      sourceType: "MANUEL",
      measurementMethod: "Étiquette de conditionnement",
    },
    adminSession
  );

  await transitionLotStatus(heroLotId, "CLOTURE", adminSession, "Cycle complet — traçabilité aval enregistrée.", "2026-08-16T16:30:00.000Z");

  return { productId: product.id };
}
