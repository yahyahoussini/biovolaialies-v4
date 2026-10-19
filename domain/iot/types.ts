import type { DeviceStatus, DeviceType, ReadingAttribution, ReadingFlag, SensorType } from "../shared/enums";
import type { ProvenanceFields } from "../shared/provenance";

export interface Device {
  id: string;
  buildingId: string;
  code: string;
  type: DeviceType;
  status: DeviceStatus;
  installedAt: string;
  lastCommunicationAt: string | null;
  /** 0-100, null when the device is mains-powered (no battery to report). */
  batteryLevel: number | null;
  /** 0-100, null when not applicable to this device's connectivity. */
  signalQuality: number | null;
  /** Telemetry fields (client documents 2 and 3); absent on devices recorded before them. */
  catalogRef?: string | null;
  gatewayId?: string | null;
  clockOffsetSeconds?: number | null;
  lastClockSyncAt?: string | null;
}

export interface Sensor {
  id: string;
  deviceId: string;
  sensorType: SensorType;
  unit: string;
  /** A sensor can individually fault even while its parent device is ONLINE — reuses DeviceStatus rather than a new enum. */
  status: DeviceStatus;
  configuration: Record<string, unknown> | null;
  /** Identifier the gateway sends for this channel. */
  code?: string | null;
  catalogRef?: string | null;
  zoneId?: string | null;
  position?: string | null;
  mountingHeightM?: number | null;
}

/**
 * `deviceId` is narrowed to required here (a measurement always has a real device behind
 * it, unlike the loose/optional pointer other Phase-3 provenance-bearing records use).
 */
export interface Measurement extends Omit<ProvenanceFields, "deviceId"> {
  id: string;
  sensorId: string;
  deviceId: string;
  buildingId: string;
  lotId: string | null;
  value: number;
  unit: string;
  capturedAt: string;
  zoneId?: string | null;
  qualityFlag?: ReadingFlag | null;
  attribution?: ReadingAttribution | null;
  ingestMessageId?: string | null;
  receivedAt?: string | null;
}

export type NewDevice = Omit<Device, "id">;
export type NewSensor = Omit<Sensor, "id">;
export type NewMeasurement = Omit<Measurement, "id">;
