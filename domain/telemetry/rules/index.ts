import type { DecisionRule } from "../catalog";
import { incubatorPositions, eggRoomGap, weighingUniformity } from "./birds-hatchery";
import { co2Ventilation, depressionCommand, h2sPresence, learnedBand, lightProgramme, nh3Exposure, zoneDrift } from "./environment";
import { accessOutOfHours, runAvailability } from "./site";
import type { RuleEvaluator } from "./types";
import { lineImbalance, screwNoRotation, siloStock, tankAutonomy, waterProfile } from "./water-feed";

/** Every data-driven rule. CAPTEUR_SILENCIEUX is apart: it runs against the clock (see site.ts). */
export const EVALUATORS: RuleEvaluator[] = [
  learnedBand,
  zoneDrift,
  co2Ventilation,
  nh3Exposure,
  h2sPresence,
  depressionCommand,
  lightProgramme,
  runAvailability,
  waterProfile,
  lineImbalance,
  tankAutonomy,
  siloStock,
  screwNoRotation,
  weighingUniformity,
  incubatorPositions,
  eggRoomGap,
  accessOutOfHours,
];

export const RULE_LABEL: Record<DecisionRule, string> = {
  ...(Object.fromEntries(EVALUATORS.map((e) => [e.code, e.label])) as Record<DecisionRule, string>),
  CAPTEUR_SILENCIEUX: "Capteur ou passerelle silencieux",
};

export function evaluatorFor(code: string): RuleEvaluator | undefined {
  return EVALUATORS.find((e) => e.code === code);
}

/** Evaluation step: the gateway's report period (document 2, ch. 6). Rules are replayed at this pace over a catch-up. */
export const EVALUATION_STEP_SECONDS = 120;
