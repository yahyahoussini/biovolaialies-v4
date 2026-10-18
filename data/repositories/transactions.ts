import { eq } from "drizzle-orm";
import type {
  FeedUsageRecord,
  Lot,
  LotEvent,
  MortalityRecord,
  NewFeedUsageRecord,
  NewLotEvent,
  NewMortalityRecord,
  NewWeightMeasurementRecord,
  WeightMeasurementRecord,
} from "../../domain/production/types";
import { db } from "../db/client";
import { feedUsageRecords, lotEvents, lots, mortalityRecords, weightMeasurementRecords } from "../db/schema";

/**
 * The places this codebase writes several rows that must exist together. Each one is a single
 * `db.batch`, never an interactive `db.transaction`: an interactive transaction on the shared
 * libSQL connection lets OTHER requests' statements run inside it, so concurrent traffic could
 * fail it with SQLITE_BUSY and roll back someone else's write along with it. A batch runs
 * atomically in one go (synchronously on a local file, one request on Turso), so nothing can
 * interleave. Row ids are generated up front so later statements can reference earlier rows.
 */
export async function recordLotEventWithPopulationUpdate(
  eventInput: NewLotEvent,
  populationUpdate: { lotId: string; currentPopulation: number } | null
): Promise<{ event: LotEvent; lot: Lot | null }> {
  const insertEvent = db.insert(lotEvents).values(eventInput).returning();
  if (!populationUpdate) {
    const [event] = await insertEvent;
    return { event: event as LotEvent, lot: null };
  }
  const [[event], [lot]] = await db.batch([
    insertEvent,
    db.update(lots).set({ currentPopulation: populationUpdate.currentPopulation }).where(eq(lots.id, populationUpdate.lotId)).returning(),
  ]);
  return { event: event as LotEvent, lot: lot ?? null };
}

/**
 * Phase 3: MORTALITE, ALIMENTATION and PESEE now also have dedicated structured tables
 * (feed_usage_records / weight_measurement_records / mortality_records) carrying full
 * provenance — the lot_events timeline entry stays (existing UI reads it), but the
 * structured row is the source of truth for analytics/quality. Both are written in the
 * same batch, linked via lot_events.sourceId -> the structured record's id, so neither can
 * exist without the other.
 */
export async function recordMortalityWithPopulationUpdate(
  mortalityInput: NewMortalityRecord,
  eventInput: Omit<NewLotEvent, "sourceId">,
  currentPopulation: number
): Promise<{ record: MortalityRecord; event: LotEvent; lot: Lot }> {
  const recordId = crypto.randomUUID();
  const [[record], [event], [lot]] = await db.batch([
    db.insert(mortalityRecords).values({ ...mortalityInput, id: recordId }).returning(),
    db.insert(lotEvents).values({ ...eventInput, sourceId: recordId }).returning(),
    db.update(lots).set({ currentPopulation }).where(eq(lots.id, mortalityInput.lotId)).returning(),
  ]);
  return { record, event: event as LotEvent, lot };
}

export async function recordFeedUsageWithEvent(
  feedInput: NewFeedUsageRecord,
  eventInput: Omit<NewLotEvent, "sourceId">
): Promise<{ record: FeedUsageRecord; event: LotEvent }> {
  const recordId = crypto.randomUUID();
  const [[record], [event]] = await db.batch([
    db.insert(feedUsageRecords).values({ ...feedInput, id: recordId }).returning(),
    db.insert(lotEvents).values({ ...eventInput, sourceId: recordId }).returning(),
  ]);
  return { record, event: event as LotEvent };
}

export async function recordWeightMeasurementWithEvent(
  weightInput: NewWeightMeasurementRecord,
  eventInput: Omit<NewLotEvent, "sourceId">
): Promise<{ record: WeightMeasurementRecord; event: LotEvent }> {
  const recordId = crypto.randomUUID();
  const [[record], [event]] = await db.batch([
    db.insert(weightMeasurementRecords).values({ ...weightInput, id: recordId }).returning(),
    db.insert(lotEvents).values({ ...eventInput, sourceId: recordId }).returning(),
  ]);
  return { record, event: event as LotEvent };
}
