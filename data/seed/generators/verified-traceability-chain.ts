import { repositories } from "../../repositories";
import { createCollection } from "../../../services/traceability/collection";
import { createDestination } from "../../../services/traceability/destination";
import { createProduct } from "../../../services/traceability/product";
import { createSlaughterBatch } from "../../../services/traceability/slaughter";
import { createTransformationBatch } from "../../../services/traceability/transformation";
import type { Session } from "../../../services/auth/session";

export const VERIFIED_LOT_CODE = "BU-2025-010";

/**
 * The counterpart to seedHeroTraceabilityChain: a *validated* chain, so the demo can show both
 * halves of the public passport's verdict instead of only the cautious one.
 *
 * The hero lot BU-2026-001 is SIMULATION throughout and deliberately reads "Traçabilité non
 * vérifiée" (DEMO_RUNBOOK.md §8). That is the honest default, but on its own it leaves the
 * question "so what does a verified passport look like?" unanswered. BU-2025-010 answers it:
 * a cycle that closed in January 2026, whose downstream records were since confirmed, so every
 * record here carries dataStatus VALIDE and the product passport renders "Vérifié" with no
 * demo-data banner and every step green.
 *
 * Three constraints shaped this, and each is worth keeping if the numbers are ever edited:
 *
 * 1. No lifecycle transition. BU-2025-010 is seeded CLOTURE and stays CLOTURE. Re-seeding it
 *    as ACTIF so it could be walked through the lifecycle would put it in front of the rule
 *    engine as a live lot (seed-database.ts runs detection *before* this generator), which
 *    would change the documented anomaly/alert counts. A completed 2025 cycle acquiring its
 *    downstream records is also simply what happened.
 * 2. Every record sets measurementMethod. checkProvenance() in domain/quality/checks.ts warns
 *    on REEL/VALIDE data with no sourceId, documentId *or* measurementMethod — so validated
 *    records without a stated method would each add an integrity warning.
 * 3. Quantities are exact integers under the lot's own ceiling. resolveAvailableQuantity()
 *    caps a KG collection at currentPopulation × latest average weight = 10 680 × 2.28 =
 *    24 350.4 kg; 24 000 sits under it, and each stage's parts sum exactly so the
 *    equality checks in domain/production/quantity-integrity.ts pass without slack.
 *
 * Note this deliberately produces a verified *product* passport, not a verified *lot* one:
 * the lot passport only reads verified at status LIBERE, which ALLOWED_TRANSITIONS reaches
 * solely from BLOQUE — a released quality hold, not a completed cycle. A finished lot is
 * CLOTURE, and CLOTURE is not a verified state.
 */
export async function seedVerifiedTraceabilityChain(
  adminSession: Session
): Promise<{ lotId: string; productId: string }> {
  const lot = await repositories.lots.findByCode(VERIFIED_LOT_CODE);
  if (!lot) {
    throw new Error(`Seed error: expected lot ${VERIFIED_LOT_CODE} to exist before the verified chain is built.`);
  }

  // Dated just after the lot's own endedAt (2026-01-15T06:00) and strictly in order, so the
  // chronology checks pass on real grounds rather than by exemption.
  const collection = await createCollection(
    {
      code: "COL-2025-010",
      lotId: lot.id,
      quantity: 24000,
      unit: "KG",
      collectedAt: "2026-01-15T08:00:00.000Z",
      dataStatus: "VALIDE",
      sourceType: "MANUEL",
      measurementMethod: "Comptage et pesée à l'enlèvement — bon de collecte contresigné (10 680 sujets)",
    },
    adminSession
  );

  // 70% carcass yield: 16800 + 7200 = 24000 exactly.
  const slaughterBatch = await createSlaughterBatch(
    {
      code: "AB-2025-010",
      sourceLotId: lot.id,
      sourceCollectionId: collection.id,
      quantityIn: 24000,
      quantityOut: 16800,
      losses: 7200,
      slaughteredAt: "2026-01-15T11:00:00.000Z",
      dataStatus: "VALIDE",
      sourceType: "MANUEL",
      measurementMethod: "Registre d'abattage — pesée carcasses validée",
    },
    adminSession
  );

  // 90% output / 10% rejects: 15120 + 0 + 1680 = 16800 exactly.
  const transformationBatch = await createTransformationBatch(
    {
      code: "TR-2025-010",
      upstreamType: "SLAUGHTER_BATCH",
      upstreamId: slaughterBatch.id,
      processType: "Découpe et conditionnement",
      inputQuantity: 16800,
      outputQuantity: 15120,
      losses: 0,
      rejects: 1680,
      occurredAt: "2026-01-15T15:00:00.000Z",
      dataStatus: "VALIDE",
      sourceType: "MANUEL",
      measurementMethod: "Bon de production contrôlé",
    },
    adminSession
  );

  const destination = await createDestination(
    { code: "DEST-2025-010", name: "Grossiste Casablanca", type: "GROSSISTE", city: "Casablanca" },
    adminSession
  );

  const product = await createProduct(
    {
      code: "BVU-PROD-2025-010",
      name: "Poulet fermier — Ross 308",
      category: "Volaille fraîche découpée",
      transformationBatchId: transformationBatch.id,
      packagingDate: "2026-01-15T17:00:00.000Z",
      quantity: 15120,
      unit: "kg",
      destinationId: destination.id,
      dataStatus: "VALIDE",
      sourceType: "MANUEL",
      measurementMethod: "Étiquette de conditionnement — lot contrôlé et validé",
    },
    adminSession
  );

  return { lotId: lot.id, productId: product.id };
}
