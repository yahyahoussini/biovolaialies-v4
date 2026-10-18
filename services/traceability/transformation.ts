import { z } from "zod";
import { repositories } from "../../data/repositories";
import { validateProcessingYield, validateTransferQuantity } from "../../domain/production/quantity-integrity";
import type { TransformationBatch } from "../../domain/production/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "./relations";

/**
 * Structured Transformation Batch (phase-7 brief §7) — `input = output + losses + rejects`,
 * validated with the Phase-3 `validateProcessingYield` (reused, not a second engine).
 * `upstreamType`/`upstreamId` is polymorphic (a slaughter batch, or another transformation
 * batch for a second processing step) — matches ARCHITECTURE.md's schema exactly.
 */
export const createTransformationBatchInputSchema = z.object({
  code: z.string().trim().min(3).max(50),
  upstreamType: z.enum(["SLAUGHTER_BATCH", "TRANSFORMATION_BATCH"]),
  upstreamId: z.string().min(1),
  processType: z.string().trim().min(1).max(100),
  inputQuantity: z.number().positive(),
  outputQuantity: z.number().nonnegative(),
  losses: z.number().nonnegative(),
  rejects: z.number().nonnegative().default(0),
  occurredAt: z.string().trim().min(1),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  measurementMethod: z.string().trim().min(1).max(200).optional().nullable(),
  documentId: z.string().trim().min(1).optional().nullable(),
});
export type CreateTransformationBatchInput = z.infer<typeof createTransformationBatchInputSchema>;

export async function createTransformationBatch(input: unknown, session: Session): Promise<TransformationBatch> {
  if (!can(session, "CREATE", "EVENTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer un lot de transformation.");
  }
  const parsed = createTransformationBatchInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  await assertNotOnHold(data.upstreamType, data.upstreamId);

  const existingCode = await repositories.transformationBatches.findByCode(data.code);
  if (existingCode) throw new ConflictError(`Le code de lot de transformation "${data.code}" est déjà utilisé.`);

  let upstreamOutput: number;
  let scopeLotId: string | null = null;
  if (data.upstreamType === "SLAUGHTER_BATCH") {
    const upstream = await repositories.slaughterBatches.findById(data.upstreamId);
    if (!upstream) throw new NotFoundError("SLAUGHTER_BATCH", data.upstreamId);
    upstreamOutput = upstream.quantityOut;
    scopeLotId = upstream.sourceLotId;
  } else {
    const upstream = await repositories.transformationBatches.findById(data.upstreamId);
    if (!upstream) throw new NotFoundError("TRANSFORMATION_BATCH", data.upstreamId);
    upstreamOutput = upstream.outputQuantity;
  }

  if (scopeLotId) {
    assertInScope(session, await resolveLotHierarchy(scopeLotId));
  }

  const alreadyUsed = (await repositories.transformationBatches.listByUpstream(data.upstreamType, data.upstreamId)).reduce(
    (sum, batch) => sum + batch.inputQuantity,
    0
  );
  const available = upstreamOutput - alreadyUsed;
  const availabilityCheck = validateTransferQuantity(available, data.inputQuantity);
  if (!availabilityCheck.ok) throw new ValidationError(availabilityCheck.error);

  const yieldCheck = validateProcessingYield(data.inputQuantity, data.outputQuantity, data.losses, data.rejects);
  if (!yieldCheck.ok) throw new ValidationError(yieldCheck.error);

  const batch = await repositories.transformationBatches.create({
    code: data.code,
    upstreamType: data.upstreamType,
    upstreamId: data.upstreamId,
    processType: data.processType,
    inputQuantity: data.inputQuantity,
    outputQuantity: data.outputQuantity,
    losses: data.losses,
    rejects: data.rejects,
    occurredAt: data.occurredAt,
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
    fromType: "TRANSFORMATION_BATCH",
    fromId: batch.id,
    relationType: "TRANSFORME_DEPUIS",
    toType: data.upstreamType,
    toId: data.upstreamId,
    actorId: session.userId,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "transformation_batch",
    entityId: batch.id,
    field: null,
    oldValue: null,
    newValue: `${data.inputQuantity} → ${data.outputQuantity} (pertes ${data.losses}, rejets ${data.rejects})`,
    reason: "Enregistrement d'un lot de transformation",
    relatedLotId: scopeLotId,
    relatedEventId: null,
  });

  return batch;
}
