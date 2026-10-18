import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { Measurement } from "../../domain/iot/types";
import {
  checkMeasurementQuality,
  checkMeasurementUnitMatchesSensor,
} from "../../domain/quality/iot-data-quality";
import type { QualityCheckResult } from "../../domain/quality/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy } from "../identity/scope-check";

export const recordMeasurementInputSchema = z.object({
  sensorId: z.string().min(1),
  value: z.number(),
  capturedAt: z.string().trim().min(1),
  lotId: z.string().trim().min(1).optional().nullable(),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE),
  dataStatus: z.enum(DATA_STATUS),
  measurementMethod: z.string().trim().min(1).optional().nullable(),
});
export type RecordMeasurementInput = z.infer<typeof recordMeasurementInputSchema>;

/**
 * Manual/operator path for recording a measurement — most measurements in this phase
 * come from the simulator (seed) instead, but this is the real, tested, audited path a
 * future "manual reading" form or device-ingestion endpoint would call. Never bypasses
 * the data-quality layer (phase-4 brief §4).
 */
export async function recordMeasurement(
  input: unknown,
  session: Session
): Promise<{ record: Measurement; quality: QualityCheckResult }> {
  if (!can(session, "EDIT", "IOT")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer une mesure IoT.");
  }

  const parsed = recordMeasurementInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  const data = parsed.data;

  const sensor = await repositories.sensors.findById(data.sensorId);
  if (!sensor) throw new NotFoundError("Sensor", data.sensorId);
  const device = await repositories.devices.findById(sensor.deviceId);
  if (!device) throw new NotFoundError("Device", sensor.deviceId);

  assertInScope(session, await resolveBuildingHierarchy(device.buildingId));

  if (data.lotId) {
    const lot = await repositories.lots.findById(data.lotId);
    if (!lot) throw new NotFoundError("Lot", data.lotId);
    if (lot.buildingId !== device.buildingId) {
      throw new ValidationError("Le lot indiqué n'appartient pas au bâtiment de cet appareil.");
    }
  }

  const recordInput = {
    sensorId: sensor.id,
    deviceId: device.id,
    buildingId: device.buildingId,
    lotId: data.lotId ?? null,
    value: data.value,
    unit: sensor.unit,
    capturedAt: data.capturedAt,
    sourceType: data.sourceType,
    sourceId: null,
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: data.measurementMethod ?? null,
    documentId: null,
    validationStatus: null,
  };

  const unitIssue = checkMeasurementUnitMatchesSensor(recordInput.unit, sensor.unit);
  const quality = checkMeasurementQuality(recordInput, device.buildingId);
  if (unitIssue) quality.issues.push(unitIssue);
  if (unitIssue || !quality.ok) throw new ValidationError(quality.issues.map((i) => i.message).join(" "));

  const record = await repositories.measurements.create(recordInput);

  await recordAudit({
    actorId: session.userId,
    entityType: "measurement",
    entityId: record.id,
    field: null,
    oldValue: null,
    newValue: `${data.value} ${sensor.unit}`,
    reason: "Enregistrement manuel d'une mesure IoT",
    relatedLotId: data.lotId ?? null,
    relatedEventId: null,
  });

  return { record, quality };
}
