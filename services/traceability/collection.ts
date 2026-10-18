import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { validateTransferQuantity } from "../../domain/production/quantity-integrity";
import type { Collection, Lot } from "../../domain/production/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { getLotOrThrow } from "../production/lot";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "./relations";

/** Units that mean "a count of birds" — compared directly against the lot's population. Anything else is treated as a mass unit. */
const POPULATION_UNITS = new Set(["sujets", "sujet", "têtes", "tete", "tetes", "unités", "unite", "unites"]);

/**
 * "Available quantity" only means the same thing as `lot.currentPopulation` when the
 * collection is itself counted in birds. A mass-denominated collection (e.g. "KG" of live
 * weight — the realistic unit for a poultry pickup) needs the population converted to an
 * equivalent weight ceiling using the lot's own latest known average weight, or the
 * comparison would silently compare birds against kilograms.
 */
export async function resolveAvailableQuantity(lot: Lot, unit: string): Promise<number> {
  if (POPULATION_UNITS.has(unit.trim().toLowerCase())) {
    return lot.currentPopulation;
  }
  const weightRecords = await repositories.weightMeasurements.listByLot(lot.id);
  const latest = weightRecords[0]; // listByLot already orders desc by occurredAt
  if (!latest) {
    throw new ValidationError(
      "Impossible de valider la quantité collectée : aucune pesée connue pour ce lot ne permet de convertir la population en poids."
    );
  }
  return Math.round(lot.currentPopulation * latest.averageWeight * 10) / 10;
}

/**
 * Structured Collection (phase-7 brief §5) — the first downstream stage after the Lot.
 * Quantity is checked against the Phase-3 `validateTransferQuantity` (reused, not a second
 * engine): "available" is the lot's current population minus whatever has already been
 * collected from it.
 */
export const createCollectionInputSchema = z.object({
  code: z.string().trim().min(3).max(50),
  lotId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1),
  destinationId: z.string().trim().min(1).optional().nullable(),
  collectedAt: z.string().trim().min(1),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  measurementMethod: z.string().trim().min(1).max(200).optional().nullable(),
  documentId: z.string().trim().min(1).optional().nullable(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionInputSchema>;

export async function createCollection(input: unknown, session: Session): Promise<Collection> {
  if (!can(session, "CREATE", "EVENTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer une collecte.");
  }
  const parsed = createCollectionInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const lot = await getLotOrThrow(data.lotId);
  assertInScope(session, await resolveLotHierarchy(data.lotId));

  await assertNotOnHold("LOT", lot.id);

  const existingCode = await repositories.collections.findByCode(data.code);
  if (existingCode) throw new ConflictError(`Le code de collecte "${data.code}" est déjà utilisé.`);

  if (data.destinationId) {
    const destination = await repositories.destinations.findById(data.destinationId);
    if (!destination) throw new ValidationError("La destination indiquée n'existe pas.");
  }

  const priorCollections = await repositories.collections.listByLot(data.lotId);
  const alreadyCollected = priorCollections.reduce((sum, c) => sum + c.quantity, 0);
  const availableCeiling = await resolveAvailableQuantity(lot, data.unit);
  const available = availableCeiling - alreadyCollected;
  const quantityCheck = validateTransferQuantity(available, data.quantity);
  if (!quantityCheck.ok) throw new ValidationError(quantityCheck.error);

  const collection = await repositories.collections.create({
    code: data.code,
    lotId: data.lotId,
    quantity: data.quantity,
    unit: data.unit,
    destinationId: data.destinationId ?? null,
    collectedAt: data.collectedAt,
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
    fromType: "COLLECTION",
    fromId: collection.id,
    relationType: "COLLECTE_DE",
    toType: "LOT",
    toId: lot.id,
    actorId: session.userId,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "collection",
    entityId: collection.id,
    field: null,
    oldValue: null,
    newValue: `${data.quantity} ${data.unit}`,
    reason: "Enregistrement d'une collecte",
    relatedLotId: lot.id,
    relatedEventId: null,
  });

  return collection;
}
