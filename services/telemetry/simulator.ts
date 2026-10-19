import type { GatewayMessage } from "../../domain/telemetry/ingest";
import { sensorSpec, CONTROLLER_CHANNELS } from "../../domain/telemetry/catalog";
import type { SensorType } from "../../domain/shared/enums";

/**
 * Deterministic gateway simulator. It produces exactly what a field gateway would send — one
 * message per report period, readings at each channel's acquisition interval, site events —
 * and marks every message `simulated`, so the platform stores it as SIMULATION, never as real.
 * Scenarios inject the incidents document 2 describes, to show each rule doing its job.
 */

export interface SimChannel {
  code: string;
  ref: string;
  type: SensorType;
  position: string | null;
  zoneCode: string | null;
}

export interface SimDevice {
  code: string;
  ref: string;
}

export type Scenario =
  | { kind: "NH3_EPISODE"; zoneSuffix: string; from: number; to: number; ppm: number }
  | { kind: "WATER_DROP_PUMP"; from: number; to: number; factor: number }
  | { kind: "SCREW_STALL"; line: string; from: number; to: number }
  | { kind: "NIGHT_DOOR"; at: number; badge: string | null }
  | { kind: "INCUBATOR_MACHINE_DRIFT"; from: number; to: number; offset: number; zoneSuffix?: string }
  | { kind: "EGG_ROOM_DOOR"; from: number; to: number }
  | { kind: "HOT_SPELL"; from: number; to: number; extra: number }
  | { kind: "GSM_ALARM"; at: number };

export interface SimInput {
  gateway: string;
  channels: SimChannel[];
  devices: SimDevice[];
  from: number;
  to: number;
  /** Lot placement, for age-based curves. */
  lotStartedAt: number | null;
  population: number;
  scenarios: Scenario[];
  startSeq: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  return h;
}
/** Deterministic noise in [-a, a]. */
const noise = (key: string, t: number, a: number) => ((hash(`${key}:${t}`) % 10000) / 10000 - 0.5) * 2 * a;
/** Local hour (Morocco, UTC+1 outside Ramadan) as a fraction. */
const localHour = (t: number) => (((t + HOUR) % DAY) + DAY) % DAY / HOUR;
const isDay = (t: number) => localHour(t) >= 6 && localHour(t) < 20;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function active<K extends Scenario["kind"]>(input: SimInput, kind: K, t: number): Extract<Scenario, { kind: K }> | undefined {
  return input.scenarios.find((s) => s.kind === kind && "from" in s && t >= s.from && t < s.to) as Extract<Scenario, { kind: K }> | undefined;
}

function age(input: SimInput, t: number): number {
  return input.lotStartedAt === null ? 30 : Math.max(0, (t - input.lotStartedAt) / DAY);
}

/** Beldi growth, roughly 1.7 kg at 100 days — a smooth curve, not a reference. */
const beldiWeight = (days: number) => 0.04 + 0.0165 * days;

function outsideTemp(t: number): number {
  return 26 + 8 * Math.sin((2 * Math.PI * (localHour(t) - 9)) / 24);
}

function value(input: SimInput, ch: SimChannel, t: number): number | null {
  const a = age(input, t);
  const key = ch.code;
  const ventilation = (tt: number) => (isDay(tt) ? 55 + 10 * Math.sin((2 * Math.PI * (localHour(tt) - 8)) / 24) : 30);
  const hot = active(input, "HOT_SPELL", t);
  switch (ch.ref) {
    case "A01": {
      const target = Math.max(22, 32 - a * 0.3);
      const zoneOffset = ch.zoneCode?.endsWith("Z3") ? 0.5 : ch.zoneCode?.endsWith("Z1") ? -0.3 : 0;
      const temp = target + 1.5 * Math.sin((2 * Math.PI * (localHour(t) - 9)) / 24) + zoneOffset + noise(key, t, 0.2) + (hot?.extra ?? 0);
      return ch.type === "TEMPERATURE" ? r1(temp) : r1(Math.min(85, Math.max(35, 72 - (temp - 22) * 1.8 + noise(key, t, 2))));
    }
    case "A02":
      return Math.round(1500 + (isDay(t) ? 0 : 500) + noise(key, t, 120));
    case "A03": {
      const ep = active(input, "NH3_EPISODE", t);
      if (ep && ch.position && ch.position.includes(ep.zoneSuffix)) return r1(ep.ppm + noise(key, t, 1.5));
      return r1(Math.max(0, 8 + Math.min(6, a / 20) + noise(key, t, 1.5)));
    }
    case "A04":
      return r2(Math.max(0, 0.15 + noise(key, t, 0.1)));
    case "A05":
      return r1(ventilation(t) >= 30 ? 8 + ventilation(t) * 0.2 + noise(key, t, 1) : 2 + noise(key, t, 0.5));
    case "A06":
      return isDay(t) ? r1(22 + noise(key, t, 2)) : r1(Math.max(0, 0.4 + noise(key, t, 0.3)));
    case "PLC":
      if (ch.type === "VENTILATION") return Math.round(ventilation(t) + noise(key, t, 2));
      if (ch.type === "VOLETS") return Math.round(ventilation(t) * 0.9 + noise(key, t, 2));
      if (ch.type === "COMMANDE_VIS") return localHour(t) % 1 < 1 / 6 && isDay(t) ? 1 : 0;
      if (ch.type === "TEMPERATURE_MACHINE") return r2(37.6 + noise(key, t, 0.05));
      return null;
    case "D04": {
      const cmdOn = localHour(t) % 1 < 1 / 6 && isDay(t);
      const stall = active(input, "SCREW_STALL", t);
      if (stall && ch.position === stall.line) return 0;
      return cmdOn ? r1(42 + noise(key, t, 2)) : 0;
    }
    case "C01": {
      const perBirdDay = 0.08 + 0.0018 * a;
      const shape = isDay(t) ? 1.4 : 0.35;
      const drop = active(input, "WATER_DROP_PUMP", t);
      const litresPer2Min = ((input.population * perBirdDay) / 720) * shape * (drop ? drop.factor : 1);
      return r1(Math.max(0, litresPer2Min + noise(key, t, litresPer2Min * 0.05)));
    }
    case "C02": {
      const perBirdDay = 0.08 + 0.0018 * a;
      const shape = isDay(t) ? 1.4 : 0.35;
      const lpm = ((input.population * perBirdDay) / 1440) * shape / 4;
      return r2(Math.max(0, lpm + noise(key, t, lpm * 0.04)));
    }
    case "C03": {
      const drop = active(input, "WATER_DROP_PUMP", t);
      return r2((drop ? 1.25 : 1.9) + noise(key, t, 0.03));
    }
    case "C05":
      return r1(20 + (outsideTemp(t) - 26) * 0.35 + noise(key, t, 0.2));
    case "D01": {
      // Draw-down at the flock's intake, refilled with a 6 t delivery every 4.5 days; occasional gusts.
      const perDay = input.population * (0.03 + 0.0012 * a);
      const cycle = 4.5 * DAY;
      const sinceDelivery = ((t - input.from) % cycle + cycle) % cycle;
      const gust = hash(`${key}:${Math.floor(t / (5 * MIN))}`) % 37 === 0 ? 350 : 0;
      return Math.round(Math.max(0, 7000 - (sinceDelivery / DAY) * perDay + gust + noise(key, t, 15)));
    }
    case "C04": {
      // 10 m³ buffer tank topped up by the borehole pump once a day.
      const since = ((t - input.from) % DAY + DAY) % DAY;
      return Math.round(9800 - (since / DAY) * 2600 + noise(key, t, 20));
    }
    case "E02":
      return null;
    case "B01":
      if (ch.type === "TEMPERATURE") return r1(outsideTemp(t) + noise(key, t, 0.4));
      if (ch.type === "HUMIDITE") return r1(Math.max(15, 55 - (outsideTemp(t) - 26) * 2 + noise(key, t, 3)));
      if (ch.type === "PLUIE") return 0;
      if (ch.type === "VENT") return r1(Math.max(0, 3 + noise(key, t, 2)));
      return null;
    case "B02":
      if (ch.type === "HUMIDITE_SOL") return r1(ch.position?.includes("sortie") ? 24 + noise(key, t, 1) : 17 + noise(key, t, 1));
      return r1(24 + (outsideTemp(t) - 26) * 0.5 + noise(key, t, 0.5));
    case "H06": {
      const d = active(input, "INCUBATOR_MACHINE_DRIFT", t);
      const drift = d && (!d.zoneSuffix || ch.zoneCode?.endsWith(d.zoneSuffix)) ? d : undefined;
      const base = 37.6 - (drift ? drift.offset : 0);
      const pos = ch.position === "HAUT" ? 0.12 : ch.position === "BAS" ? -0.1 : ch.position === "REPRISE" ? -0.2 : 0;
      return r2(base + pos + noise(key, t, 0.04));
    }
    case "H06b": {
      const door = active(input, "EGG_ROOM_DOOR", t);
      if (ch.type === "HUMIDITE") return r1(78 + noise(key, t, 1.5));
      if (door && ch.position === "PORTE") return r1(20.5 + noise(key, t, 0.3));
      return r1((ch.position === "FOND" ? 15.8 : 16.6) + noise(key, t, 0.2));
    }
    case "H03":
      return r1(17 + noise(key, t, 0.4));
    default:
      return null;
  }
}

function acquisitionMs(ch: SimChannel): number | null {
  const spec = ch.ref === "PLC" ? CONTROLLER_CHANNELS : sensorSpec(ch.ref);
  return spec?.acquisitionSeconds ? spec.acquisitionSeconds * 1000 : null;
}

/** Bird passages on an automatic scale: about 25 an hour by day, few at night. */
function scalePassages(input: SimInput, ch: SimChannel, from: number, to: number): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = [];
  for (let t = Math.ceil(from / (2 * MIN)) * 2 * MIN; t < to; t += 2 * MIN) {
    const h = hash(`${ch.code}:${t}`);
    if (!isDay(t) && h % 10 !== 0) continue;
    const mean = beldiWeight(age(input, t));
    // Normal-ish spread (CV ≈ 9 %) from two uniforms.
    const z = (((h % 1000) / 1000 + ((h >>> 10) % 1000) / 1000) - 1) * 1.7;
    out.push({ at: t + (h % 60) * 1000, value: r2(Math.max(0.03, mean * (1 + 0.09 * z))) });
  }
  return out;
}

const DOOR_TIMES = [7, 12.5, 18];

/** Messages covering [from, to), one per 2-minute report period. */
export function simulateGateway(input: SimInput): GatewayMessage[] {
  const messages: GatewayMessage[] = [];
  let seq = input.startSeq;
  const period = 2 * MIN;
  const door = input.devices.find((d) => d.ref === "O01");
  const gsm = input.devices.find((d) => d.ref === "L01");
  for (let start = Math.floor(input.from / period) * period; start < input.to; start += period) {
    const end = start + period;
    const readings: GatewayMessage["readings"] = [];
    for (const ch of input.channels) {
      if (ch.ref === "E01") {
        for (const p of scalePassages(input, ch, start, end)) readings.push({ sensor: ch.code, at: new Date(p.at).toISOString(), value: p.value });
        continue;
      }
      const every = acquisitionMs(ch);
      if (!every) continue;
      for (let t = Math.ceil(start / every) * every; t < end; t += every) {
        const v = value(input, ch, t);
        if (v !== null) readings.push({ sensor: ch.code, at: new Date(t).toISOString(), value: v });
      }
    }
    const events: GatewayMessage["events"] = [];
    if (door) {
      for (const h of DOOR_TIMES) {
        const day = Math.floor((start + HOUR) / DAY) * DAY - HOUR;
        const at = day + h * HOUR;
        if (at >= start && at < end) {
          events.push({ device: door.code, kind: "ACCES_BADGE", at: new Date(at).toISOString(), badge: "B-104" });
          events.push({ device: door.code, kind: "PORTE_OUVERTE", at: new Date(at + 5000).toISOString() });
          events.push({ device: door.code, kind: "PORTE_FERMEE", at: new Date(at + 4 * MIN).toISOString() });
        }
      }
      for (const s of input.scenarios) {
        if (s.kind === "NIGHT_DOOR" && s.at >= start && s.at < end) {
          if (s.badge) events.push({ device: door.code, kind: "ACCES_BADGE", at: new Date(s.at).toISOString(), badge: s.badge });
          events.push({ device: door.code, kind: "PORTE_OUVERTE", at: new Date(s.at + 3000).toISOString() });
          events.push({ device: door.code, kind: "PORTE_FERMEE", at: new Date(s.at + 90_000).toISOString() });
        }
      }
    }
    if (gsm) {
      for (const s of input.scenarios) {
        if (s.kind === "GSM_ALARM" && s.at >= start && s.at < end) {
          events.push({ device: gsm.code, kind: "ALARME_GSM_DECLENCHEE", at: new Date(s.at).toISOString(), data: { entree: "Thermostat de sécurité" } });
          events.push({ device: gsm.code, kind: "ALARME_GSM_APPEL", at: new Date(s.at + 30_000).toISOString(), data: { numero: 1 } });
          events.push({ device: gsm.code, kind: "ALARME_GSM_ACQUITTEE", at: new Date(s.at + 9 * MIN).toISOString(), data: { mode: "physique" } });
        }
      }
    }
    readings.sort((a, b) => (a.at < b.at ? -1 : 1));
    messages.push({ gateway: input.gateway, seq: seq++, sentAt: new Date(end).toISOString(), simulated: true, readings, events });
  }
  return messages;
}

/** Manual control weighing (E02): a protocol session of `count` birds at several spots. */
export function simulateControlWeighing(code: string, at: number, lotStartedAt: number, count: number, bias = -0.03): { sensor: string; at: string; value: number }[] {
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = hash(`${code}:${at}:${i}`);
    const z = (((h % 1000) / 1000 + ((h >>> 10) % 1000) / 1000) - 1) * 1.7;
    const mean = beldiWeight((at - lotStartedAt) / DAY) + bias;
    out.push({ sensor: code, at: new Date(at + i * 20_000).toISOString(), value: r2(Math.max(0.03, mean * (1 + 0.09 * z))) });
  }
  return out;
}
