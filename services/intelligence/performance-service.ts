import { computeTrend, type TrendResult } from "../../domain/intelligence/trend";
import { KPI_CODE, type KpiCode } from "../../domain/intelligence/kpi-definitions";
import { computeKpi, fetchLotRecords, rollingPeriod, type KpiResult, type LotRecordsBundle } from "./kpi-service";

/**
 * Reusable "current vs reference period" performance analysis (phase-6 brief §6-§7).
 * Reference is explicit and fixed: the same-length period immediately preceding the current
 * one (rollingPeriod's `offsetDays` param) — never an arbitrary comparison. Only meaningful
 * for KPIs with a real rolling-period definition (not CURRENT_POPULATION, which is
 * instantaneous, or FCR, whose "period" is the two-weigh-in bracket, not a fixed window).
 */
export interface PerformanceSnapshot {
  code: KpiCode;
  current: KpiResult;
  previous: KpiResult;
  trend: TrendResult;
}

const TRENDABLE_KPIS: readonly KpiCode[] = ["MORTALITY_RATE", "AVERAGE_WEIGHT", "FEED_CONSUMPTION", "WATER_CONSUMPTION"];

export function isTrendable(code: KpiCode): boolean {
  return TRENDABLE_KPIS.includes(code);
}

export async function getPerformanceSnapshot(
  lotId: string,
  code: KpiCode,
  now: Date = new Date(),
  periodDays = 7,
  preFetchedRecords?: LotRecordsBundle
): Promise<PerformanceSnapshot> {
  if (!isTrendable(code)) {
    throw new Error(`KPI "${code}" doesn't have a rolling-period trend definition.`);
  }
  const records = preFetchedRecords ?? (await fetchLotRecords(lotId));
  const current = await computeKpi(lotId, code, now, periodDays, records);
  // The reference period precedes the current one wherever that ends: now, or a closed lot's end.
  const previousReferenceNow = rollingPeriod(current.period.to, periodDays, periodDays).to;
  const previous = await computeKpi(lotId, code, previousReferenceNow, periodDays, records);
  const observationCount = current.sourceCount + previous.sourceCount;
  const trend = computeTrend(current.value, previous.value, observationCount);
  return { code, current, previous, trend };
}

export interface KpiWithTrend {
  code: KpiCode;
  result: KpiResult;
  trend?: TrendResult;
}

/** Every KPI for a lot in one pass — the Lot "Performance" tab and the dashboard both read through this, never a second computation path. */
export async function getLotPerformanceOverview(lotId: string, now: Date = new Date()): Promise<KpiWithTrend[]> {
  const records = await fetchLotRecords(lotId);
  const overview: KpiWithTrend[] = [];
  for (const code of KPI_CODE) {
    if (isTrendable(code)) {
      const snapshot = await getPerformanceSnapshot(lotId, code, now, 7, records);
      overview.push({ code, result: snapshot.current, trend: snapshot.trend });
    } else {
      overview.push({ code, result: await computeKpi(lotId, code, now, 7, records) });
    }
  }
  return overview;
}
