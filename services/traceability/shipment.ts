import { z } from "zod";
import { repositories } from "../../data/repositories";
import type { Shipment } from "../../domain/traceability/shipment";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { isWithinScope } from "../identity/scope-check";
import { assertNotOnHold, resolveEntityHierarchy } from "../quality/holds";
import { createRelation } from "./relations";

export const createShipmentSchema = z.object({
  code: z.string().trim().min(3).max(50),
  productId: z.string().min(1),
  destinationId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(20).default("kg"),
  shippedAt: z.string().trim().min(1),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE).default("MANUEL"),
  documentId: z.string().trim().max(200).optional().nullable(),
});

/** Quantity of a product already shipped. */
export async function quantityShipped(productId: string): Promise<number> {
  return (await repositories.shipments.listByProduct(productId)).reduce((sum, s) => sum + s.quantity, 0);
}

/**
 * Commercial dispatch (client spec phase 13). Refused for a product under quality hold, and —
 * when the packaged quantity is known — for more than what is left in stock.
 */
export async function createShipment(input: unknown, session: Session): Promise<Shipment> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer une expédition.");
  const parsed = createShipmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const product = await repositories.products.findById(data.productId);
  if (!product) throw new NotFoundError("Produit", data.productId);
  const destination = await repositories.destinations.findById(data.destinationId);
  if (!destination) throw new NotFoundError("Destination", data.destinationId);
  if (!isGlobalScope(session)) {
    const path = await resolveEntityHierarchy("PRODUCT", product.id);
    if (!path || !isWithinScope(session, path)) throw new AuthorizationError("Ce produit n'appartient pas à votre périmètre.");
  }
  await assertNotOnHold("PRODUCT", product.id);
  if (await repositories.shipments.findByCode(data.code)) throw new ConflictError(`Le code d'expédition "${data.code}" est déjà utilisé.`);

  if (product.quantity !== null) {
    if (product.unit && product.unit !== data.unit) throw new ValidationError(`L'unité doit être celle du produit (${product.unit}).`);
    const remaining = product.quantity - (await quantityShipped(product.id));
    if (data.quantity > remaining + 1e-9) throw new ValidationError(`Seulement ${remaining} ${product.unit ?? ""} restent en stock pour ce produit.`);
  }

  const shipment = await repositories.shipments.create({
    code: data.code,
    productId: product.id,
    destinationId: destination.id,
    quantity: data.quantity,
    unit: data.unit,
    shippedAt: data.shippedAt,
    dataStatus: data.dataStatus,
    sourceType: data.sourceType,
    sourceId: null,
    actorId: session.userId,
    measurementMethod: null,
    deviceId: null,
    documentId: data.documentId || null,
    validationStatus: null,
  });
  await createRelation({ fromType: "SHIPMENT", fromId: shipment.id, relationType: "EXPEDIE_DEPUIS", toType: "PRODUCT", toId: product.id, metadata: { quantity: data.quantity, unit: data.unit }, actorId: session.userId });
  await createRelation({ fromType: "SHIPMENT", fromId: shipment.id, relationType: "DESTINE_A", toType: "DESTINATION", toId: destination.id, actorId: session.userId });
  await recordAudit({
    actorId: session.userId,
    entityType: "shipment",
    entityId: shipment.id,
    field: null,
    oldValue: null,
    newValue: `${data.quantity} ${data.unit} de ${product.code} → ${destination.name}`,
    reason: "Expédition commerciale",
    relatedLotId: null,
    relatedEventId: null,
  });
  return shipment;
}
