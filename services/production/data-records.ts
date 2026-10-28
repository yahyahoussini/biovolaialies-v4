import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import {
  recordFeedUsageWithEvent,
  recordMortalityWithPopulationUpdate,
  recordWeightMeasurementWithEvent,
} from "../../data/repositories/transactions";
import { applyMortality } from "../../domain/production/population";
import {
  checkEnvironmentMeasurementQuality,
  checkFeedUsageQuality,
  checkMortalityRecordQuality,
  checkWaterUsageQuality,
  checkWeightMeasurementQuality,
} from "../../domain/quality/production-data-quality";
import type { QualityCheckResult } from "../../domain/quality/types";
import type {
  EnvironmentMeasurementRecord,
  FeedUsageRecord,
  MortalityRecord,
  WaterUsageRecord,
  WeightMeasurementRecord,
} from "../../domain/production/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE, SENSOR_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy, resolveLotHierarchy } from "../identity/scope-check";
import { getLotOrThrow } from "./lot";

const provenanceInputShape = {
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  sourceId: z.string().trim().min(1).optional().nullable(),
  dataStatus: z.enum(DATA_STATUS),
  measurementMethod: z.string().trim().min(1).max(200).optional().nullable(),
  deviceId: z.string().trim().min(1).optional().nullable(),
  documentId: z.string().trim().min(1).optional().nullable(),
};

function formatIssues(result: QualityCheckResult): string {
  return result.issues.map((issue) => issue.message).join(" ");
}

function normalizeOptional<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export const createFeedUsageInputSchema = z.object({
  occurredAt: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1),
  feedType: z.string().trim().min(1),
  feedSource: z.string().trim().min(1).optional().nullable(),
  ...provenanceInputShape,
});
export type CreateFeedUsageInput = z.infer<typeof createFeedUsageInputSchema>;

export async function createFeedUsageRecord(
  lotId: string,
  input: unknown,
  session: Session
): Promise<{ record: FeedUsageRecord; quality: QualityCheckResult }> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour saisir des données d'alimentation.");

  await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));

  const parsed = createFeedUsageInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const recordInput = {
    lotId,
    occurredAt: data.occurredAt,
    quantity: data.quantity,
    unit: data.unit,
    feedType: data.feedType,
    feedSource: normalizeOptional(data.feedSource),
    sourceType: data.sourceType,
    sourceId: normalizeOptional(data.sourceId),
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: normalizeOptional(data.measurementMethod),
    deviceId: normalizeOptional(data.deviceId),
    documentId: normalizeOptional(data.documentId),
    validationStatus: null,
  };

  const quality = checkFeedUsageQuality(recordInput);
  if (!quality.ok) throw new ValidationError(formatIssues(quality));

  const { record } = await recordFeedUsageWithEvent(recordInput, {
    lotId,
    eventType: "ALIMENTATION",
    payload: { quantityKg: data.quantity, feedType: data.feedType },
    occurredAt: data.occurredAt,
    actorId: session.userId,
    dataStatus: data.dataStatus,
    sourceType: data.sourceType,
    deviceId: normalizeOptional(data.deviceId),
    measurementMethod: normalizeOptional(data.measurementMethod),
    validationStatus: null,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "feed_usage_record",
    entityId: record.id,
    field: null,
    oldValue: null,
    newValue: `${data.quantity} ${data.unit}`,
    reason: "Saisie de consommation d'aliment",
    relatedLotId: lotId,
    relatedEventId: null,
  });

  return { record, quality };
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

export const createWaterUsageInputSchema = z.object({
  buildingId: z.string().min(1),
  lotId: z.string().trim().min(1).optional().nullable(),
  occurredAt: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim().min(1),
  source: z.string().trim().min(1).optional().nullable(),
  ...provenanceInputShape,
});
export type CreateWaterUsageInput = z.infer<typeof createWaterUsageInputSchema>;

export async function createWaterUsageRecord(
  input: unknown,
  session: Session
): Promise<{ record: WaterUsageRecord; quality: QualityCheckResult }> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour saisir des données d'eau.");

  const parsed = createWaterUsageInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  assertInScope(session, await resolveBuildingHierarchy(data.buildingId));
  if (data.lotId) {
    const lot = await getLotOrThrow(data.lotId);
    if (lot.buildingId !== data.buildingId) {
      throw new ValidationError("Le lot indiqué n'appartient pas à ce bâtiment.");
    }
  }

  const recordInput = {
    buildingId: data.buildingId,
    lotId: normalizeOptional(data.lotId),
    occurredAt: data.occurredAt,
    quantity: data.quantity,
    unit: data.unit,
    source: normalizeOptional(data.source),
    sourceType: data.sourceType,
    sourceId: normalizeOptional(data.sourceId),
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: normalizeOptional(data.measurementMethod),
    deviceId: normalizeOptional(data.deviceId),
    documentId: normalizeOptional(data.documentId),
    validationStatus: null,
  };

  const quality = checkWaterUsageQuality(recordInput, data.buildingId);
  if (!quality.ok) throw new ValidationError(formatIssues(quality));

  const record = await repositories.waterUsage.create(recordInput);

  await recordAudit({
    actorId: session.userId,
    entityType: "water_usage_record",
    entityId: record.id,
    field: null,
    oldValue: null,
    newValue: `${data.quantity} ${data.unit}`,
    reason: "Saisie de consommation d'eau",
    relatedLotId: data.lotId ?? null,
    relatedEventId: null,
  });

  return { record, quality };
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export const createWeightMeasurementInputSchema = z.object({
  occurredAt: z.string().trim().min(1),
  averageWeight: z.number().positive(),
  unit: z.string().trim().min(1),
  sampleCount: z.number().int().positive().optional().nullable(),
  ...provenanceInputShape,
});
export type CreateWeightMeasurementInput = z.infer<typeof createWeightMeasurementInputSchema>;

export async function createWeightMeasurementRecord(
  lotId: string,
  input: unknown,
  session: Session
): Promise<{ record: WeightMeasurementRecord; quality: QualityCheckResult }> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour saisir des pesées.");

  await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));

  const parsed = createWeightMeasurementInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const recordInput = {
    lotId,
    occurredAt: data.occurredAt,
    averageWeight: data.averageWeight,
    unit: data.unit,
    sampleCount: normalizeOptional(data.sampleCount),
    sourceType: data.sourceType,
    sourceId: normalizeOptional(data.sourceId),
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: normalizeOptional(data.measurementMethod),
    deviceId: normalizeOptional(data.deviceId),
    documentId: normalizeOptional(data.documentId),
    validationStatus: null,
  };

  const quality = checkWeightMeasurementQuality(recordInput);
  if (!quality.ok) throw new ValidationError(formatIssues(quality));

  const { record } = await recordWeightMeasurementWithEvent(recordInput, {
    lotId,
    eventType: "PESEE",
    payload: { averageWeightKg: data.averageWeight, sampleSize: data.sampleCount ?? undefined },
    occurredAt: data.occurredAt,
    actorId: session.userId,
    dataStatus: data.dataStatus,
    sourceType: data.sourceType,
    deviceId: normalizeOptional(data.deviceId),
    measurementMethod: normalizeOptional(data.measurementMethod),
    validationStatus: null,
  });

  await recordAudit({
    actorId: session.userId,
    entityType: "weight_measurement_record",
    entityId: record.id,
    field: null,
    oldValue: null,
    newValue: `${data.averageWeight} ${data.unit}`,
    reason: "Saisie de pesée",
    relatedLotId: lotId,
    relatedEventId: null,
  });

  return { record, quality };
}

// ---------------------------------------------------------------------------
// Mortality
// ---------------------------------------------------------------------------

export const createMortalityRecordInputSchema = z.object({
  occurredAt: z.string().trim().min(1),
  count: z.number().int().positive(),
  suspectedCause: z.string().trim().min(1).max(200).optional().nullable(),
  ...provenanceInputShape,
});
export type CreateMortalityRecordInput = z.infer<typeof createMortalityRecordInputSchema>;

export async function createMortalityRecord(
  lotId: string,
  input: unknown,
  session: Session
): Promise<{ record: MortalityRecord; quality: QualityCheckResult }> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour saisir la mortalité.");

  const lot = await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));

  const parsed = createMortalityRecordInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const recordInput = {
    lotId,
    occurredAt: data.occurredAt,
    count: data.count,
    suspectedCause: normalizeOptional(data.suspectedCause),
    causeValidated: false,
    sourceType: data.sourceType,
    sourceId: normalizeOptional(data.sourceId),
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: normalizeOptional(data.measurementMethod),
    deviceId: normalizeOptional(data.deviceId),
    documentId: normalizeOptional(data.documentId),
    validationStatus: null,
  };

  const quality = checkMortalityRecordQuality(recordInput);
  if (!quality.ok) throw new ValidationError(formatIssues(quality));

  const populationResult = applyMortality(lot.currentPopulation, data.count);
  if (!populationResult.ok) throw new ValidationError(populationResult.error);

  const { record } = await recordMortalityWithPopulationUpdate(
    recordInput,
    {
      lotId,
      eventType: "MORTALITE",
      payload: { quantity: data.count, cause: data.suspectedCause ?? undefined },
      occurredAt: data.occurredAt,
      actorId: session.userId,
      dataStatus: data.dataStatus,
      sourceType: data.sourceType,
      deviceId: normalizeOptional(data.deviceId),
      measurementMethod: normalizeOptional(data.measurementMethod),
      validationStatus: null,
    },
    populationResult.value
  );

  await recordAudit({
    actorId: session.userId,
    entityType: "lot",
    entityId: lotId,
    field: "currentPopulation",
    oldValue: String(lot.currentPopulation),
    newValue: String(populationResult.value),
    reason: `Mortalité enregistrée (${data.count} sujets, enregistrement ${record.id})`,
    relatedLotId: lotId,
    relatedEventId: null,
  });

  return { record, quality };
}

/**
 * A counter-entry for mortality recorded in excess — a manager's arbitration of a disputed field
 * day. A mortality record with a negative count keeps every sum right, and the birds return to the
 * lot's population. Nothing already recorded is edited: the correction is a new, signed record.
 */
export async function recordMortalityCorrection(
  lotId: string,
  count: number,
  reason: string,
  session: Session,
  sourceId: string | null = null,
  occurredAt: string = new Date().toISOString()
): Promise<MortalityRecord> {
  if (!can(session, "VALIDATE", "EVENTS")) throw new AuthorizationError("Seul un responsable corrige une mortalité enregistrée.");
  const lot = await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));
  if (!Number.isInteger(count) || count <= 0) throw new ValidationError("Une correction porte sur un nombre entier positif de sujets.");
  const recorded = (await repositories.mortalityRecords.listByLot(lotId)).reduce((sum, r) => sum + r.count, 0);
  if (count > recorded) throw new ValidationError(`La correction (${count}) dépasse la mortalité enregistrée sur ce lot (${recorded}).`);
  const method = "Correction de mortalité (contre-passation)";
  const newPopulation = lot.currentPopulation + count;
  const { record } = await recordMortalityWithPopulationUpdate(
    {
      lotId,
      occurredAt,
      count: -count,
      suspectedCause: reason.slice(0, 200),
      causeValidated: true,
      sourceType: "MANUEL",
      sourceId,
      actorId: session.userId,
      dataStatus: lot.dataStatus,
      measurementMethod: method,
      deviceId: null,
      documentId: null,
      validationStatus: "VALIDE",
    },
    {
      lotId,
      eventType: "MORTALITE",
      payload: { quantity: -count, cause: "Correction de mortalité" },
      occurredAt,
      actorId: session.userId,
      dataStatus: lot.dataStatus,
      sourceType: "MANUEL",
      deviceId: null,
      measurementMethod: method,
      validationStatus: "VALIDE",
    },
    newPopulation
  );
  await recordAudit({
    actorId: session.userId,
    entityType: "lot",
    entityId: lotId,
    field: "currentPopulation",
    oldValue: String(lot.currentPopulation),
    newValue: String(newPopulation),
    reason: `Correction de mortalité (+${count} sujets) : ${reason}`,
    relatedLotId: lotId,
    relatedEventId: null,
  });
  return record;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const createEnvironmentMeasurementInputSchema = z.object({
  buildingId: z.string().min(1),
  lotId: z.string().trim().min(1).optional().nullable(),
  measurementType: z.enum(SENSOR_TYPE),
  value: z.number(),
  unit: z.string().trim().min(1),
  occurredAt: z.string().trim().min(1),
  ...provenanceInputShape,
});
export type CreateEnvironmentMeasurementInput = z.infer<typeof createEnvironmentMeasurementInputSchema>;

export async function createEnvironmentMeasurementRecord(
  input: unknown,
  session: Session
): Promise<{ record: EnvironmentMeasurementRecord; quality: QualityCheckResult }> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour saisir une mesure environnementale.");

  const parsed = createEnvironmentMeasurementInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  assertInScope(session, await resolveBuildingHierarchy(data.buildingId));
  if (data.lotId) {
    const lot = await getLotOrThrow(data.lotId);
    if (lot.buildingId !== data.buildingId) {
      throw new ValidationError("Le lot indiqué n'appartient pas à ce bâtiment.");
    }
  }

  const recordInput = {
    buildingId: data.buildingId,
    lotId: normalizeOptional(data.lotId),
    measurementType: data.measurementType,
    value: data.value,
    unit: data.unit,
    occurredAt: data.occurredAt,
    sourceType: data.sourceType,
    sourceId: normalizeOptional(data.sourceId),
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: normalizeOptional(data.measurementMethod),
    deviceId: normalizeOptional(data.deviceId),
    documentId: normalizeOptional(data.documentId),
    validationStatus: null,
  };

  const quality = checkEnvironmentMeasurementQuality(recordInput, data.buildingId);
  if (!quality.ok) throw new ValidationError(formatIssues(quality));

  const record = await repositories.environmentMeasurements.create(recordInput);

  await recordAudit({
    actorId: session.userId,
    entityType: "environment_measurement_record",
    entityId: record.id,
    field: null,
    oldValue: null,
    newValue: `${data.value} ${data.unit}`,
    reason: "Saisie de mesure environnementale",
    relatedLotId: data.lotId ?? null,
    relatedEventId: null,
  });

  return { record, quality };
}
