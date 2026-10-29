import { createHash, randomUUID } from "node:crypto";
import { repositories } from "../../data/repositories";
import type { Device, NewMeasurement, Sensor } from "../../domain/iot/types";
import { bucketStart } from "../../domain/telemetry/aggregate";
import { channelSpec } from "../../domain/telemetry/catalog";
import { CLOCK_TOLERANCE_SECONDS, classifyReading } from "../../domain/telemetry/ingest";
import { SENSOR_TYPE_LABEL } from "../../domain/telemetry/labels";
import { compareMachineWithProbes, type MachineComparison } from "../../domain/telemetry/machine-compare";
import { decodeLogBytes, isSampleLog, LOG_TIME_ZONES, parseLog, TIME_FORMATS, type LogProfile } from "../../domain/telemetry/machine-log";
import { buildSampleLog, toWindows1252 } from "../../domain/telemetry/machine-sample";
import { occupantAt } from "../../domain/telemetry/occupation";
import { mergeParams } from "../../domain/telemetry/rules/settings";
import type { MachineImport, Zone } from "../../domain/telemetry/types";
import type { ReadingFlag, SensorType } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { withLock } from "../../lib/keyed-lock";
import { parseInput, z } from "../../lib/zod";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, isWithinScope, resolveBuildingHierarchy, type HierarchyPath } from "../identity/scope-check";
import { appendLedgerEvent } from "../ledger/ledger";
import { aggregateRange } from "./aggregate";
import { clearTelemetrySeriesCache, evaluateBuilding } from "./evaluate";
import { storedReadingsHash } from "./ingest";

/**
 * Incubator logs imported from a file (document 3, lot 13). The values land on the incubator's
 * machine channel — the same one the gateway fills when the machine can be read over Modbus — so
 * charts, buckets and the COUVOIR_POSITIONS rule see one series whatever its path. Each import is
 * registered with the SHA-256 of the exact bytes received, and the readings it stored are anchored
 * in the chained ledger, like a gateway message.
 */

/** About a month of one-minute lines from several channels. A longer export is split by the user. */
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
const IMPORT_METHOD = "Journal machine importé (fichier)";
const MIN = 60_000;
const HOUR = 60 * MIN;

export type MachineFeed = "PASSERELLE" | "FICHIER";
export const MACHINE_FEED_LABEL: Record<MachineFeed, string> = {
  PASSERELLE: "Lue par la passerelle (Modbus RTU)",
  FICHIER: "Journal exporté puis importé (fichier)",
};

const IMPORT_DATA_STATUS = ["REEL", "TEST", "SIMULATION"] as const;

const profileSchema = z.object({
  delimiter: z.enum([";", ",", "\t"]),
  decimal: z.enum([",", "."]),
  timeColumns: z.array(z.string().trim().min(1).max(120)).min(1).max(2),
  timeFormat: z.enum(TIME_FORMATS),
  timeZone: z.enum(LOG_TIME_ZONES),
  channels: z.record(z.string(), z.string().trim().min(1).max(120)),
});

const importSchema = z.object({
  zoneId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(200),
  dataStatus: z.enum(IMPORT_DATA_STATUS),
  profile: profileSchema,
});

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" });

/** The incubator's machine channels: values read from the machine itself, not from an independent probe. */
async function machineSensors(zoneId: string): Promise<Sensor[]> {
  return ((await repositories.telemetrySensors.listByZones([zoneId])) as Sensor[]).filter((s) => s.catalogRef === "PLC");
}

async function incubatorZone(zoneId: string, session: Session): Promise<Zone & { buildingId: string }> {
  const zone = await repositories.zones.findById(zoneId);
  if (!zone || zone.kind !== "INCUBATEUR" || !zone.buildingId) throw new NotFoundError("Incubateur", zoneId);
  assertInScope(session, await resolveBuildingHierarchy(zone.buildingId));
  return zone as Zone & { buildingId: string };
}

/** The rule's own tolerance between the machine and the independent probes, as set for this building. */
async function machineGapTolerance(buildingId: string): Promise<number> {
  const settings = await repositories.ruleSettings.listAll();
  const layer = (b: string | null) => settings.find((s) => s.ruleCode === "COUVOIR_POSITIONS" && s.buildingId === b)?.params;
  return Number(mergeParams("COUVOIR_POSITIONS", layer(null), layer(buildingId)).maxMachineGapC);
}

export interface IncubatorTarget {
  zone: Zone;
  buildingLabel: string;
  machine: { sensorId: string; sensorType: SensorType; label: string; code: string | null }[];
  feed: MachineFeed;
  /** Independent H06 probes in the machine, the reference the machine is compared with. */
  probes: number;
  lastImport: MachineImport | null;
  /** The profile of the last import of this machine, offered again: a machine always writes the same way. */
  lastProfile: LogProfile | null;
}

/** Incubators in the reader's scope that have a machine channel to fill. */
export async function incubatorTargets(session: Session): Promise<IncubatorTarget[]> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const zones = (await repositories.zones.list()).filter((z) => z.kind === "INCUBATEUR" && z.buildingId);
  const devices = new Map((await repositories.devices.list()).map((d) => [d.id, d]));
  const buildings = new Map((await repositories.buildings.list()).map((b) => [b.id, b]));
  const paths = new Map<string, HierarchyPath>();
  const imports = await repositories.machineImports.list(500, zones.map((z) => z.id));
  const out: IncubatorTarget[] = [];
  for (const zone of zones) {
    const buildingId = zone.buildingId as string;
    if (!paths.has(buildingId)) paths.set(buildingId, await resolveBuildingHierarchy(buildingId));
    if (!isWithinScope(session, paths.get(buildingId)!)) continue;
    const sensors = (await repositories.telemetrySensors.listByZones([zone.id])) as Sensor[];
    const machine = sensors.filter((s) => s.catalogRef === "PLC");
    if (machine.length === 0) continue;
    const lastImport = imports.find((i) => i.zoneId === zone.id) ?? null;
    const building = buildings.get(buildingId);
    out.push({
      zone,
      buildingLabel: building ? `${building.name} (${building.code})` : buildingId,
      machine: machine.map((s) => ({ sensorId: s.id, sensorType: s.sensorType, label: SENSOR_TYPE_LABEL[s.sensorType], code: s.code ?? null })),
      feed: machine.some((s) => devices.get(s.deviceId)?.gatewayId) ? "PASSERELLE" : "FICHIER",
      probes: sensors.filter((s) => s.catalogRef === "H06" && s.sensorType === "TEMPERATURE").length,
      lastImport,
      lastProfile: lastImport ? (lastImport.profile as unknown as LogProfile) : null,
    });
  }
  return out.sort((a, b) => (a.buildingLabel + a.zone.code < b.buildingLabel + b.zone.code ? -1 : 1));
}

export interface MachineImportResult {
  record: MachineImport;
  flagged: Partial<Record<ReadingFlag, number>>;
  comparison: MachineComparison | null;
}

/**
 * Stores one machine log. The same file for the same incubator is refused, so a double click or a
 * second upload never writes twice; a different file overlapping an earlier one only adds the
 * readings not stored yet (same channel, same instant: same reading). Every reading is kept, odd
 * ones with a flag saying why, exactly as from a gateway.
 */
export async function importMachineLog(raw: unknown, bytes: Uint8Array, session: Session, now = new Date()): Promise<MachineImportResult> {
  if (!can(session, "EDIT", "IOT")) throw new AuthorizationError();
  const input = parseInput(importSchema, raw);
  if (bytes.byteLength === 0) throw new ValidationError("Le fichier est vide.");
  if (bytes.byteLength > MAX_LOG_BYTES) {
    throw new ValidationError(`Fichier trop volumineux : ${Math.round(bytes.byteLength / 1024)} Ko pour ${MAX_LOG_BYTES / 1024 / 1024} Mo au plus. Exportez une période plus courte.`);
  }
  const zone = await incubatorZone(input.zoneId, session);
  const sensors = await machineSensors(zone.id);
  const byType = new Map(sensors.map((s) => [s.sensorType as string, s]));
  const channels = Object.keys(input.profile.channels);
  if (channels.length === 0) throw new ValidationError("Aucune colonne n'est associée à une voie de la machine.");
  for (const type of channels) {
    if (!byType.has(type)) throw new ValidationError(`Aucune voie « ${SENSOR_TYPE_LABEL[type as SensorType] ?? type} » n'est déclarée pour cet incubateur.`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { text, encoding } = decodeLogBytes(bytes);
  if (input.dataStatus === "REEL" && isSampleLog(text)) {
    throw new ValidationError("Ce fichier est l'exemple fourni par la plateforme : ses valeurs sont simulées. Importez-le comme « Simulation ».");
  }

  return withLock(`machine-import:${zone.id}`, async () => {
    const earlier = await repositories.machineImports.findByZoneAndSha(zone.id, sha256);
    if (earlier) throw new ConflictError(`Ce fichier a déjà été importé pour cet incubateur le ${fmt(earlier.importedAt)} (${earlier.accepted} mesures). Rien n'a été réécrit.`);
    const log = parseLog(text, input.profile);
    if (log.rows.length === 0) {
      const first = log.errors[0];
      throw new ValidationError(`Aucune ligne lisible avec ce profil.${first ? ` Ligne ${first.line} : ${first.message}` : ""}`);
    }

    const importId = randomUUID();
    const receivedAt = now.toISOString();
    const devices = new Map<string, Device>((await repositories.devices.list()).map((d) => [d.id, d]));
    const calibrations = await repositories.calibrations.latestBySensor();
    const occupations = await repositories.zoneOccupations.listByZones([zone.id]);
    const ordered = [...log.rows].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const before = await repositories.readings.previousBefore(sensors.map((s) => s.id), ordered[0].at);
    const previous = new Map(sensors.map((s) => [s.id, before.get(s.id) ?? null]));

    const rows: NewMeasurement[] = [];
    for (const r of ordered) {
      for (const [type, value] of Object.entries(r.values)) {
        const sensor = byType.get(type)!;
        const device = devices.get(sensor.deviceId)!;
        // A file may be months old, so the gateway's 30-day window does not apply; a machine clock
        // ahead of the server does, and so does a line dated before the machine was installed.
        const flag: ReadingFlag =
          Date.parse(r.at) > now.getTime() + CLOCK_TOLERANCE_SECONDS * 1000
            ? "HORLOGE"
            : classifyReading({
                channel: channelSpec(sensor.catalogRef ?? null, sensor.sensorType),
                sensorType: sensor.sensorType,
                sensorStatus: sensor.status,
                value,
                capturedAt: r.at,
                receivedAt: r.at,
                gatewayClockOffsetSeconds: 0,
                installedAt: device.installedAt,
                calibrationDueAt: calibrations.get(sensor.id)?.nextDueAt ?? null,
                previous: previous.get(sensor.id) ?? null,
              });
        if (flag === "OK") previous.set(sensor.id, { value, capturedAt: r.at });
        const occupant = occupantAt(occupations, zone.id, r.at);
        rows.push({
          sensorId: sensor.id,
          deviceId: sensor.deviceId,
          buildingId: zone.buildingId,
          lotId: occupant.lotId,
          value,
          unit: sensor.unit,
          capturedAt: r.at,
          sourceType: "CAPTEUR",
          sourceId: importId,
          actorId: session.userId,
          dataStatus: input.dataStatus,
          measurementMethod: IMPORT_METHOD,
          documentId: null,
          validationStatus: null,
          zoneId: zone.id,
          qualityFlag: flag,
          attribution: occupant.attribution,
          ingestMessageId: null,
          receivedAt,
        });
      }
    }

    const inserted = new Set((await repositories.readings.insertIgnoringDuplicates(rows)).map((i) => `${i.sensorId}|${i.capturedAt}`));
    // Exactly the rows written, each once: the count reported and the hash anchored are those of the database.
    const stored = rows.filter((r) => inserted.delete(`${r.sensorId}|${r.capturedAt}`));
    const flagged: Partial<Record<ReadingFlag, number>> = {};
    for (const r of stored) if (r.qualityFlag && r.qualityFlag !== "OK") flagged[r.qualityFlag] = (flagged[r.qualityFlag] ?? 0) + 1;
    const storedFrom = stored.length ? stored[0].capturedAt : null;
    const storedTo = stored.length ? stored[stored.length - 1].capturedAt : null;

    const record = await repositories.machineImports.create({
      id: importId,
      buildingId: zone.buildingId,
      zoneId: zone.id,
      fileName: input.fileName,
      sha256,
      bytes: bytes.byteLength,
      encoding,
      profile: input.profile as unknown as Record<string, unknown>,
      dataStatus: input.dataStatus,
      lines: log.lines,
      accepted: stored.length,
      duplicates: rows.length - stored.length,
      rejected: log.lines - log.rows.length,
      flagged: Object.values(flagged).reduce((a, b) => a + (b ?? 0), 0),
      errors: log.errors,
      fromAt: log.from,
      toAt: log.to,
      importedBy: session.userId,
      importedAt: receivedAt,
    });

    const codes = new Map(sensors.map((s) => [s.id, s.code ?? s.id]));
    await appendLedgerEvent({
      eventType: "MACHINE_LOG_IMPORT",
      objectType: "MACHINE_IMPORT",
      objectId: importId,
      actorKind: "USER",
      actorId: session.userId,
      source: `fichier:${input.fileName}`,
      occurredAt: receivedAt,
      payload: {
        zone: zone.code,
        fileName: input.fileName,
        fileSha256: sha256,
        bytes: bytes.byteLength,
        lines: log.lines,
        readingsStored: stored.length,
        readingsHash: storedReadingsHash(stored.map((r) => ({ sensorCode: codes.get(r.sensorId)!, capturedAt: r.capturedAt, value: r.value }))),
        flagged,
        from: log.from,
        to: log.to,
        dataStatus: input.dataStatus,
      },
      idempotencyKey: `machine-import:${importId}`,
    });

    if (storedFrom && storedTo) {
      // Rules only move forward from their watermark: lines after it are judged now, earlier ones
      // only enter the buckets and the comparison below.
      clearTelemetrySeriesCache();
      await aggregateRange(storedFrom, storedTo, sensors.map((s) => s.id));
      await evaluateBuilding(zone.buildingId);
    }
    return { record, flagged, comparison: await comparisonFor(record) };
  });
}

/** Machine against the independent probes, hour by hour, over the period an import covers. */
async function comparisonFor(record: MachineImport): Promise<MachineComparison | null> {
  if (!record.fromAt || !record.toAt) return null;
  const sensors = (await repositories.telemetrySensors.listByZones([record.zoneId])) as Sensor[];
  const machine = sensors.find((s) => s.catalogRef === "PLC" && s.sensorType === "TEMPERATURE_MACHINE");
  const probes = sensors.filter((s) => s.catalogRef === "H06" && s.sensorType === "TEMPERATURE");
  if (!machine || probes.length === 0) return null;
  const buckets = await repositories.aggregates.list("1h", [machine.id, ...probes.map((p) => p.id)], bucketStart(record.fromAt, "1h"), new Date(Date.parse(record.toAt) + 1).toISOString());
  const position = new Map(probes.map((p) => [p.id, p.position ?? null]));
  return compareMachineWithProbes(
    buckets.filter((b) => b.sensorId === machine.id && b.count > 0).map((b) => ({ at: b.bucketStart, mean: b.sum / b.count })),
    buckets.filter((b) => position.has(b.sensorId) && b.count > 0).map((b) => ({ at: b.bucketStart, mean: b.sum / b.count, position: position.get(b.sensorId) ?? null })),
    await machineGapTolerance(record.buildingId)
  );
}

export interface MachineImportRow extends MachineImport {
  zoneCode: string;
  zoneName: string;
  buildingLabel: string;
  importedByName: string;
}

async function toRows(records: MachineImport[]): Promise<MachineImportRow[]> {
  const [zones, buildings, users] = await Promise.all([repositories.zones.list(), repositories.buildings.list(), repositories.users.list()]);
  return records.map((r) => {
    const zone = zones.find((z) => z.id === r.zoneId);
    const building = buildings.find((b) => b.id === r.buildingId);
    return {
      ...r,
      zoneCode: zone?.code ?? r.zoneId,
      zoneName: zone?.name ?? "—",
      buildingLabel: building ? `${building.name} (${building.code})` : r.buildingId,
      importedByName: users.find((u) => u.id === r.importedBy)?.fullName ?? "—",
    };
  });
}

/** The import register of the incubators the reader may see, newest first. */
export async function listMachineImports(session: Session, limit = 100): Promise<MachineImportRow[]> {
  const zoneIds = (await incubatorTargets(session)).map((t) => t.zone.id);
  return toRows(await repositories.machineImports.list(limit, zoneIds));
}

export async function getMachineImport(importId: string, session: Session): Promise<{ row: MachineImportRow; comparison: MachineComparison | null; feed: MachineFeed }> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const record = await repositories.machineImports.findById(importId);
  if (!record) throw new NotFoundError("Import", importId);
  assertInScope(session, await resolveBuildingHierarchy(record.buildingId));
  const devices = new Map((await repositories.devices.list()).map((d) => [d.id, d]));
  const feed: MachineFeed = (await machineSensors(record.zoneId)).some((s) => devices.get(s.deviceId)?.gatewayId) ? "PASSERELLE" : "FICHIER";
  return { row: (await toRows([record]))[0], comparison: await comparisonFor(record), feed };
}

export type ImportVerification = "INTACT" | "MODIFIE" | "PURGE" | "INCONNU";

/**
 * Re-hashes the readings an import stored and compares with the hash written in the ledger when
 * it was imported. Raw readings are purged after 90 days; once part of the period is gone there is
 * nothing complete left to re-hash, which is said as such rather than reported as a change.
 */
export async function verifyMachineImport(importId: string, session: Session): Promise<ImportVerification> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const record = await repositories.machineImports.findById(importId);
  if (!record) throw new NotFoundError("Import", importId);
  assertInScope(session, await resolveBuildingHierarchy(record.buildingId));
  const anchor = (await repositories.ledger.listByObject("MACHINE_IMPORT", importId)).find((e) => e.eventType === "MACHINE_LOG_IMPORT");
  if (!anchor) return "INCONNU";
  const payload = anchor.payload as Record<string, unknown>;
  const expected = String(payload.readingsHash ?? "");
  const storedCount = Number(payload.readingsStored ?? 0);
  const sensors = await machineSensors(record.zoneId);
  const rows = record.fromAt && record.toAt ? await repositories.machineImports.storedReadings(importId, sensors.map((s) => s.id), record.fromAt, record.toAt) : [];
  if (rows.length !== storedCount && record.fromAt) {
    const oldest = await repositories.readings.oldestCapturedAt();
    if (!oldest || record.fromAt < oldest) return "PURGE";
  }
  const codes = new Map(sensors.map((s) => [s.id, s.code ?? s.id]));
  const actual = storedReadingsHash(rows.map((r) => ({ sensorCode: codes.get(r.sensorId) ?? r.sensorId, capturedAt: r.capturedAt, value: r.value })));
  return actual === expected ? "INTACT" : "MODIFIE";
}

/**
 * Whether the gateway reads the machine (Modbus, when the plate says it has a port) or its log is
 * exported and imported. A channel no gateway reads is left out of the gateway's configuration and
 * of the silence check: its data arrives when someone imports it.
 */
export async function setMachineFeed(zoneId: string, feed: MachineFeed, session: Session): Promise<void> {
  if (!can(session, "EDIT", "IOT")) throw new AuthorizationError();
  if (feed !== "PASSERELLE" && feed !== "FICHIER") throw new ValidationError("Mode de lecture inconnu.");
  const zone = await incubatorZone(zoneId, session);
  const sensors = await machineSensors(zone.id);
  if (sensors.length === 0) throw new ValidationError("Aucune voie machine n'est déclarée pour cet incubateur.");
  const devices = await repositories.devices.listByBuilding(zone.buildingId);
  const gateway = devices.find((d) => d.type === "PASSERELLE");
  if (feed === "PASSERELLE" && !gateway) throw new ValidationError("Ce bâtiment n'a pas de passerelle : la machine ne peut être lue que par fichier.");
  for (const device of devices.filter((d) => sensors.some((s) => s.deviceId === d.id))) {
    const target = feed === "PASSERELLE" ? gateway!.id : null;
    if ((device.gatewayId ?? null) === target) continue;
    await repositories.devices.attach(device.id, { catalogRef: device.catalogRef ?? "PLC", gatewayId: target });
    await recordAudit({
      actorId: session.userId,
      entityType: "device",
      entityId: device.id,
      field: "lecture",
      oldValue: MACHINE_FEED_LABEL[device.gatewayId ? "PASSERELLE" : "FICHIER"],
      newValue: MACHINE_FEED_LABEL[feed],
      reason: feed === "PASSERELLE" ? `${zone.code} : sortie de communication raccordée à la passerelle` : `${zone.code} : pas de lecture directe de la machine, journal exporté et importé`,
      relatedLotId: null,
      relatedEventId: null,
    });
  }
}

/**
 * An example log for one incubator: the twelve hours up to its latest independent-probe reading,
 * as a French machine would write it, with a display drifting up over the last six hours and three
 * minutes where the machine wrote "ERR". Marked as an example: it can only be imported as simulation.
 */
export async function machineLogSample(zoneId: string, session: Session): Promise<{ fileName: string; body: Uint8Array<ArrayBuffer> }> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const zone = await incubatorZone(zoneId, session);
  const probes = ((await repositories.telemetrySensors.listByZones([zone.id])) as Sensor[]).filter((s) => s.catalogRef === "H06");
  const last = (await repositories.readings.rangeOf(probes.map((p) => p.id))).last;
  const to = Math.floor((last ? Date.parse(last) : Date.now()) / MIN) * MIN + MIN;
  const text = buildSampleLog({ machine: zone.code, from: to - 12 * HOUR, to, driftFrom: to - 6 * HOUR, faultMinutes: [200, 201, 202], marker: true });
  return { fileName: `exemple-journal-${zone.code}.csv`, body: toWindows1252(text) };
}
