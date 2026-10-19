import type { SensorType } from "../../../domain/shared/enums";
import { repositories } from "../../repositories";
import { logDeviceEvent } from "../../../services/iot/device-events";
import { DeterministicSensorSimulator } from "../../../services/iot/simulator";
import { HERO_ANOMALY_WINDOW } from "../../../services/iot/hero-scenario";
import type { SeededHierarchy } from "./hierarchy";

const simulator = new DeterministicSensorSimulator();
const NOW = new Date("2026-08-16T12:00:00.000Z");

const SENSOR_UNIT: Partial<Record<SensorType, string>> = {
  TEMPERATURE: "C",
  HUMIDITE: "%",
  CO2: "PPM",
  LUMIERE: "LUX",
  EAU: "L",
  ALIMENT: "KG",
  POIDS: "KG",
};

interface BuildingIotSeed {
  farmName: string;
  buildingCode: string;
  deviceCode: string;
  sensorTypes: SensorType[];
  historyDays: number;
  intervalMinutes: number;
  /** Only the hero building gets the controlled anomaly window. */
  applyHeroAnomaly?: boolean;
  /** Simulates a device that has gone quiet and a sensor that has faulted — the offline/fault demo case. */
  degraded?: boolean;
}

const BUILDING_SEEDS: BuildingIotSeed[] = [
  {
    farmName: "Ferme Al Baraka",
    buildingCode: "BAT-01",
    deviceCode: "DEV-B01-001",
    sensorTypes: ["TEMPERATURE", "HUMIDITE", "CO2", "LUMIERE", "POIDS"],
    historyDays: 26,
    intervalMinutes: 360,
    applyHeroAnomaly: true,
  },
  {
    farmName: "Ferme Ouazzani",
    buildingCode: "BAT-01",
    deviceCode: "DEV-B02-001",
    sensorTypes: ["TEMPERATURE", "HUMIDITE"],
    historyDays: 5,
    intervalMinutes: 360,
  },
  {
    farmName: "Ferme Amrani",
    buildingCode: "BAT-01",
    deviceCode: "DEV-B03-001",
    sensorTypes: ["TEMPERATURE", "CO2"],
    historyDays: 5,
    intervalMinutes: 360,
    degraded: true,
  },
];

export async function seedIot(hierarchy: SeededHierarchy): Promise<void> {
  for (const seed of BUILDING_SEEDS) {
    const farm = hierarchy.farmsByKey.get(seed.farmName);
    const buildingId = farm?.buildingIds.get(seed.buildingCode);
    if (!farm || !buildingId) {
      throw new Error(`IoT seed error: unknown farm/building "${seed.farmName}" / "${seed.buildingCode}"`);
    }

    const lots = await repositories.lots.listByBuilding(buildingId);
    const activeLot = lots.find((lot) => lot.status === "ACTIF") ?? null;

    const rangeEnd = NOW;
    const rangeStart = new Date(rangeEnd.getTime() - seed.historyDays * 86_400_000);
    const installedAt = new Date(Math.min(rangeStart.getTime(), activeLot ? new Date(activeLot.startedAt ?? rangeStart).getTime() : rangeStart.getTime()));

    const device = await repositories.devices.create({
      buildingId,
      code: seed.deviceCode,
      type: "CAPTEUR_MULTI",
      status: seed.degraded ? "OFFLINE" : "ONLINE",
      installedAt: installedAt.toISOString(),
      lastCommunicationAt: seed.degraded
        ? new Date(rangeEnd.getTime() - 5 * 3_600_000).toISOString() // quiet for 5 hours — stale
        : rangeEnd.toISOString(),
      batteryLevel: seed.degraded ? 12 : 78,
      signalQuality: seed.degraded ? 20 : 88,
    });

    for (const [index, sensorType] of seed.sensorTypes.entries()) {
      const isFaultDemo = seed.degraded && index === 0;
      const sensor = await repositories.sensors.create({
        deviceId: device.id,
        sensorType,
        unit: SENSOR_UNIT[sensorType] ?? "",
        status: isFaultDemo ? "FAULT" : seed.degraded ? "OFFLINE" : "ONLINE",
        configuration: { intervalMinutes: seed.intervalMinutes },
      });

      const readings = simulator.generate(
        sensor,
        device,
        {
          lotId: activeLot?.id ?? null,
          lotStartedAt: activeLot?.startedAt ?? null,
          anomalyWindow: seed.applyHeroAnomaly && sensorType === "TEMPERATURE" ? HERO_ANOMALY_WINDOW : undefined,
        },
        { from: rangeStart, to: rangeEnd },
        seed.intervalMinutes
      );

      if (readings.length > 0) {
        await repositories.measurements.createMany(readings);
      }
    }

    if (seed.degraded && activeLot) {
      await logDeviceEvent({
        buildingId,
        deviceId: device.id,
        eventType: "SENSOR_FAULT",
        description: `Capteur ${seed.sensorTypes[0]} en défaut sur l'appareil ${device.code}.`,
        occurredAt: new Date(rangeEnd.getTime() - 6 * 3_600_000).toISOString(),
      });
      await logDeviceEvent({
        buildingId,
        deviceId: device.id,
        eventType: "DEVICE_OFFLINE",
        description: `Appareil ${device.code} hors ligne depuis 5 heures.`,
        occurredAt: new Date(rangeEnd.getTime() - 5 * 3_600_000).toISOString(),
      });
    }
  }
}
