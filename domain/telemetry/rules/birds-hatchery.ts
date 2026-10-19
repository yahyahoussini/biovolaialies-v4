import { ageDay, seasonOf, selectBand } from "../bands";
import { meanOf, recentMean, round1, round2, windowPoints, windowValues, type ChannelSeries, fr } from "./series";
import { num } from "./settings";
import type { RuleEvaluator, Verdict } from "./types";

const HOUR = 3_600_000;

export interface WeighingStats {
  n: number;
  mean: number;
  cvPct: number;
  /** Share of birds within ±10 % of the mean — the usual flock uniformity figure. */
  homogeneityPct: number;
  /** Centre of the most populated 50 g class. */
  mode: number;
}

export function weighingStats(weights: number[]): WeighingStats | null {
  if (weights.length === 0) return null;
  const n = weights.length;
  const mean = weights.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(weights.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const within = weights.filter((w) => Math.abs(w - mean) <= 0.1 * mean).length;
  const bins = new Map<number, number>();
  for (const w of weights) {
    const bin = Math.floor(w / 0.05);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  let modeBin = 0;
  let best = -1;
  for (const [bin, count] of bins) {
    if (count > best || (count === best && bin < modeBin)) {
      best = count;
      modeBin = bin;
    }
  }
  return { n, mean, cvPct: mean > 0 ? (sd / mean) * 100 : 0, homogeneityPct: (within / n) * 100, mode: modeBin * 0.05 + 0.025 };
}

/**
 * E01, corrected by E02: weight distribution of the flock over the last hours. "Le mode et la
 * dispersion valent plus que la moyenne" — so uniformity is judged on its own, and the mean is
 * compared to the band only after removing the bias the mobile control scale revealed.
 */
export const weighingUniformity: RuleEvaluator = {
  code: "PESEE_HOMOGENEITE",
  label: "Pesée automatique et homogénéité",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("PESEE_HOMOGENEITE");
    const autos = ctx.series.filter((s) => s.catalogRef === "E01" && s.sensorType === "POIDS");
    if (autos.length === 0) return [];
    const from = ctx.at - num(p, "windowHours") * HOUR;
    const weights = autos.flatMap((s) => windowValues(s, from, ctx.at));
    if (weights.length < num(p, "minPassages")) return [];
    const stats = weighingStats(weights)!;
    const occupant = ctx.occupantOf(autos[0].zoneId, ctx.at);

    // Bias of the automatic scale, from the latest mobile control weighing of the last 7 days.
    const manual = ctx.series.filter((s) => s.catalogRef === "E02" && s.sensorType === "POIDS");
    const manualPts = manual.flatMap((s) => windowPoints(s, ctx.at - 7 * 24 * HOUR, ctx.at));
    let bias: number | null = null;
    if (manualPts.length >= 10) {
      const last = Math.max(...manualPts.map((x) => x.t));
      const session = manualPts.filter((x) => last - x.t <= 3 * HOUR).map((x) => x.v);
      const sameDayAuto = autos.flatMap((s) => windowValues(s, last - 12 * HOUR, last + 12 * HOUR));
      const m = meanOf(session);
      const a = meanOf(sameDayAuto);
      if (m !== null && a !== null && sameDayAuto.length >= 20) bias = a - m;
    }
    const corrected = bias === null ? stats.mean : stats.mean - bias;

    const reasons: string[] = [];
    let low: number | null = null;
    let high: number | null = null;
    let bandId: string | null = null;
    if (occupant) {
      const band = selectBand(ctx.bands, "POIDS", occupant.productionLine, ageDay(occupant.startedAt, ctx.at), seasonOf(ctx.at));
      if (band) {
        low = band.low;
        high = band.high;
        bandId = band.id;
        if (corrected < band.low || corrected > band.high) {
          reasons.push(`poids moyen ${fr(round2(corrected))} kg hors de la bande ${fr(band.low)}–${fr(band.high)} kg à J${ageDay(occupant.startedAt, ctx.at)}`);
        }
      }
    }
    if (stats.homogeneityPct < num(p, "minHomogeneityPct")) {
      reasons.push(`homogénéité ${Math.round(stats.homogeneityPct)} % (minimum ${fr(num(p, "minHomogeneityPct"))} %)`);
    }
    const summary = `${stats.n} passages : moyenne ${fr(round2(stats.mean))} kg${bias !== null ? ` (corrigée ${round2(corrected)} kg, biais balance ${bias >= 0 ? "+" : ""}${round2(bias)} kg)` : ""}, mode ${fr(round2(stats.mode))} kg, CV ${fr(round1(stats.cvPct))} %, homogénéité ${Math.round(stats.homogeneityPct)} %.`;
    return [
      {
        subjectKey: `building:${ctx.buildingId}`,
        subjectLabel: `Pesée — ${ctx.buildingName}`,
        state: reasons.length ? "ALERTE" : "NORMAL",
        value: round2(corrected),
        unit: "KG",
        low,
        high,
        bandId,
        lotId: occupant?.lotId ?? null,
        diagnosis: reasons.length ? `${reasons.join(" ; ")}. ${summary}` : summary,
        context: { ...stats, mean: round2(stats.mean), mode: round2(stats.mode), cvPct: round1(stats.cvPct), homogeneityPct: Math.round(stats.homogeneityPct), scaleBiasKg: bias === null ? null : round2(bias) },
      },
    ];
  },
};

function byZone(series: ChannelSeries[]): Map<string, ChannelSeries[]> {
  const out = new Map<string, ChannelSeries[]>();
  for (const s of series) {
    if (!s.zoneId) continue;
    out.set(s.zoneId, [...(out.get(s.zoneId) ?? []), s]);
  }
  return out;
}

/**
 * H06: independent probes at the top, middle and bottom of the trolley and in the return air.
 * The gap with what the machine displays is "l'indicateur le plus utile du couvoir": a machine
 * regulating on a drifting probe shows that all is well.
 */
export const incubatorPositions: RuleEvaluator = {
  code: "COUVOIR_POSITIONS",
  label: "Sondes indépendantes d'incubateur",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("COUVOIR_POSITIONS");
    const out: Verdict[] = [];
    for (const [zoneId, probes] of byZone(ctx.series.filter((s) => s.catalogRef === "H06" && s.sensorType === "TEMPERATURE"))) {
      const values = probes.map((s) => ({ s, v: recentMean(s, ctx.at, 10) })).filter((x): x is { s: ChannelSeries; v: number } => x.v !== null);
      if (values.length === 0) continue;
      const trolley = values.filter((x) => (x.s.position ?? "").toUpperCase() !== "REPRISE");
      const spread = trolley.length >= 2 ? Math.max(...trolley.map((x) => x.v)) - Math.min(...trolley.map((x) => x.v)) : 0;
      const outOfRange = values.filter((x) => x.v < num(p, "lowC") || x.v > num(p, "highC"));
      const machine = ctx.series.find((s) => s.zoneId === zoneId && s.sensorType === "TEMPERATURE_MACHINE");
      const machineValue = recentMean(machine, ctx.at, 10);
      const trolleyMean = meanOf(trolley.map((x) => x.v));
      const machineGap = machineValue !== null && trolleyMean !== null ? machineValue - trolleyMean : null;

      const memory = ctx.memory("COUVOIR_POSITIONS", `zone:${zoneId}`);
      const lastAt = typeof memory?.lastAt === "number" ? memory.lastAt : ctx.at;
      const outMinutes = (typeof memory?.outMinutes === "number" ? memory.outMinutes : 0) + (outOfRange.length ? (ctx.at - lastAt) / 60_000 : 0);

      const reasons: string[] = [];
      if (outOfRange.length) reasons.push(`${outOfRange.map((x) => `${x.s.position ?? "?"} ${round2(x.v)} °C`).join(", ")} hors de ${fr(num(p, "lowC"))}–${fr(num(p, "highC"))} °C (${Math.round(outMinutes)} min cumulées)`);
      if (spread > num(p, "maxSpreadC")) reasons.push(`écart de ${fr(round2(spread))} °C entre positions du chariot (max ${fr(num(p, "maxSpreadC"))} °C)`);
      if (machineGap !== null && Math.abs(machineGap) > num(p, "maxMachineGapC")) {
        reasons.push(`la machine affiche ${fr(round2(machineValue!))} °C, les sondes indépendantes mesurent ${fr(round2(trolleyMean!))} °C : la machine régule peut-être sur une sonde qui dérive`);
      }
      const state = outOfRange.length && outMinutes >= num(p, "criticalOutMinutes") ? "CRITIQUE" : reasons.length ? "ALERTE" : "NORMAL";
      const zoneName = probes[0].zoneName ?? zoneId;
      out.push({
        subjectKey: `zone:${zoneId}`,
        subjectLabel: `Incubateur — ${zoneName}`,
        state,
        value: round2(spread),
        unit: "C",
        low: num(p, "lowC"),
        high: num(p, "highC"),
        lotId: null,
        diagnosis: reasons.length ? `${reasons.join(" ; ")}.` : `Positions ${values.map((x) => `${x.s.position ?? "?"} ${round2(x.v)} °C`).join(", ")} : conformes.`,
        context: { positions: values.map((x) => ({ position: x.s.position, value: round2(x.v) })), machine: machineValue === null ? null : round2(machineValue), machineGap: machineGap === null ? null : round2(machineGap) },
        memory: { lastAt: ctx.at, outMinutes: outOfRange.length ? Math.round(outMinutes * 10) / 10 : 0 },
      });
    }
    return out;
  },
};

/** H06b: two probes, at the door and at the coldest far point — out of range, or apart from each other. */
export const eggRoomGap: RuleEvaluator = {
  code: "SALLE_OEUFS_ECART",
  label: "Salle des œufs",
  raisesAlerts: true,
  evaluate(ctx) {
    const p = ctx.params("SALLE_OEUFS_ECART");
    const out: Verdict[] = [];
    for (const [zoneId, probes] of byZone(ctx.series.filter((s) => s.catalogRef === "H06b" && s.sensorType === "TEMPERATURE"))) {
      const values = probes.map((s) => ({ s, v: recentMean(s, ctx.at, 15) })).filter((x): x is { s: ChannelSeries; v: number } => x.v !== null);
      if (values.length === 0) continue;
      const reasons: string[] = [];
      const outOfRange = values.filter((x) => x.v < num(p, "lowC") || x.v > num(p, "highC"));
      if (outOfRange.length) reasons.push(`${outOfRange.map((x) => `${x.s.position ?? "?"} ${round1(x.v)} °C`).join(", ")} hors de ${fr(num(p, "lowC"))}–${fr(num(p, "highC"))} °C`);
      const gap = values.length >= 2 ? Math.max(...values.map((x) => x.v)) - Math.min(...values.map((x) => x.v)) : 0;
      if (gap > num(p, "maxGapC")) reasons.push(`écart de ${fr(round1(gap))} °C entre les deux points : porte restée ouverte ou air mal réparti`);
      out.push({
        subjectKey: `zone:${zoneId}`,
        subjectLabel: `Salle des œufs — ${probes[0].zoneName ?? zoneId}`,
        state: reasons.length ? "ALERTE" : "NORMAL",
        value: round1(gap),
        unit: "C",
        low: num(p, "lowC"),
        high: num(p, "highC"),
        lotId: null,
        diagnosis: reasons.length ? `${reasons.join(" ; ")}.` : `${values.map((x) => `${x.s.position ?? "?"} ${round1(x.v)} °C`).join(", ")} : conforme.`,
      });
    }
    return out;
  },
};
