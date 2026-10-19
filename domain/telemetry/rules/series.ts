import type { SensorType, ZoneKind } from "../../shared/enums";

/**
 * One channel's usable readings (flag OK only), sorted by time. Rules read these through the
 * helpers below, which never look past the evaluation instant: a rule replayed over three days
 * of catch-up sees, at each step, exactly what it would have seen live.
 */
export interface ChannelSeries {
  sensorId: string;
  sensorCode: string | null;
  sensorType: SensorType;
  catalogRef: string | null;
  zoneId: string | null;
  zoneKind: ZoneKind | null;
  zoneName: string | null;
  position: string | null;
  unit: string;
  times: number[];
  values: number[];
  /**
   * A site-level channel (weather, tank, run) hosted by another building of the farm: readable
   * as context here, but judged only in its host building, so one tank never raises two alerts.
   */
  contextOnly?: boolean;
}

/** Index of the last reading at or before `at`, or -1. */
export function lastIndexAtOrBefore(times: number[], at: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= at) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Index of the first reading strictly after `at`, or times.length. */
function firstIndexAfter(times: number[], at: number): number {
  return lastIndexAtOrBefore(times, at) + 1;
}

/** Latest value no older than `maxAgeSeconds` at instant `at`. */
export function latest(s: ChannelSeries | undefined, at: number, maxAgeSeconds: number): { value: number; at: number } | null {
  if (!s) return null;
  const i = lastIndexAtOrBefore(s.times, at);
  if (i < 0 || at - s.times[i] > maxAgeSeconds * 1000) return null;
  return { value: s.values[i], at: s.times[i] };
}

/** Values in (from, to]. */
export function windowValues(s: ChannelSeries | undefined, from: number, to: number): number[] {
  if (!s) return [];
  const start = firstIndexAfter(s.times, from);
  const end = lastIndexAtOrBefore(s.times, to);
  return end >= start ? s.values.slice(start, end + 1) : [];
}

/** Times and values in (from, to]. */
export function windowPoints(s: ChannelSeries | undefined, from: number, to: number): { t: number; v: number }[] {
  if (!s) return [];
  const start = firstIndexAfter(s.times, from);
  const end = lastIndexAtOrBefore(s.times, to);
  const out: { t: number; v: number }[] = [];
  for (let i = start; i <= end; i++) out.push({ t: s.times[i], v: s.values[i] });
  return out;
}

export function meanOf(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean of the last `minutes` before `at`; null when the window holds no reading. */
export function recentMean(s: ChannelSeries | undefined, at: number, minutes: number): number | null {
  return meanOf(windowValues(s, at - minutes * 60_000, at));
}

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** A number as a French reader writes it in a diagnosis (decimal comma, at most 2 decimals). */
export const fr = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
