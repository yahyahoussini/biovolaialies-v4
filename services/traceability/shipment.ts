import { z } from "zod";
import { repositories } from "../../data/repositories";
import type { Shipment } from "../../domain/traceability/shipment";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { businessDate } from "../../domain/shared/dates";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { isWithinScope } from "../identity/scope-check";
import { assertNotOnHold, resolveEntityHierarchy } from "../quality/holds";
import { withLock } from "../../lib/keyed-lock";
import { createRelation } from "./relations";

export const createShipmentSchema = z.object({
  code: z.string().trim().min(3).max(50),
  productId: z.string().min(1),
  destinationId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(20).default("kg"),
  shippedAt: businessDate("Expédition"),
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
  // Serialised per product so two simultaneous shipments cannot both pass the stock check.
  const productId = typeof input === "object" && input && "productId" in input ? String((input as { productId: unknown }).productId) : "";
  return withLock(`shipment:${productId}`, () => createShipmentUnlocked(input, session));
}

async function createShipmentUnlocked(input: unknown, session: Session): Promise<Shipment> {
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

  // One unit per product, always: the recall adds shipped quantities together.
  const expectedUnit = product.unit ?? (await repositories.shipments.listByProduct(product.id))[0]?.unit ?? null;
  if (expectedUnit && expectedUnit !== data.unit) throw new ValidationError(`L'unité doit être celle du produit (${expectedUnit}).`);
  if (product.quantity !== null) {
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

export interface ShipmentOverview {
  products: { id: string; code: string; name: string; quantity: number | null; unit: string | null; shipped: number; onHold: boolean }[];
  shipments: (Shipment & { productCode: string; destinationLabel: string })[];
  destinations: { id: string; label: string }[];
}

export async function getShipmentOverview(session: Session): Promise<ShipmentOverview> {
  if (!can(session, "VIEW", "PRODUCTS")) throw new AuthorizationError();
  const [products, shipments, destinations] = await Promise.all([
    repositories.products.list(),
    repositories.shipments.list(),
    repositories.destinations.list(),
  ]);
  const visible = [];
  for (const product of products) {
    if (!isGlobalScope(session)) {
      const path = await resolveEntityHierarchy("PRODUCT", product.id);
      if (!path || !isWithinScope(session, path)) continue;
    }
    visible.push(product);
  }
  const visibleIds = new Set(visible.map((p) => p.id));
  const destinationLabel = new Map(destinations.map((d) => [d.id, `${d.name} — ${d.city}`]));
  const productCode = new Map(visible.map((p) => [p.id, p.code]));
  return {
    products: await Promise.all(
      visible.map(async (p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        quantity: p.quantity,
        unit: p.unit,
        shipped: shipments.filter((s) => s.productId === p.id).reduce((sum, s) => sum + s.quantity, 0),
        onHold: (await repositories.qualityCases.listActiveItemsFor("PRODUCT", p.id)).length > 0,
      }))
    ),
    shipments: shipments
      .filter((s) => visibleIds.has(s.productId))
      .map((s) => ({ ...s, productCode: productCode.get(s.productId) ?? "—", destinationLabel: destinationLabel.get(s.destinationId) ?? "—" })),
    destinations: destinations.map((d) => ({ id: d.id, label: `${d.name} — ${d.city}` })),
  };
}
