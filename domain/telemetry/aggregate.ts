import type { AggregateGranularity } from "../shared/enums";

/**
 * Retention in three tiers (document 3, ch. 3):
 *  - raw readings, kept 90 days at their acquisition interval;
 *  - 15-minute buckets, kept two years, with min, max, mean, standard deviation and availability
 *    ("pas seulement la moyenne, sinon les pics disparaissent");
 *  - hourly buckets, kept forever.
 * Buckets store count, sum and sum of squares so that an hour is the exact merge of its four
 * quarters and the standard deviation survives the deletion of the raw readings.
 */
export const RAW_RETENTION_DAYS = 90;
export const QUARTER_RETENTION_DAYS = 730;

export const GRANULARITY_SECONDS: Record<AggregateGranularity, number> = { "15m": 900, "1h": 3600 };

export function bucketStart(at: string | number, granularity: AggregateGranularity): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  const size = GRANULARITY_SECONDS[granularity] * 1000;
  return new Date(Math.floor(ms / size) * size).toISOString();
}

export interface BucketStats {
  count: number;
  suspectCount: number;
  sum: number;
  sumSq: number;
  min: number | null;
  max: number | null;
}

export const EMPTY_BUCKET: BucketStats = { count: 0, suspectCount: 0, sum: 0, sumSq: 0, min: null, max: null };

/** Adds one reading. Flagged readings are counted apart and never enter the statistics. */
export function addReading(bucket: BucketStats, value: number, usable: boolean): BucketStats {
  if (!usable) return { ...bucket, suspectCount: bucket.suspectCount + 1 };
  return {
    count: bucket.count + 1,
    suspectCount: bucket.suspectCount,
    sum: bucket.sum + value,
    sumSq: bucket.sumSq + value * value,
    min: bucket.min === null ? value : Math.min(bucket.min, value),
    max: bucket.max === null ? value : Math.max(bucket.max, value),
  };
}

export function mergeBuckets(a: BucketStats, b: BucketStats): BucketStats {
  return {
    count: a.count + b.count,
    suspectCount: a.suspectCount + b.suspectCount,
    sum: a.sum + b.sum,
    sumSq: a.sumSq + b.sumSq,
    min: a.min === null ? b.min : b.min === null ? a.min : Math.min(a.min, b.min),
    max: a.max === null ? b.max : b.max === null ? a.max : Math.max(a.max, b.max),
  };
}

export function mean(b: Pick<BucketStats, "count" | "sum">): number | null {
  return b.count > 0 ? b.sum / b.count : null;
}

/** Population standard deviation of the bucket. Clamped at 0 against floating-point noise. */
export function stddev(b: Pick<BucketStats, "count" | "sum" | "sumSq">): number | null {
  if (b.count === 0) return null;
  const m = b.sum / b.count;
  return Math.sqrt(Math.max(0, b.sumSq / b.count - m * m));
}

/** Readings a sensor promised in a bucket, from its acquisition interval; null when it is not periodic. */
export function expectedCount(granularity: AggregateGranularity, acquisitionSeconds: number | null): number | null {
  if (!acquisitionSeconds || acquisitionSeconds <= 0) return null;
  return Math.max(1, Math.floor(GRANULARITY_SECONDS[granularity] / acquisitionSeconds));
}

/**
 * Share of the promised readings that arrived and were usable, 0..1. A suspect reading is not
 * "available": the point of the figure is to say how much of the period the data really covers.
 */
export function availability(b: Pick<BucketStats, "count">, expected: number | null): number | null {
  if (expected === null || expected <= 0) return null;
  return Math.min(1, b.count / expected);
}

/** Availability over many buckets, weighted by what each promised. */
export function overallAvailability(buckets: { count: number; expected: number | null }[]): number | null {
  let got = 0;
  let promised = 0;
  for (const b of buckets) {
    if (b.expected === null) continue;
    got += Math.min(b.count, b.expected);
    promised += b.expected;
  }
  return promised > 0 ? got / promised : null;
}

/** A bucket is closed — safe to aggregate for good — once its end is before the cut-off. */
export function isClosed(bucketStartIso: string, granularity: AggregateGranularity, cutoff: number): boolean {
  return Date.parse(bucketStartIso) + GRANULARITY_SECONDS[granularity] * 1000 <= cutoff;
}
