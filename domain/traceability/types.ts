import type { DestinationType, RelationType } from "../shared/enums";
import type { ProvenanceFields } from "../shared/provenance";

/** An edge in the traceability graph. Generic by design — new edge types need no new table. */
export interface Relation {
  id: string;
  fromType: string;
  fromId: string;
  relationType: RelationType;
  toType: string;
  toId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A product must have a valid source (phase-7 brief §8) — transformationBatchId is a required FK, never optional. */
export interface Product extends ProvenanceFields {
  id: string;
  code: string;
  name: string;
  category: string;
  transformationBatchId: string;
  packagingDate: string;
  expiryDate: string | null;
  /** Packaged quantity — null on rows recorded before quantities were captured. */
  quantity: number | null;
  unit: string | null;
  createdAt: string;
}

export interface Destination {
  id: string;
  code: string;
  name: string;
  type: DestinationType;
  city: string;
}

export type QrScope = "LOT" | "PRODUCT";

export interface QrToken {
  id: string;
  token: string;
  scope: QrScope;
  lotId: string | null;
  productId: string | null;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
}

/** One stage in the simplified public lineage (phase-9 brief §8) — never the raw entity graph. */
export interface PublicLineageStage {
  label: string;
  name: string;
}

/** One entry in the simplified public timeline (phase-9 brief §7) — curated stage, not a raw lot_event. */
export interface PublicTimelineEntry {
  label: string;
  description: string | null;
  date: string | null;
  verified: boolean;
}

/**
 * Curated, public-safe view returned by services/public/passport.ts — the ONLY shape the
 * public route is allowed to render. Never the raw Lot/Product entity, never an internal id.
 */
export interface PublicPassport {
  scope: QrScope;
  productName: string | null;
  publicProductCode: string | null;
  /**
   * The BIOVOLAILLES identifier of what was scanned — the product's, or the lot's for a lot
   * passport (document 3, ch. 2: "ce à quoi toutes les données se rattachent").
   */
  bvuId: string | null;
  lotCode: string;
  originFarmName: string;
  originCity: string;
  period: { start: string | null; end: string | null };
  /** Human-readable, derived strictly from lifecycle state — never "Verified" just because the QR resolved. */
  publicStatus: string;
  verified: boolean;
  certifications: string[];
  timeline: PublicTimelineEntry[];
  lineage: PublicLineageStage[];
  /** True unless the underlying data is REEL/VALIDE — drives the "Données de démonstration" banner (phase-9 brief §15). */
  isDemoData: boolean;
  /**
   * True while a quality hold covers the scanned product (or lot). The passport then says so
   * plainly and never reads as verified — the public must not be reassured about goods the
   * operator itself has blocked.
   */
  qualityHold: boolean;
  /** Public-safe upstream facts (strain, hatchery city) when the hatchery chain is recorded. */
  geneticOrigin: string | null;
}

export type NewRelation = Omit<Relation, "id" | "createdAt">;
export type NewProduct = Omit<Product, "id" | "createdAt">;
export type NewDestination = Omit<Destination, "id">;
export type NewQrToken = Omit<QrToken, "id" | "createdAt">;
