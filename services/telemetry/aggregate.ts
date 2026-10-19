import { repositories } from "../../data/repositories";
import {
  addReading,
  bucketStart,
  EMPTY_BUCKET,
  expectedCount,
  GRANULARITY_SECONDS,
  QUARTER_RETENTION_DAYS,
  RAW_RETENTION_DAYS,
  type BucketStats,
} from "../../domain/telemetry/aggregate";
import { expectedIntervalSeconds } from "../../domain/telemetry/catalog";
import type { MeasurementAggregate } from "../../domain/telemetry/types";
import type { AggregateGranularity } from "../../domain/shared/enums";
import { recordAudit } from "../audit/record";

const DAY = 86_400_000;

interface BucketAcc {
  stats: BucketStats;
  buildingId: string;
  zoneId: string | null;
  lots: Map<string, number>;
}

function toRow(sensorId: string, granularity: AggregateGranularity, start: string, acc: BucketAcc, acquisition: number | null): Omit<MeasurementAggregate, "id"> {
  let lotId: string | null = null;
  let best = 0;
  for (const [lot, n] of acc.lots) if (n > best) [lotId, best] = [lot, n];
  return {
    sensorId,
    granularity,
    bucketStart: start,
    buildingId: acc.buildingId,
    zoneId: acc.zoneId,
    lotId,
    count: acc.stats.count,
    expected: expectedCount(granularity, acquisition),
    suspectCount: acc.stats.suspectCount,
    sum: acc.stats.sum,
    sumSq: acc.stats.sumSq,
    min: acc.stats.min,
    max: acc.stats.max,
  };
}

/**
 * Recomputes the 15-minute and hourly buckets covering [from, to] from the raw readings, for
 * the given sensors or all of them. Idempotent: a bucket is rewritten, never added to, so a
 * late reading or a replayed backlog just yields the right figures again.
 */
export async function aggregateRange(from: string, to: string, sensorIds?: string[]): Promise<{ quarters: number; hours: number }> {
  const start = Date.parse(bucketStart(from, "1h"));
  const end = Date.parse(bucketStart(to, "1h")) + GRANULARITY_SECONDS["1h"] * 1000;
  const sensors = await repositories.telemetrySensors.listAll();
  const acquisition = new Map(sensors.map((s) => [s.id, expectedIntervalSeconds(s.catalogRef)]));
  const total = { quarters: 0, hours: 0 };
  // A day at a time (hour-aligned), so a long backlog never sits in memory at once.
  for (let dayStart = start; dayStart < end; dayStart += DAY) {
    const part = await aggregateWindow(new Date(dayStart).toISOString(), new Date(Math.min(dayStart + DAY, end)).toISOString(), acquisition, sensorIds);
    total.quarters += part.quarters;
    total.hours += part.hours;
  }
  return total;
}

async function aggregateWindow(start: string, end: string, acquisition: Map<string, number | null>, sensorIds?: string[]): Promise<{ quarters: number; hours: number }> {
  const readings = await repositories.readings.listForAggregation(start, end, sensorIds);
  if (readings.length === 0) return { quarters: 0, hours: 0 };

  const buckets: Record<AggregateGranularity, Map<string, BucketAcc>> = { "15m": new Map(), "1h": new Map() };
  for (const r of readings) {
    // Legacy rows carry no flag; they predate the checks and count as usable.
    const usable = r.qualityFlag === null || r.qualityFlag === "OK";
    for (const g of ["15m", "1h"] as const) {
      const key = `${r.sensorId}|${bucketStart(r.capturedAt, g)}`;
      const acc = buckets[g].get(key) ?? { stats: EMPTY_BUCKET, buildingId: r.buildingId, zoneId: r.zoneId, lots: new Map() };
      acc.stats = addReading(acc.stats, r.value, usable);
      if (r.lotId) acc.lots.set(r.lotId, (acc.lots.get(r.lotId) ?? 0) + 1);
      buckets[g].set(key, acc);
    }
  }
  const rows: Omit<MeasurementAggregate, "id">[] = [];
  for (const g of ["15m", "1h"] as const) {
    for (const [key, acc] of buckets[g]) {
      const [sensorId, bucket] = key.split("|");
      rows.push(toRow(sensorId, g, bucket, acc, acquisition.get(sensorId) ?? null));
    }
  }
  await repositories.aggregates.upsertMany(rows);
  return { quarters: buckets["15m"].size, hours: buckets["1h"].size };
}

export interface RetentionReport {
  rawCutoff: string;
  quarterCutoff: string;
  aggregatedDays: number;
  rawDeleted: number;
  quartersDeleted: number;
}

/**
 * The three retention tiers of document 3, ch. 3. Raw readings are deleted only after their
 * buckets are written; hourly buckets are never deleted. What is deleted, and up to when, is
 * written to the audit trail — "ce qui est effacé" is part of the data's life too.
 */
export async function runRetention(now = new Date()): Promise<RetentionReport> {
  const rawCutoff = bucketStart(now.getTime() - RAW_RETENTION_DAYS * DAY, "1h");
  const quarterCutoff = bucketStart(now.getTime() - QUARTER_RETENTION_DAYS * DAY, "1h");
  const oldest = await repositories.readings.oldestCapturedAt();
  let aggregatedDays = 0;
  if (oldest && oldest < rawCutoff) {
    for (let day = Date.parse(bucketStart(oldest, "1h")); day < Date.parse(rawCutoff); day += DAY) {
      await aggregateRange(new Date(day).toISOString(), new Date(Math.min(day + DAY, Date.parse(rawCutoff)) - 1).toISOString());
      aggregatedDays++;
    }
  }
  const rawDeleted = await repositories.readings.purgeBefore(rawCutoff);
  const quartersDeleted = await repositories.aggregates.purgeBefore("15m", quarterCutoff);
  if (rawDeleted || quartersDeleted) {
    await recordAudit({
      actorId: null,
      entityType: "telemetry_retention",
      entityId: now.toISOString(),
      field: null,
      oldValue: null,
      newValue: `${rawDeleted} mesures brutes < ${rawCutoff} ; ${quartersDeleted} agrégats 15 min < ${quarterCutoff}`,
      reason: "Rétention : brut 90 jours, agrégats 15 min 2 ans, agrégats horaires sans limite",
      relatedLotId: null,
      relatedEventId: null,
    });
  }
  return { rawCutoff, quarterCutoff, aggregatedDays, rawDeleted, quartersDeleted };
}
