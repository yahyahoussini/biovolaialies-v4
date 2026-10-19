import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import type { Sensor } from "../../domain/iot/types";
import { sensorSpec } from "../../domain/telemetry/catalog";
import type { SensorCalibration } from "../../domain/telemetry/types";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy } from "../identity/scope-check";

const DAY = 86_400_000;
/** "À échéance" this many days before the due date. */
export const DUE_SOON_DAYS = 14;

export const recordCalibrationSchema = z.object({
  sensorId: z.string().min(1),
  calibratedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide."),
  method: z.string().trim().min(3).max(200),
  referenceInstrument: z.string().trim().min(3, "Nommez l'instrument de référence et son certificat.").max(200),
  referenceValue: z.number().finite(),
  measuredValue: z.number().finite(),
  tolerance: z.number().positive("La tolérance doit être positive."),
  offsetApplied: z.number().finite().nullable().optional(),
  intervalDays: z.number().int().min(7).max(1095),
  evidenceRef: z.string().trim().min(3, "Une preuve (PV, photo, certificat) est requise.").max(300),
});

/**
 * Calibration register (document 3, lot 6). The result is computed, not declared: within the
 * tolerance it is CONFORME; outside but corrected by an offset, AJUSTE; otherwise NON_CONFORME,
 * and the sensor is put out of service so its readings stop feeding rules and averages until
 * a conforming calibration is recorded.
 */
export async function recordCalibration(input: unknown, session: Session): Promise<SensorCalibration> {
  if (!can(session, "EDIT", "IOT")) throw new AuthorizationError();
  const data = parseInput(recordCalibrationSchema, input);
  const sensor = (await repositories.sensors.findById(data.sensorId)) as Sensor | null;
  if (!sensor) throw new NotFoundError("Capteur", data.sensorId);
  const device = await repositories.devices.findById(sensor.deviceId);
  if (!device) throw new NotFoundError("Appareil", sensor.deviceId);
  assertInScope(session, await resolveBuildingHierarchy(device.buildingId));
  if (Date.parse(data.calibratedAt) > Date.now() + 3_600_000) throw new ValidationError("Un étalonnage ne se date pas dans le futur.");

  const error = Math.abs(data.measuredValue - data.referenceValue);
  const corrected = data.offsetApplied !== null && data.offsetApplied !== undefined ? Math.abs(data.measuredValue + data.offsetApplied - data.referenceValue) : null;
  const result = error <= data.tolerance ? "CONFORME" : corrected !== null && corrected <= data.tolerance ? "AJUSTE" : "NON_CONFORME";
  const calibratedAt = new Date(data.calibratedAt).toISOString();
  const row = await repositories.calibrations.create({
    sensorId: sensor.id,
    calibratedAt,
    method: data.method,
    referenceInstrument: data.referenceInstrument,
    referenceValue: data.referenceValue,
    measuredValue: data.measuredValue,
    offsetApplied: data.offsetApplied ?? null,
    tolerance: data.tolerance,
    result,
    nextDueAt: new Date(Date.parse(calibratedAt) + data.intervalDays * DAY).toISOString(),
    performedBy: session.userId,
    evidenceRef: data.evidenceRef,
  });
  if (result === "NON_CONFORME" && sensor.status !== "FAULT") await repositories.sensors.updateStatus(sensor.id, "FAULT");
  if (result !== "NON_CONFORME" && sensor.status === "FAULT") await repositories.sensors.updateStatus(sensor.id, "ONLINE");
  await recordAudit({
    actorId: session.userId,
    entityType: "sensor_calibration",
    entityId: row.id,
    field: "result",
    oldValue: null,
    newValue: `${result} (écart ${Math.round(error * 1000) / 1000} ; tolérance ${data.tolerance})`,
    reason: `Étalonnage ${sensor.code ?? sensor.id} — preuve ${data.evidenceRef}`,
    relatedLotId: null,
    relatedEventId: null,
  });
  return row;
}

export type CalibrationStatus = "A_JOUR" | "A_ECHEANCE" | "ECHU" | "JAMAIS" | "NON_CONFORME";

export interface CalibrationRegisterRow {
  sensorId: string;
  code: string;
  ref: string | null;
  label: string;
  buildingId: string;
  last: SensorCalibration | null;
  status: CalibrationStatus;
  /** Error found at each calibration, oldest first: a steady climb is drift. */
  errors: number[];
  drifting: boolean;
}

/** One row per measuring channel in scope, with its calibration state and the drift its history shows. */
export async function calibrationRegister(session: Session, now = new Date()): Promise<CalibrationRegisterRow[]> {
  if (!can(session, "VIEW", "IOT")) throw new AuthorizationError();
  const devices = await repositories.devices.list();
  const sensors = ((await repositories.telemetrySensors.listAll()) as Sensor[]).filter((s) => s.catalogRef && s.catalogRef !== "PLC");
  const rows: CalibrationRegisterRow[] = [];
  for (const s of sensors) {
    const device = devices.find((d) => d.id === s.deviceId);
    if (!device) continue;
    try {
      assertInScope(session, await resolveBuildingHierarchy(device.buildingId));
    } catch {
      continue;
    }
    const history = (await repositories.calibrations.listBySensor(s.id)).slice().reverse();
    const last = history[history.length - 1] ?? null;
    const errors = history.map((c) => Math.round((c.measuredValue - c.referenceValue) * 1000) / 1000);
    const status: CalibrationStatus = !last
      ? "JAMAIS"
      : last.result === "NON_CONFORME"
        ? "NON_CONFORME"
        : Date.parse(last.nextDueAt) < now.getTime()
          ? "ECHU"
          : Date.parse(last.nextDueAt) < now.getTime() + DUE_SOON_DAYS * DAY
            ? "A_ECHEANCE"
            : "A_JOUR";
    // Drift: three or more calibrations whose absolute error grows each time.
    const abs = errors.map(Math.abs);
    const drifting = abs.length >= 3 && abs.slice(-3).every((v, i, a) => i === 0 || v > a[i - 1]);
    rows.push({ sensorId: s.id, code: s.code ?? s.id, ref: s.catalogRef ?? null, label: `${sensorSpec(s.catalogRef)?.label ?? s.sensorType} · ${s.sensorType}`, buildingId: device.buildingId, last, status, errors, drifting });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}
