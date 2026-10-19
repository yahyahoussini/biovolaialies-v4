import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NewMeasurement } from "../../domain/iot/types";
import type { AggregateGranularity, BandStatus } from "../../domain/shared/enums";
import type {
  IngestMessage,
  MeasurementAggregate,
  ReferenceBand,
  RuleStateRow,
  RuleTransition,
  SensorCalibration,
  SiteEvent,
  Zone,
  ZoneOccupation,
} from "../../domain/telemetry/types";
import { db } from "../db/client";
import {
  alertNotifications,
  eggLoggerMissions,
  ingestMessages,
  measurementAggregates,
  measurements,
  referenceBands,
  ruleSettings,
  ruleStates,
  ruleTransitions,
  ruleWatermarks,
  sensorCalibrations,
  sensors,
  siteEvents,
  zoneOccupations,
  zones,
} from "../db/schema";

const CHUNK = 400;
function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export class DrizzleZoneRepository {
  async list(): Promise<Zone[]> {
    return db.query.zones.findMany({ orderBy: (t, { asc }) => [asc(t.farmId), asc(t.code)] });
  }
  async findById(id: string): Promise<Zone | null> {
    return (await db.query.zones.findFirst({ where: eq(zones.id, id) })) ?? null;
  }
  async listByFarm(farmId: string): Promise<Zone[]> {
    return db.query.zones.findMany({ where: eq(zones.farmId, farmId), orderBy: (t, { asc }) => asc(t.code) });
  }
  async listByBuilding(buildingId: string): Promise<Zone[]> {
    return db.query.zones.findMany({ where: eq(zones.buildingId, buildingId), orderBy: (t, { asc }) => asc(t.code) });
  }
  async create(input: Omit<Zone, "id">): Promise<Zone> {
    const [row] = await db.insert(zones).values(input).returning();
    return row;
  }
}

export class DrizzleZoneOccupationRepository {
  async listByZones(zoneIds: string[]): Promise<ZoneOccupation[]> {
    if (zoneIds.length === 0) return [];
    return db.query.zoneOccupations.findMany({ where: inArray(zoneOccupations.zoneId, zoneIds), orderBy: (t, { asc }) => asc(t.startedAt) });
  }
  async listByLot(lotId: string): Promise<ZoneOccupation[]> {
    return db.query.zoneOccupations.findMany({ where: eq(zoneOccupations.lotId, lotId), orderBy: (t, { asc }) => asc(t.startedAt) });
  }
  async list(): Promise<ZoneOccupation[]> {
    return db.query.zoneOccupations.findMany({ orderBy: (t, { desc }) => desc(t.startedAt) });
  }
  async findById(id: string): Promise<ZoneOccupation | null> {
    return (await db.query.zoneOccupations.findFirst({ where: eq(zoneOccupations.id, id) })) ?? null;
  }
  async create(input: Omit<ZoneOccupation, "id">): Promise<ZoneOccupation> {
    const [row] = await db.insert(zoneOccupations).values(input).returning();
    return row;
  }
  /** Closes an open occupation; returns null if it was already closed (lost race). */
  async close(id: string, endedAt: string): Promise<ZoneOccupation | null> {
    const [row] = await db
      .update(zoneOccupations)
      .set({ endedAt })
      .where(and(eq(zoneOccupations.id, id), isNull(zoneOccupations.endedAt)))
      .returning();
    return row ?? null;
  }
}

export class DrizzleTelemetryReadingRepository {
  /** Inserts readings; the (sensor, capturedAt) unique index silently drops the ones already stored. Returns what was new. */
  async insertIgnoringDuplicates(rows: NewMeasurement[]): Promise<{ id: string; sensorId: string; capturedAt: string }[]> {
    const inserted: { id: string; sensorId: string; capturedAt: string }[] = [];
    for (const part of chunks(rows)) {
      const r = await db
        .insert(measurements)
        .values(part)
        .onConflictDoNothing()
        .returning({ id: measurements.id, sensorId: measurements.sensorId, capturedAt: measurements.capturedAt });
      inserted.push(...r);
    }
    return inserted;
  }

  /** The reading just before `at` for each sensor — the previous value the spike check compares to. */
  async previousBefore(sensorIds: string[], at: string): Promise<Map<string, { value: number; capturedAt: string }>> {
    const out = new Map<string, { value: number; capturedAt: string }>();
    for (const id of sensorIds) {
      const row = await db.query.measurements.findFirst({
        where: and(eq(measurements.sensorId, id), lt(measurements.capturedAt, at)),
        orderBy: (t, { desc }) => desc(t.capturedAt),
        columns: { value: true, capturedAt: true },
      });
      if (row) out.set(id, row);
    }
    return out;
  }

  /** Usable (OK or legacy unflagged) readings of the given sensors in [from, to], oldest first. */
  async listUsable(sensorIds: string[], from: string, to: string): Promise<{ sensorId: string; capturedAt: string; value: number }[]> {
    if (sensorIds.length === 0) return [];
    return db
      .select({ sensorId: measurements.sensorId, capturedAt: measurements.capturedAt, value: measurements.value })
      .from(measurements)
      .where(
        and(
          inArray(measurements.sensorId, sensorIds),
          gte(measurements.capturedAt, from),
          lte(measurements.capturedAt, to),
          or(eq(measurements.qualityFlag, "OK"), isNull(measurements.qualityFlag))
        )
      )
      .orderBy(asc(measurements.capturedAt));
  }

  /** All readings (any flag) in [from, to) for aggregation. */
  async listForAggregation(from: string, to: string, sensorIds?: string[]) {
    return db
      .select({
        sensorId: measurements.sensorId,
        buildingId: measurements.buildingId,
        zoneId: measurements.zoneId,
        lotId: measurements.lotId,
        capturedAt: measurements.capturedAt,
        value: measurements.value,
        qualityFlag: measurements.qualityFlag,
      })
      .from(measurements)
      .where(and(gte(measurements.capturedAt, from), lt(measurements.capturedAt, to), sensorIds ? inArray(measurements.sensorId, sensorIds) : undefined))
      .orderBy(asc(measurements.capturedAt));
  }

  /** Re-ties the automatic attributions of a zone over [from, to) to a lot (or to none). Manual attributions are left alone. */
  async setAttribution(zoneId: string, from: string, to: string | null, lotId: string | null): Promise<number> {
    const r = await db
      .update(measurements)
      .set({ lotId, attribution: lotId ? "OCCUPATION" : "AUCUN_LOT" })
      .where(
        and(
          eq(measurements.zoneId, zoneId),
          gte(measurements.capturedAt, from),
          to ? lt(measurements.capturedAt, to) : undefined,
          inArray(measurements.attribution, ["OCCUPATION", "AUCUN_LOT", "AMBIGU"])
        )
      )
      .returning({ id: measurements.id });
    return r.length;
  }

  async listByIngestMessage(messageId: string) {
    return db
      .select({ sensorId: measurements.sensorId, capturedAt: measurements.capturedAt, value: measurements.value })
      .from(measurements)
      .where(eq(measurements.ingestMessageId, messageId));
  }

  /**
   * First and last reading of these sensors, any flag. One query per sensor on purpose: SQLite
   * answers min/max of one sensor from the (sensor, capturedAt) index in a single step, whereas
   * a min/max over an IN list reads every row of every sensor.
   */
  async rangeOf(sensorIds: string[]): Promise<{ first: string | null; last: string | null }> {
    let first: string | null = null;
    let last: string | null = null;
    for (const id of sensorIds) {
      const [lo] = await db.select({ v: sql<string | null>`min(${measurements.capturedAt})` }).from(measurements).where(eq(measurements.sensorId, id));
      const [hi] = await db.select({ v: sql<string | null>`max(${measurements.capturedAt})` }).from(measurements).where(eq(measurements.sensorId, id));
      if (lo?.v && (!first || lo.v < first)) first = lo.v;
      if (hi?.v && (!last || hi.v > last)) last = hi.v;
    }
    return { first, last };
  }

  /** Last reading per sensor, from the index (see rangeOf). */
  async lastReadingPerSensor(sensorIds?: string[]): Promise<Map<string, string>> {
    const ids = sensorIds ?? (await db.select({ id: sensors.id }).from(sensors)).map((r) => r.id);
    const out = new Map<string, string>();
    for (const id of ids) {
      const [hi] = await db.select({ v: sql<string | null>`max(${measurements.capturedAt})` }).from(measurements).where(eq(measurements.sensorId, id));
      if (hi?.v) out.set(id, hi.v);
    }
    return out;
  }

  async latestPerSensor(sensorIds: string[]) {
    const out = new Map<string, { value: number; capturedAt: string; qualityFlag: string | null }>();
    for (const id of sensorIds) {
      const row = await db.query.measurements.findFirst({
        where: eq(measurements.sensorId, id),
        orderBy: (t, { desc }) => desc(t.capturedAt),
        columns: { value: true, capturedAt: true, qualityFlag: true },
      });
      if (row) out.set(id, row);
    }
    return out;
  }

  async countByFlag(buildingId: string, from: string): Promise<{ flag: string | null; n: number }[]> {
    return db
      .select({ flag: measurements.qualityFlag, n: sql<number>`count(*)` })
      .from(measurements)
      .where(and(eq(measurements.buildingId, buildingId), gte(measurements.capturedAt, from)))
      .groupBy(measurements.qualityFlag);
  }

  async listRecentBySensor(sensorId: string, limit: number) {
    return db.query.measurements.findMany({ where: eq(measurements.sensorId, sensorId), orderBy: (t, { desc }) => desc(t.capturedAt), limit });
  }

  /** Deletes raw readings older than `before` — only call once their 15-minute buckets are stored. */
  async purgeBefore(before: string): Promise<number> {
    const r = await db.delete(measurements).where(lt(measurements.capturedAt, before)).returning({ id: measurements.id });
    return r.length;
  }

  async oldestCapturedAt(): Promise<string | null> {
    const [row] = await db.select({ v: sql<string | null>`min(${measurements.capturedAt})` }).from(measurements);
    return row?.v ?? null;
  }
}

export class DrizzleIngestMessageRepository {
  async find(gatewayId: string, seq: number, payloadHash: string): Promise<IngestMessage | null> {
    return (
      (await db.query.ingestMessages.findFirst({
        where: and(eq(ingestMessages.gatewayId, gatewayId), eq(ingestMessages.seq, seq), eq(ingestMessages.payloadHash, payloadHash)),
      })) ?? null
    );
  }
  async existsWithOtherContent(gatewayId: string, seq: number, payloadHash: string): Promise<boolean> {
    const row = await db.query.ingestMessages.findFirst({
      where: and(eq(ingestMessages.gatewayId, gatewayId), eq(ingestMessages.seq, seq), sql`${ingestMessages.payloadHash} <> ${payloadHash}`),
      columns: { id: true },
    });
    return !!row;
  }
  /** Inserts the message; returns null when the same message was stored concurrently. */
  async create(input: Omit<IngestMessage, "id">): Promise<IngestMessage | null> {
    const [row] = await db.insert(ingestMessages).values(input).onConflictDoNothing().returning();
    return row ?? null;
  }
  async update(id: string, patch: Partial<Pick<IngestMessage, "accepted" | "duplicates" | "rejected" | "flagged">>) {
    await db.update(ingestMessages).set(patch).where(eq(ingestMessages.id, id));
  }
  async listRecent(limit: number, gatewayId?: string): Promise<IngestMessage[]> {
    return db.query.ingestMessages.findMany({
      where: gatewayId ? eq(ingestMessages.gatewayId, gatewayId) : undefined,
      orderBy: (t, { desc }) => desc(t.receivedAt),
      limit,
    });
  }
}

export class DrizzleSiteEventRepository {
  async insertIgnoringDuplicates(rows: Omit<SiteEvent, "id">[]): Promise<number> {
    let n = 0;
    for (const part of chunks(rows)) {
      const r = await db.insert(siteEvents).values(part).onConflictDoNothing().returning({ id: siteEvents.id });
      n += r.length;
    }
    return n;
  }
  async listByBuilding(buildingId: string, from: string, to: string): Promise<SiteEvent[]> {
    return db.query.siteEvents.findMany({
      where: and(eq(siteEvents.buildingId, buildingId), gte(siteEvents.occurredAt, from), lte(siteEvents.occurredAt, to)),
      orderBy: (t, { asc }) => asc(t.occurredAt),
    }) as Promise<SiteEvent[]>;
  }
  async listRecent(limit: number, buildingIds?: string[]): Promise<SiteEvent[]> {
    return db.query.siteEvents.findMany({
      where: buildingIds ? inArray(siteEvents.buildingId, buildingIds) : undefined,
      orderBy: (t, { desc }) => desc(t.occurredAt),
      limit,
    }) as Promise<SiteEvent[]>;
  }
}

export class DrizzleAggregateRepository {
  async upsertMany(rows: Omit<MeasurementAggregate, "id">[]): Promise<void> {
    for (const part of chunks(rows, 200)) {
      await db
        .insert(measurementAggregates)
        .values(part)
        .onConflictDoUpdate({
          target: [measurementAggregates.sensorId, measurementAggregates.granularity, measurementAggregates.bucketStart],
          set: {
            count: sql`excluded.count`,
            expected: sql`excluded.expected`,
            suspectCount: sql`excluded.suspect_count`,
            sum: sql`excluded.sum`,
            sumSq: sql`excluded.sum_sq`,
            min: sql`excluded.min`,
            max: sql`excluded.max`,
            lotId: sql`excluded.lot_id`,
            zoneId: sql`excluded.zone_id`,
          },
        });
    }
  }
  async list(granularity: AggregateGranularity, sensorIds: string[], from: string, to: string): Promise<MeasurementAggregate[]> {
    if (sensorIds.length === 0) return [];
    return db.query.measurementAggregates.findMany({
      where: and(
        eq(measurementAggregates.granularity, granularity),
        inArray(measurementAggregates.sensorId, sensorIds),
        gte(measurementAggregates.bucketStart, from),
        lt(measurementAggregates.bucketStart, to)
      ),
      orderBy: (t, { asc }) => asc(t.bucketStart),
    });
  }
  async listByLots(granularity: AggregateGranularity, lotIds: string[]): Promise<MeasurementAggregate[]> {
    if (lotIds.length === 0) return [];
    return db.query.measurementAggregates.findMany({
      where: and(eq(measurementAggregates.granularity, granularity), inArray(measurementAggregates.lotId, lotIds)),
      orderBy: (t, { asc }) => asc(t.bucketStart),
    });
  }
  async latestBucket(granularity: AggregateGranularity): Promise<string | null> {
    const [row] = await db
      .select({ v: sql<string | null>`max(${measurementAggregates.bucketStart})` })
      .from(measurementAggregates)
      .where(eq(measurementAggregates.granularity, granularity));
    return row?.v ?? null;
  }
  async purgeBefore(granularity: AggregateGranularity, before: string): Promise<number> {
    const r = await db
      .delete(measurementAggregates)
      .where(and(eq(measurementAggregates.granularity, granularity), lt(measurementAggregates.bucketStart, before)))
      .returning({ id: measurementAggregates.id });
    return r.length;
  }
  async counts(): Promise<{ granularity: string; n: number }[]> {
    return db.select({ granularity: measurementAggregates.granularity, n: sql<number>`count(*)` }).from(measurementAggregates).groupBy(measurementAggregates.granularity);
  }
}

export class DrizzleReferenceBandRepository {
  async list(): Promise<ReferenceBand[]> {
    return db.query.referenceBands.findMany({ orderBy: (t, { asc }) => [asc(t.sensorType), asc(t.productionLine), asc(t.ageDayFrom), asc(t.version)] }) as Promise<ReferenceBand[]>;
  }
  async listActive(): Promise<ReferenceBand[]> {
    return db.query.referenceBands.findMany({ where: eq(referenceBands.status, "ACTIVE") }) as Promise<ReferenceBand[]>;
  }
  async findById(id: string): Promise<ReferenceBand | null> {
    return ((await db.query.referenceBands.findFirst({ where: eq(referenceBands.id, id) })) as ReferenceBand | undefined) ?? null;
  }
  async create(input: Omit<ReferenceBand, "id" | "createdAt">): Promise<ReferenceBand> {
    const [row] = await db.insert(referenceBands).values(input).returning();
    return row as ReferenceBand;
  }
  /** Compare-and-set on status, so two people deciding the same proposal cannot both win. */
  async setStatus(id: string, from: BandStatus, to: BandStatus, decidedBy: string | null): Promise<ReferenceBand | null> {
    const [row] = await db
      .update(referenceBands)
      .set({ status: to, decidedBy, decidedAt: new Date().toISOString() })
      .where(and(eq(referenceBands.id, id), eq(referenceBands.status, from)))
      .returning();
    return (row as ReferenceBand | undefined) ?? null;
  }
}

export class DrizzleRuleSettingsRepository {
  async listAll() {
    return db.query.ruleSettings.findMany();
  }
  async upsert(ruleCode: string, buildingId: string | null, params: Record<string, number | string>, updatedBy: string) {
    const existing = await db.query.ruleSettings.findFirst({
      where: and(eq(ruleSettings.ruleCode, ruleCode), buildingId ? eq(ruleSettings.buildingId, buildingId) : isNull(ruleSettings.buildingId)),
    });
    const now = new Date().toISOString();
    if (existing) {
      const [row] = await db.update(ruleSettings).set({ params, updatedBy, updatedAt: now }).where(eq(ruleSettings.id, existing.id)).returning();
      return { row, previous: existing.params };
    }
    const [row] = await db.insert(ruleSettings).values({ ruleCode, buildingId, params, updatedBy, updatedAt: now }).returning();
    return { row, previous: null };
  }
}

export class DrizzleRuleStateRepository {
  async listByBuilding(buildingId: string): Promise<RuleStateRow[]> {
    return db.query.ruleStates.findMany({ where: eq(ruleStates.buildingId, buildingId) }) as Promise<RuleStateRow[]>;
  }
  async listNonNormal(): Promise<RuleStateRow[]> {
    return db.query.ruleStates.findMany({ where: sql`${ruleStates.state} <> 'NORMAL'` }) as Promise<RuleStateRow[]>;
  }
  async listByRule(ruleCode: string): Promise<RuleStateRow[]> {
    return db.query.ruleStates.findMany({ where: eq(ruleStates.ruleCode, ruleCode) }) as Promise<RuleStateRow[]>;
  }
  async upsertMany(rows: Omit<RuleStateRow, "id">[]): Promise<void> {
    for (const part of chunks(rows, 200)) {
      await db
        .insert(ruleStates)
        .values(part)
        .onConflictDoUpdate({
          target: [ruleStates.ruleCode, ruleStates.subjectKey],
          set: { state: sql`excluded.state`, since: sql`excluded.since`, openAlertId: sql`excluded.open_alert_id`, memory: sql`excluded.memory`, buildingId: sql`excluded.building_id` },
        });
    }
  }
  async clearOpenAlert(alertId: string): Promise<void> {
    await db.update(ruleStates).set({ openAlertId: null }).where(eq(ruleStates.openAlertId, alertId));
  }
}

export class DrizzleRuleWatermarkRepository {
  async get(buildingId: string): Promise<string | null> {
    return (await db.query.ruleWatermarks.findFirst({ where: eq(ruleWatermarks.buildingId, buildingId) }))?.evaluatedUntil ?? null;
  }
  /** Moves the watermark forward only, so two evaluations racing cannot move it back. Returns false if another run got further. */
  async advance(buildingId: string, expected: string | null, to: string): Promise<boolean> {
    const now = new Date().toISOString();
    if (expected === null) {
      const r = await db.insert(ruleWatermarks).values({ buildingId, evaluatedUntil: to, updatedAt: now }).onConflictDoNothing().returning();
      return r.length > 0;
    }
    const r = await db
      .update(ruleWatermarks)
      .set({ evaluatedUntil: to, updatedAt: now })
      .where(and(eq(ruleWatermarks.buildingId, buildingId), eq(ruleWatermarks.evaluatedUntil, expected)))
      .returning();
    return r.length > 0;
  }
}

export class DrizzleRuleTransitionRepository {
  async insertMany(rows: Omit<RuleTransition, "id">[]): Promise<RuleTransition[]> {
    const out: RuleTransition[] = [];
    for (const part of chunks(rows, 200)) out.push(...((await db.insert(ruleTransitions).values(part).returning()) as RuleTransition[]));
    return out;
  }
  async listByBuilding(buildingId: string, from: string, to: string): Promise<RuleTransition[]> {
    return db.query.ruleTransitions.findMany({
      where: and(eq(ruleTransitions.buildingId, buildingId), gte(ruleTransitions.at, from), lte(ruleTransitions.at, to)),
      orderBy: (t, { asc }) => asc(t.at),
    }) as Promise<RuleTransition[]>;
  }
  async listRecent(limit: number, buildingIds?: string[]): Promise<RuleTransition[]> {
    return db.query.ruleTransitions.findMany({
      where: buildingIds ? inArray(ruleTransitions.buildingId, buildingIds) : undefined,
      orderBy: (t, { desc }) => desc(t.at),
      limit,
    }) as Promise<RuleTransition[]>;
  }
  async listByAlert(alertId: string): Promise<RuleTransition[]> {
    return db.query.ruleTransitions.findMany({ where: eq(ruleTransitions.alertId, alertId), orderBy: (t, { asc }) => asc(t.at) }) as Promise<RuleTransition[]>;
  }
  async listBySubject(ruleCode: string, subjectKey: string): Promise<RuleTransition[]> {
    return db.query.ruleTransitions.findMany({
      where: and(eq(ruleTransitions.ruleCode, ruleCode), eq(ruleTransitions.subjectKey, subjectKey)),
      orderBy: (t, { asc }) => asc(t.at),
    }) as Promise<RuleTransition[]>;
  }
  async setAlert(ids: string[], alertId: string): Promise<void> {
    if (ids.length === 0) return;
    await db.update(ruleTransitions).set({ alertId }).where(inArray(ruleTransitions.id, ids));
  }
  async countAll(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(ruleTransitions);
    return row?.n ?? 0;
  }
}

export class DrizzleAlertNotificationRepository {
  async create(input: Omit<typeof alertNotifications.$inferInsert, "id">) {
    const [row] = await db.insert(alertNotifications).values(input).returning();
    return row;
  }
  async listByAlert(alertId: string) {
    return db.query.alertNotifications.findMany({ where: eq(alertNotifications.alertId, alertId), orderBy: (t, { asc }) => asc(t.sentAt) });
  }
}

export class DrizzleCalibrationRepository {
  async create(input: Omit<SensorCalibration, "id">): Promise<SensorCalibration> {
    const [row] = await db.insert(sensorCalibrations).values(input).returning();
    return row as SensorCalibration;
  }
  async listBySensor(sensorId: string): Promise<SensorCalibration[]> {
    return db.query.sensorCalibrations.findMany({ where: eq(sensorCalibrations.sensorId, sensorId), orderBy: (t, { desc }) => desc(t.calibratedAt) }) as Promise<SensorCalibration[]>;
  }
  /** Latest calibration per sensor. */
  async latestBySensor(): Promise<Map<string, SensorCalibration>> {
    const rows = (await db.query.sensorCalibrations.findMany({ orderBy: (t, { asc }) => asc(t.calibratedAt) })) as SensorCalibration[];
    const out = new Map<string, SensorCalibration>();
    for (const r of rows) out.set(r.sensorId, r);
    return out;
  }
}

export class DrizzleEggLoggerMissionRepository {
  async create(input: { sensorId: string; eggLotId: string; startedAt: string; endedAt: string | null }) {
    const [row] = await db.insert(eggLoggerMissions).values(input).returning();
    return row;
  }
  async listByEggLot(eggLotId: string) {
    return db.query.eggLoggerMissions.findMany({ where: eq(eggLoggerMissions.eggLotId, eggLotId), orderBy: (t, { asc }) => asc(t.startedAt) });
  }
  async listBySensor(sensorId: string) {
    return db.query.eggLoggerMissions.findMany({ where: eq(eggLoggerMissions.sensorId, sensorId), orderBy: (t, { asc }) => asc(t.startedAt) });
  }
}

/** Sensor lookups the telemetry layer needs beyond the IoT repository. */
export class DrizzleTelemetrySensorRepository {
  async findByCodes(codes: string[]) {
    if (codes.length === 0) return [];
    return db.query.sensors.findMany({ where: inArray(sensors.code, codes) });
  }
  async listByDevices(deviceIds: string[]) {
    if (deviceIds.length === 0) return [];
    return db.query.sensors.findMany({ where: inArray(sensors.deviceId, deviceIds) });
  }
  async listAll() {
    return db.query.sensors.findMany();
  }
  async listByZones(zoneIds: string[]) {
    if (zoneIds.length === 0) return [];
    return db.query.sensors.findMany({ where: inArray(sensors.zoneId, zoneIds) });
  }
}
