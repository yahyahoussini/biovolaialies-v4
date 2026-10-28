import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  AGGREGATE_GRANULARITY,
  ALERT_OUTCOME,
  ALERT_SEVERITY,
  ALERT_STATUS,
  BAND_SOURCE,
  BAND_STATUS,
  CALIBRATION_RESULT,
  CHICK_GRADE,
  EGG_TYPE,
  ID_ALIAS_SCHEME,
  LINE_PURPOSE,
  LOT_PHASE,
  PHASE_PLAN_CHECK,
  SUBJECT_EVENT_TYPE,
  SUBJECT_SEX,
  SUBJECT_STATUS,
  TABLE_EGG_LOT_STATUS,
  TRANSFER_OBJECT,
  TRANSFER_STATUS,
  DEVICE_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  READING_ATTRIBUTION,
  READING_FLAG,
  RULE_STATE,
  SEASON,
  SITE_EVENT_KIND,
  ZONE_KIND,
  COMMISSIONING_RESULT,
  HATCH_CYCLE_STATUS,
  LEAD_ACTIVITY,
  LEAD_STATUS,
  LEDGER_ACTOR_KIND,
  QUALITY_CASE_STATUS,
  QUALITY_HOLD_SCOPE,
  QUALITY_REASON,
  ANOMALY_STATUS,
  BUILDING_ZONE_TYPE,
  DATA_STATUS,
  DESTINATION_TYPE,
  DEVICE_STATUS,
  EVENT_TYPE,
  LOT_STATUS,
  MEASUREMENT_SOURCE_TYPE,
  ORGANIZATION_TYPE,
  RELATION_TYPE,
  ROLE,
  SANITARY_STATUS,
  SCOPE_TYPE,
  SENSOR_TYPE,
  VALIDATION_STATUS,
} from "../../domain/shared/enums";
import { DISCREPANCY_STATUS, FIELD_KIND, FIELD_STATUS } from "../../domain/field/field";
import { EGG_EXCEPTION, MARKING_ROUTE, MARKING_RUN_STATUS, MARKING_SOURCE, type MarkingRoute } from "../../domain/marking/marking";

/**
 * Drizzle schema — mirrors domain/*\/types.ts 1:1 (same fields, camelCase JS <-> snake_case columns).
 * This file is the ONLY place table shape is defined; repositories map rows to domain types.
 * SQLite/libSQL today; the shape is chosen to be a near-direct port to Postgres later
 * (see ARCHITECTURE.md §5) — swap the driver + `sqliteTable` -> `pgTable`, keep the columns.
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString());

/**
 * Shared provenance shape (domain/shared/provenance.ts) — source_type/source_id, actor_id,
 * data_status, measurement_method, device_id, document_id, validation_status. Every
 * structured record since Phase 3 (feed/water/weight/mortality/environment, measurements)
 * and, as of Phase 7, every downstream traceability stage (collections, slaughter_batches,
 * transformation_batches, products) spreads this instead of declaring its own data_status.
 * Defined here (before `users` is declared below) because it's only *called* later, once
 * `users` already exists — the `.references(() => users.id)` closure isn't evaluated until
 * Drizzle resolves the reference, not at this function's own definition time.
 */
const provenanceColumns = () => ({
  sourceType: text("source_type", { enum: MEASUREMENT_SOURCE_TYPE }).notNull(),
  sourceId: text("source_id"),
  actorId: text("actor_id").references(() => users.id),
  dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
  measurementMethod: text("measurement_method"),
  deviceId: text("device_id"),
  documentId: text("document_id"),
  validationStatus: text("validation_status", { enum: VALIDATION_STATUS }),
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  type: text("type", { enum: ORGANIZATION_TYPE }).notNull(),
  createdAt: createdAt(),
});

export const cooperatives = sqliteTable("cooperatives", {
  id: id(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  region: text("region").notNull(),
  createdAt: createdAt(),
});

export const producers = sqliteTable("producers", {
  id: id(),
  cooperativeId: text("cooperative_id")
    .notNull()
    .references(() => cooperatives.id),
  name: text("name").notNull(),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  createdAt: createdAt(),
});

export const farms = sqliteTable("farms", {
  id: id(),
  producerId: text("producer_id")
    .notNull()
    .references(() => producers.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  geoLat: real("geo_lat"),
  geoLng: real("geo_lng"),
  createdAt: createdAt(),
});

export const buildings = sqliteTable("buildings", {
  id: id(),
  farmId: text("farm_id")
    .notNull()
    .references(() => farms.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
  zoneType: text("zone_type", { enum: BUILDING_ZONE_TYPE }).notNull(),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role", { enum: ROLE }).notNull(),
  scopeType: text("scope_type", { enum: SCOPE_TYPE }).notNull(),
  scopeId: text("scope_id"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export const lots = sqliteTable("lots", {
  id: id(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  code: text("code").notNull(),
  species: text("species").notNull(),
  breed: text("breed").notNull(),
  status: text("status", { enum: LOT_STATUS }).notNull(),
  initialPopulation: integer("initial_population").notNull(),
  currentPopulation: integer("current_population").notNull(),
  plannedStartAt: text("planned_start_at"),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
  createdAt: createdAt(),
  /** Production line of the client's process (handwritten flow): reference bands are chosen by it. */
  productionLine: text("production_line"),
  /** Breeders, meat birds or layers — set from the line; null on lots recorded before lines existed. */
  purpose: text("purpose", { enum: LINE_PURPOSE }),
  /** Hatch date of the birds: the age every phase and band is judged against. Null when unknown. */
  hatchedAt: text("hatched_at"),
});

export const lotEvents = sqliteTable("lot_events", {
  id: id(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  eventType: text("event_type", { enum: EVENT_TYPE }).notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  occurredAt: text("occurred_at").notNull(),
  actorId: text("actor_id").references(() => users.id),
  dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
  sourceType: text("source_type", { enum: MEASUREMENT_SOURCE_TYPE }),
  sourceId: text("source_id"),
  deviceId: text("device_id"),
  measurementMethod: text("measurement_method"),
  validationStatus: text("validation_status", { enum: VALIDATION_STATUS }),
  createdAt: createdAt(),
});

export const collections = sqliteTable("collections", {
  id: id(),
  code: text("code").notNull().unique(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  destinationId: text("destination_id").references(() => destinations.id),
  collectedAt: text("collected_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const slaughterBatches = sqliteTable("slaughter_batches", {
  id: id(),
  code: text("code").notNull().unique(),
  sourceLotId: text("source_lot_id")
    .notNull()
    .references(() => lots.id),
  quantityIn: real("quantity_in").notNull(),
  quantityOut: real("quantity_out").notNull(),
  losses: real("losses").notNull(),
  slaughteredAt: text("slaughtered_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const transformationBatches = sqliteTable("transformation_batches", {
  id: id(),
  code: text("code").notNull().unique(),
  upstreamType: text("upstream_type", { enum: ["SLAUGHTER_BATCH", "TRANSFORMATION_BATCH"] as const }).notNull(),
  upstreamId: text("upstream_id").notNull(),
  processType: text("process_type").notNull(),
  inputQuantity: real("input_quantity").notNull(),
  outputQuantity: real("output_quantity").notNull(),
  losses: real("losses").notNull(),
  rejects: real("rejects").notNull().default(0),
  occurredAt: text("occurred_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Structured analytical data (Phase 3) — dedicated columns, not generic JSON.
// provenanceColumns() is defined near the top of this file — see the comment there.
// ---------------------------------------------------------------------------

export const feedUsageRecords = sqliteTable("feed_usage_records", {
  id: id(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  occurredAt: text("occurred_at").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  feedType: text("feed_type").notNull(),
  feedSource: text("feed_source"),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const waterUsageRecords = sqliteTable("water_usage_records", {
  id: id(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  lotId: text("lot_id").references(() => lots.id),
  occurredAt: text("occurred_at").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  source: text("source"),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const weightMeasurementRecords = sqliteTable("weight_measurement_records", {
  id: id(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  occurredAt: text("occurred_at").notNull(),
  averageWeight: real("average_weight").notNull(),
  unit: text("unit").notNull(),
  sampleCount: integer("sample_count"),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const mortalityRecords = sqliteTable("mortality_records", {
  id: id(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  occurredAt: text("occurred_at").notNull(),
  count: integer("count").notNull(),
  suspectedCause: text("suspected_cause"),
  causeValidated: integer("cause_validated", { mode: "boolean" }).notNull().default(false),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const environmentMeasurementRecords = sqliteTable("environment_measurement_records", {
  id: id(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  lotId: text("lot_id").references(() => lots.id),
  measurementType: text("measurement_type", { enum: SENSOR_TYPE }).notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  occurredAt: text("occurred_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// IoT
// ---------------------------------------------------------------------------

export const devices = sqliteTable("devices", {
  id: id(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  code: text("code").notNull().unique(),
  type: text("type", { enum: DEVICE_TYPE }).notNull(),
  status: text("status", { enum: DEVICE_STATUS }).notNull(),
  installedAt: text("installed_at").notNull(),
  lastCommunicationAt: text("last_communication_at"),
  batteryLevel: integer("battery_level"),
  signalQuality: integer("signal_quality"),
  /** Document 2 reference (A01, D01, L01…) when the device is one of the catalogue's. */
  catalogRef: text("catalog_ref"),
  /** The gateway this device reports through (document 2 ch. 6). Null for a gateway itself. */
  gatewayId: text("gateway_id"),
  /** Gateways only: the offset last measured between the gateway clock and the server (seconds). */
  clockOffsetSeconds: real("clock_offset_seconds"),
  lastClockSyncAt: text("last_clock_sync_at"),
});

export const sensors = sqliteTable("sensors", {
  id: id(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  sensorType: text("sensor_type", { enum: SENSOR_TYPE }).notNull(),
  unit: text("unit").notNull(),
  status: text("status", { enum: DEVICE_STATUS }).notNull(),
  configuration: text("configuration", { mode: "json" }),
  /** The identifier the gateway sends. Unique, so a reading can never land on the wrong channel. */
  code: text("code").unique(),
  catalogRef: text("catalog_ref"),
  zoneId: text("zone_id").references(() => zones.id),
  /** Where it is in the zone: "8,5 m", "HAUT", "PORTE", "LIGNE 2"… (document 2 placement rules). */
  position: text("position"),
  mountingHeightM: real("mounting_height_m"),
});

export const measurements = sqliteTable("measurements", {
  id: id(),
  sensorId: text("sensor_id")
    .notNull()
    .references(() => sensors.id),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  lotId: text("lot_id").references(() => lots.id),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  capturedAt: text("captured_at").notNull(),
  ...provenanceColumns(),
  // Overrides provenanceColumns()'s loose, nullable `deviceId` — a measurement's device is
  // a real, required FK (every reading comes from an actual device), not a loose pointer.
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  createdAt: createdAt(),
  /** Telemetry columns (null on readings recorded before the ingestion layer existed). */
  zoneId: text("zone_id"),
  qualityFlag: text("quality_flag", { enum: READING_FLAG }),
  attribution: text("attribution", { enum: READING_ATTRIBUTION }),
  ingestMessageId: text("ingest_message_id"),
  receivedAt: text("received_at"),
}, (t) => [
  // A gateway replaying its buffer resends readings it already sent: same channel, same instant
  // means same reading. This index is what makes the replay free of duplicates.
  uniqueIndex("measurements_sensor_captured_uq").on(t.sensorId, t.capturedAt),
  index("measurements_building_captured_idx").on(t.buildingId, t.capturedAt),
  index("measurements_lot_idx").on(t.lotId),
]);

// ---------------------------------------------------------------------------
// Telemetry — zones, occupation, ingestion, aggregates, rules (client documents 2 and 3)
// ---------------------------------------------------------------------------

/** A place a lot can occupy and a sensor can measure: part of a building, the run, an incubator, the egg room. */
export const zones = sqliteTable("zones", {
  id: id(),
  farmId: text("farm_id")
    .notNull()
    .references(() => farms.id),
  buildingId: text("building_id").references(() => buildings.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ZONE_KIND }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("zones_farm_code_uq").on(t.farmId, t.code)]);

/**
 * "La table qu'on oublie" (document 3, ch. 2): which lot occupied which zone between which
 * dates. A reading is tied to a lot only through this table, never by guessing from the building.
 */
export const zoneOccupations = sqliteTable("zone_occupations", {
  id: id(),
  zoneId: text("zone_id")
    .notNull()
    .references(() => zones.id),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  startedAt: text("started_at").notNull(),
  /** Null while the lot is still there. */
  endedAt: text("ended_at"),
  headCount: integer("head_count"),
  note: text("note"),
  recordedBy: text("recorded_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("zone_occupations_zone_idx").on(t.zoneId, t.startedAt)]);

/**
 * One uplink from a gateway. A message resent after a lost acknowledgement has the same seq and
 * the same content, and is recognised as a duplicate. The same seq with different content means
 * the gateway's counter restarted: the message is accepted (readings still dedupe one by one)
 * and the restart is reported, which is why the content hash is part of the key.
 */
export const ingestMessages = sqliteTable("ingest_messages", {
  id: id(),
  gatewayId: text("gateway_id")
    .notNull()
    .references(() => devices.id),
  seq: integer("seq").notNull(),
  sentAt: text("sent_at").notNull(),
  receivedAt: text("received_at").notNull(),
  clockOffsetSeconds: real("clock_offset_seconds"),
  readingCount: integer("reading_count").notNull(),
  eventCount: integer("event_count").notNull(),
  accepted: integer("accepted").notNull(),
  duplicates: integer("duplicates").notNull(),
  rejected: integer("rejected").notNull(),
  flagged: integer("flagged").notNull(),
  payloadHash: text("payload_hash").notNull(),
  apiClientId: text("api_client_id"),
}, (t) => [uniqueIndex("ingest_messages_gateway_seq_hash_uq").on(t.gatewayId, t.seq, t.payloadHash)]);

/** Discrete site events: GSM alarm, safety thermostat, doors and badges, power, camera stills (document 2: L01, L03, O01, F02). */
export const siteEvents = sqliteTable("site_events", {
  id: id(),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  zoneId: text("zone_id"),
  lotId: text("lot_id"),
  kind: text("kind", { enum: SITE_EVENT_KIND }).notNull(),
  occurredAt: text("occurred_at").notNull(),
  /** Badge holder reference for access events — never a name copied from elsewhere. */
  badge: text("badge"),
  /** Camera stills and short clips stay on site; only this reference is kept centrally (document 3, ch. 8). */
  mediaRef: text("media_ref"),
  payload: text("payload", { mode: "json" }),
  ingestMessageId: text("ingest_message_id"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("site_events_device_kind_at_uq").on(t.deviceId, t.kind, t.occurredAt),
  index("site_events_building_at_idx").on(t.buildingId, t.occurredAt),
]);

/**
 * Retention tiers (document 3, ch. 3): 15-minute buckets kept two years, hourly kept forever.
 * count/sum/sumSq make buckets mergeable, so an hour is computed exactly from its quarters and
 * the standard deviation survives the purge of raw readings. `expected` is what the sensor's
 * acquisition interval promises, so availability = count / expected.
 */
export const measurementAggregates = sqliteTable("measurement_aggregates", {
  id: id(),
  sensorId: text("sensor_id")
    .notNull()
    .references(() => sensors.id),
  granularity: text("granularity", { enum: AGGREGATE_GRANULARITY }).notNull(),
  bucketStart: text("bucket_start").notNull(),
  buildingId: text("building_id").notNull(),
  zoneId: text("zone_id"),
  lotId: text("lot_id"),
  count: integer("count").notNull(),
  expected: integer("expected"),
  suspectCount: integer("suspect_count").notNull(),
  sum: real("sum").notNull(),
  sumSq: real("sum_sq").notNull(),
  min: real("min"),
  max: real("max"),
}, (t) => [
  uniqueIndex("aggregates_sensor_gran_bucket_uq").on(t.sensorId, t.granularity, t.bucketStart),
  index("aggregates_lot_idx").on(t.lotId, t.granularity),
]);

/**
 * Reference bands, editable without redeploying (document 3, ch. 1 and 4). A change never
 * edits a row: it adds a version and marks the previous one REMPLACEE, so the band in force
 * at any past instant can be shown next to the alert it produced.
 */
export const referenceBands = sqliteTable("reference_bands", {
  id: id(),
  sensorType: text("sensor_type", { enum: SENSOR_TYPE }).notNull(),
  /** Production line the band applies to, or "*" for all. */
  productionLine: text("production_line").notNull(),
  ageDayFrom: integer("age_day_from").notNull(),
  ageDayTo: integer("age_day_to").notNull(),
  season: text("season", { enum: SEASON }).notNull(),
  low: real("low").notNull(),
  high: real("high").notNull(),
  unit: text("unit").notNull(),
  source: text("source", { enum: BAND_SOURCE }).notNull(),
  status: text("status", { enum: BAND_STATUS }).notNull(),
  version: integer("version").notNull(),
  lotsUsed: integer("lots_used"),
  samples: integer("samples"),
  learnedFrom: text("learned_from", { mode: "json" }).$type<string[]>(),
  supersedesId: text("supersedes_id"),
  note: text("note"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
  decidedBy: text("decided_by").references(() => users.id),
  decidedAt: text("decided_at"),
});

/** Per-rule parameters (thresholds, delays, light programme), global or per building — set from the screen, not in code. */
export const ruleSettings = sqliteTable("rule_settings", {
  id: id(),
  ruleCode: text("rule_code").notNull(),
  /** Null = the default for every building. */
  buildingId: text("building_id"),
  params: text("params", { mode: "json" }).$type<Record<string, number | string>>().notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("rule_settings_rule_building_uq").on(t.ruleCode, t.buildingId)]);

/** Current state of one rule on one subject (a sensor, a zone pair, a building). */
export const ruleStates = sqliteTable("rule_states", {
  id: id(),
  ruleCode: text("rule_code").notNull(),
  subjectKey: text("subject_key").notNull(),
  buildingId: text("building_id").notNull(),
  state: text("state", { enum: RULE_STATE }).notNull(),
  since: text("since").notNull(),
  openAlertId: text("open_alert_id"),
  /** Running memory some rules need between steps (cumulative exposure, last delivery…). */
  memory: text("memory", { mode: "json" }).$type<Record<string, number | string | null>>(),
}, (t) => [uniqueIndex("rule_states_rule_subject_uq").on(t.ruleCode, t.subjectKey)]);

/** Evaluation progress per building: rules have looked at every reading up to `evaluatedUntil`. */
export const ruleWatermarks = sqliteTable("rule_watermarks", {
  buildingId: text("building_id").primaryKey(),
  evaluatedUntil: text("evaluated_until").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Every change of state, and only those: the state at any instant is rebuilt from here (document 3, ch. 3). */
export const ruleTransitions = sqliteTable("rule_transitions", {
  id: id(),
  ruleCode: text("rule_code").notNull(),
  subjectKey: text("subject_key").notNull(),
  buildingId: text("building_id").notNull(),
  lotId: text("lot_id"),
  fromState: text("from_state", { enum: RULE_STATE }).notNull(),
  toState: text("to_state", { enum: RULE_STATE }).notNull(),
  at: text("at").notNull(),
  value: real("value"),
  referenceLow: real("reference_low"),
  referenceHigh: real("reference_high"),
  bandId: text("band_id"),
  diagnosis: text("diagnosis").notNull(),
  context: text("context", { mode: "json" }).$type<Record<string, unknown>>(),
  alertId: text("alert_id"),
  createdAt: createdAt(),
}, (t) => [index("rule_transitions_building_at_idx").on(t.buildingId, t.at)]);

/** Who was told about an alert, by which channel, and whether it actually left. */
export const alertNotifications = sqliteTable("alert_notifications", {
  id: id(),
  alertId: text("alert_id")
    .notNull()
    .references(() => alerts.id),
  level: integer("level").notNull(),
  recipientId: text("recipient_id").references(() => users.id),
  channel: text("channel", { enum: NOTIFICATION_CHANNEL }).notNull(),
  status: text("status", { enum: NOTIFICATION_STATUS }).notNull(),
  detail: text("detail"),
  sentAt: text("sent_at").notNull(),
});

/** Calibration register (document 3, lot 6): date, method, reference, result, next due date, evidence. */
export const sensorCalibrations = sqliteTable("sensor_calibrations", {
  id: id(),
  sensorId: text("sensor_id")
    .notNull()
    .references(() => sensors.id),
  calibratedAt: text("calibrated_at").notNull(),
  method: text("method").notNull(),
  referenceInstrument: text("reference_instrument").notNull(),
  referenceValue: real("reference_value").notNull(),
  measuredValue: real("measured_value").notNull(),
  offsetApplied: real("offset_applied"),
  tolerance: real("tolerance").notNull(),
  result: text("result", { enum: CALIBRATION_RESULT }).notNull(),
  nextDueAt: text("next_due_at").notNull(),
  performedBy: text("performed_by")
    .notNull()
    .references(() => users.id),
  evidenceRef: text("evidence_ref").notNull(),
  createdAt: createdAt(),
}, (t) => [index("sensor_calibrations_sensor_idx").on(t.sensorId, t.calibratedAt)]);

/** An egg logger's trip (document 2, H03): from the laying house to setting, it travels with one egg lot. */
export const eggLoggerMissions = sqliteTable("egg_logger_missions", {
  id: id(),
  sensorId: text("sensor_id")
    .notNull()
    .references(() => sensors.id),
  eggLotId: text("egg_lot_id")
    .notNull()
    .references(() => eggLots.id),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------

export const kpiDefinitions = sqliteTable("kpi_definitions", {
  id: id(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  unit: text("unit").notNull(),
  formulaDesc: text("formula_desc").notNull(),
});

export const kpiValues = sqliteTable("kpi_values", {
  id: id(),
  kpiDefinitionId: text("kpi_definition_id")
    .notNull()
    .references(() => kpiDefinitions.id),
  lotId: text("lot_id").references(() => lots.id),
  buildingId: text("building_id").references(() => buildings.id),
  period: text("period").notNull(),
  value: real("value").notNull(),
  dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
  calculatedAt: text("calculated_at").notNull(),
});

export const rules = sqliteTable("rules", {
  id: id(),
  name: text("name").notNull(),
  target: text("target").notNull(),
  condition: text("condition", { mode: "json" }).notNull(),
  severity: text("severity", { enum: ALERT_SEVERITY }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  description: text("description").notNull(),
  explanationTemplate: text("explanation_template").notNull(),
});

export const anomalies = sqliteTable("anomalies", {
  id: id(),
  ruleId: text("rule_id")
    .notNull()
    .references(() => rules.id),
  measurementId: text("measurement_id").references(() => measurements.id),
  kpiValueId: text("kpi_value_id").references(() => kpiValues.id),
  lotId: text("lot_id").references(() => lots.id),
  buildingId: text("building_id").references(() => buildings.id),
  severity: text("severity", { enum: ALERT_SEVERITY }).notNull(),
  observedValue: real("observed_value"),
  referenceValue: real("reference_value"),
  deviationPercent: real("deviation_percent"),
  unit: text("unit"),
  confidence: text("confidence", { enum: ["HIGH", "MEDIUM", "LOW"] as const }).notNull(),
  /** JSON-encoded AnomalyExplanation (domain/intelligence/types.ts) — the eight-question breakdown, not a flat sentence. */
  explanation: text("explanation", { mode: "json" }).notNull(),
  detectedAt: text("detected_at").notNull(),
  status: text("status", { enum: ANOMALY_STATUS }).notNull(),
});

export const alerts = sqliteTable("alerts", {
  id: id(),
  anomalyId: text("anomaly_id")
    .notNull()
    .references(() => anomalies.id),
  status: text("status", { enum: ALERT_STATUS }).notNull(),
  assignedTo: text("assigned_to").references(() => users.id),
  raisedAt: text("raised_at").notNull(),
  resolvedAt: text("resolved_at"),
  /** Escalation (document 3, lot 7): level reached, and when the next level is due if nobody acknowledges. */
  escalationLevel: integer("escalation_level").notNull().default(1),
  nextEscalationAt: text("next_escalation_at"),
  /** Set when closed: was the alert right? Without it the history teaches nothing (document 3, ch. 4). */
  outcome: text("outcome", { enum: ALERT_OUTCOME }),
});

export const actionRecords = sqliteTable("actions", {
  id: id(),
  alertId: text("alert_id").references(() => alerts.id),
  lotId: text("lot_id").references(() => lots.id),
  actionType: text("action_type").notNull(),
  description: text("description").notNull(),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id),
  performedAt: text("performed_at").notNull(),
});

// ---------------------------------------------------------------------------
// Sanitary
// ---------------------------------------------------------------------------

export const sanitaryObservations = sqliteTable("sanitary_observations", {
  id: id(),
  lotId: text("lot_id")
    .notNull()
    .references(() => lots.id),
  status: text("status", { enum: SANITARY_STATUS }).notNull(),
  notes: text("notes").notNull(),
  observedBy: text("observed_by")
    .notNull()
    .references(() => users.id),
  observedAt: text("observed_at").notNull(),
  validatedBy: text("validated_by").references(() => users.id),
  validationStatus: text("validation_status", { enum: VALIDATION_STATUS }).notNull(),
});

// ---------------------------------------------------------------------------
// Traceability / QR
// ---------------------------------------------------------------------------

export const destinations = sqliteTable("destinations", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: text("type", { enum: DESTINATION_TYPE }).notNull(),
  city: text("city").notNull(),
});

export const products = sqliteTable("products", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  transformationBatchId: text("transformation_batch_id")
    .notNull()
    .references(() => transformationBatches.id),
  packagingDate: text("packaging_date").notNull(),
  expiryDate: text("expiry_date"),
  /** Packaged quantity — what a recall has to account for. Nullable: rows from before it existed carry none. */
  quantity: real("quantity"),
  unit: text("unit"),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const relations = sqliteTable("relations", {
  id: id(),
  fromType: text("from_type").notNull(),
  fromId: text("from_id").notNull(),
  relationType: text("relation_type", { enum: RELATION_TYPE }).notNull(),
  toType: text("to_type").notNull(),
  toId: text("to_id").notNull(),
  metadata: text("metadata", { mode: "json" }).notNull(),
  createdAt: createdAt(),
});

export const qrTokens = sqliteTable("qr_tokens", {
  id: id(),
  token: text("token").notNull().unique(),
  scope: text("scope", { enum: ["LOT", "PRODUCT"] as const }).notNull(),
  lotId: text("lot_id").references(() => lots.id),
  productId: text("product_id").references(() => products.id),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  expiresAt: text("expires_at"),
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditLog = sqliteTable("audit_log", {
  id: id(),
  actorId: text("actor_id").references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  relatedLotId: text("related_lot_id").references(() => lots.id),
  relatedEventId: text("related_event_id").references(() => lotEvents.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Public site — inbound B2B requests from the BVU Tech contact form
// ---------------------------------------------------------------------------

export const leads = sqliteTable("leads", {
  id: id(),
  company: text("company").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  activity: text("activity", { enum: LEAD_ACTIVITY }).notNull(),
  capacity: text("capacity"),
  need: text("need").notNull(),
  /** Consent is required to submit, so always true — kept with the wording version it was given against. */
  consent: integer("consent", { mode: "boolean" }).notNull(),
  consentVersion: text("consent_version").notNull(),
  status: text("status", { enum: LEAD_STATUS }).notNull().default("NOUVEAU"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: text("updated_at"),
});

// ---------------------------------------------------------------------------
// Upstream chain — genetics, parent flocks, eggs, hatchery, chicks (client spec A03–A07)
// ---------------------------------------------------------------------------

export const parentFlocks = sqliteTable("parent_flocks", {
  id: id(),
  code: text("code").notNull().unique(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  strain: text("strain").notNull(),
  /** Genetic origin (A03) — set once at creation and never updated: "origine non écrasable". */
  geneticSupplier: text("genetic_supplier").notNull(),
  originCountry: text("origin_country").notNull(),
  importReference: text("import_reference"),
  placedAt: text("placed_at").notNull(),
  femaleCount: integer("female_count").notNull(),
  maleCount: integer("male_count").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
  /**
   * The lot that carries the flock's population, feed, mortality, phases and sensors. A parent
   * flock is a lot of breeders plus its genetic origin; null only on flocks recorded before.
   */
  lotId: text("lot_id").references(() => lots.id),
  productionLine: text("production_line"),
});

export const eggLots = sqliteTable("egg_lots", {
  id: id(),
  code: text("code").notNull().unique(),
  parentFlockId: text("parent_flock_id")
    .notNull()
    .references(() => parentFlocks.id),
  collectedAt: text("collected_at").notNull(),
  quantity: integer("quantity").notNull(),
  storageBuildingId: text("storage_building_id").references(() => buildings.id),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

/**
 * One incubation cycle. Egg lots are loaded into it through `relations` edges
 * (HATCH_CYCLE -PROVIENT_DE-> EGG_LOT, metadata.quantity), so a cycle can draw on several lots.
 * Candling and hatch results are filled in as the cycle advances; the balance
 * eggsSet = clearsRemoved + unhatched + chicksHatched is enforced once hatched.
 */
export const hatchCycles = sqliteTable("hatch_cycles", {
  id: id(),
  code: text("code").notNull().unique(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  incubatorRef: text("incubator_ref").notNull(),
  setAt: text("set_at").notNull(),
  eggsSet: integer("eggs_set").notNull(),
  status: text("status", { enum: HATCH_CYCLE_STATUS }).notNull(),
  candledAt: text("candled_at"),
  clearsRemoved: integer("clears_removed"),
  hatchedAt: text("hatched_at"),
  chicksHatched: integer("chicks_hatched"),
  unhatched: integer("unhatched"),
  culls: integer("culls"),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

export const chickLots = sqliteTable("chick_lots", {
  id: id(),
  code: text("code").notNull().unique(),
  hatchCycleId: text("hatch_cycle_id")
    .notNull()
    .references(() => hatchCycles.id),
  quantity: integer("quantity").notNull(),
  grade: text("grade", { enum: CHICK_GRADE }).notNull(),
  dispatchedAt: text("dispatched_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Downstream — commercial shipments of packaged products (client spec phase 13)
// ---------------------------------------------------------------------------

export const shipments = sqliteTable("shipments", {
  id: id(),
  code: text("code").notNull().unique(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  destinationId: text("destination_id")
    .notNull()
    .references(() => destinations.id),
  quantity: real("quantity").notNull(),
  unit: text("unit").notNull(),
  shippedAt: text("shipped_at").notNull(),
  ...provenanceColumns(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Quality — HOLD / RELEASE cases and the objects each one blocks (rules R09/R10)
// ---------------------------------------------------------------------------

export const qualityCases = sqliteTable("quality_cases", {
  id: id(),
  code: text("code").notNull().unique(),
  rootType: text("root_type").notNull(),
  rootId: text("root_id").notNull(),
  reason: text("reason", { enum: QUALITY_REASON }).notNull(),
  description: text("description").notNull(),
  scope: text("scope", { enum: QUALITY_HOLD_SCOPE }).notNull(),
  status: text("status", { enum: QUALITY_CASE_STATUS }).notNull(),
  evidenceRefs: text("evidence_refs", { mode: "json" }).$type<string[]>().notNull(),
  openedBy: text("opened_by")
    .notNull()
    .references(() => users.id),
  openedAt: text("opened_at").notNull(),
  decidedBy: text("decided_by").references(() => users.id),
  decisionJustification: text("decision_justification"),
  decisionEvidenceRefs: text("decision_evidence_refs", { mode: "json" }).$type<string[]>(),
  decidedAt: text("decided_at"),
});

export const qualityHoldItems = sqliteTable("quality_hold_items", {
  id: id(),
  caseId: text("case_id")
    .notNull()
    .references(() => qualityCases.id),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  /** Distance from the case's root object along the genealogy (0 = the root itself). */
  depth: integer("depth").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Ledger — append-only, hash-chained event journal (rules R07/R08, test T08)
// ---------------------------------------------------------------------------

/**
 * Every row carries `hash = sha256(prevHash + canonical(row))`, so altering, deleting or
 * reordering any past row breaks every hash after it. `seq` is unique, which also serialises
 * concurrent appends: the loser of a race hits the constraint and retries on the new head.
 * The repository exposes no update or delete — a correction is a new event naming the one it
 * corrects (`correctsEventId`).
 */
export const ledgerEvents = sqliteTable("ledger_events", {
  id: id(),
  seq: integer("seq").notNull().unique(),
  eventType: text("event_type").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  actorKind: text("actor_kind", { enum: LEDGER_ACTOR_KIND }).notNull(),
  actorId: text("actor_id"),
  source: text("source").notNull(),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  schemaVersion: integer("schema_version").notNull(),
  /** Client-supplied replay key (offline sync): the same key with the same payload is a no-op. */
  idempotencyKey: text("idempotency_key").unique(),
  payloadHash: text("payload_hash").notNull(),
  correctsEventId: text("corrects_event_id"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

// ---------------------------------------------------------------------------
// Machine identities for the /api/v1 integration surface
// ---------------------------------------------------------------------------

export const apiClients = sqliteTable("api_clients", {
  id: id(),
  name: text("name").notNull(),
  /** First characters of the key, shown in the admin list so a key can be recognised without being stored. */
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  /** A gateway key may post only for this gateway. Null for an integration server serving several. */
  deviceId: text("device_id"),
});

// ---------------------------------------------------------------------------
// Equipment register per reference unit + commissioning checklist (client xlsx / spec)
// ---------------------------------------------------------------------------

export const equipmentItems = sqliteTable("equipment_items", {
  id: id(),
  unitCode: text("unit_code").notNull(),
  unitLabel: text("unit_label").notNull(),
  category: text("category").notNull(),
  reference: text("reference"),
  name: text("name").notNull(),
  quantityRef: real("quantity_ref"),
  quantityMax: real("quantity_max"),
  status: text("status"),
  function: text("function"),
  characteristics: text("characteristics"),
  decisionRule: text("decision_rule"),
  candidates: text("candidates"),
  sortOrder: integer("sort_order").notNull(),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by").references(() => users.id),
});

export const commissioningTests = sqliteTable("commissioning_tests", {
  id: id(),
  code: text("code").notNull().unique(),
  equipment: text("equipment").notNull(),
  procedure: text("procedure").notNull(),
  result: text("result", { enum: COMMISSIONING_RESULT }).notNull(),
  executedBy: text("executed_by").references(() => users.id),
  executedAt: text("executed_at"),
  evidence: text("evidence"),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// Production flow (handwritten diagram): lines, phases, movements, individuals, table eggs
// ---------------------------------------------------------------------------

/**
 * A production line of the client's flow — what the birds are for and the phases they go
 * through, with the age windows the diagram gives. The plan is data, editable without a release.
 */
export const productionLines = sqliteTable("production_lines", {
  id: id(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  purpose: text("purpose", { enum: LINE_PURPOSE }).notNull(),
  /** Line whose breeders produce the chicks of this one (commercial lines only). */
  parentLineCode: text("parent_line_code"),
  eggType: text("egg_type", { enum: EGG_TYPE }),
  /** Ordered phases; each but the last ends between two ages in days. */
  phasePlan: text("phase_plan", { mode: "json" }).$type<{ phase: string; endsBetween: [number, number] | null }[]>().notNull(),
  /** Age window for leaving the line (slaughter of meat birds, reform of layers and breeders). */
  exitMinDays: integer("exit_min_days"),
  exitMaxDays: integer("exit_max_days"),
  exitLabel: text("exit_label").notNull(),
  /** Where the figures come from: the client's diagram, or a hypothesis to confirm. */
  source: text("source").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by").references(() => users.id),
});

export const lotPhases = sqliteTable(
  "lot_phases",
  {
    id: id(),
    lotId: text("lot_id")
      .notNull()
      .references(() => lots.id),
    phase: text("phase", { enum: LOT_PHASE }).notNull(),
    buildingId: text("building_id")
      .notNull()
      .references(() => buildings.id),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    ageDaysAtStart: integer("age_days_at_start"),
    planCheck: text("plan_check", { enum: PHASE_PLAN_CHECK }).notNull(),
    notes: text("notes"),
    actorId: text("actor_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("lot_phases_lot_idx").on(t.lotId, t.startedAt)]
);

/**
 * A movement of birds or eggs between sites, counted and signed by the sender, then counted and
 * signed again by a different person at arrival. The gap between the two counts is kept.
 */
export const transfers = sqliteTable(
  "transfers",
  {
    id: id(),
    code: text("code").notNull().unique(),
    objectType: text("object_type", { enum: TRANSFER_OBJECT }).notNull(),
    objectId: text("object_id").notNull(),
    sourceBuildingId: text("source_building_id")
      .notNull()
      .references(() => buildings.id),
    destinationBuildingId: text("destination_building_id")
      .notNull()
      .references(() => buildings.id),
    /** Existing lot the birds join, or the lot created at reception. */
    destinationLotId: text("destination_lot_id").references(() => lots.id),
    /** Code of the lot to create at reception when no destination lot exists yet. */
    destinationLotCode: text("destination_lot_code"),
    /** Line of the lot created at reception — required for chicks, whose line the hatchery cannot infer. */
    destinationLineCode: text("destination_line_code"),
    phaseOnArrival: text("phase_on_arrival", { enum: LOT_PHASE }),
    quantitySent: integer("quantity_sent").notNull(),
    sentAt: text("sent_at").notNull(),
    sentBy: text("sent_by")
      .notNull()
      .references(() => users.id),
    senderName: text("sender_name").notNull(),
    senderSignature: text("sender_signature").notNull(),
    documentRef: text("document_ref"),
    transporter: text("transporter"),
    vehicle: text("vehicle"),
    crates: integer("crates"),
    notes: text("notes"),
    quantityReceived: integer("quantity_received"),
    deadOnArrival: integer("dead_on_arrival"),
    receivedAt: text("received_at"),
    receivedBy: text("received_by").references(() => users.id),
    receiverName: text("receiver_name"),
    receiverSignature: text("receiver_signature"),
    /** sent − (received alive + dead on arrival): what neither count explains. */
    discrepancy: integer("discrepancy"),
    discrepancyReason: text("discrepancy_reason"),
    status: text("status", { enum: TRANSFER_STATUS }).notNull(),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
    updatedAt: text("updated_at"),
  },
  (t) => [index("transfers_object_idx").on(t.objectType, t.objectId), index("transfers_destination_idx").on(t.destinationBuildingId, t.status)]
);

/** Individually identified birds: a permanent identity, a visual ring, optionally an RFID chip. */
export const subjects = sqliteTable(
  "subjects",
  {
    id: id(),
    bvuId: text("bvu_id").notNull().unique(),
    lotId: text("lot_id")
      .notNull()
      .references(() => lots.id),
    sex: text("sex", { enum: SUBJECT_SEX }).notNull(),
    /** Ring number: the visual back-up identity every subject must carry. */
    visualId: text("visual_id").notNull().unique(),
    /** Chip or tag UID. Never reused: releasing one is a controlled, recorded act. */
    rfidUid: text("rfid_uid").unique(),
    taggedAt: text("tagged_at").notNull(),
    status: text("status", { enum: SUBJECT_STATUS }).notNull(),
    statusAt: text("status_at").notNull(),
    statusReason: text("status_reason"),
    notes: text("notes"),
    dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
    actorId: text("actor_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("subjects_lot_idx").on(t.lotId)]
);

export const subjectEvents = sqliteTable(
  "subject_events",
  {
    id: id(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    eventType: text("event_type", { enum: SUBJECT_EVENT_TYPE }).notNull(),
    value: real("value"),
    unit: text("unit"),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** How the reading was tied to this bird (RFID read at a station, ring checked by hand…). */
    attributionProof: text("attribution_proof"),
    occurredAt: text("occurred_at").notNull(),
    actorId: text("actor_id").references(() => users.id),
    deviceId: text("device_id"),
    sourceType: text("source_type", { enum: MEASUREMENT_SOURCE_TYPE }).notNull(),
    dataStatus: text("data_status", { enum: DATA_STATUS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("subject_events_subject_idx").on(t.subjectId, t.occurredAt)]
);

/** One day's collection of table eggs from a layer lot, graded at collection. */
export const tableEggLots = sqliteTable(
  "table_egg_lots",
  {
    id: id(),
    code: text("code").notNull().unique(),
    lotId: text("lot_id")
      .notNull()
      .references(() => lots.id),
    collectedOn: text("collected_on").notNull(),
    eggType: text("egg_type", { enum: EGG_TYPE }).notNull(),
    /** Every egg collected: saleable + cracked + dirty + small. */
    quantity: integer("quantity").notNull(),
    saleable: integer("saleable").notNull(),
    cracked: integer("cracked").notNull(),
    dirty: integer("dirty").notNull(),
    small: integer("small").notNull(),
    status: text("status", { enum: TABLE_EGG_LOT_STATUS }).notNull(),
    ...provenanceColumns(),
    createdAt: createdAt(),
  },
  (t) => [index("table_egg_lots_lot_idx").on(t.lotId, t.collectedOn)]
);

/**
 * The BIOVOLAILLES identifier of each traced object (document 3, chapter 2): ours, permanent,
 * and the thing every record attaches to. Assigned once per object, never changed.
 */
export const bvuIds = sqliteTable(
  "bvu_ids",
  {
    bvuId: text("bvu_id").primaryKey(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bvu_ids_object_idx").on(t.objectType, t.objectId)]
);

/** A supplier's code, a ring, a chip, an old code — resolvable to our identifier, never replacing it. */
export const identifierAliases = sqliteTable(
  "identifier_aliases",
  {
    id: id(),
    bvuId: text("bvu_id")
      .notNull()
      .references(() => bvuIds.bvuId),
    scheme: text("scheme", { enum: ID_ALIAS_SCHEME }).notNull(),
    /** Who issued the code (supplier name, ring maker); empty for our own schemes. */
    issuer: text("issuer").notNull().default(""),
    value: text("value").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    reason: text("reason"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("identifier_aliases_value_idx").on(t.scheme, t.value), index("identifier_aliases_bvu_idx").on(t.bvuId)]
);

// ---------------------------------------------------------------------------
// Field app (document 3, ch. 05)
// ---------------------------------------------------------------------------

/**
 * Every entry a phone sends, kept whatever became of it: applied, confirming, flagged or refused.
 * op_id makes a replay harmless; (device_id, device_seq) keeps each phone's order.
 */
export const fieldEntries = sqliteTable(
  "field_entries",
  {
    id: id(),
    opId: text("op_id").notNull().unique(),
    deviceId: text("device_id").notNull(),
    deviceSeq: integer("device_seq").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: FIELD_KIND }).notNull(),
    lotId: text("lot_id").references(() => lots.id),
    transferId: text("transfer_id").references(() => transfers.id),
    payload: text("payload", { mode: "json" }).notNull(),
    /** When the person entered it, by the phone's clock. */
    capturedAt: text("captured_at").notNull(),
    /** When it reached the server. */
    receivedAt: text("received_at").notNull(),
    status: text("status", { enum: FIELD_STATUS }).notNull(),
    message: text("message"),
    /** The record the entry produced (mortality_record, lot_event, transfer…), when it produced one. */
    resultType: text("result_type"),
    resultId: text("result_id"),
    /** Daily mortality only: lot and farm day, and how many birds this entry added to the lot. */
    dayKey: text("day_key"),
    appliedCount: integer("applied_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("field_entries_device_seq_idx").on(t.deviceId, t.deviceSeq),
    index("field_entries_day_idx").on(t.dayKey),
    index("field_entries_author_idx").on(t.authorId, t.receivedAt),
  ]
);

/** A day of mortality whose declarations disagree: kept open until a manager arbitrates it. */
export const fieldDiscrepancies = sqliteTable(
  "field_discrepancies",
  {
    id: id(),
    dayKey: text("day_key").notNull().unique(),
    lotId: text("lot_id")
      .notNull()
      .references(() => lots.id),
    day: text("day").notNull(),
    status: text("status", { enum: DISCREPANCY_STATUS }).notNull(),
    reason: text("reason").notNull(),
    openedAt: text("opened_at").notNull(),
    resolvedBy: text("resolved_by").references(() => users.id),
    resolvedAt: text("resolved_at"),
    /** The day's mortality the manager settled on, and why. */
    resolvedCount: integer("resolved_count"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [index("field_discrepancies_lot_idx").on(t.lotId, t.status)]
);

// ---------------------------------------------------------------------------
// Egg marking (document 2, ch. 08; document 3, lot 15)
// ---------------------------------------------------------------------------

/** A marking machine and its read-back camera. The prefix is printed on every shell it marks. */
export const eggMarkingLines = sqliteTable("egg_marking_lines", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  buildingId: text("building_id")
    .notNull()
    .references(() => buildings.id),
  routes: text("routes", { mode: "json" }).$type<MarkingRoute[]>().notNull(),
  shellPrefix: text("shell_prefix").notNull().unique(),
  nextSerial: integer("next_serial").notNull().default(0),
  readThreshold: real("read_threshold").notNull(),
  readWindow: integer("read_window").notNull(),
  trayCapacity: integer("tray_capacity").notNull(),
  protocol: text("protocol"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by").references(() => users.id),
});

/** One sitting of a line on one source. Counters are kept on the row so a run reads in one query. */
export const eggMarkingRuns = sqliteTable(
  "egg_marking_runs",
  {
    id: id(),
    code: text("code").notNull().unique(),
    lineId: text("line_id")
      .notNull()
      .references(() => eggMarkingLines.id),
    route: text("route", { enum: MARKING_ROUTE }).notNull(),
    sourceType: text("source_type", { enum: MARKING_SOURCE }).notNull(),
    sourceId: text("source_id").notNull(),
    status: text("status", { enum: MARKING_RUN_STATUS }).notNull(),
    startedAt: text("started_at").notNull(),
    startedBy: text("started_by")
      .notNull()
      .references(() => users.id),
    endedAt: text("ended_at"),
    endedBy: text("ended_by").references(() => users.id),
    firstSerial: integer("first_serial"),
    lastSerial: integer("last_serial"),
    allocated: integer("allocated").notNull().default(0),
    printed: integer("printed").notNull().default(0),
    readOk: integer("read_ok").notNull().default(0),
    readKo: integer("read_ko").notNull().default(0),
    guardSince: text("guard_since").notNull(),
    notes: text("notes"),
    closeNote: text("close_note"),
    createdAt: createdAt(),
  },
  (t) => [index("egg_marking_runs_line_idx").on(t.lineId, t.status), index("egg_marking_runs_source_idx").on(t.sourceType, t.sourceId)]
);

/** Codes handed out in one request. (line, first serial) unique: two blocks can never share a code. */
export const eggCodeBlocks = sqliteTable(
  "egg_code_blocks",
  {
    id: id(),
    lineId: text("line_id")
      .notNull()
      .references(() => eggMarkingLines.id),
    runId: text("run_id")
      .notNull()
      .references(() => eggMarkingRuns.id),
    requestRef: text("request_ref").notNull(),
    firstSerial: integer("first_serial").notNull(),
    lastSerial: integer("last_serial").notNull(),
    allocatedAt: text("allocated_at").notNull(),
    requestedBy: text("requested_by").notNull(),
  },
  (t) => [uniqueIndex("egg_code_blocks_line_serial_idx").on(t.lineId, t.firstSerial), uniqueIndex("egg_code_blocks_ref_idx").on(t.runId, t.requestRef)]
);

/** Eggs printed and read back, one row per camera report — a range, never a row per egg. */
export const eggReadBatches = sqliteTable(
  "egg_read_batches",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => eggMarkingRuns.id),
    batchRef: text("batch_ref").notNull(),
    firstSerial: integer("first_serial").notNull(),
    lastSerial: integer("last_serial").notNull(),
    readAt: text("read_at").notNull(),
    ok: integer("ok").notNull(),
    ko: integer("ko").notNull(),
    receivedAt: text("received_at").notNull(),
    reportedBy: text("reported_by").notNull(),
  },
  (t) => [
    uniqueIndex("egg_read_batches_ref_idx").on(t.runId, t.batchRef),
    index("egg_read_batches_serial_idx").on(t.runId, t.firstSerial),
    index("egg_read_batches_read_idx").on(t.readAt),
  ]
);

/** The eggs that are not like the others: unreadable at the camera, or removed at candling. */
export const eggReadExceptions = sqliteTable(
  "egg_read_exceptions",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => eggMarkingRuns.id),
    serial: integer("serial").notNull(),
    kind: text("kind", { enum: EGG_EXCEPTION }).notNull(),
    at: text("at").notNull(),
    recordedBy: text("recorded_by").references(() => users.id),
    hatchCycleId: text("hatch_cycle_id").references(() => hatchCycles.id),
    note: text("note"),
  },
  (t) => [uniqueIndex("egg_read_exceptions_serial_idx").on(t.runId, t.serial, t.kind), index("egg_read_exceptions_cycle_idx").on(t.hatchCycleId)]
);

/** A tray, box or alvéole: consecutive codes, its own BIOVOLAILLES identifier, and the QR the consumer scans. */
export const eggTrays = sqliteTable(
  "egg_trays",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => eggMarkingRuns.id),
    trayRef: text("tray_ref"),
    firstSerial: integer("first_serial").notNull(),
    lastSerial: integer("last_serial").notNull(),
    capacity: integer("capacity").notNull(),
    eggCount: integer("egg_count").notNull(),
    packedAt: text("packed_at").notNull(),
    /** Who declared it: "user:<id>" for a person in the application, "api:<client id>" for a line controller. */
    packedBy: text("packed_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("egg_trays_serial_idx").on(t.runId, t.firstSerial), uniqueIndex("egg_trays_ref_idx").on(t.runId, t.trayRef)]
);

/** Each time the read-back guard stopped the line, and who restarted it, after doing what. */
export const eggReadStops = sqliteTable(
  "egg_read_stops",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => eggMarkingRuns.id),
    stoppedAt: text("stopped_at").notNull(),
    rate: real("rate").notNull(),
    considered: integer("considered").notNull(),
    liftedAt: text("lifted_at"),
    liftedBy: text("lifted_by").references(() => users.id),
    liftNote: text("lift_note"),
  },
  (t) => [index("egg_read_stops_run_idx").on(t.runId)]
);
