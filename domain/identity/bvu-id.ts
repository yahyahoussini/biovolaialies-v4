import { randomBytes } from "node:crypto";
import { BODY_LENGTH, BVU_KIND, formatBvuId, type BvuObjectType } from "./bvu-id-format";

export { BVU_KIND, checkDigit, formatBvuId, isValidBvuId, normalizeBvuId, parseBvuId, type BvuObjectType } from "./bvu-id-format";

/** Server-side only: draws the random body. Everything else lives in bvu-id-format.ts. */
export function newBvuId(objectType: BvuObjectType): string {
  const body = randomBytes(7).toString("hex").toUpperCase().slice(0, BODY_LENGTH);
  return formatBvuId(BVU_KIND[objectType], body);
}
