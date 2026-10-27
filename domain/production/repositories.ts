import type {
  Collection,
  EnvironmentMeasurementRecord,
  FeedUsageRecord,
  Lot,
  LotEvent,
  MortalityRecord,
  NewCollection,
  NewEnvironmentMeasurementRecord,
  NewFeedUsageRecord,
  NewLot,
  NewLotEvent,
  NewMortalityRecord,
  NewSlaughterBatch,
  NewTransformationBatch,
  NewWaterUsageRecord,
  NewWeightMeasurementRecord,
  SlaughterBatch,
  TransformationBatch,
  WaterUsageRecord,
  WeightMeasurementRecord,
} from "./types";
import type { LotStatus } from "../shared/enums";

/** Core aggregate — fully implemented against Drizzle. */
export interface LotRepository {
  findById(id: string): Promise<Lot | null>;
  /** `code` is the lot's public "Business ID" (e.g. BU-2026-001) — used to enforce uniqueness at creation. */
  findByCode(code: string): Promise<Lot | null>;
  listByBuilding(buildingId: string): Promise<Lot[]>;
  list(): Promise<Lot[]>;
  create(input: NewLot): Promise<Lot>;
  update(id: string, patch: Partial<Pick<Lot, "species" | "breed" | "plannedStartAt" | "dataStatus">>): Promise<Lot>;
  updateStatus(id: string, status: LotStatus, extra?: Partial<Pick<Lot, "startedAt" | "endedAt">>): Promise<Lot>;
  /** Population only ever moves through a validated event (see services/production/lot-events.ts) — never a raw field edit. */
  updatePopulation(id: string, currentPopulation: number): Promise<Lot>;
  /** Line, age reference, site and counts as set by the production-flow services (phases, movements). */
  updateFlow(id: string, patch: Partial<Pick<Lot, "buildingId" | "initialPopulation" | "currentPopulation" | "productionLine" | "purpose" | "hatchedAt">>): Promise<Lot>;
}

/** Core aggregate — fully implemented against Drizzle as of Phase 2. */
export interface LotEventRepository {
  findById(id: string): Promise<LotEvent | null>;
  listByLot(lotId: string): Promise<LotEvent[]>;
  /** Most recent events across several lots in one query — the dashboard's activity feed (phase-5 brief §9). Empty `lotIds` short-circuits to []. */
  listRecentByLots(lotIds: string[], limit: number): Promise<LotEvent[]>;
  create(input: NewLotEvent): Promise<LotEvent>;
}

export interface CollectionRepository {
  findById(id: string): Promise<Collection | null>;
  findByCode(code: string): Promise<Collection | null>;
  listByLot(lotId: string): Promise<Collection[]>;
  list(): Promise<Collection[]>;
  create(input: NewCollection): Promise<Collection>;
}

export interface SlaughterBatchRepository {
  findById(id: string): Promise<SlaughterBatch | null>;
  findByCode(code: string): Promise<SlaughterBatch | null>;
  listBySourceLot(lotId: string): Promise<SlaughterBatch[]>;
  list(): Promise<SlaughterBatch[]>;
  create(input: NewSlaughterBatch): Promise<SlaughterBatch>;
}

export interface TransformationBatchRepository {
  findById(id: string): Promise<TransformationBatch | null>;
  findByCode(code: string): Promise<TransformationBatch | null>;
  /** Batches made from a given upstream object (slaughter batch or another transformation batch) — used by the chain traversal. */
  listByUpstream(upstreamType: TransformationBatch["upstreamType"], upstreamId: string): Promise<TransformationBatch[]>;
  list(): Promise<TransformationBatch[]>;
  create(input: NewTransformationBatch): Promise<TransformationBatch>;
}

// ---------------------------------------------------------------------------
// Structured analytical data (Phase 3) — all fully implemented against Drizzle.
// ---------------------------------------------------------------------------

export interface FeedUsageRepository {
  findById(id: string): Promise<FeedUsageRecord | null>;
  listByLot(lotId: string): Promise<FeedUsageRecord[]>;
  create(input: NewFeedUsageRecord): Promise<FeedUsageRecord>;
}

export interface WaterUsageRepository {
  findById(id: string): Promise<WaterUsageRecord | null>;
  listByLot(lotId: string): Promise<WaterUsageRecord[]>;
  listByBuilding(buildingId: string): Promise<WaterUsageRecord[]>;
  create(input: NewWaterUsageRecord): Promise<WaterUsageRecord>;
}

export interface WeightMeasurementRepository {
  findById(id: string): Promise<WeightMeasurementRecord | null>;
  listByLot(lotId: string): Promise<WeightMeasurementRecord[]>;
  create(input: NewWeightMeasurementRecord): Promise<WeightMeasurementRecord>;
}

export interface MortalityRecordRepository {
  findById(id: string): Promise<MortalityRecord | null>;
  listByLot(lotId: string): Promise<MortalityRecord[]>;
  create(input: NewMortalityRecord): Promise<MortalityRecord>;
}

export interface EnvironmentMeasurementRepository {
  findById(id: string): Promise<EnvironmentMeasurementRecord | null>;
  listByLot(lotId: string): Promise<EnvironmentMeasurementRecord[]>;
  listByBuilding(buildingId: string): Promise<EnvironmentMeasurementRecord[]>;
  create(input: NewEnvironmentMeasurementRecord): Promise<EnvironmentMeasurementRecord>;
}
