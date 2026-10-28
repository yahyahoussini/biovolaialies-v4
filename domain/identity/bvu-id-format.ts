/**
 * The BIOVOLAILLES identifier (document 3, chapter 2): ours, permanent, and what every record
 * attaches to — "du premier œuf jusqu'au point de vente". A supplier's code is kept beside it as
 * an alias, never in its place, because it disappears when the supplier changes.
 *
 * Format of the client's trace engine, `BVU-<KIND>-<14 hex>`, with one refinement: the 14th hex
 * digit is a Luhn mod-16 check digit over the first 13, so a code typed or read wrong (one wrong
 * digit, or two neighbours swapped) is refused instead of pointing at nothing — or at another bird.
 *
 * This is the pure part, with no Node import, so the field app checks codes on the phone, offline.
 * Drawing a new identifier stays server-side, in bvu-id.ts.
 */
export const BVU_KIND = {
  PARENT_FLOCK: "GEN",
  EGG_LOT: "EGG",
  HATCH_CYCLE: "HAT",
  CHICK_LOT: "CHK",
  LOT: "FLK",
  SUBJECT: "IND",
  TRANSFER: "MOV",
  TABLE_EGG_LOT: "TEG",
  COLLECTION: "COL",
  SLAUGHTER_BATCH: "SLA",
  TRANSFORMATION_BATCH: "PRC",
  PRODUCT: "PRO",
  SHIPMENT: "TRN",
  QUALITY_CASE: "HLD",
  SAMPLE: "SMP",
  PACKAGE: "PKG",
  CRATE: "CRT",
  SENSOR: "SEN",
  ASSET: "AST",
} as const;
export type BvuObjectType = keyof typeof BVU_KIND;

export const BODY_LENGTH = 13;
const PATTERN = /^BVU-([A-Z]{3})-([0-9A-F]{14})$/;

/** Luhn mod 16: catches every single wrong digit and almost every swap of two neighbours. */
export function checkDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * parseInt(body[i], 16);
    addend = Math.floor(addend / 16) + (addend % 16);
    sum += addend;
    factor = factor === 2 ? 1 : 2;
  }
  return ((16 - (sum % 16)) % 16).toString(16).toUpperCase();
}

export function formatBvuId(kind: string, body: string): string {
  return `BVU-${kind}-${body}${checkDigit(body)}`;
}

/** Accepts lower case and surrounding spaces (a scanner or a person typing), returns the canonical form. */
export function normalizeBvuId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function parseBvuId(raw: string): { kind: string; objectType: BvuObjectType | null; valid: boolean } | null {
  const match = PATTERN.exec(normalizeBvuId(raw));
  if (!match) return null;
  const [, kind, digits] = match;
  const objectType = (Object.entries(BVU_KIND).find(([, k]) => k === kind)?.[0] as BvuObjectType | undefined) ?? null;
  return { kind, objectType, valid: checkDigit(digits.slice(0, BODY_LENGTH)) === digits[BODY_LENGTH] };
}

export function isValidBvuId(raw: string): boolean {
  const parsed = parseBvuId(raw);
  return !!parsed && parsed.valid && parsed.objectType !== null;
}
