import type { Sensor } from "../../../domain/iot/types";
import type { Session } from "../../../services/auth/session";
import { createApiClient } from "../../../services/api/clients";
import { authenticateApiKey } from "../../../services/api/clients";
import { resolveAlert } from "../../../services/intelligence/alerts";
import { seedStartingBands, proposeLearnedBands } from "../../../services/telemetry/bands";
import { recordCalibration } from "../../../services/telemetry/calibration";
import { runSilenceCheck } from "../../../services/telemetry/evaluate";
import { ingestGatewayBatch } from "../../../services/telemetry/ingest";
import { startOccupation } from "../../../services/telemetry/occupation";
import { provisionBuildingUnchecked } from "../../../services/telemetry/provisioning";
import { simulateControlWeighing, simulateGateway, type Scenario, type SimChannel, type SimDevice } from "../../../services/telemetry/simulator";
import { saveRuleSettings } from "../../../services/telemetry/settings";
import { recordAudit } from "../../../services/audit/record";
import { repositories } from "../../repositories";
import { bucketStart } from "../../../domain/telemetry/aggregate";
import { logger } from "../../../lib/logger";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Raw readings kept in the demo snapshot. Production keeps 90 days; the demo file would weigh hundreds of MB. */
const DEMO_RAW_HOURS = 6;

export const BELDI_LOT_CODE = "BV-BEL-2026-03";

async function simTopology(buildingId: string, farmId: string) {
  const devices = await repositories.devices.listByBuilding(buildingId);
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  const zones = new Map((await repositories.zones.listByFarm(farmId)).map((z) => [z.id, z.code]));
  const channels: SimChannel[] = sensors.map((s) => ({ code: s.code!, ref: s.catalogRef!, type: s.sensorType, position: s.position ?? null, zoneCode: s.zoneId ? zones.get(s.zoneId) ?? null : null }));
  const simDevices: SimDevice[] = devices.filter((d) => d.catalogRef).map((d) => ({ code: d.code, ref: d.catalogRef! }));
  return { channels, simDevices, sensors };
}

/** Sends messages the way a gateway does: in batches, each batch stamped with its transmission time. */
async function send(messages: ReturnType<typeof simulateGateway>, principal: NonNullable<Awaited<ReturnType<typeof authenticateApiKey>>>, batchMinutes: number) {
  const perBatch = Math.max(1, Math.round(batchMinutes / 2));
  for (let i = 0; i < messages.length; i += perBatch) {
    const part = messages.slice(i, i + perBatch);
    const sentAt = Date.parse(part[part.length - 1].sentAt) + 5000;
    await ingestGatewayBatch(part.map((m) => ({ ...m, sentAt: new Date(sentAt).toISOString() })), principal, new Date(sentAt));
  }
}

/**
 * Past beldi lots of the reference building, closed, with their hourly temperature and weight
 * buckets — the history the band learning needs (document 3, ch. 4). Generated straight as
 * hourly buckets: their raw readings would long since have been purged (90-day tier).
 */
async function seedPastLots(buildingId: string, sensorIds: { temperature: string; weight: string; zoneId: string }) {
  const past = [
    { code: "BV-BEL-2025-01", start: "2025-03-03T06:00:00.000Z", days: 112, offset: 0.4 },
    { code: "BV-BEL-2025-02", start: "2025-07-14T06:00:00.000Z", days: 105, offset: 1.1 },
    { code: "BV-BEL-2026-01", start: "2025-11-24T06:00:00.000Z", days: 118, offset: -0.5 },
  ];
  for (const p of past) {
    const start = Date.parse(p.start);
    const lot = await repositories.lots.create({
      buildingId,
      code: p.code,
      species: "Poulet",
      breed: "Beldi",
      status: "CLOTURE",
      initialPopulation: 4000,
      // No mortality is recorded for these history-only lots, so the headcount cannot move.
      currentPopulation: 4000,
      plannedStartAt: p.start.slice(0, 10),
      startedAt: p.start,
      endedAt: new Date(start + p.days * DAY).toISOString(),
      dataStatus: "SIMULATION",
      productionLine: "CHAIR_FERMIER",
      purpose: "CHAIR",
      hatchedAt: p.start,
    });
    const rows = [];
    for (let h = 0; h < p.days * 24; h += 1) {
      const t = start + h * HOUR;
      const age = h / 24;
      const local = ((t + HOUR) % DAY) / HOUR;
      const target = Math.max(22, 32 - age * 0.3) + p.offset + 1.5 * Math.sin((2 * Math.PI * (local - 9)) / 24);
      const jitter = (((h * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
      const temp = target + jitter * 0.8;
      rows.push({ sensorId: sensorIds.temperature, granularity: "1h" as const, bucketStart: new Date(t).toISOString(), buildingId, zoneId: sensorIds.zoneId, lotId: lot.id, count: 60, expected: 60, suspectCount: 0, sum: temp * 60, sumSq: temp * temp * 60 + 0.04 * 60, min: temp - 0.3, max: temp + 0.3 });
      if (local >= 6 && local < 20) {
        const w = (0.04 + 0.0165 * age) * (1 + p.offset * 0.02) * (1 + jitter * 0.04);
        rows.push({ sensorId: sensorIds.weight, granularity: "1h" as const, bucketStart: new Date(t).toISOString(), buildingId, zoneId: sensorIds.zoneId, lotId: lot.id, count: 25, expected: null, suspectCount: 0, sum: w * 25, sumSq: w * w * 25 * 1.008, min: w * 0.8, max: w * 1.2 });
      }
    }
    await repositories.aggregates.upsertMany(rows);
  }
}

/**
 * Telemetry of the client's documents 2 and 3, end to end on simulated data:
 *  - a pilot beldi farm whose building is equipped exactly as document 2's reference case;
 *  - the hatchery (COUV-01) with independent incubator probes and egg-room probes;
 *  - 56 hours sent by the gateway simulator through the real ingestion API path, with a
 *    6-hour gateway outage and its catch-up, and the incidents document 2 describes;
 *  - calibration records, band learning over three finished lots, one alert closed with its
 *    intervention and outcome.
 * Every reading is stored as SIMULATION.
 */
export async function seedTelemetry(input: { heroProducerId: string; adminSession: Session; light?: boolean }): Promise<void> {
  const admin = input.adminSession;
  await seedStartingBands(admin.userId);

  // Pilot farm and the reference building of document 2 (50 m, three rearing zones).
  const farm = await repositories.farms.create({ producerId: input.heroProducerId, name: "Ferme pilote Biovolailles", city: "Meknès", region: "Fès-Meknès", geoLat: 33.8935, geoLng: -5.5473 });
  const building = await repositories.buildings.create({ farmId: farm.id, code: "BEL-01", name: "Bâtiment beldi de référence", capacity: 4500, zoneType: "ELEVAGE" });
  const lotStart = Date.parse("2026-06-22T06:00:00.000Z");
  const lot = await repositories.lots.create({
    buildingId: building.id,
    code: BELDI_LOT_CODE,
    species: "Poulet",
    breed: "Beldi",
    status: "ACTIF",
    initialPopulation: 4000,
    currentPopulation: 4000,
    plannedStartAt: "2026-06-22",
    startedAt: new Date(lotStart).toISOString(),
    endedAt: null,
    dataStatus: "SIMULATION",
    productionLine: "CHAIR_FERMIER",
    purpose: "CHAIR",
    hatchedAt: new Date(lotStart).toISOString(),
  });
  const provisioned = await provisionBuildingUnchecked(building.id, { installedAt: "2025-02-15T08:00:00.000Z" });
  for (const zone of provisioned.zones.filter((z) => z.kind === "ELEVAGE")) {
    await startOccupation({ zoneId: zone.id, lotId: lot.id, startedAt: new Date(lotStart).toISOString(), headCount: zone.code.endsWith("Z2") ? 1334 : 1333 }, admin);
  }
  const topo = await simTopology(building.id, farm.id);
  const z2 = provisioned.zones.find((z) => z.code.endsWith("Z2"))!;
  await seedPastLots(building.id, {
    temperature: topo.sensors.find((s) => s.catalogRef === "A01" && s.sensorType === "TEMPERATURE" && s.zoneId === z2.id)!.id,
    weight: topo.sensors.find((s) => s.catalogRef === "E01")!.id,
    zoneId: z2.id,
  });

  // Hatchery: two incubators, the egg room, the door and the GSM alarm.
  const hatchery = (await repositories.buildings.list()).find((b) => b.code === "COUV-01");
  const hatcheryProvisioned = hatchery ? await provisionBuildingUnchecked(hatchery.id, { incubators: ["INC-1", "INC-2"], installedAt: "2025-02-15T08:00:00.000Z" }) : null;

  // A rule set from the screen, as the technician would: the farm's light programme, 06:00–20:00 at 22 lux.
  await saveRuleSettings("LUMIERE_PROGRAMME", null, { onTime: "06:00", offTime: "20:00", targetLux: "22" }, admin);

  // Calibrations: most channels done at commissioning; one due soon; one drifting over three checks.
  const calibrate = async (code: string, at: string, ref: number, measured: number, tolerance: number, intervalDays: number, evidence: string) => {
    const sensor = topo.sensors.find((s) => s.code === code) ?? (await repositories.telemetrySensors.findByCodes([code]))[0];
    if (!sensor) return;
    await recordCalibration({ sensorId: sensor.id, calibratedAt: at, method: "Comparaison in situ avec sonde étalon", referenceInstrument: "Thermo-hygromètre étalon, certificat COFRAC 2025-118", referenceValue: ref, measuredValue: measured, tolerance, intervalDays, evidenceRef: evidence }, admin);
  };
  for (const s of topo.sensors.filter((x) => x.catalogRef === "A01")) await calibrate(s.code!, "2026-03-10T09:00:00.000Z", s.sensorType === "TEMPERATURE" ? 25 : 60, s.sensorType === "TEMPERATURE" ? 25.1 : 61, s.sensorType === "TEMPERATURE" ? 0.3 : 3, 180, `PV-ETAL-2026-03-${s.code}`);
  const nh3 = topo.sensors.filter((x) => x.catalogRef === "A03");
  if (nh3[0]) await calibrate(nh3[0].code!, "2026-02-25T09:00:00.000Z", 25, 25.8, 2, 180, "PV-ETAL-NH3-01");
  if (nh3[1]) {
    // A cell drifting: the error grows at each check (document 3, lot 6 "alertes de dérive").
    await calibrate(nh3[1].code!, "2025-09-01T09:00:00.000Z", 25, 25.3, 2, 90, "PV-ETAL-NH3-02a");
    await calibrate(nh3[1].code!, "2025-12-01T09:00:00.000Z", 25, 25.9, 2, 90, "PV-ETAL-NH3-02b");
    await calibrate(nh3[1].code!, "2026-05-25T09:00:00.000Z", 25, 26.6, 2, 90, "PV-ETAL-NH3-02c");
  }

  // Gateway keys, bound to their gateway, as they would be issued on the "Accès API" screen.
  const { key } = await createApiClient({ name: "Passerelle BEL-01", scopes: ["telemetry:write"], gatewayCode: provisioned.gatewayCode }, admin);
  const principal = (await authenticateApiKey(`Bearer ${key}`))!;

  // Light mode (the in-app demo reset, which must finish within a request): 8 hours, the same
  // incidents except the water profile, which needs two previous days to compare with.
  const light = input.light ?? false;
  const from = NOW - (light ? 8 : 56) * HOUR;
  const scenarios: Scenario[] = light
    ? [
        { kind: "NH3_EPISODE", zoneSuffix: "38 m", from: NOW - 7 * HOUR, to: NOW - 3.5 * HOUR, ppm: 31 },
        { kind: "SCREW_STALL", line: "Ligne 2", from: NOW - 5 * HOUR, to: NOW - 4.5 * HOUR },
        { kind: "NIGHT_DOOR", at: Date.parse("2026-08-16T04:20:00.000Z"), badge: null },
      ]
    : [
        { kind: "NH3_EPISODE", zoneSuffix: "38 m", from: NOW - 30 * HOUR, to: NOW - 26.5 * HOUR, ppm: 31 },
        { kind: "SCREW_STALL", line: "Ligne 2", from: NOW - 21 * HOUR, to: NOW - 20.5 * HOUR },
        { kind: "NIGHT_DOOR", at: Date.parse("2026-08-16T01:40:00.000Z"), badge: null },
        { kind: "WATER_DROP_PUMP", from: NOW - 5 * HOUR, to: NOW, factor: 0.5 },
      ];
  const messages = simulateGateway({ gateway: provisioned.gatewayCode, channels: topo.channels, devices: topo.simDevices, from, to: NOW, lotStartedAt: lotStart, population: 4000, scenarios, startSeq: 41_200 });
  // Mobile control weighing (E02) mid-window, through the same gateway.
  const e02 = topo.sensors.find((s) => s.catalogRef === "E02");
  const weighingAt = NOW - (light ? 6 : 36) * HOUR;
  if (e02) {
    const idx = messages.findIndex((m) => Date.parse(m.sentAt) > weighingAt);
    messages[idx] = { ...messages[idx], readings: [...messages[idx].readings, ...simulateControlWeighing(e02.code!, weighingAt - 60_000 * 30, lotStart, 60)].sort((a, b) => (a.at < b.at ? -1 : 1)) };
  }

  // Live until the outage, then 6 hours of silence, then the buffer comes back at once.
  const outageStart = NOW - (light ? 3 : 14) * HOUR;
  const outageEnd = NOW - (light ? 2 : 8) * HOUR;
  const before = messages.filter((m) => Date.parse(m.sentAt) <= outageStart);
  const during = messages.filter((m) => Date.parse(m.sentAt) > outageStart && Date.parse(m.sentAt) <= outageEnd);
  const after = messages.filter((m) => Date.parse(m.sentAt) > outageEnd);
  let t = Date.now();
  await send(before, principal, 60);
  logger.info("seed", `Telemetry: ${before.length} live messages in ${Date.now() - t} ms`);
  t = Date.now();
  // The scheduler's silence check runs during the outage, as it would every few minutes.
  await runSilenceCheck(new Date(outageStart + (outageEnd - outageStart) * 0.75));
  await ingestGatewayBatch(during.map((m) => ({ ...m, sentAt: new Date(outageEnd + 60_000).toISOString() })), principal, new Date(outageEnd + 60_000));
  await runSilenceCheck(new Date(outageEnd + 2 * 60_000));
  await send(after, principal, 30);
  logger.info("seed", `Telemetry: outage, catch-up of ${during.length} messages and ${after.length} live messages in ${Date.now() - t} ms`);

  if (hatchery && hatcheryProvisioned) {
    const { key: hk } = await createApiClient({ name: "Passerelle COUV-01", scopes: ["telemetry:write"], gatewayCode: hatcheryProvisioned.gatewayCode }, admin);
    const hp = (await authenticateApiKey(`Bearer ${hk}`))!;
    const ht = await simTopology(hatchery.id, hatchery.farmId);
    const hmsgs = simulateGateway({
      gateway: hatcheryProvisioned.gatewayCode,
      channels: ht.channels,
      devices: ht.simDevices,
      from: NOW - (light ? 8 : 24) * HOUR,
      to: NOW,
      lotStartedAt: null,
      population: 0,
      scenarios: [
        // The machine of INC-2 keeps displaying 37.6 °C while its own probe has drifted: the independent probes read 0.7 °C lower.
        { kind: "INCUBATOR_MACHINE_DRIFT", from: NOW - 9 * HOUR, to: NOW, offset: 0.7, zoneSuffix: "INC-2" },
        { kind: "EGG_ROOM_DOOR", from: NOW - (light ? 6 : 17) * HOUR, to: NOW - (light ? 5.4 : 16.4) * HOUR },
        { kind: "GSM_ALARM", at: NOW - (light ? 5.5 : 16.5) * HOUR },
      ],
      startSeq: 9_800,
    });
    await send(hmsgs, hp, 60);
  }

  // The NH3 alert, handled: litter changed in the back zone, and the alert was right.
  const nh3State = (await repositories.ruleStates.listByBuilding(building.id)).find((s) => s.ruleCode === "NH3_EXPOSITION" && s.openAlertId);
  if (nh3State?.openAlertId) {
    await resolveAlert(nh3State.openAlertId, admin, "Litière remplacée zone arrière (38 m), ventilation minimale relevée de 10 %.", "JUSTIFIEE");
  }

  // Band learning over the three finished lots: proposals wait for the technician's decision.
  await proposeLearnedBands(admin);

  // Demo-size trim: keep 6 hours of raw readings; 15-minute and hourly buckets keep the rest.
  const cutoff = bucketStart(NOW - DEMO_RAW_HOURS * HOUR, "1h");
  const removed = await repositories.readings.purgeBefore(cutoff);
  await recordAudit({
    actorId: null,
    entityType: "telemetry_retention",
    entityId: "demo-snapshot",
    field: null,
    oldValue: null,
    newValue: `${removed} mesures brutes antérieures à ${cutoff} retirées du jeu de démonstration`,
    reason: `Démonstration : brut conservé ${DEMO_RAW_HOURS} h pour la taille du fichier (production : 90 jours). Agrégats 15 min et horaires conservés.`,
    relatedLotId: null,
    relatedEventId: null,
  });
}
