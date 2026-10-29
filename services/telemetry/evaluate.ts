import { repositories } from "../../data/repositories";
import type { Sensor } from "../../domain/iot/types";
import type { Lot } from "../../domain/production/types";
import { sensorSpec, type DecisionRule } from "../../domain/telemetry/catalog";
import { occupantAt } from "../../domain/telemetry/occupation";
import { EVALUATION_STEP_SECONDS } from "../../domain/telemetry/rules/index";
import { runRules, stateKey, type SubjectState, type Transition } from "../../domain/telemetry/rules/runner";
import type { ChannelSeries } from "../../domain/telemetry/rules/series";
import { mergeParams } from "../../domain/telemetry/rules/settings";
import { silenceVerdicts, type SilenceInput } from "../../domain/telemetry/rules/site";
import type { OccupantInfo, RuleParams, SiteEventPoint } from "../../domain/telemetry/rules/types";
import type { RuleStateRow, RuleTransition, Zone, ZoneOccupation } from "../../domain/telemetry/types";
import type { RuleState } from "../../domain/shared/enums";
import { withLock } from "../../lib/keyed-lock";
import { raiseAlertToCritical, raiseTelemetryAlert } from "./alerting";

const DAY = 86_400_000;
/**
 * How far back each channel must be read for the rules to judge the first step of a chunk: the
 * water profile compares with the 3 previous days, the silo filter reads 2 days, the rest at
 * most a day (NH3 exposure, weighing, tank drawdown, rain). Reading only that keeps a live
 * evaluation from re-reading days of history every two minutes.
 */
const LOOKBACK_BY_REF: Record<string, number> = { C01: 3.5 * DAY, C03: 3.5 * DAY, C05: 1.1 * DAY, D01: 2.1 * DAY };
const DEFAULT_LOOKBACK_MS = 1.1 * DAY;
const lookbackOf = (ref: string | null | undefined) => LOOKBACK_BY_REF[ref ?? ""] ?? DEFAULT_LOOKBACK_MS;
/** A first evaluation never reaches further back than the gateway buffer. */
const MAX_FIRST_SPAN_MS = 31 * DAY;
const CHUNK_MS = DAY;

export interface EvaluationReport {
  buildingId: string;
  from: string | null;
  to: string | null;
  steps: number;
  transitions: number;
  alertsRaised: number;
  /** False when the time budget ran out first: the scheduler or the next message picks up from the watermark. */
  caughtUp: boolean;
}

async function ruleParamsResolver(buildingId: string): Promise<(rule: DecisionRule) => RuleParams> {
  const settings = await repositories.ruleSettings.listAll();
  return (rule) =>
    mergeParams(
      rule,
      settings.find((s) => s.ruleCode === rule && s.buildingId === null)?.params,
      settings.find((s) => s.ruleCode === rule && s.buildingId === buildingId)?.params
    );
}

interface Topology {
  buildingName: string;
  sensors: (Sensor & { contextOnly: boolean })[];
  zones: Map<string, Zone>;
  deviceCode: Map<string, string>;
  deviceOfSensor: Map<string, string>;
}

/** The building's own channels, plus its farm's site-level channels as context. */
async function loadTopology(buildingId: string): Promise<Topology | null> {
  const building = await repositories.buildings.findById(buildingId);
  if (!building) return null;
  const devices = await repositories.devices.list();
  const farmZones = await repositories.zones.listByFarm(building.farmId);
  const siteZoneIds = farmZones.filter((z) => z.buildingId === null).map((z) => z.id);
  const own = (await repositories.telemetrySensors.listByDevices(devices.filter((d) => d.buildingId === buildingId).map((d) => d.id))) as Sensor[];
  const site = ((await repositories.telemetrySensors.listByZones(siteZoneIds)) as Sensor[]).filter((s) => !own.some((o) => o.id === s.id));
  return {
    buildingName: `${building.name} (${building.code})`,
    sensors: [...own.map((s) => ({ ...s, contextOnly: false })), ...site.map((s) => ({ ...s, contextOnly: true }))],
    zones: new Map(farmZones.map((z) => [z.id, z])),
    deviceCode: new Map(devices.map((d) => [d.id, d.code])),
    deviceOfSensor: new Map([...own, ...site].map((s) => [s.id, s.deviceId])),
  };
}

type Points = { times: number[]; values: number[] };

/**
 * Usable readings kept in memory per building between evaluations, so a live evaluation every
 * two minutes reads only what arrived since the last one instead of a day of history. Rules only
 * move forward (watermark), so nothing at or before `coveredTo` can still change the outcome.
 * Per instance; a cold instance simply reloads.
 */
interface SeriesCache {
  sensorKey: string;
  coveredTo: number;
  bySensor: Map<string, Points>;
}
const seriesCache = new Map<string, SeriesCache>();
const MAX_CACHED_BUILDINGS = 50;

/** Drops cached series (tests, demo reset, data rewritten in place). */
export function clearTelemetrySeriesCache(): void {
  seriesCache.clear();
}

async function loadSeries(buildingId: string, topology: Topology, from: number, to: number): Promise<Map<string, Points>> {
  const sensorKey = topology.sensors.map((s) => s.id).sort().join(",");
  const cached = seriesCache.get(buildingId);
  const reuse = cached && cached.sensorKey === sensorKey && cached.coveredTo <= to && cached.coveredTo >= from - DAY;
  const bySensor: Map<string, Points> = reuse ? cached.bySensor : new Map();
  const groups = new Map<number, string[]>();
  for (const sensor of topology.sensors) {
    const lb = lookbackOf(sensor.catalogRef);
    groups.set(lb, [...(groups.get(lb) ?? []), sensor.id]);
  }
  const fresh = (
    await Promise.all(
      Array.from(groups).map(([lb, ids]) =>
        // With a usable cache only the readings after it are fetched (exclusive bound: +1 ms).
        repositories.readings.listUsable(ids, new Date(reuse ? cached.coveredTo + 1 : from - lb).toISOString(), new Date(to).toISOString())
      )
    )
  ).flat();
  for (const r of fresh) {
    const p = bySensor.get(r.sensorId) ?? { times: [], values: [] };
    p.times.push(Date.parse(r.capturedAt));
    p.values.push(r.value);
    bySensor.set(r.sensorId, p);
  }
  // Keep each channel's look-back only.
  for (const sensor of topology.sensors) {
    const p = bySensor.get(sensor.id);
    if (!p) continue;
    const floor = from - lookbackOf(sensor.catalogRef);
    let cut = 0;
    while (cut < p.times.length && p.times[cut] < floor) cut++;
    if (cut) bySensor.set(sensor.id, { times: p.times.slice(cut), values: p.values.slice(cut) });
  }
  if (!seriesCache.has(buildingId) && seriesCache.size >= MAX_CACHED_BUILDINGS) seriesCache.delete(seriesCache.keys().next().value!);
  seriesCache.set(buildingId, { sensorKey, coveredTo: to, bySensor });
  return bySensor;
}

function toSeries(topology: Topology, bySensor: Map<string, Points>): ChannelSeries[] {
  return topology.sensors.map((s) => {
    const zone = s.zoneId ? topology.zones.get(s.zoneId) : undefined;
    const data = bySensor.get(s.id) ?? { times: [], values: [] };
    return {
      sensorId: s.id,
      sensorCode: s.code ?? null,
      sensorType: s.sensorType,
      catalogRef: s.catalogRef ?? null,
      zoneId: s.zoneId ?? null,
      zoneKind: zone?.kind ?? null,
      zoneName: zone?.name ?? null,
      position: s.position ?? null,
      unit: s.unit,
      times: data.times,
      values: data.values,
      contextOnly: s.contextOnly,
    };
  });
}

async function occupantResolver(zoneIds: string[]): Promise<(zoneId: string | null, at: number) => OccupantInfo | null> {
  const occupations: ZoneOccupation[] = await repositories.zoneOccupations.listByZones(zoneIds);
  const lots = new Map<string, Lot>();
  for (const id of new Set(occupations.map((o) => o.lotId))) {
    const lot = await repositories.lots.findById(id);
    if (lot) lots.set(id, lot);
  }
  return (zoneId, at) => {
    const o = occupantAt(occupations, zoneId, new Date(at).toISOString());
    const lot = o.lotId ? lots.get(o.lotId) : undefined;
    if (!lot) return null;
    const placed = occupations.filter((x) => x.lotId === lot.id).map((x) => x.startedAt).sort()[0];
    return { lotId: lot.id, lotCode: lot.code, productionLine: lot.productionLine ?? null, startedAt: lot.startedAt ?? placed };
  };
}

/** Writes transitions in time order, opening an alert when a rule leaves NORMAL and raising it when it turns critical. */
async function persistTransitions(
  transitions: Transition[],
  buildingId: string,
  buildingName: string,
  openAlerts: Map<string, string | null>
): Promise<{ rows: number; alerts: number }> {
  const rows: Omit<RuleTransition, "id">[] = [];
  let alerts = 0;
  for (const t of transitions) {
    const key = stateKey(t.rule, t.verdict.subjectKey);
    let alertId = openAlerts.get(key) ?? null;
    if (alertId) {
      // An open alert stays open until a person closes it with an intervention; a closed one frees the subject.
      const alert = await repositories.alerts.findById(alertId);
      if (!alert || alert.status === "RESOLVED" || alert.status === "DISMISSED") alertId = null;
    }
    if (t.raisesAlerts && t.to !== "NORMAL") {
      if (!alertId) {
        const alert = await raiseTelemetryAlert({ rule: t.rule, verdict: t.verdict, at: t.at, from: t.from, buildingId, buildingName });
        alertId = alert.id;
        alerts++;
      } else if (t.to === "CRITIQUE") {
        await raiseAlertToCritical(alertId, buildingId);
      }
    }
    openAlerts.set(key, alertId);
    rows.push({
      ruleCode: t.rule,
      subjectKey: t.verdict.subjectKey,
      buildingId,
      lotId: t.verdict.lotId,
      fromState: t.from,
      toState: t.to,
      at: new Date(t.at).toISOString(),
      value: t.verdict.value,
      referenceLow: t.verdict.low ?? null,
      referenceHigh: t.verdict.high ?? null,
      bandId: t.verdict.bandId ?? null,
      diagnosis: t.verdict.diagnosis,
      context: { subject: t.verdict.subjectLabel, unit: t.verdict.unit ?? null, ...(t.verdict.context ?? {}) },
      alertId,
    });
  }
  await repositories.ruleTransitions.insertMany(rows);
  return { rows: rows.length, alerts };
}

function statesFromRows(rows: RuleStateRow[]): { states: Map<string, SubjectState>; openAlerts: Map<string, string | null> } {
  const states = new Map<string, SubjectState>();
  const openAlerts = new Map<string, string | null>();
  for (const r of rows) {
    const key = stateKey(r.ruleCode, r.subjectKey);
    states.set(key, { state: r.state, since: Date.parse(r.since), memory: r.memory });
    openAlerts.set(key, r.openAlertId);
  }
  return { states, openAlerts };
}

/**
 * Runs the rules of one building from its watermark up to its newest reading, a day at a time,
 * within a time budget. Serialised per building in this instance; the watermark only moves
 * forward by compare-and-set, so a concurrent run on another instance cannot write the same
 * range twice — it loses the race and stops.
 */
export async function evaluateBuilding(buildingId: string, opts: { until?: number; timeBudgetMs?: number } = {}): Promise<EvaluationReport> {
  return withLock(`telemetry-eval:${buildingId}`, async () => {
    const started = Date.now();
    const budget = opts.timeBudgetMs ?? 8000;
    const report: EvaluationReport = { buildingId, from: null, to: null, steps: 0, transitions: 0, alertsRaised: 0, caughtUp: true };
    const topology = await loadTopology(buildingId);
    if (!topology || topology.sensors.length === 0) return report;
    const ownIds = topology.sensors.filter((s) => !s.contextOnly).map((s) => s.id);
    const range = await repositories.readings.rangeOf(ownIds);
    if (!range.last) return report;
    const until = Math.min(opts.until ?? Date.parse(range.last), Date.parse(range.last));

    let watermark = await repositories.ruleWatermarks.get(buildingId);
    const step = EVALUATION_STEP_SECONDS * 1000;
    let from = watermark ? Date.parse(watermark) : Math.max(Date.parse(range.first!) - step, until - MAX_FIRST_SPAN_MS);
    report.from = new Date(from).toISOString();
    if (until - from < step) return report;

    const params = await ruleParamsResolver(buildingId);
    const bands = await repositories.bands.listActive();
    const occupantOf = await occupantResolver(Array.from(topology.zones.keys()));
    const { states, openAlerts } = statesFromRows(await repositories.ruleStates.listByBuilding(buildingId));

    while (until - from >= step) {
      const chunkTo = Math.min(until, from + CHUNK_MS);
      const readings = await loadSeries(buildingId, topology, from, chunkTo);
      const events: SiteEventPoint[] = (await repositories.siteEvents.listByBuilding(buildingId, new Date(from - DAY).toISOString(), new Date(chunkTo).toISOString())).map((e) => ({
        deviceId: e.deviceId,
        deviceCode: topology.deviceCode.get(e.deviceId) ?? e.deviceId,
        kind: e.kind,
        at: Date.parse(e.occurredAt),
        badge: e.badge,
      }));
      const out = runRules({
        buildingId,
        buildingName: topology.buildingName,
        from,
        to: chunkTo,
        series: toSeries(topology, readings),
        events,
        bands,
        occupantOf,
        params,
        states,
      });
      if (out.steps === 0) break;
      const newMark = new Date(out.evaluatedUntil).toISOString();
      // Claim the range before writing anything: losing here means another run already did it.
      if (!(await repositories.ruleWatermarks.advance(buildingId, watermark, newMark))) {
        report.caughtUp = false;
        return report;
      }
      watermark = newMark;

      if (out.derivedEvents.length) {
        await repositories.siteEvents.insertIgnoringDuplicates(
          out.derivedEvents.map((e) => ({
            deviceId: topology.deviceOfSensor.get(e.sensorId)!,
            buildingId,
            zoneId: topology.sensors.find((s) => s.id === e.sensorId)?.zoneId ?? null,
            lotId: null,
            kind: e.kind,
            occurredAt: new Date(e.at).toISOString(),
            badge: null,
            mediaRef: null,
            payload: { ...e.payload, rule: e.rule },
            ingestMessageId: null,
          }))
        );
      }
      const written = await persistTransitions(out.transitions, buildingId, topology.buildingName, openAlerts);
      report.transitions += written.rows;
      report.alertsRaised += written.alerts;
      report.steps += out.steps;

      const touched = new Set([...out.lastVerdicts.keys()]);
      await repositories.ruleStates.upsertMany(
        Array.from(touched).map((key) => {
          const [ruleCode, ...rest] = key.split("|");
          const s = states.get(key)!;
          return {
            ruleCode,
            subjectKey: rest.join("|"),
            buildingId,
            state: s.state,
            since: new Date(s.since).toISOString(),
            openAlertId: openAlerts.get(key) ?? null,
            memory: s.memory,
          };
        })
      );
      from = out.evaluatedUntil;
      report.to = newMark;
      if (Date.now() - started > budget && until - from >= step) {
        report.caughtUp = false;
        break;
      }
    }
    return report;
  });
}

/** Runs every building that has telemetry, for the scheduler. */
export async function evaluateAllBuildings(timeBudgetMs = 20000): Promise<EvaluationReport[]> {
  const started = Date.now();
  const buildingIds = Array.from(new Set((await repositories.devices.list()).filter((d) => d.catalogRef || d.type === "PASSERELLE").map((d) => d.buildingId)));
  const out: EvaluationReport[] = [];
  for (const id of buildingIds) {
    const left = timeBudgetMs - (Date.now() - started);
    if (left <= 0) break;
    out.push(await evaluateBuilding(id, { timeBudgetMs: left }));
  }
  return out;
}

/**
 * Silence check (CAPTEUR_SILENCIEUX) — against the clock, for every periodic channel. A gateway
 * that has gone quiet sends nothing, so nothing else would ever notice.
 */
export async function runSilenceCheck(now = new Date()): Promise<{ transitions: number; alertsRaised: number }> {
  const rule: DecisionRule = "CAPTEUR_SILENCIEUX";
  const devices = await repositories.devices.list();
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const sensors = (await repositories.telemetrySensors.listAll()) as Sensor[];
  const last = await repositories.readings.lastReadingPerSensor();
  const buildings = new Map((await repositories.buildings.list()).map((b) => [b.id, `${b.name} (${b.code})`]));
  const inputs: SilenceInput[] = [];
  for (const s of sensors) {
    const spec = sensorSpec(s.catalogRef);
    const device = deviceById.get(s.deviceId);
    if (!spec || !device) continue;
    const gateway = device.type === "PASSERELLE" ? device : device.gatewayId ? deviceById.get(device.gatewayId) : undefined;
    // A channel no gateway reads (an incubator whose log is imported from a file) cannot fall
    // silent: its data arrives when someone imports it, not on the gateway's clock.
    if (!gateway) continue;
    inputs.push({
      sensorId: s.id,
      label: `${s.code ?? s.id} (${spec.ref} ${spec.label})`,
      gatewayId: gateway.id,
      gatewayLabel: gateway.code,
      buildingId: device.buildingId,
      // Event-driven channels (a bird on the scale) can be quiet for good reasons; only periodic ones go "silent".
      reportSeconds: spec.acquisitionSeconds ? spec.reportSeconds : null,
      lastReadingAt: last.has(s.id) ? Date.parse(last.get(s.id)!) : null,
      installedAt: Date.parse(device.installedAt),
    });
  }
  const settings = await repositories.ruleSettings.listAll();
  const verdicts = silenceVerdicts(inputs, now.getTime(), mergeParams(rule, settings.find((x) => x.ruleCode === rule && x.buildingId === null)?.params));
  const stored = new Map((await repositories.ruleStates.listByRule(rule)).map((r) => [r.subjectKey, r]));
  let transitions = 0;
  let alertsRaised = 0;
  const byBuilding = new Map<string, Transition[]>();
  const openAlerts = new Map<string, string | null>();
  const upserts: Omit<RuleStateRow, "id">[] = [];
  for (const v of verdicts) {
    const prev = stored.get(v.subjectKey);
    const prevState: RuleState = prev?.state ?? "NORMAL";
    openAlerts.set(stateKey(rule, v.subjectKey), prev?.openAlertId ?? null);
    if (v.state === prevState) continue;
    const list = byBuilding.get(v.buildingId) ?? [];
    list.push({
      rule,
      raisesAlerts: true,
      from: prevState,
      to: v.state,
      at: now.getTime(),
      verdict: { subjectKey: v.subjectKey, subjectLabel: v.subjectLabel, state: v.state, value: v.silentMinutes, unit: "MIN", lotId: null, diagnosis: v.diagnosis },
    });
    byBuilding.set(v.buildingId, list);
  }
  for (const [buildingId, list] of byBuilding) {
    const written = await persistTransitions(list, buildingId, buildings.get(buildingId) ?? buildingId, openAlerts);
    transitions += written.rows;
    alertsRaised += written.alerts;
    for (const t of list) {
      upserts.push({
        ruleCode: rule,
        subjectKey: t.verdict.subjectKey,
        buildingId,
        state: t.to,
        since: now.toISOString(),
        openAlertId: openAlerts.get(stateKey(rule, t.verdict.subjectKey)) ?? null,
        memory: null,
      });
    }
  }
  await repositories.ruleStates.upsertMany(upserts);
  return { transitions, alertsRaised };
}


