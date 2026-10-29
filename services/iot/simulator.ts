import type { Device, NewMeasurement, Sensor } from "../../domain/iot/types";
import type { SensorDataSource, SimulationContext } from "./sensor-data-source";

/** Deterministic string hash — same seed always produces the same "noise", never real randomness. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function seededNoise(seedKey: string, at: Date, amplitude: number): number {
  const seed = hashString(`${seedKey}:${at.toISOString()}`);
  return ((seed % 1000) / 1000 - 0.5) * 2 * amplitude;
}

function ageDays(at: Date, lotStartedAt: string | null): number {
  if (!lotStartedAt) return 20;
  return Math.max(0, (at.getTime() - new Date(lotStartedAt).getTime()) / 86_400_000);
}

function hourFraction(at: Date): number {
  return at.getUTCHours() + at.getUTCMinutes() / 60;
}

/** A gradual triangular ramp up then down across the window — never an instant jump (phase-4 brief §6). */
function anomalyRamp(at: Date, context: SimulationContext): number {
  const window = context.anomalyWindow;
  if (!window || at < window.start || at > window.end) return 0;
  const progress = (at.getTime() - window.start.getTime()) / (window.end.getTime() - window.start.getTime());
  const rampFactor = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
  return window.peakOffset * rampFactor;
}

function temperatureAt(at: Date, context: SimulationContext, seedKey: string): number {
  const age = ageDays(at, context.lotStartedAt);
  const baseForAge = Math.max(21, 32 - age * 0.3);
  const dayNightSwing = 2.5 * Math.sin((2 * Math.PI * (hourFraction(at) - 6)) / 24);
  const value = baseForAge + dayNightSwing + seededNoise(seedKey, at, 0.3) + anomalyRamp(at, context);
  return Math.round(value * 10) / 10;
}

function humidityAt(at: Date, context: SimulationContext, seedKey: string): number {
  const temp = temperatureAt(at, context, `${seedKey}:temp-ref`);
  const value = 68 - (temp - 25) * 1.4 + seededNoise(seedKey, at, 2);
  return Math.round(Math.min(85, Math.max(35, value)) * 10) / 10;
}

function co2At(at: Date, _context: SimulationContext, seedKey: string): number {
  const hour = hourFraction(at);
  const nightVentilationDrop = hour < 6 || hour > 20 ? 150 : 0;
  const value = 750 + nightVentilationDrop + seededNoise(seedKey, at, 60);
  return Math.round(Math.max(400, value));
}

function lightAt(at: Date, _context: SimulationContext, seedKey: string): number {
  const hour = hourFraction(at);
  const isLit = hour >= 6 && hour <= 20;
  const value = isLit ? 25 + seededNoise(seedKey, at, 3) : 0.5;
  return Math.round(Math.max(0, value) * 10) / 10;
}

/** Automated scale reading — smooth growth curve, small noise, never a random jump (phase-4 brief §5). */
function weightAt(at: Date, context: SimulationContext, seedKey: string): number {
  const age = ageDays(at, context.lotStartedAt);
  const value = 0.045 + 0.062 * age + seededNoise(seedKey, at, 0.02);
  return Math.round(Math.max(0.03, value) * 100) / 100;
}

function waterAt(at: Date, context: SimulationContext, seedKey: string): number {
  const age = ageDays(at, context.lotStartedAt);
  const hourlyBase = (0.9 + 0.27 * age) / 24; // liters/bird/day spread across the day, roughly
  const dayPeak = hourFraction(at) >= 7 && hourFraction(at) <= 19 ? 1.3 : 0.7; // birds drink more in daylight
  const value = hourlyBase * dayPeak * 1000 + seededNoise(seedKey, at, 20); // scaled per-building approximation
  return Math.round(Math.max(0, value) * 10) / 10;
}

function feedAt(at: Date, context: SimulationContext, seedKey: string): number {
  return Math.round(waterAt(at, context, seedKey) * 0.56 * 10) / 10;
}

const GENERATORS: Partial<Record<Sensor["sensorType"], (at: Date, context: SimulationContext, seedKey: string) => number>> = {
  TEMPERATURE: temperatureAt,
  HUMIDITE: humidityAt,
  CO2: co2At,
  LUMIERE: lightAt,
  POIDS: weightAt,
  EAU: waterAt,
  ALIMENT: feedAt,
};

export class DeterministicSensorSimulator implements SensorDataSource {
  generate(
    sensor: Sensor,
    device: Device,
    context: SimulationContext,
    range: { from: Date; to: Date },
    intervalMinutes: number
  ): NewMeasurement[] {
    const generator = GENERATORS[sensor.sensorType];
    if (!generator) return [];

    const measurements: NewMeasurement[] = [];
    const stepMs = intervalMinutes * 60_000;
    // Noise keyed by what a reseed gives back (the device's code), never by the sensor's random id.
    const seedKey = `${device.code}:${sensor.code ?? sensor.sensorType}`;
    for (let t = range.from.getTime(); t <= range.to.getTime(); t += stepMs) {
      const at = new Date(t);
      measurements.push({
        sensorId: sensor.id,
        deviceId: device.id,
        buildingId: device.buildingId,
        lotId: context.lotId,
        value: generator(at, context, seedKey),
        unit: sensor.unit,
        capturedAt: at.toISOString(),
        sourceType: "SIMULATEUR",
        sourceId: null,
        actorId: null,
        dataStatus: "SIMULATION",
        measurementMethod: null,
        documentId: null,
        validationStatus: null,
      });
    }
    return measurements;
  }
}
