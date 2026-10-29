/**
 * What the incubator displayed against what the independent H06 probes measured, hour by hour, over
 * a period that is already past (document 2: "l'écart entre la sonde indépendante et la machine
 * est l'indicateur le plus utile du couvoir"). The live rule COUVOIR_POSITIONS judges the present;
 * a machine log imported from a file arrives after the fact, when the rules have moved on, so the
 * same comparison is made here on the hourly buckets — with the rule's own tolerance and its own
 * reading of "the trolley": every position except the return air.
 * Pure: no I/O.
 */

export interface HourlyValue {
  /** Start of the hour (ISO). */
  at: string;
  mean: number;
}

export interface ProbeHourlyValue extends HourlyValue {
  position: string | null;
}

export interface ComparisonHour {
  at: string;
  machine: number;
  /** Mean of the trolley probes that reported that hour. */
  probes: number;
  probeCount: number;
  /** Machine minus probes: positive when the machine shows warmer than the eggs are. */
  gap: number;
  beyond: boolean;
}

export interface MachineComparison {
  tolerance: number;
  hours: ComparisonHour[];
  /** Hours with a machine value but no probe value: nothing to compare with. */
  machineOnly: number;
  beyond: number;
  /** The gap of largest size, with its sign. */
  maxGap: number | null;
  meanGap: number | null;
  firstBeyondAt: string | null;
}

// `|| 0` turns -0 into 0: a gap of -0.004 is shown as 0,00, not -0,00.
const round2 = (v: number) => Math.round(v * 100) / 100 || 0;

export const isTrolleyPosition = (position: string | null) => (position ?? "").toUpperCase() !== "REPRISE";

export function compareMachineWithProbes(machine: HourlyValue[], probes: ProbeHourlyValue[], tolerance: number): MachineComparison {
  const byHour = new Map<string, number[]>();
  for (const p of probes) if (isTrolleyPosition(p.position)) byHour.set(p.at, [...(byHour.get(p.at) ?? []), p.mean]);
  const hours: ComparisonHour[] = [];
  let machineOnly = 0;
  for (const m of [...machine].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    const values = byHour.get(m.at);
    if (!values?.length) {
      machineOnly++;
      continue;
    }
    const probesMean = values.reduce((a, b) => a + b, 0) / values.length;
    const gap = m.mean - probesMean;
    // Rounded before judging, as displayed: an hour shown at 0.50 °C is not reported beyond a 0.5 °C tolerance.
    hours.push({ at: m.at, machine: round2(m.mean), probes: round2(probesMean), probeCount: values.length, gap: round2(gap), beyond: Math.abs(round2(gap)) > tolerance });
  }
  const gaps = hours.map((h) => h.gap);
  const maxGap = gaps.length ? gaps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null;
  return {
    tolerance,
    hours,
    machineOnly,
    beyond: hours.filter((h) => h.beyond).length,
    maxGap,
    meanGap: gaps.length ? round2(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    firstBeyondAt: hours.find((h) => h.beyond)?.at ?? null,
  };
}
