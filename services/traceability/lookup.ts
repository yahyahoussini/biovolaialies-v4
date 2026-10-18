import { repositories } from "../../data/repositories";
import type { EntityType } from "../../domain/traceability/entity-types";

/** Business-code lookup for every traceable object — how people name things on the floor. */
export async function findEntityIdByCode(type: EntityType, code: string): Promise<string | null> {
  const c = code.trim();
  if (!c) return null;
  const finders: Record<EntityType, () => Promise<{ id: string } | null>> = {
    PARENT_FLOCK: () => repositories.parentFlocks.findByCode(c),
    EGG_LOT: () => repositories.eggLots.findByCode(c),
    HATCH_CYCLE: () => repositories.hatchCycles.findByCode(c),
    CHICK_LOT: () => repositories.chickLots.findByCode(c),
    LOT: () => repositories.lots.findByCode(c),
    COLLECTION: () => repositories.collections.findByCode(c),
    SLAUGHTER_BATCH: () => repositories.slaughterBatches.findByCode(c),
    TRANSFORMATION_BATCH: () => repositories.transformationBatches.findByCode(c),
    PRODUCT: () => repositories.products.findByCode(c),
    SHIPMENT: () => repositories.shipments.findByCode(c),
    DESTINATION: () => repositories.destinations.findByCode(c),
  };
  return (await finders[type]())?.id ?? null;
}
