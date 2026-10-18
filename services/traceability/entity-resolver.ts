import { repositories } from "../../data/repositories";
import type { EntityType } from "../../domain/traceability/entity-types";
import type { DataStatus } from "../../domain/shared/enums";

/**
 * A resolved, display-ready node in the traceability graph — one shape for every entity
 * type the graph knows about, so services/traceability/chain.ts doesn't special-case each
 * kind while walking the relations table. `href` is only set for entities with a real
 * detail page (today, only Lot) — everything else is shown inline on the traceability page
 * itself (phase-7 brief §6: "this is a traceability MVP", not five new CRUD route trees).
 */
export interface ChainNode {
  type: EntityType;
  id: string;
  code: string;
  label: string;
  dataStatus: DataStatus | null;
  /** The node's own primary timestamp — what chronology checks compare across the chain. */
  occurredAt: string;
  href: string | null;
}

export async function resolveNode(type: EntityType, id: string): Promise<ChainNode | null> {
  switch (type) {
    case "LOT": {
      const lot = await repositories.lots.findById(id);
      if (!lot) return null;
      return {
        type,
        id,
        code: lot.code,
        label: `Lot ${lot.code}`,
        dataStatus: lot.dataStatus,
        occurredAt: lot.startedAt ?? lot.createdAt,
        href: `/lots/${lot.id}`,
      };
    }
    case "COLLECTION": {
      const collection = await repositories.collections.findById(id);
      if (!collection) return null;
      return {
        type,
        id,
        code: collection.code,
        label: `Collecte ${collection.code}`,
        dataStatus: collection.dataStatus,
        occurredAt: collection.collectedAt,
        href: null,
      };
    }
    case "SLAUGHTER_BATCH": {
      const batch = await repositories.slaughterBatches.findById(id);
      if (!batch) return null;
      return {
        type,
        id,
        code: batch.code,
        label: `Abattage ${batch.code}`,
        dataStatus: batch.dataStatus,
        occurredAt: batch.slaughteredAt,
        href: null,
      };
    }
    case "TRANSFORMATION_BATCH": {
      const batch = await repositories.transformationBatches.findById(id);
      if (!batch) return null;
      return {
        type,
        id,
        code: batch.code,
        label: `Transformation ${batch.code}`,
        dataStatus: batch.dataStatus,
        occurredAt: batch.occurredAt,
        href: null,
      };
    }
    case "PRODUCT": {
      const product = await repositories.products.findById(id);
      if (!product) return null;
      return {
        type,
        id,
        code: product.code,
        label: `Produit ${product.code}`,
        dataStatus: product.dataStatus,
        occurredAt: product.packagingDate,
        href: null,
      };
    }
    case "PARENT_FLOCK": {
      const flock = await repositories.parentFlocks.findById(id);
      if (!flock) return null;
      return { type, id, code: flock.code, label: `Reproducteurs ${flock.code}`, dataStatus: flock.dataStatus, occurredAt: flock.placedAt, href: `/couvoir/reproducteurs/${flock.id}` };
    }
    case "EGG_LOT": {
      const egg = await repositories.eggLots.findById(id);
      if (!egg) return null;
      return { type, id, code: egg.code, label: `Œufs ${egg.code}`, dataStatus: egg.dataStatus, occurredAt: egg.collectedAt, href: null };
    }
    case "HATCH_CYCLE": {
      const cycle = await repositories.hatchCycles.findById(id);
      if (!cycle) return null;
      return { type, id, code: cycle.code, label: `Incubation ${cycle.code}`, dataStatus: cycle.dataStatus, occurredAt: cycle.setAt, href: `/couvoir/cycles/${cycle.id}` };
    }
    case "CHICK_LOT": {
      const chicks = await repositories.chickLots.findById(id);
      if (!chicks) return null;
      return { type, id, code: chicks.code, label: `Poussins ${chicks.code}`, dataStatus: chicks.dataStatus, occurredAt: chicks.dispatchedAt, href: null };
    }
    case "SHIPMENT": {
      const shipment = await repositories.shipments.findById(id);
      if (!shipment) return null;
      return { type, id, code: shipment.code, label: `Expédition ${shipment.code}`, dataStatus: shipment.dataStatus, occurredAt: shipment.shippedAt, href: null };
    }
    case "DESTINATION": {
      const destination = await repositories.destinations.findById(id);
      if (!destination) return null;
      return {
        type,
        id,
        code: destination.code,
        label: `Destination ${destination.code}`,
        dataStatus: null,
        occurredAt: "",
        href: null,
      };
    }
    default:
      return null;
  }
}

export async function entityExists(type: EntityType, id: string): Promise<boolean> {
  return (await resolveNode(type, id)) !== null;
}
