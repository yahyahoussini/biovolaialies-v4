import { repositories } from "../../data/repositories";
import type { Device, Sensor } from "../../domain/iot/types";
import { availability, mean, overallAvailability, stddev } from "../../domain/telemetry/aggregate";
import { CONTROLLER_CHANNELS, sensorSpec } from "../../domain/telemetry/catalog";
import { occupantAt } from "../../domain/telemetry/occupation";
import type { MeasurementAggregate, RuleStateRow, Zone } from "../../domain/telemetry/types";
import type { ReadingFlag } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import type { Session } from "../auth/session";
import { assertInScope, isWithinScope, resolveBuildingHierarchy } from "../identity/scope-check";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function buildingsInScope(session: Session) {
  const buildings = await repositories.buildings.list();
  const out = [];
  for (const b of buildings) if (isWithinScope(session, await resolveBuildingHierarchy(b.id))) out.push(b);
  return out;
}

export interface BuildingTelemetrySummary {
  buildingId: string;
  buildingLabel: string;
  farmName: string;
  gateway: Device | null;
  channels: number;
  /** Instant the availability window ends: the newest reading of the building, not "now". */
  lastReadingAt: string | null;
  availability24h: number | null;
  flagged24h: Partial<Record<ReadingFlag, number>>;
  activeStates: number;
  critical: number;
}

export async function telemetryOverview(session: Session): Promise<BuildingTelemetrySummary[]> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const devices = await repositories.devices.list();
  const farms = new Map((await repositories.farms.list()).map((f) => [f.id, f.name]));
  const states = await repositories.ruleStates.listNonNormal();
  const out: BuildingTelemetrySummary[] = [];
  for (const b of await buildingsInScope(session)) {
    const gateway = devices.find((d) => d.buildingId === b.id && d.type === "PASSERELLE") ?? null;
    if (!gateway) continue;
    const own = devices.filter((d) => d.buildingId === b.id).map((d) => d.id);
    const sensors = (await repositories.telemetrySensors.listByDevices(own)) as Sensor[];
    const range = await repositories.readings.rangeOf(sensors.map((s) => s.id));
    let availability24h: number | null = null;
    const flagged24h: Partial<Record<ReadingFlag, number>> = {};
    if (range.last) {
      const to = Date.parse(range.last);
      const quarters = await repositories.aggregates.list("15m", sensors.map((s) => s.id), new Date(to - DAY).toISOString(), new Date(to).toISOString());
      availability24h = overallAvailability(quarters);
      for (const row of await repositories.readings.countByFlag(b.id, new Date(to - DAY).toISOString())) {
        if (row.flag && row.flag !== "OK") flagged24h[row.flag as ReadingFlag] = Number(row.n);
      }
    }
    const mine = states.filter((s) => s.buildingId === b.id);
    out.push({
      buildingId: b.id,
      buildingLabel: `${b.name} (${b.code})`,
      farmName: farms.get(b.farmId) ?? "—",
      gateway,
      channels: sensors.length,
      lastReadingAt: range.last,
      availability24h,
      flagged24h,
      activeStates: mine.length,
      critical: mine.filter((s) => s.state === "CRITIQUE").length,
    });
  }
  return out;
}

export interface ChannelRow {
  sensor: Sensor;
  device: Device;
  ref: string | null;
  label: string;
  zone: Zone | null;
  frequency: string;
  last: { value: number; capturedAt: string; qualityFlag: string | null } | null;
  availability24h: number | null;
  stats24h: { mean: number | null; min: number | null; max: number | null; stddev: number | null };
}

export async function buildingTelemetry(buildingId: string, session: Session) {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const building = await repositories.buildings.findById(buildingId);
  if (!building) throw new NotFoundError("Bâtiment", buildingId);
  assertInScope(session, await resolveBuildingHierarchy(buildingId));
  const farm = await repositories.farms.findById(building.farmId);
  const devices = (await repositories.devices.list()).filter((d) => d.buildingId === buildingId);
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  const zones = await repositories.zones.listByFarm(building.farmId);
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const occupations = await repositories.zoneOccupations.listByZones(zones.map((z) => z.id));
  const lots = new Map((await repositories.lots.list()).map((l) => [l.id, l]));
  const range = await repositories.readings.rangeOf(sensors.map((s) => s.id));
  const windowEnd = range.last ? Date.parse(range.last) : Date.now();
  const latest = await repositories.readings.latestPerSensor(sensors.map((s) => s.id));
  const quarters = await repositories.aggregates.list("15m", sensors.map((s) => s.id), new Date(windowEnd - DAY).toISOString(), new Date(windowEnd + 1).toISOString());
  const bySensor = new Map<string, MeasurementAggregate[]>();
  for (const q of quarters) bySensor.set(q.sensorId, [...(bySensor.get(q.sensorId) ?? []), q]);

  const channels: ChannelRow[] = sensors
    .map((s) => {
      const spec = s.catalogRef === "PLC" ? CONTROLLER_CHANNELS : sensorSpec(s.catalogRef);
      const qs = bySensor.get(s.id) ?? [];
      const merged = qs.reduce(
        (acc, q) => ({ count: acc.count + q.count, sum: acc.sum + q.sum, sumSq: acc.sumSq + q.sumSq, min: acc.min === null ? q.min : q.min === null ? acc.min : Math.min(acc.min, q.min), max: acc.max === null ? q.max : q.max === null ? acc.max : Math.max(acc.max, q.max) }),
        { count: 0, sum: 0, sumSq: 0, min: null as number | null, max: null as number | null }
      );
      // Availability over the full 24 h: a quarter with no reading at all counts as missing.
      const expectedPerQuarter = qs[0]?.expected ?? (spec?.acquisitionSeconds ? Math.floor(900 / spec.acquisitionSeconds) : null);
      return {
        sensor: s,
        device: deviceById.get(s.deviceId)!,
        ref: s.catalogRef ?? null,
        label: spec?.label ?? s.sensorType,
        zone: s.zoneId ? (zoneById.get(s.zoneId) ?? null) : null,
        frequency: spec?.frequency ?? "—",
        last: latest.get(s.id) ?? null,
        availability24h: expectedPerQuarter ? availability({ count: merged.count }, expectedPerQuarter * 96) : null,
        stats24h: { mean: mean(merged), min: merged.min, max: merged.max, stddev: stddev(merged) },
      };
    })
    .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "") || (a.sensor.code ?? "").localeCompare(b.sensor.code ?? ""));

  const at = new Date(windowEnd).toISOString();
  const buildingZones = zones.filter((z) => z.buildingId === buildingId || z.buildingId === null);
  const zoneRows = buildingZones.map((z) => {
    const occ = occupantAt(occupations, z.id, at);
    return { zone: z, lot: occ.lotId ? lots.get(occ.lotId) ?? null : null, history: occupations.filter((o) => o.zoneId === z.id) };
  });

  const states: RuleStateRow[] = (await repositories.ruleStates.listByBuilding(buildingId)).filter((s) => s.state !== "NORMAL");
  const transitions = (await repositories.ruleTransitions.listRecent(60, [buildingId]));
  const events = await repositories.siteEvents.listRecent(40, [buildingId]);

  // Hourly temperature per rearing zone over the last 3 days, for the chart.
  const a01 = sensors.filter((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE");
  const hours = await repositories.aggregates.list("1h", a01.map((s) => s.id), new Date(windowEnd - 3 * DAY).toISOString(), new Date(windowEnd + 1).toISOString());
  const temperatureSeries = a01.map((s) => ({
    label: `${s.position ?? s.code}`,
    points: hours.filter((h) => h.sensorId === s.id).map((h) => ({ capturedAt: h.bucketStart, value: Math.round((h.sum / Math.max(1, h.count)) * 10) / 10 })),
  }));

  return { building, farm, gateway: devices.find((d) => d.type === "PASSERELLE") ?? null, devices, channels, zoneRows, states, transitions, events, windowEnd: at, temperatureSeries };
}

export async function activeRuleStates(session: Session) {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const allowed = new Set((await buildingsInScope(session)).map((b) => b.id));
  return (await repositories.ruleStates.listNonNormal()).filter((s) => allowed.has(s.buildingId));
}

export async function recentTransitions(session: Session, limit = 100) {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const allowed = (await buildingsInScope(session)).map((b) => b.id);
  return repositories.ruleTransitions.listRecent(limit, allowed);
}

export async function ingestLog(session: Session, limit = 150) {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const allowed = new Set((await buildingsInScope(session)).map((b) => b.id));
  const gateways = (await repositories.devices.list()).filter((d) => d.type === "PASSERELLE" && allowed.has(d.buildingId));
  const byId = new Map(gateways.map((g) => [g.id, g]));
  const messages = (await repositories.ingestMessages.listRecent(limit * 3)).filter((m) => byId.has(m.gatewayId)).slice(0, limit);
  return { gateways, messages: messages.map((m) => ({ ...m, gatewayCode: byId.get(m.gatewayId)?.code ?? "?" })) };
}

export async function telemetryCounts() {
  return {
    aggregates: await repositories.aggregates.counts(),
    transitions: await repositories.ruleTransitions.countAll(),
  };
}
