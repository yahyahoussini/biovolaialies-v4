import { createHash } from "node:crypto";
import { repositories } from "../../data/repositories";
import type { ApiPrincipal } from "../../domain/api/types";
import type { Device, NewMeasurement, Sensor } from "../../domain/iot/types";
import { canonicalJson } from "../../domain/ledger/hash-chain";
import { CONTROLLER_CHANNELS, channelSpec, sensorSpec } from "../../domain/telemetry/catalog";
import { classifyReading, gatewayMessageSchema, type GatewayMessage } from "../../domain/telemetry/ingest";
import { occupantAt } from "../../domain/telemetry/occupation";
import type { SensorCalibration, SiteEvent, Zone, ZoneOccupation } from "../../domain/telemetry/types";
import type { ReadingFlag } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { appendLedgerEvent } from "../ledger/ledger";
import { aggregateRange } from "./aggregate";
import { evaluateBuilding } from "./evaluate";

export interface MessageResult {
  gateway: string;
  seq: number;
  /** "rejected": the whole message was refused (malformed, unknown gateway, wrong key) — see `error`. */
  status: "accepted" | "duplicate" | "rejected";
  error?: string;
  /** The gateway's counter restarted: this seq was already used for other content. */
  seqReused: boolean;
  clockOffsetSeconds: number;
  readings: { accepted: number; duplicates: number; rejected: number; flagged: Partial<Record<ReadingFlag, number>> };
  events: { accepted: number; duplicates: number; rejected: number };
  errors: { index: number; kind: "reading" | "event"; message: string }[];
}

/** What a message's readings and events are, independent of when it was (re)sent. */
function contentHash(message: GatewayMessage): string {
  return createHash("sha256")
    .update(canonicalJson({ readings: message.readings, events: message.events, simulated: message.simulated ?? false }))
    .digest("hex");
}

/** Hash of the readings actually stored for a message: recomputable from the database, so a later edit shows. */
export function storedReadingsHash(rows: { sensorCode: string; capturedAt: string; value: number }[]): string {
  const sorted = [...rows].sort((a, b) => (a.sensorCode + a.capturedAt < b.sensorCode + b.capturedAt ? -1 : 1));
  return createHash("sha256").update(canonicalJson(sorted.map((r) => [r.sensorCode, r.capturedAt, r.value]))).digest("hex");
}

const iso = (v: string) => new Date(v).toISOString();

/** Everything about one gateway's equipment, loaded once per batch rather than once per message. */
interface GatewayContext {
  gateway: Device;
  reachable: Map<string, Device>;
  deviceByCode: Map<string, Device>;
  sensorByCode: Map<string, Sensor>;
  buildingZones: Zone[];
  occupations: ZoneOccupation[];
  calibrations: Map<string, SensorCalibration>;
  /** Last usable value per sensor, carried from message to message for the spike check. */
  previous: Map<string, { value: number; capturedAt: string } | null>;
  lastByDevice: Map<string, string>;
  lastClockOffset: number | null;
  receivedAt: string;
}

interface Batch {
  contexts: Map<string, GatewayContext>;
  sensorIds: Set<string>;
  buildingIds: Set<string>;
  from: string | null;
  to: string | null;
}

async function gatewayContext(batch: Batch, gateway: Device, receivedAt: string): Promise<GatewayContext> {
  const cached = batch.contexts.get(gateway.id);
  if (cached) return cached;
  const allDevices = await repositories.devices.list();
  // A gateway may only speak for its own equipment.
  const reachable = new Map<string, Device>(allDevices.filter((d) => d.id === gateway.id || d.gatewayId === gateway.id).map((d) => [d.id, d]));
  const sensors = (await repositories.telemetrySensors.listByDevices(Array.from(reachable.keys()))) as Sensor[];
  const buildingIds = Array.from(new Set(Array.from(reachable.values()).map((d) => d.buildingId)));
  const buildingZones = (await Promise.all(buildingIds.map((b) => repositories.zones.listByBuilding(b)))).flat();
  const zoneIds = new Set([...sensors.map((s) => s.zoneId).filter((z): z is string => !!z), ...buildingZones.map((z) => z.id)]);
  const ctx: GatewayContext = {
    gateway,
    reachable,
    deviceByCode: new Map(Array.from(reachable.values()).map((d) => [d.code, d])),
    sensorByCode: new Map(sensors.filter((s) => s.code).map((s) => [s.code as string, s])),
    buildingZones,
    occupations: await repositories.zoneOccupations.listByZones(Array.from(zoneIds)),
    calibrations: await repositories.calibrations.latestBySensor(),
    previous: new Map(),
    lastByDevice: new Map(),
    lastClockOffset: null,
    receivedAt,
  };
  batch.contexts.set(gateway.id, ctx);
  return ctx;
}

const emptyResult = (gateway: string, seq: number, clockOffsetSeconds: number): MessageResult => ({
  gateway,
  seq,
  status: "accepted",
  seqReused: false,
  clockOffsetSeconds,
  readings: { accepted: 0, duplicates: 0, rejected: 0, flagged: {} },
  events: { accepted: 0, duplicates: 0, rejected: 0 },
  errors: [],
});

/**
 * Ingestion layer (document 3, ch. 1): "reçoit les messages des passerelles, valide, horodate,
 * écrit". It must accept catch-up — a gateway cut off for three days sends three days at once,
 * without duplicates and without loss. Readings are never dropped for being odd: they are stored
 * with a flag saying what is wrong, so the gap and the fault stay visible.
 *
 * Messages are stored in order, then aggregates and rules run once for the whole batch: replaying
 * the rules after each message of a 30-day backlog would redo the same work thousands of times.
 */
export async function ingestGatewayBatch(raws: unknown[], principal: ApiPrincipal, now = new Date()): Promise<MessageResult[]> {
  const batch: Batch = { contexts: new Map(), sensorIds: new Set(), buildingIds: new Set(), from: null, to: null };
  const receivedAt = now.toISOString();
  const results: MessageResult[] = [];
  for (const raw of raws) {
    try {
      results.push(await storeMessage(raw, principal, now, receivedAt, batch));
    } catch (error) {
      // One bad message must not block the backlog behind it: it is reported and the rest goes on.
      if (!(error instanceof ValidationError) && !(error instanceof AuthorizationError)) throw error;
      const r = raw as { gateway?: unknown; seq?: unknown } | null;
      results.push({
        ...emptyResult(typeof r?.gateway === "string" ? r.gateway : "?", typeof r?.seq === "number" ? r.seq : -1, 0),
        status: "rejected",
        error: error.message,
      });
    }
  }

  // Health of the equipment: the gateway spoke, and each device that sent something spoke.
  for (const ctx of batch.contexts.values()) {
    await repositories.devices.update(ctx.gateway.id, { status: "ONLINE", lastCommunicationAt: receivedAt });
    if (ctx.lastClockOffset !== null) await repositories.devices.setClock(ctx.gateway.id, ctx.lastClockOffset, receivedAt);
    for (const [deviceId, last] of ctx.lastByDevice) {
      const device = ctx.reachable.get(deviceId)!;
      if (deviceId !== ctx.gateway.id && (!device.lastCommunicationAt || last > device.lastCommunicationAt)) {
        await repositories.devices.update(deviceId, { status: device.status === "FAULT" ? "FAULT" : "ONLINE", lastCommunicationAt: last });
      }
    }
    for (const sensor of ctx.sensorByCode.values()) {
      if (sensor.status === "OFFLINE" && batch.sensorIds.has(sensor.id)) await repositories.sensors.updateStatus(sensor.id, "ONLINE");
    }
  }

  if (batch.from && batch.to) await aggregateRange(batch.from, batch.to, Array.from(batch.sensorIds));
  for (const buildingId of batch.buildingIds) await evaluateBuilding(buildingId);
  return results;
}

export async function ingestGatewayMessage(raw: unknown, principal: ApiPrincipal, now = new Date()): Promise<MessageResult> {
  return (await ingestGatewayBatch([raw], principal, now))[0];
}

async function storeMessage(raw: unknown, principal: ApiPrincipal, now: Date, receivedAt: string, batch: Batch): Promise<MessageResult> {
  const parsed = gatewayMessageSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const message = parsed.data;

  const gateway = await repositories.devices.findByCode(message.gateway);
  if (!gateway || gateway.type !== "PASSERELLE") throw new ValidationError(`Passerelle inconnue : ${message.gateway}.`);
  if (principal.deviceId && principal.deviceId !== gateway.id) throw new AuthorizationError("Cette clé est liée à une autre passerelle.");

  const clockOffsetSeconds = Math.round((now.getTime() - Date.parse(message.sentAt)) / 1000);
  const payloadHash = contentHash(message);
  const result = emptyResult(gateway.code, message.seq, clockOffsetSeconds);

  const duplicate = () => {
    result.status = "duplicate";
    result.readings.duplicates = message.readings.length;
    result.events.duplicates = message.events.length;
    return result;
  };
  if (await repositories.ingestMessages.find(gateway.id, message.seq, payloadHash)) return duplicate();
  result.seqReused = await repositories.ingestMessages.existsWithOtherContent(gateway.id, message.seq, payloadHash);

  const stored = await repositories.ingestMessages.create({
    gatewayId: gateway.id,
    seq: message.seq,
    sentAt: iso(message.sentAt),
    receivedAt,
    clockOffsetSeconds,
    readingCount: message.readings.length,
    eventCount: message.events.length,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    flagged: 0,
    payloadHash,
    apiClientId: principal.clientId,
  });
  // Null: the same message was stored by a concurrent request a moment ago.
  if (!stored) return duplicate();

  const ctx = await gatewayContext(batch, gateway, receivedAt);
  ctx.lastClockOffset = clockOffsetSeconds;

  // Readings in time order, so the spike check compares each to the one before it.
  const ordered = message.readings.map((r, index) => ({ ...r, index, atIso: iso(r.at) })).sort((a, b) => (a.atIso < b.atIso ? -1 : a.atIso > b.atIso ? 1 : 0));
  const unknownPrev = Array.from(new Set(ordered.map((r) => ctx.sensorByCode.get(r.sensor)?.id).filter((id): id is string => !!id && !ctx.previous.has(id))));
  if (unknownPrev.length && ordered.length) {
    const found = await repositories.readings.previousBefore(unknownPrev, ordered[0].atIso);
    for (const id of unknownPrev) ctx.previous.set(id, found.get(id) ?? null);
  }
  const dataStatus = message.simulated ? "SIMULATION" : "REEL";
  const rows: (NewMeasurement & { flag: ReadingFlag; sensorCode: string })[] = [];
  for (const r of ordered) {
    const sensor = ctx.sensorByCode.get(r.sensor);
    if (!sensor) {
      result.readings.rejected++;
      result.errors.push({ index: r.index, kind: "reading", message: `Voie inconnue ou rattachée à une autre passerelle : ${r.sensor}.` });
      continue;
    }
    const device = ctx.reachable.get(sensor.deviceId)!;
    const flag = classifyReading({
      channel: channelSpec(sensor.catalogRef ?? device.catalogRef ?? null, sensor.sensorType),
      sensorType: sensor.sensorType,
      sensorStatus: sensor.status,
      value: r.value,
      capturedAt: r.atIso,
      receivedAt,
      gatewayClockOffsetSeconds: clockOffsetSeconds,
      installedAt: device.installedAt,
      calibrationDueAt: ctx.calibrations.get(sensor.id)?.nextDueAt ?? null,
      previous: ctx.previous.get(sensor.id) ?? null,
    });
    // Only a usable value becomes the reference for the next spike check.
    if (flag === "OK") ctx.previous.set(sensor.id, { value: r.value, capturedAt: r.atIso });
    const occupant = occupantAt(ctx.occupations, sensor.zoneId ?? null, r.atIso);
    rows.push({
      sensorId: sensor.id,
      deviceId: sensor.deviceId,
      buildingId: device.buildingId,
      lotId: occupant.lotId,
      value: r.value,
      unit: sensor.unit,
      capturedAt: r.atIso,
      sourceType: "CAPTEUR",
      sourceId: gateway.code,
      actorId: null,
      dataStatus,
      measurementMethod: sensor.catalogRef ?? null,
      documentId: null,
      validationStatus: null,
      zoneId: sensor.zoneId ?? null,
      qualityFlag: flag,
      attribution: occupant.attribution,
      ingestMessageId: stored.id,
      receivedAt,
      flag,
      sensorCode: r.sensor,
    });
  }

  const inserted = await repositories.readings.insertIgnoringDuplicates(
    rows.map((r) => {
      const m: NewMeasurement & { flag?: ReadingFlag; sensorCode?: string } = { ...r };
      delete m.flag;
      delete m.sensorCode;
      return m;
    })
  );
  const insertedKeys = new Set(inserted.map((i) => `${i.sensorId}|${i.capturedAt}`));
  const storedRows = rows.filter((r) => insertedKeys.has(`${r.sensorId}|${r.capturedAt}`));
  result.readings.accepted = storedRows.length;
  result.readings.duplicates = rows.length - storedRows.length;
  for (const r of storedRows) if (r.flag !== "OK") result.readings.flagged[r.flag] = (result.readings.flagged[r.flag] ?? 0) + 1;

  // Site events: alarm, thermostat, doors and badges, power, camera stills.
  const eventRows: Omit<SiteEvent, "id">[] = [];
  for (const [index, e] of message.events.entries()) {
    const device = ctx.deviceByCode.get(e.device);
    if (!device) {
      result.events.rejected++;
      result.errors.push({ index, kind: "event", message: `Équipement inconnu ou rattaché à une autre passerelle : ${e.device}.` });
      continue;
    }
    const at = iso(e.at);
    // "Journal des accès rattaché au bâtiment et au lot": the lot occupying the building, when there is exactly one.
    const lots = new Set(
      ctx.buildingZones.filter((z) => z.buildingId === device.buildingId).map((z) => occupantAt(ctx.occupations, z.id, at).lotId).filter((l): l is string => !!l)
    );
    eventRows.push({
      deviceId: device.id,
      buildingId: device.buildingId,
      zoneId: null,
      lotId: lots.size === 1 ? Array.from(lots)[0] : null,
      kind: e.kind,
      occurredAt: at,
      badge: e.badge ?? null,
      mediaRef: e.mediaRef ?? null,
      payload: e.data ?? null,
      ingestMessageId: stored.id,
    });
  }
  const eventsInserted = await repositories.siteEvents.insertIgnoringDuplicates(eventRows);
  result.events.accepted = eventsInserted;
  result.events.duplicates = eventRows.length - eventsInserted;

  await repositories.ingestMessages.update(stored.id, {
    accepted: result.readings.accepted + result.events.accepted,
    duplicates: result.readings.duplicates + result.events.duplicates,
    rejected: result.readings.rejected + result.events.rejected,
    flagged: Object.values(result.readings.flagged).reduce((a, b) => a + (b ?? 0), 0),
  });

  // The stored content is anchored in the ledger: a later edit of these readings breaks the hash.
  if (storedRows.length || eventsInserted) {
    await appendLedgerEvent({
      eventType: "TELEMETRY_MESSAGE",
      objectType: "INGEST_MESSAGE",
      objectId: stored.id,
      actorKind: "API_CLIENT",
      actorId: principal.clientId,
      source: `gateway:${gateway.code}`,
      occurredAt: receivedAt,
      payload: {
        gateway: gateway.code,
        seq: message.seq,
        readingsStored: storedRows.length,
        eventsStored: eventsInserted,
        readingsHash: storedReadingsHash(storedRows.map((r) => ({ sensorCode: r.sensorCode, capturedAt: r.capturedAt, value: r.value }))),
        flagged: result.readings.flagged,
        seqReused: result.seqReused,
        clockOffsetSeconds,
      },
      idempotencyKey: `telemetry:${stored.id}`,
    });
  }

  for (const r of storedRows) {
    batch.sensorIds.add(r.sensorId);
    batch.buildingIds.add(r.buildingId);
    if (!batch.from || r.capturedAt < batch.from) batch.from = r.capturedAt;
    if (!batch.to || r.capturedAt > batch.to) batch.to = r.capturedAt;
    if (r.capturedAt > (ctx.lastByDevice.get(r.deviceId) ?? "")) ctx.lastByDevice.set(r.deviceId, r.capturedAt);
  }
  for (const e of eventRows) batch.buildingIds.add(e.buildingId);
  return result;
}

/**
 * Re-hashes the readings stored for a message and compares with the hash written in the ledger
 * when they arrived. Raw readings are purged after 90 days; past that, there is nothing left to re-hash.
 */
export async function verifyIngestMessage(messageId: string): Promise<{ status: "INTACT" | "MODIFIE" | "PURGE" | "INCONNU"; expected: string | null; actual: string | null }> {
  const events = await repositories.ledger.listByObject("INGEST_MESSAGE", messageId);
  const anchor = events.find((e) => e.eventType === "TELEMETRY_MESSAGE");
  if (!anchor) return { status: "INCONNU", expected: null, actual: null };
  const expected = String((anchor.payload as Record<string, unknown>).readingsHash ?? "");
  const stored = Number((anchor.payload as Record<string, unknown>).readingsStored ?? 0);
  const rows = await repositories.readings.listByIngestMessage(messageId);
  if (stored > 0 && rows.length === 0) return { status: "PURGE", expected, actual: null };
  const codes = new Map(((await repositories.telemetrySensors.listAll()) as Sensor[]).map((s) => [s.id, s.code ?? s.id]));
  const actual = storedReadingsHash(rows.map((r) => ({ sensorCode: codes.get(r.sensorId) ?? r.sensorId, capturedAt: r.capturedAt, value: r.value })));
  return { status: actual === expected ? "INTACT" : "MODIFIE", expected, actual };
}

export async function gatewayConfiguration(principal: ApiPrincipal, code: string | null) {
  const gateway = principal.deviceId ? await repositories.devices.findById(principal.deviceId) : code ? await repositories.devices.findByCode(code) : null;
  if (!gateway || gateway.type !== "PASSERELLE") throw new NotFoundError("Passerelle", code ?? principal.deviceId ?? "?");
  if (principal.deviceId && code && code !== gateway.code) throw new AuthorizationError("Cette clé est liée à une autre passerelle.");
  const devices = (await repositories.devices.list()).filter((d) => d.gatewayId === gateway.id);
  const sensors = (await repositories.telemetrySensors.listByDevices(devices.map((d) => d.id))) as Sensor[];
  const zones = new Map((await repositories.zones.list()).map((z) => [z.id, z.code]));
  return {
    gateway: gateway.code,
    reportSeconds: 120,
    bufferDays: 30,
    devices: devices.map((d) => ({ code: d.code, ref: d.catalogRef ?? null, type: d.type })),
    channels: sensors.map((s) => {
      const spec = s.catalogRef === "PLC" ? CONTROLLER_CHANNELS : sensorSpec(s.catalogRef);
      return {
        code: s.code,
        ref: s.catalogRef ?? null,
        type: s.sensorType,
        unit: s.unit,
        position: s.position ?? null,
        zone: s.zoneId ? (zones.get(s.zoneId) ?? null) : null,
        acquisitionSeconds: spec?.acquisitionSeconds ?? null,
      };
    }),
  };
}
