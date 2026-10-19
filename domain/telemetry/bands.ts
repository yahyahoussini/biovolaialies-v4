import type { Season, SensorType } from "../shared/enums";
import type { ReferenceBand } from "./types";

/**
 * Reference bands (document 3, ch. 4). No published target exists for beldi chicken (98 to 150
 * days, against 42 for the breeders' reference curves), so the system starts from wide bands
 * written by the poultry technician and learns its own from the farm's finished lots.
 */

/** Meteorological seasons, northern hemisphere (Morocco). */
export function seasonOf(at: string | number): Exclude<Season, "TOUTES"> {
  const month = new Date(typeof at === "number" ? at : Date.parse(at)).getUTCMonth() + 1;
  if (month === 12 || month <= 2) return "HIVER";
  if (month <= 5) return "PRINTEMPS";
  if (month <= 8) return "ETE";
  return "AUTOMNE";
}

/** Age in whole days since the lot was placed (day 0 = placement day). */
export function ageDay(lotStartedAt: string, at: string | number): number {
  const t = typeof at === "number" ? at : Date.parse(at);
  return Math.floor((t - Date.parse(lotStartedAt)) / 86_400_000);
}

/**
 * The active band for a reading. Most specific wins: the lot's own line before "*", its season
 * before "TOUTES". No band means no judgement — never a default threshold invented on the spot.
 */
export function selectBand(
  bands: ReferenceBand[],
  sensorType: SensorType,
  productionLine: string | null,
  age: number,
  season: Season
): ReferenceBand | null {
  let best: { band: ReferenceBand; score: number } | null = null;
  for (const b of bands) {
    if (b.status !== "ACTIVE" || b.sensorType !== sensorType) continue;
    if (age < b.ageDayFrom || age > b.ageDayTo) continue;
    const lineMatch = b.productionLine === "*" ? 0 : b.productionLine === productionLine ? 2 : -1;
    const seasonMatch = b.season === "TOUTES" ? 0 : b.season === season ? 1 : -1;
    if (lineMatch < 0 || seasonMatch < 0) continue;
    const score = lineMatch + seasonMatch;
    if (!best || score > best.score) best = { band: b, score };
  }
  return best?.band ?? null;
}

/** Linear-interpolated percentile of a sorted array, p in 0..100. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error("percentile of an empty set");
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export interface LearningSample {
  lotId: string;
  age: number;
  season: Exclude<Season, "TOUTES">;
  /** Hourly mean of the channel, attributed to the lot through the occupation table. */
  value: number;
  /** True when the hour falls inside an alert closed as JUSTIFIEE: a real problem, not normal running. */
  duringConfirmedProblem: boolean;
}

/** A learned band needs this much history before it may replace the technician's. */
export const MIN_LOTS_TO_LEARN = 3;
export const MIN_HOURS_TO_LEARN = 48;
export const LEARN_PERCENTILES: [number, number] = [5, 95];

export interface LearnedBand {
  low: number;
  high: number;
  lotsUsed: number;
  samples: number;
  excluded: number;
  learnedFrom: string[];
}

export type LearnOutcome = { ok: true; band: LearnedBand } | { ok: false; reason: string; lotsAvailable: number; samples: number };

/**
 * Learns one band from finished lots. Every lot counts, good and bad ones alike (document 3:
 * "un historique où seuls les bons lots sont saisis n'apprend rien"); only the hours of a
 * confirmed problem are left out, because those are what the band must catch, not absorb.
 */
export function learnBand(
  samples: LearningSample[],
  target: Pick<ReferenceBand, "ageDayFrom" | "ageDayTo" | "season">
): LearnOutcome {
  const inWindow = samples.filter(
    (s) => s.age >= target.ageDayFrom && s.age <= target.ageDayTo && (target.season === "TOUTES" || s.season === target.season)
  );
  const usable = inWindow.filter((s) => !s.duringConfirmedProblem);
  const lots = Array.from(new Set(usable.map((s) => s.lotId))).sort();
  if (lots.length < MIN_LOTS_TO_LEARN) {
    return { ok: false, reason: `${lots.length} lot(s) terminé(s) couvrent cette fenêtre ; il en faut ${MIN_LOTS_TO_LEARN}.`, lotsAvailable: lots.length, samples: usable.length };
  }
  if (usable.length < MIN_HOURS_TO_LEARN) {
    return { ok: false, reason: `${usable.length} heure(s) mesurée(s) ; il en faut ${MIN_HOURS_TO_LEARN}.`, lotsAvailable: lots.length, samples: usable.length };
  }
  const sorted = usable.map((s) => s.value).sort((a, b) => a - b);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    ok: true,
    band: {
      low: round(percentile(sorted, LEARN_PERCENTILES[0])),
      high: round(percentile(sorted, LEARN_PERCENTILES[1])),
      lotsUsed: lots.length,
      samples: usable.length,
      excluded: inWindow.length - usable.length,
      learnedFrom: lots,
    },
  };
}

export const SEASON_LABEL: Record<Season, string> = {
  TOUTES: "Toutes saisons",
  HIVER: "Hiver",
  PRINTEMPS: "Printemps",
  ETE: "Été",
  AUTOMNE: "Automne",
};
