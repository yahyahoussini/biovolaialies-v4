import { SAMPLE_MARKER } from "./machine-log";

/**
 * An incubator log as a French machine writes it on its USB key: a few lines about the machine,
 * then one line a minute, local time, semicolons, decimal commas, "°C" in one byte. Used for the
 * downloadable example and the demonstration data — never for real data: the example carries a
 * marker line, and an import refuses to store it as real.
 * Pure: no I/O.
 */

export interface SampleLogInput {
  machine: string;
  /** Instants (ms). Lines every minute in [from, to). */
  from: number;
  to: number;
  /** From this instant the display drifts up, to +0.7 °C at `to` (a display probe going wrong). */
  driftFrom?: number;
  /** Lines (minute index from `from`) where the machine wrote "ERR" instead of a value. */
  faultMinutes?: number[];
  /** The example handed out on screen: a first line says it must be imported as simulation. */
  marker: boolean;
}

const MIN = 60_000;

function localParts(at: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Casablanca", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("day")}/${get("month")}/${get("year")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Deterministic, centred noise in [-1, 1] for minute `i` of a machine. */
function noise(seed: string, i: number): number {
  let h = 2166136261;
  for (const c of `${seed}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

const comma = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");

export function buildSampleLog(input: SampleLogInput): string {
  const start = Math.ceil(input.from / MIN) * MIN;
  const out: string[] = [];
  if (input.marker) out.push(`${SAMPLE_MARKER} : valeurs simulées, à importer comme « Simulation »`);
  out.push(`Incubateur ${input.machine} : journal exporté (clé USB)`);
  out.push(`Exporté le ${localParts(input.to).date} à ${localParts(input.to).time}`);
  out.push("Date;Heure;T air (°C);Consigne T (°C);HR (%);Retournements");
  const faults = new Set(input.faultMinutes ?? []);
  for (let t = start, i = 0; t < input.to; t += MIN, i++) {
    const { date, time } = localParts(t);
    const drift = input.driftFrom !== undefined && t >= input.driftFrom ? (0.7 * (t - input.driftFrom)) / Math.max(MIN, input.to - input.driftFrom) : 0;
    const air = faults.has(i) ? "ERR" : comma(37.6 + drift + 0.06 * noise(input.machine, i), 1);
    const humidity = Math.round(55 + 2 * noise(`${input.machine}:hr`, i));
    const turned = time.endsWith(":00") ? 1 : 0;
    out.push([date, time, air, comma(37.6, 1), humidity, turned].join(";"));
  }
  return out.join("\r\n") + "\r\n";
}

/** The text as Windows-1252 bytes, as the machine writes it. Only Latin-1 characters are expected. */
export function toWindows1252(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    bytes[i] = c < 256 ? c : 0x3f;
  }
  return bytes;
}
