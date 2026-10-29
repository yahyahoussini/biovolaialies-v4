import type {
  AggregateGranularity,
  BandSource,
  BandStatus,
  CalibrationResult,
  DataStatus,
  ReadingAttribution,
  ReadingFlag,
  RuleState,
  Season,
  SensorType,
  SiteEventKind,
  ZoneKind,
} from "../shared/enums";

export interface Zone {
  id: string;
  farmId: string;
  buildingId: string | null;
  code: string;
  name: string;
  kind: ZoneKind;
}

export interface ZoneOccupation {
  id: string;
  zoneId: string;
  lotId: string;
  startedAt: string;
  endedAt: string | null;
  headCount: number | null;
  note: string | null;
  recordedBy: string | null;
}

export interface IngestMessage {
  id: string;
  gatewayId: string;
  seq: number;
  sentAt: string;
  receivedAt: string;
  clockOffsetSeconds: number | null;
  readingCount: number;
  eventCount: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  flagged: number;
  payloadHash: string;
  apiClientId: string | null;
}

export interface SiteEvent {
  id: string;
  deviceId: string;
  buildingId: string;
  zoneId: string | null;
  lotId: string | null;
  kind: SiteEventKind;
  occurredAt: string;
  badge: string | null;
  mediaRef: string | null;
  payload: Record<string, unknown> | null;
  ingestMessageId: string | null;
}

export interface MeasurementAggregate {
  id: string;
  sensorId: string;
  granularity: AggregateGranularity;
  bucketStart: string;
  buildingId: string;
  zoneId: string | null;
  lotId: string | null;
  count: number;
  expected: number | null;
  suspectCount: number;
  sum: number;
  sumSq: number;
  min: number | null;
  max: number | null;
}

export interface ReferenceBand {
  id: string;
  sensorType: SensorType;
  productionLine: string;
  ageDayFrom: number;
  ageDayTo: number;
  season: Season;
  low: number;
  high: number;
  unit: string;
  source: BandSource;
  status: BandStatus;
  version: number;
  lotsUsed: number | null;
  samples: number | null;
  learnedFrom: string[] | null;
  supersedesId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface RuleStateRow {
  id: string;
  ruleCode: string;
  subjectKey: string;
  buildingId: string;
  state: RuleState;
  since: string;
  openAlertId: string | null;
  memory: Record<string, number | string | null> | null;
}

export interface RuleTransition {
  id: string;
  ruleCode: string;
  subjectKey: string;
  buildingId: string;
  lotId: string | null;
  fromState: RuleState;
  toState: RuleState;
  at: string;
  value: number | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  bandId: string | null;
  diagnosis: string;
  context: Record<string, unknown> | null;
  alertId: string | null;
}

export interface SensorCalibration {
  id: string;
  sensorId: string;
  calibratedAt: string;
  method: string;
  referenceInstrument: string;
  referenceValue: number;
  measuredValue: number;
  offsetApplied: number | null;
  tolerance: number;
  result: CalibrationResult;
  nextDueAt: string;
  performedBy: string;
  evidenceRef: string;
}

/** A reading as the rules see it: always an OK one, already tied (or not) to a lot. */
export interface TelemetryReading {
  sensorId: string;
  capturedAt: string;
  value: number;
  flag: ReadingFlag;
  lotId: string | null;
  attribution: ReadingAttribution;
}

/** One incubator log imported from a file: what it held, what was stored, and the file's fingerprint. */
export interface MachineImport {
  id: string;
  buildingId: string;
  zoneId: string;
  fileName: string;
  /** SHA-256 of the exact bytes received. */
  sha256: string;
  bytes: number;
  encoding: string;
  profile: Record<string, unknown>;
  dataStatus: DataStatus;
  /** Data lines in the file, read or not. */
  lines: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  flagged: number;
  /** Lines that could not be read, with their number (capped). */
  errors: { line: number; message: string }[];
  fromAt: string | null;
  toAt: string | null;
  importedBy: string;
  importedAt: string;
}
