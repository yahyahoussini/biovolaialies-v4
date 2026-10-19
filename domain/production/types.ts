import type { DataStatus, EventType, LotStatus, MeasurementSourceType, SensorType, ValidationStatus } from "../shared/enums";
import type { ProvenanceFields } from "../shared/provenance";

export interface Lot {
  id: string;
  buildingId: string;
  code: string;
  species: string;
  breed: string;
  status: LotStatus;
  initialPopulation: number;
  currentPopulation: number;
  plannedStartAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  dataStatus: DataStatus;
  createdAt: string;
  /** Production line of the client's process; null on lots recorded before it existed. */
  productionLine?: string | null;
}

export interface LotEvent {
  id: string;
  lotId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  occurredAt: string;
  actorId: string | null;
  dataStatus: DataStatus;
  sourceType: MeasurementSourceType | null;
  sourceId: string | null;
  deviceId: string | null;
  measurementMethod: string | null;
  validationStatus: ValidationStatus | null;
  createdAt: string;
}

/**
 * Downstream traceability chain (phase-7 brief §5-§7) — each stage carries the same
 * ProvenanceFields shape as the Phase-3 structured records (feed/water/weight/...), reused
 * as-is via services/provenance/provenance-service.ts. `code` is the human-readable business
 * id (e.g. "COL-2026-001"), same pattern as Lot.code.
 */
export interface Collection extends ProvenanceFields {
  id: string;
  code: string;
  lotId: string;
  quantity: number;
  unit: string;
  destinationId: string | null;
  collectedAt: string;
  createdAt: string;
}

export interface SlaughterBatch extends ProvenanceFields {
  id: string;
  code: string;
  sourceLotId: string;
  quantityIn: number;
  quantityOut: number;
  losses: number;
  slaughteredAt: string;
  createdAt: string;
}

export type TransformationSourceType = "SLAUGHTER_BATCH" | "TRANSFORMATION_BATCH";

export interface TransformationBatch extends ProvenanceFields {
  id: string;
  code: string;
  /** What this batch was made from — a different concept than ProvenanceFields' own sourceType/sourceId (data provenance), hence the distinct name. */
  upstreamType: TransformationSourceType;
  upstreamId: string;
  processType: string;
  inputQuantity: number;
  outputQuantity: number;
  losses: number;
  /** Output that failed quality control — distinct from process losses (phase-7 brief §7's "input = output + losses + rejects"). */
  rejects: number;
  occurredAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Structured analytical data (Phase 3) — dedicated, typed tables rather than
// generic JSON payloads, each carrying full provenance (domain/shared/provenance.ts).
// ---------------------------------------------------------------------------

export interface FeedUsageRecord extends ProvenanceFields {
  id: string;
  lotId: string;
  occurredAt: string;
  quantity: number;
  unit: string;
  feedType: string;
  /** Feed lot/supplier reference, free text — no supplier management module yet (by design, this phase). */
  feedSource: string | null;
  createdAt: string;
}

export interface WaterUsageRecord extends ProvenanceFields {
  id: string;
  buildingId: string;
  lotId: string | null;
  occurredAt: string;
  quantity: number;
  unit: string;
  source: string | null;
  createdAt: string;
}

export interface WeightMeasurementRecord extends ProvenanceFields {
  id: string;
  lotId: string;
  occurredAt: string;
  averageWeight: number;
  unit: string;
  sampleCount: number | null;
  createdAt: string;
}

export interface MortalityRecord extends ProvenanceFields {
  id: string;
  lotId: string;
  occurredAt: string;
  count: number;
  /** A suspected cause is not a validated one — see `causeValidated`. Never render as fact until true. */
  suspectedCause: string | null;
  causeValidated: boolean;
  createdAt: string;
}

export interface EnvironmentMeasurementRecord extends ProvenanceFields {
  id: string;
  buildingId: string;
  lotId: string | null;
  /** Reuses SENSOR_TYPE (domain/shared/enums.ts) restricted in practice to TEMPERATURE|HUMIDITE|CO2|LUMIERE — same vocabulary the future IoT sensors table will use. */
  measurementType: SensorType;
  value: number;
  unit: string;
  occurredAt: string;
  createdAt: string;
}

export type NewLot = Omit<Lot, "id" | "createdAt">;
export type NewLotEvent = Omit<LotEvent, "id" | "createdAt">;
export type NewCollection = Omit<Collection, "id" | "createdAt">;
export type NewSlaughterBatch = Omit<SlaughterBatch, "id" | "createdAt">;
export type NewTransformationBatch = Omit<TransformationBatch, "id" | "createdAt">;
export type NewFeedUsageRecord = Omit<FeedUsageRecord, "id" | "createdAt">;
export type NewWaterUsageRecord = Omit<WaterUsageRecord, "id" | "createdAt">;
export type NewWeightMeasurementRecord = Omit<WeightMeasurementRecord, "id" | "createdAt">;
export type NewMortalityRecord = Omit<MortalityRecord, "id" | "createdAt">;
export type NewEnvironmentMeasurementRecord = Omit<EnvironmentMeasurementRecord, "id" | "createdAt">;
