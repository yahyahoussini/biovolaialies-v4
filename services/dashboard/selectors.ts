import { DATA_STATUS, type DataStatus, type LotStatus, type SensorType } from "../../domain/shared/enums";
import { LOT_STATUS_LABEL } from "../../lib/status-colors";
import type { AlertWithContext } from "../intelligence/queries";
import type {
  DashboardDevice,
  DashboardEvent,
  DashboardFilters,
  DashboardKpis,
  DashboardLot,
  DashboardSensorReading,
  NeedsAttentionItem,
  ScopeQualitySummary,
  TrendPoint,
} from "./types";

/**
 * Pure, framework-agnostic aggregation over an already-fetched DashboardOverview slice.
 * No I/O here — `overview.ts` does the fetching, this file only computes. That split is
 * what lets the exact same functions run once on the server (initial render) and again on
 * the client (interactive filters) without a second round-trip to the database, and lets
 * every number here be unit-tested without a database (phase-5 brief §17).
 */

/** Lots with birds in them — a created lot has none yet. Shared with the role views so a page never shows two headcounts. */
export const OCCUPIED_LOT_STATUSES: readonly LotStatus[] = ["ACTIF", "EN_TRANSFERT", "SUSPENDU", "BLOQUE", "LIBERE"];
const ATTENTION_LOT_STATUSES: readonly LotStatus[] = ["SUSPENDU", "BLOQUE"];

function matchesScope(farmId: string, buildingId: string, filters: DashboardFilters): boolean {
  if (filters.farmId !== "ALL" && farmId !== filters.farmId) return false;
  if (filters.buildingId !== "ALL" && buildingId !== filters.buildingId) return false;
  return true;
}

export function filterLots(lots: DashboardLot[], filters: DashboardFilters): DashboardLot[] {
  return lots.filter((lot) => matchesScope(lot.farmId, lot.buildingId, filters));
}

export function filterDevices(devices: DashboardDevice[], filters: DashboardFilters): DashboardDevice[] {
  return devices.filter((device) => matchesScope(device.farmId, device.buildingId, filters));
}

export function filterEvents(events: DashboardEvent[], filters: DashboardFilters, now: Date): DashboardEvent[] {
  const cutoff = now.getTime() - filters.periodDays * 86_400_000;
  return events
    .filter((event) => matchesScope(event.farmId, event.buildingId, filters))
    .filter((event) => new Date(event.occurredAt).getTime() >= cutoff);
}

/** Active alerts aren't period-filtered — an open alert doesn't stop being relevant because it's older than the selected window. */
export function filterAlerts(alerts: AlertWithContext[], filters: DashboardFilters): AlertWithContext[] {
  return alerts.filter((entry) => {
    const farmId = entry.farmId ?? "";
    const buildingId = entry.buildingId ?? "";
    return matchesScope(farmId, buildingId, filters);
  });
}

export function computeKpis(
  lots: DashboardLot[],
  devices: DashboardDevice[],
  alerts: AlertWithContext[],
  filters: DashboardFilters,
  now: Date
): DashboardKpis {
  const cutoff = now.getTime() - filters.periodDays * 86_400_000;
  let feedQuantityKg = 0;
  for (const lot of lots) {
    for (const record of lot.feedRecords) {
      const t = new Date(record.occurredAt).getTime();
      if (t >= cutoff && t <= now.getTime()) feedQuantityKg += record.quantity;
    }
  }

  return {
    activeLots: lots.filter((lot) => lot.status === "ACTIF").length,
    totalLots: lots.length,
    population: lots
      .filter((lot) => OCCUPIED_LOT_STATUSES.includes(lot.status))
      .reduce((sum, lot) => sum + lot.currentPopulation, 0),
    feedQuantityKg: Math.round(feedQuantityKg * 10) / 10,
    devicesTotal: devices.length,
    devicesOnline: devices.filter((d) => d.status === "ONLINE").length,
    devicesOffline: devices.filter((d) => d.status === "OFFLINE").length,
    devicesFault: devices.filter((d) => d.status === "FAULT").length,
    activeAlerts: alerts.length,
  };
}

/** Daily feed-consumption trend, zero-filled so gaps in the seeded/real data don't read as a broken chart. */
export function computeFeedTrend(lots: DashboardLot[], filters: DashboardFilters, now: Date): TrendPoint[] {
  const byDay = new Map<string, number>();
  const start = new Date(now.getTime() - (filters.periodDays - 1) * 86_400_000);

  for (let i = 0; i < filters.periodDays; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }

  const startOfWindow = start.getTime();
  for (const lot of lots) {
    for (const record of lot.feedRecords) {
      const t = new Date(record.occurredAt).getTime();
      if (t < startOfWindow || t > now.getTime()) continue;
      const key = record.occurredAt.slice(0, 10);
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + record.quantity);
    }
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: Math.round(value * 10) / 10 }));
}

/** Weighted average of each lot's own (already-computed) quality score — see services/quality/lot-quality.ts. */
export function aggregateScopeQuality(lots: DashboardLot[]): ScopeQualitySummary {
  const byDataStatus = Object.fromEntries(DATA_STATUS.map((status) => [status, 0])) as Record<DataStatus, number>;
  let totalRecords = 0;
  let errorCount = 0;
  let warningCount = 0;
  let lotsWithIssues = 0;
  let weightedScoreSum = 0;
  let weightSum = 0;

  for (const lot of lots) {
    totalRecords += lot.quality.totalRecords;
    errorCount += lot.quality.errorCount;
    warningCount += lot.quality.warningCount;
    if (lot.quality.errorCount > 0 || lot.quality.warningCount > 0) lotsWithIssues += 1;
    for (const status of DATA_STATUS) byDataStatus[status] += lot.quality.byDataStatus[status];

    const weight = lot.quality.totalRecords + 1; // +1 mirrors the population-reconciliation check counted per lot
    weightedScoreSum += lot.quality.scorePercent * weight;
    weightSum += weight;
  }

  return {
    totalRecords,
    byDataStatus,
    errorCount,
    warningCount,
    scorePercent: weightSum === 0 ? 100 : Math.round(weightedScoreSum / weightSum),
    lotsWithIssues,
  };
}

function formatRelative(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

/**
 * Everything the "À surveiller" section shows (phase-5 brief §7) — data-quality issues
 * (including population inconsistencies, already folded into lot.quality.issues by
 * services/quality/lot-quality.ts), offline/fault devices, stale sensor readings on
 * devices that otherwise report ONLINE, and lots stuck in SUSPENDU/BLOQUE. No alert/anomaly
 * engine here — this only surfaces conditions that already exist in the data.
 */
export function buildNeedsAttentionItems(lots: DashboardLot[], devices: DashboardDevice[], now: Date): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = [];

  for (const lot of lots) {
    for (const [index, entry] of lot.quality.issues.entries()) {
      items.push({
        id: `quality-${lot.id}-${entry.recordType}-${entry.recordId}-${index}`,
        severity: entry.issue.severity === "error" ? "critical" : "warning",
        title: entry.issue.code === "POPULATION_INCONSISTENCY" ? "Incohérence d'effectif" : "Donnée à vérifier",
        context: `Lot ${lot.code} — ${lot.farmName}`,
        reason: entry.issue.message,
        time: null,
        href: `/lots/${lot.id}`,
        farmId: lot.farmId,
        buildingId: lot.buildingId,
      });
    }

    if (ATTENTION_LOT_STATUSES.includes(lot.status)) {
      items.push({
        id: `lot-status-${lot.id}`,
        severity: lot.status === "BLOQUE" ? "critical" : "warning",
        title: `Lot ${LOT_STATUS_LABEL[lot.status].toLowerCase()}`,
        context: `Lot ${lot.code} — ${lot.farmName}`,
        reason: "Nécessite une revue de statut.",
        time: null,
        href: `/lots/${lot.id}`,
        farmId: lot.farmId,
        buildingId: lot.buildingId,
      });
    }
  }

  for (const device of devices) {
    if (device.status === "OFFLINE" || device.status === "FAULT") {
      items.push({
        id: `device-status-${device.id}`,
        severity: device.status === "FAULT" ? "critical" : "warning",
        title: device.status === "FAULT" ? "Appareil en défaut" : "Appareil hors ligne",
        context: `${device.code} — ${device.farmName} · ${device.buildingCode}`,
        reason: device.lastCommunicationAt
          ? `Dernière communication ${formatRelative(device.lastCommunicationAt, now)}.`
          : "Aucune communication enregistrée.",
        time: device.lastCommunicationAt,
        href: `/iot/${device.id}`,
        farmId: device.farmId,
        buildingId: device.buildingId,
      });
    } else if (device.staleSensorCount > 0) {
      items.push({
        id: `device-stale-${device.id}`,
        severity: "warning",
        title: "Mesures obsolètes",
        context: `${device.code} — ${device.farmName} · ${device.buildingCode}`,
        reason: `${device.staleSensorCount} capteur(s) sans lecture récente.`,
        time: null,
        href: `/iot/${device.id}`,
        farmId: device.farmId,
        buildingId: device.buildingId,
      });
    }
  }

  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/**
 * Real persisted alerts (phase-6 brief §19), reusing the exact same NeedsAttentionItem shape
 * and NeedsAttentionList component the "À surveiller" section already uses — an additive
 * section, not a dashboard redesign.
 */
export function mapAlertsToAttentionItems(alerts: AlertWithContext[]): NeedsAttentionItem[] {
  const items = alerts.map((entry): NeedsAttentionItem => {
    const context = entry.lotCode
      ? `Lot ${entry.lotCode} — ${entry.farmName ?? "—"}`
      : entry.buildingCode
        ? `${entry.buildingCode} — ${entry.farmName ?? "—"}`
        : "—";
    return {
      id: `alert-${entry.alert.id}`,
      severity: entry.anomaly.severity === "CRITICAL" ? "critical" : "warning",
      title: entry.rule?.name ?? entry.anomaly.explanation.what,
      context,
      reason: entry.anomaly.explanation.whatChanged,
      time: entry.anomaly.detectedAt,
      href: `/alertes/${entry.alert.id}`,
      farmId: entry.farmId ?? "",
      buildingId: entry.buildingId ?? "",
    };
  });
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

const ENVIRONMENT_SENSOR_TYPES: readonly SensorType[] = ["TEMPERATURE", "HUMIDITE", "CO2"];

export interface EnvironmentAverage extends DashboardSensorReading {
  sensorCount: number;
}

/** Averages each environmental sensor type's latest reading across every device in scope — the "Temperature 27.4°C / Humidity 64% / CO2 1020 ppm" row (phase-5 brief §6). */
export function computeEnvironmentAverages(devices: DashboardDevice[]): EnvironmentAverage[] {
  const bySensorType = new Map<SensorType, DashboardSensorReading[]>();
  for (const device of devices) {
    for (const reading of device.latestReadings) {
      if (!ENVIRONMENT_SENSOR_TYPES.includes(reading.sensorType)) continue;
      const list = bySensorType.get(reading.sensorType) ?? [];
      list.push(reading);
      bySensorType.set(reading.sensorType, list);
    }
  }

  return ENVIRONMENT_SENSOR_TYPES.filter((type) => bySensorType.has(type)).map((type) => {
    const readings = bySensorType.get(type)!;
    const average = readings.reduce((sum, r) => sum + r.value, 0) / readings.length;
    const latestCapturedAt = readings.reduce((latest, r) => (r.capturedAt > latest ? r.capturedAt : latest), readings[0].capturedAt);
    return {
      sensorType: type,
      value: Math.round(average * 10) / 10,
      unit: readings[0].unit,
      dataStatus: readings[0].dataStatus,
      capturedAt: latestCapturedAt,
      sensorCount: readings.length,
    };
  });
}
