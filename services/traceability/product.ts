import { z } from "zod";
import { repositories } from "../../data/repositories";
import type { Product } from "../../domain/traceability/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "./relations";

/**
 * Product (phase-7 brief §8-§9) — `transformationBatchId` is required (both by the DB's
 * NOT NULL FK and this schema): "a product without source must be rejected". `destinationId`
 * is optional; when set, a DESTINE_A relation is recorded alongside the structural pointer.
 */
export const createProductInputSchema = z.object({
  code: z.string().trim().min(3).max(50),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  transformationBatchId: z.string().min(1, "Un produit doit avoir une transformation source."),
  packagingDate: z.string().trim().min(1),
  expiryDate: z.string().trim().min(1).optional().nullable(),
  quantity: z.number().positive().optional().nullable(),
  unit: z.string().trim().min(1).max(20).optional().nullable(),
  destinationId: z.string().trim().min(1).optional().nullable(),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  measurementMethod: z.string().trim().min(1).max(200).optional().nullable(),
  documentId: z.string().trim().min(1).optional().nullable(),
});
export type CreateProductInput = z.infer<typeof createProductInputSchema>;

export async function createProduct(input: unknown, session: Session): Promise<Product> {
  if (!can(session, "CREATE", "EVENTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer un produit.");
  }
  const parsed = createProductInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const transformationBatch = await repositories.transformationBatches.findById(data.transformationBatchId);
  if (!transformationBatch) throw new NotFoundError("TRANSFORMATION_BATCH", data.transformationBatchId);

  await assertNotOnHold("TRANSFORMATION_BATCH", transformationBatch.id);

  const existingCode = await repositories.products.findByCode(data.code);
  if (existingCode) throw new ConflictError(`Le code produit "${data.code}" est déjà utilisé.`);

  let destination = null;
  if (data.destinationId) {
    destination = await repositories.destinations.findById(data.destinationId);
    if (!destination) throw new NotFoundError("DESTINATION", data.destinationId);
  }

  const scopeLotId = await findSourceLotId(transformationBatch.upstreamType, transformationBatch.upstreamId);
  if (scopeLotId) {
    assertInScope(session, await resolveLotHierarchy(scopeLotId));
  }

  const product = await repositories.products.create({
    code: data.code,
    name: data.name,
    category: data.category,
    transformationBatchId: data.transformationBatchId,
    packagingDate: data.packagingDate,
    expiryDate: data.expiryDate ?? null,
    quantity: data.quantity ?? null,
    unit: data.quantity ? (data.unit ?? "kg") : null,
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
    fromType: "PRODUCT",
    fromId: product.id,
    relationType: "CONDITIONNE_DEPUIS",
    toType: "TRANSFORMATION_BATCH",
    toId: transformationBatch.id,
    actorId: session.userId,
  });

  if (destination) {
    await createRelation({
      fromType: "PRODUCT",
      fromId: product.id,
      relationType: "DESTINE_A",
      toType: "DESTINATION",
      toId: destination.id,
      actorId: session.userId,
    });
  }

  await recordAudit({
    actorId: session.userId,
    entityType: "product",
    entityId: product.id,
    field: null,
    oldValue: null,
    newValue: data.code,
    reason: "Enregistrement d'un produit",
    relatedLotId: scopeLotId,
    relatedEventId: null,
  });

  return product;
}

/** Walks upstream from a transformation batch to find the originating lot, for scope checks. */
async function findSourceLotId(upstreamType: "SLAUGHTER_BATCH" | "TRANSFORMATION_BATCH", upstreamId: string): Promise<string | null> {
  if (upstreamType === "SLAUGHTER_BATCH") {
    const batch = await repositories.slaughterBatches.findById(upstreamId);
    return batch?.sourceLotId ?? null;
  }
  const batch = await repositories.transformationBatches.findById(upstreamId);
  if (!batch) return null;
  return findSourceLotId(batch.upstreamType, batch.upstreamId);
}
