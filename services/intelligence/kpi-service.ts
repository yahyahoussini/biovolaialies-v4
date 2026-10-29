import { repositories } from "../../data/repositories";
import {
  ageAdjustedReference,
  calculateFcr,
  calculateGrowthRatePerDay,
  calculateMortalityRate,
  filterByPeriod,
  latestWeight,
  sumQuantity,
} from "../../domain/intelligence/kpi-calculations";
import { KPI_DEFINITIONS, type KpiCode } from "../../domain/intelligence/kpi-definitions";
import { evaluateKpiEligibility, type KpiEligibility } from "../../domain/intelligence/kpi-eligibility";
import { reconcilePopulation, type PopulationReconciliation } from "../../domain/production/reconciliation";
import type { DataStatus } from "../../domain/shared/enums";
import { NotFoundError } from "../../domain/shared/errors";
import type { KpiDefinition, KpiValue } from "../../domain/intelligence/types";
import { getLotOrThrow } from "../production/lot";

/**
 * The live KPI engine (phase-6 brief §1-§5). KPIs are computed on demand from the same
 * structured records the Phase-3 data-quality engine already validates — never persisted
 * on every render (that would be a `kpi_values` row per page view). A row is only written
 * as durable evidence when a rule fires — see persistKpiEvidence() and services/intelligence/detection.ts.
 */

export interface Period {
  from: Date;
  to: Date;
  label: string;
}

/** A rolling window ending `offsetDays` before `now` — e.g. rollingPeriod(now, 7, 7) is "the 7 days before the current 7-day period". */
export function rollingPeriod(now: Date, days: number, offsetDays = 0): Period {
  const to = new Date(now.getTime() - offsetDays * 86_400_000);
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to, label: offsetDays === 0 ? `${days} derniers jours` : `${days} jours précédents` };
}

export interface KpiResult {
  code: KpiCode;
  label: string;
  unit: string;
  value: number | null;
  eligibility: KpiEligibility;
  eligibilityReason: string | null;
  /** The KPI value's own status — always CALCULE (it's a derived number); eligibility carries the input-quality signal separately (brief §5's worked example). */
  dataStatus: DataStatus;
  period: Period;
  calculatedAt: string;
  formula: string;
  sourceCount: number;
  populationReconciliation?: PopulationReconciliation;
}

export interface LotRecordsBundle {
  mortality: Awaited<ReturnType<typeof repositories.mortalityRecords.listByLot>>;
  weight: Awaited<ReturnType<typeof repositories.weightMeasurements.listByLot>>;
  feed: Awaited<ReturnType<typeof repositories.feedUsage.listByLot>>;
  water: Awaited<ReturnType<typeof repositories.waterUsage.listByLot>>;
}

export async function fetchLotRecords(lotId: string): Promise<LotRecordsBundle> {
  const [mortality, weight, feed, water] = await Promise.all([
    repositories.mortalityRecords.listByLot(lotId),
    repositories.weightMeasurements.listByLot(lotId),
    repositories.feedUsage.listByLot(lotId),
    repositories.waterUsage.listByLot(lotId),
  ]);
  return { mortality, weight, feed, water };
}

function result(
  code: KpiCode,
  value: number | null,
  eligibility: KpiEligibility,
  eligibilityReason: string | null,
  period: Period,
  calculatedAt: string,
  sourceCount: number,
  populationReconciliation?: PopulationReconciliation
): KpiResult {
  const def = KPI_DEFINITIONS[code];
  return {
    code,
    label: def.label,
    unit: def.unit,
    value,
    eligibility,
    eligibilityReason,
    dataStatus: "CALCULE",
    period,
    calculatedAt,
    formula: def.formula,
    sourceCount,
    populationReconciliation,
  };
}

export async function computeKpi(
  lotId: string,
  code: KpiCode,
  now: Date = new Date(),
  periodDays = 7,
  records?: LotRecordsBundle
): Promise<KpiResult> {
  const lot = await getLotOrThrow(lotId);
  const { mortality, weight, feed, water } = records ?? (await fetchLotRecords(lotId));
  // A lot that has ended is read at its end: its figures stay those of its last days instead of
  // emptying a week after it closes (document 3 keeps an archive of finished lots).
  const endedAt = lot.endedAt ? Date.parse(lot.endedAt) : null;
  const reference = endedAt !== null && endedAt < now.getTime() ? new Date(endedAt) : now;
  const ended = reference !== now;
  const rolling = rollingPeriod(reference, periodDays);
  const period = ended ? { ...rolling, label: `${rolling.label} avant la clôture` } : rolling;
  const calculatedAt = now.toISOString();

  switch (code) {
    case "CURRENT_POPULATION": {
      const totalMortality = mortality.reduce((sum, r) => sum + r.count, 0);
      const reconciliation = reconcilePopulation({
        initialPopulation: lot.initialPopulation,
        totalMortality,
        totalExits: 0,
        totalEntries: 0,
        recordedPopulation: lot.currentPopulation,
      });
      return result(
        code,
        lot.currentPopulation,
        reconciliation.consistent ? "AVAILABLE" : "LIMITED",
        reconciliation.consistent ? null : `Écart de ${reconciliation.difference} sujet(s) avec la population attendue d'après l'historique.`,
        { from: reference, to: reference, label: ended ? "À la clôture" : "Instantané" },
        calculatedAt,
        mortality.length,
        reconciliation
      );
    }

    case "MORTALITY_RATE": {
      const inPeriod = filterByPeriod(mortality, period.from, period.to);
      const mortalityInPeriod = inPeriod.reduce((sum, r) => sum + r.count, 0);
      const populationAtStart = lot.currentPopulation + mortalityInPeriod;
      const value = calculateMortalityRate(mortalityInPeriod, populationAtStart);
      // Zero mortality records in the period is a real, confident 0% — not "insufficient data" (unlike feed/water, mortality has no implicit "must be logged regularly" expectation).
      if (inPeriod.length === 0) {
        return result(code, value, "AVAILABLE", null, period, calculatedAt, 0);
      }
      const eligibility = evaluateKpiEligibility(inPeriod.map((r) => r.dataStatus));
      return result(code, value, eligibility.eligibility, eligibility.reason, period, calculatedAt, inPeriod.length);
    }

    case "AVERAGE_WEIGHT": {
      const inPeriod = filterByPeriod(weight, period.from, period.to);
      const latest = latestWeight(inPeriod);
      const eligibility = evaluateKpiEligibility(inPeriod.map((r) => r.dataStatus));
      return result(code, latest?.averageWeight ?? null, eligibility.eligibility, eligibility.reason, period, calculatedAt, inPeriod.length);
    }

    case "FEED_CONSUMPTION": {
      const inPeriod = filterByPeriod(feed, period.from, period.to);
      const value = inPeriod.length === 0 ? null : sumQuantity(inPeriod);
      const eligibility = evaluateKpiEligibility(inPeriod.map((r) => r.dataStatus));
      return result(code, value, eligibility.eligibility, eligibility.reason, period, calculatedAt, inPeriod.length);
    }

    case "WATER_CONSUMPTION": {
      const inPeriod = filterByPeriod(water, period.from, period.to);
      const value = inPeriod.length === 0 ? null : sumQuantity(inPeriod);
      const eligibility = evaluateKpiEligibility(inPeriod.map((r) => r.dataStatus));
      return result(code, value, eligibility.eligibility, eligibility.reason, period, calculatedAt, inPeriod.length);
    }

    case "FCR": {
      const sorted = [...weight].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      const [latest, previous] = sorted;
      if (!latest || !previous) {
        return result(
          code,
          null,
          "INSUFFICIENT",
          "Au moins deux pesées sont nécessaires pour calculer le FCR.",
          period,
          calculatedAt,
          weight.length
        );
      }
      const bracket = { from: new Date(previous.occurredAt), to: new Date(latest.occurredAt) };
      const feedInInterval = filterByPeriod(feed, bracket.from, bracket.to);
      const feedKg = sumQuantity(feedInInterval);
      const flockWeightGainKg = (latest.averageWeight - previous.averageWeight) * lot.currentPopulation;
      const value = calculateFcr(feedKg, flockWeightGainKg);
      const bracketLabel = `Entre le ${bracket.from.toLocaleDateString("fr-FR")} et le ${bracket.to.toLocaleDateString("fr-FR")}`;
      if (value === null) {
        return result(
          code,
          null,
          "INSUFFICIENT",
          "Le gain de poids sur l'intervalle n'est pas positif — FCR non calculable.",
          { ...bracket, label: bracketLabel },
          calculatedAt,
          feedInInterval.length + 2
        );
      }
      const eligibility = evaluateKpiEligibility([...feedInInterval.map((r) => r.dataStatus), latest.dataStatus, previous.dataStatus]);
      return result(
        code,
        value,
        eligibility.eligibility,
        eligibility.reason,
        { ...bracket, label: bracketLabel },
        calculatedAt,
        feedInInterval.length + 2
      );
    }

    default:
      throw new Error(`Unknown KPI code: ${code satisfies never}`);
  }
}

/** Growth rate (kg/day) between the two most recent weight measurements — shared by the FCR calc and the performance-decline rule. */
export function currentGrowthRate(weight: LotRecordsBundle["weight"]): { current: number | null; previous: number | null } {
  const sorted = [...weight].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  if (sorted.length < 3) return { current: null, previous: null };
  const [m1, m2, m3] = sorted.slice(-3);
  return { current: calculateGrowthRatePerDay(m3, m2), previous: calculateGrowthRatePerDay(m2, m1) };
}

/**
 * Age-adjusted feed reference for the current 7-day period vs the previous one — see
 * domain/intelligence/kpi-calculations.ts's ageAdjustedReference for why a raw period-over-
 * period comparison would be biased. Returns null if the lot isn't old enough yet.
 */
export function ageAdjustedFeedReference(
  feed: LotRecordsBundle["feed"],
  lotStartedAt: string,
  now: Date,
  periodDays = 7
): { currentKg: number; referenceKg: number | null; dataStatus: DataStatus | null } {
  const current = rollingPeriod(now, periodDays);
  const previous = rollingPeriod(now, periodDays, periodDays);
  const currentRecords = filterByPeriod(feed, current.from, current.to);
  const previousRecords = filterByPeriod(feed, previous.from, previous.to);
  const currentKg = sumQuantity(currentRecords);
  const previousKg = sumQuantity(previousRecords);

  const startedAtMs = new Date(lotStartedAt).getTime();
  const currentMidAgeDays = (current.from.getTime() + current.to.getTime()) / 2 / 86_400_000 - startedAtMs / 86_400_000;
  const previousMidAgeDays = (previous.from.getTime() + previous.to.getTime()) / 2 / 86_400_000 - startedAtMs / 86_400_000;

  const referenceKg = ageAdjustedReference(previousKg, currentMidAgeDays, previousMidAgeDays);
  const dataStatus = currentRecords[0]?.dataStatus ?? previousRecords[0]?.dataStatus ?? null;
  return { currentKg, referenceKg, dataStatus };
}

/**
 * Persists a `kpi_values` row as durable evidence for an anomaly (`anomalies.kpiValueId`) —
 * the one case a KPI computation IS written to the database. Idempotent lookup of the
 * `kpi_definitions` row (findOrCreate) so this never depends on a seed step having run first.
 */
export async function persistKpiEvidence(
  lotId: string,
  code: KpiCode,
  value: number,
  period: Period,
  dataStatus: DataStatus,
  now: Date
): Promise<KpiValue> {
  const definition = await findOrCreateKpiDefinition(code);
  return repositories.kpiValues.create({
    kpiDefinitionId: definition.id,
    lotId,
    buildingId: null,
    period: `${period.from.toISOString().slice(0, 10)}/${period.to.toISOString().slice(0, 10)}`,
    value,
    dataStatus: "CALCULE",
    calculatedAt: now.toISOString(),
  });
}

export async function findOrCreateKpiDefinition(code: KpiCode): Promise<KpiDefinition> {
  const existing = await repositories.kpiDefinitions.findByCode(code);
  if (existing) return existing;
  const spec = KPI_DEFINITIONS[code];
  return repositories.kpiDefinitions.create({ code: spec.code, label: spec.label, unit: spec.unit, formulaDesc: spec.formula });
}

export async function requireKpiDefinition(code: KpiCode): Promise<KpiDefinition> {
  const def = await repositories.kpiDefinitions.findByCode(code);
  if (!def) throw new NotFoundError("KpiDefinition", code);
  return def;
}
