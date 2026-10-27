import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { validateProcessingYield, validateTransferQuantity } from "../../domain/production/quantity-integrity";
import type { SlaughterBatch } from "../../domain/production/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { getLotOrThrow } from "../production/lot";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "./relations";

/**
 * Structured Slaughter Batch (phase-7 brief §6) — "a traceability MVP, not a complex
 * abattoir management system": quantityIn/Out/losses only, no yield-grade breakdown. All
 * three quantities share one unit (kg live/carcass weight) so `validateProcessingYield`
 * (Phase 3, reused) can check `quantityOut + losses = quantityIn` exactly.
 */
export const createSlaughterBatchInputSchema = z.object({
  code: z.string().trim().min(3).max(50),
  sourceLotId: z.string().min(1),
  /** Optional — when the batch was collected first, this records the more specific graph edge (SLAUGHTER_BATCH -ABATTU_DEPUIS-> COLLECTION) instead of pointing straight at the lot. */
  sourceCollectionId: z.string().trim().min(1).optional().nullable(),
  quantityIn: z.number().positive(),
  quantityOut: z.number().nonnegative(),
  losses: z.number().nonnegative(),
  slaughteredAt: z.string().trim().min(1),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  measurementMethod: z.string().trim().min(1).max(200).optional().nullable(),
  documentId: z.string().trim().min(1).optional().nullable(),
});
export type CreateSlaughterBatchInput = z.infer<typeof createSlaughterBatchInputSchema>;

export async function createSlaughterBatch(input: unknown, session: Session): Promise<SlaughterBatch> {
  if (!can(session, "CREATE", "EVENTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer un lot d'abattage.");
  }
  const parsed = createSlaughterBatchInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const lot = await getLotOrThrow(data.sourceLotId);
  assertInScope(session, await resolveLotHierarchy(data.sourceLotId));

  await assertNotOnHold("LOT", lot.id);
  if (data.sourceCollectionId) await assertNotOnHold("COLLECTION", data.sourceCollectionId);
  // Layers and breeders leave for slaughter as spent hens (handwritten flow: "24 à 30 mois ⇒ abattoir").
  if (lot.purpose === "PONTE" || lot.purpose === "REPRODUCTION") {
    const phase = await repositories.lotPhases.current(lot.id);
    if (phase && phase.phase !== "REFORME") {
      throw new ValidationError("Des pondeuses ou des reproducteurs passent d'abord en réforme : enregistrez la phase « Réforme » avant l'abattage.");
    }
  }

  const existingCode = await repositories.slaughterBatches.findByCode(data.code);
  if (existingCode) throw new ConflictError(`Le code de lot d'abattage "${data.code}" est déjà utilisé.`);

  let sourceCollection = null;
  if (data.sourceCollectionId) {
    sourceCollection = await repositories.collections.findById(data.sourceCollectionId);
    if (!sourceCollection) throw new NotFoundError("COLLECTION", data.sourceCollectionId);
    if (sourceCollection.lotId !== lot.id) {
      throw new ValidationError("La collecte indiquée ne provient pas de ce lot.");
    }
  }

  // Available input = what was actually collected (if a collection mediated this batch) or the lot's own population otherwise.
  const available = sourceCollection ? sourceCollection.quantity : lot.currentPopulation;
  const availabilityCheck = validateTransferQuantity(available, data.quantityIn);
  if (!availabilityCheck.ok) throw new ValidationError(availabilityCheck.error);

  const yieldCheck = validateProcessingYield(data.quantityIn, data.quantityOut, data.losses, 0);
  if (!yieldCheck.ok) throw new ValidationError(yieldCheck.error);

  const batch = await repositories.slaughterBatches.create({
    code: data.code,
    sourceLotId: lot.id,
    quantityIn: data.quantityIn,
    quantityOut: data.quantityOut,
    losses: data.losses,
    slaughteredAt: data.slaughteredAt,
    sourceType: data.sourceType,
    sourceId: null,
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: data.measurementMethod ?? null,
    deviceId: null,
    documentId: data.documentId ?? null,
    validationStatus: null,
  });

  await createRelation({
    fromType: "SLAUGHTER_BATCH",
    fromId: batch.id,
    relationType: "ABATTU_DEPUIS",
    toType: sourceCollection ? "COLLECTION" : "LOT",
    toId: sourceCollection ? sourceCollection.id : lot.id,
    actorId: session.userId,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "slaughter_batch",
    entityId: batch.id,
    field: null,
    oldValue: null,
    newValue: `${data.quantityIn} → ${data.quantityOut} (pertes ${data.losses})`,
    reason: "Enregistrement d'un lot d'abattage",
    relatedLotId: lot.id,
    relatedEventId: null,
  });

  return batch;
}
