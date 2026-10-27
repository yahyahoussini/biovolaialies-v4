/**
 * The node vocabulary the traceability graph knows how to resolve. Upstream (parent flock →
 * egg lot → hatch cycle → chick lot) was added for the client's full-chain spec (A03–A07),
 * and SHIPMENT for commercial dispatch — each as "a string here + a resolver case", with no
 * change to the generic `relations` table, exactly as this file was designed to allow.
 */
export const ENTITY_TYPE = [
  "PARENT_FLOCK",
  "EGG_LOT",
  "HATCH_CYCLE",
  "CHICK_LOT",
  "LOT",
  "COLLECTION",
  "SLAUGHTER_BATCH",
  "TRANSFORMATION_BATCH",
  "PRODUCT",
  "SHIPMENT",
  "DESTINATION",
  /** A day's table eggs from a layer lot (handwritten flow, white and "Pistache" eggs). */
  "TABLE_EGG_LOT",
] as const;
export type EntityType = (typeof ENTITY_TYPE)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPE as readonly string[]).includes(value);
}
