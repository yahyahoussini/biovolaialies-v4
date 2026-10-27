import { repositories } from "../../data/repositories";
import {
  checkEnvironmentMeasurementQuality,
  checkFeedUsageQuality,
  checkMortalityRecordQuality,
  checkWaterUsageQuality,
  checkWeightMeasurementQuality,
} from "../../domain/quality/production-data-quality";
import type { QualityCheckResult, QualityIssue } from "../../domain/quality/types";
import { reconcilePopulation, type PopulationReconciliation } from "../../domain/production/reconciliation";
import { DATA_STATUS, type DataStatus } from "../../domain/shared/enums";
import { getLotOrThrow } from "../production/lot";

export type LotQualityRecordType = "feed" | "water" | "weight" | "mortality" | "environment" | "population";

export interface LotQualityRecordIssue {
  recordType: LotQualityRecordType;
  recordId: string;
  issue: QualityIssue;
}

export interface LotDataQualitySummary {
  totalRecords: number;
  byDataStatus: Record<DataStatus, number>;
  errorCount: number;
  warningCount: number;
  /** Share of checked items (records + the population reconciliation) with zero errors. */
  scorePercent: number;
  issues: LotQualityRecordIssue[];
  populationReconciliation: PopulationReconciliation;
}

/**
 * Runs the data-quality engine (domain/quality) against every structured record this lot
 * owns, plus population reconciliation, and rolls the result into one summary — the
 * numbers behind the Lot Data tab's quality card (phase-3 brief §17). Nothing here is
 * hardcoded: every count is derived from what's actually in the database right now.
 */
export async function computeLotDataQuality(lotId: string): Promise<LotDataQualitySummary> {
  const lot = await getLotOrThrow(lotId);
  const [feed, water, weight, mortality, environment] = await Promise.all([
    repositories.feedUsage.listByLot(lotId),
    repositories.waterUsage.listByLot(lotId),
    repositories.weightMeasurements.listByLot(lotId),
    repositories.mortalityRecords.listByLot(lotId),
    repositories.environmentMeasurements.listByLot(lotId),
  ]);

  const byDataStatus = Object.fromEntries(DATA_STATUS.map((status) => [status, 0])) as Record<DataStatus, number>;
  const issues: LotQualityRecordIssue[] = [];

  function tally(record: { id: string; dataStatus: DataStatus }, type: LotQualityRecordType, result: QualityCheckResult) {
    byDataStatus[record.dataStatus] += 1;
    for (const issue of result.issues) {
      issues.push({ recordType: type, recordId: record.id, issue });
    }
  }

  for (const record of feed) tally(record, "feed", checkFeedUsageQuality(record));
  for (const record of water) tally(record, "water", checkWaterUsageQuality(record, record.buildingId));
  for (const record of weight) tally(record, "weight", checkWeightMeasurementQuality(record));
  for (const record of mortality) tally(record, "mortality", checkMortalityRecordQuality(record));
  for (const record of environment) {
    tally(record, "environment", checkEnvironmentMeasurementQuality(record, record.buildingId));
  }

  const totalMortality = mortality.reduce((sum, record) => sum + record.count, 0);
  // Birds leave a lot with a transfer at departure (a cancelled one gives them back). Birds
  // received are already in initialPopulation: a reception sets or raises it with its own count.
  const totalExits = (await repositories.transfers.listByObject("LOT", lot.id))
    .filter((t) => t.status !== "ANNULE")
    .reduce((sum, t) => sum + t.quantitySent, 0);
  const populationReconciliation = reconcilePopulation({
    initialPopulation: lot.initialPopulation,
    totalMortality,
    totalExits,
    totalEntries: 0,
    recordedPopulation: lot.currentPopulation,
  });
  if (!populationReconciliation.consistent) {
    issues.push({
      recordType: "population",
      recordId: lot.id,
      issue: {
        severity: "error",
        code: "POPULATION_INCONSISTENCY",
        message: `Population attendue ${populationReconciliation.expectedPopulation}, population enregistrée ${populationReconciliation.recordedPopulation} (écart de ${populationReconciliation.difference}).`,
      },
    });
  }

  const totalRecords = feed.length + water.length + weight.length + mortality.length + environment.length;
  const errorCount = issues.filter((entry) => entry.issue.severity === "error").length;
  const warningCount = issues.filter((entry) => entry.issue.severity === "warning").length;

  const checkedItems = totalRecords + 1; // +1 for the population reconciliation check itself
  const itemsWithErrors = new Set(
    issues.filter((entry) => entry.issue.severity === "error").map((entry) => `${entry.recordType}:${entry.recordId}`)
  ).size;
  const scorePercent = checkedItems === 0 ? 100 : Math.round(((checkedItems - itemsWithErrors) / checkedItems) * 100);

  return { totalRecords, byDataStatus, errorCount, warningCount, scorePercent, issues, populationReconciliation };
}
