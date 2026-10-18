import type { RelationType } from "../shared/enums";
import type { EntityType } from "./entity-types";

export interface RelationRule {
  from: EntityType;
  to: EntityType;
}

/**
 * Which (relationType, fromType, toType) triples are allowed (phase-7 brief §2's "relation is
 * allowed" check). Edges point from the downstream/dependent object to the thing it came
 * from — "COLLECTION COLLECTE_DE LOT" reads as "this collection was collected from that lot".
 * Only the pairs this phase's chain actually uses are listed; an unlisted relation type is
 * rejected rather than silently allowed — the vocabulary can grow later (genetics/hatchery)
 * without weakening what's already enforced.
 */
export const ALLOWED_RELATIONS: Partial<Record<RelationType, RelationRule[]>> = {
  // Upstream chain (client spec A03–A07): eggs from a parent flock, loaded into a cycle,
  // hatched into a chick lot, placed as a farm lot. metadata.quantity carries the count moved.
  PROVIENT_DE: [
    { from: "EGG_LOT", to: "PARENT_FLOCK" },
    { from: "HATCH_CYCLE", to: "EGG_LOT" },
    { from: "CHICK_LOT", to: "HATCH_CYCLE" },
    { from: "LOT", to: "CHICK_LOT" },
  ],
  EXPEDIE_DEPUIS: [{ from: "SHIPMENT", to: "PRODUCT" }],
  COLLECTE_DE: [{ from: "COLLECTION", to: "LOT" }],
  ABATTU_DEPUIS: [
    { from: "SLAUGHTER_BATCH", to: "COLLECTION" },
    { from: "SLAUGHTER_BATCH", to: "LOT" },
  ],
  TRANSFORME_DEPUIS: [
    { from: "TRANSFORMATION_BATCH", to: "SLAUGHTER_BATCH" },
    { from: "TRANSFORMATION_BATCH", to: "TRANSFORMATION_BATCH" },
  ],
  DECOUPE_DEPUIS: [
    { from: "TRANSFORMATION_BATCH", to: "SLAUGHTER_BATCH" },
    { from: "TRANSFORMATION_BATCH", to: "TRANSFORMATION_BATCH" },
  ],
  CONDITIONNE_DEPUIS: [{ from: "PRODUCT", to: "TRANSFORMATION_BATCH" }],
  DESTINE_A: [
    { from: "PRODUCT", to: "DESTINATION" },
    { from: "SHIPMENT", to: "DESTINATION" },
  ],
};

export function isRelationAllowed(relationType: RelationType, from: EntityType, to: EntityType): boolean {
  const rules = ALLOWED_RELATIONS[relationType];
  if (!rules) return false;
  return rules.some((rule) => rule.from === from && rule.to === to);
}
