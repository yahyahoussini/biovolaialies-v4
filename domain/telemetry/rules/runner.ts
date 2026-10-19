import type { RuleState } from "../../shared/enums";
import type { DecisionRule } from "../catalog";
import type { ReferenceBand } from "../types";
import { EVALUATION_STEP_SECONDS, EVALUATORS } from "./index";
import type { ChannelSeries } from "./series";
import type { EvalContext, OccupantInfo, RuleEvaluator, RuleMemory, RuleParams, SiteEventPoint, Verdict } from "./types";

export interface SubjectState {
  state: RuleState;
  since: number;
  memory: RuleMemory | null;
}

export interface RunInput {
  buildingId: string;
  buildingName: string;
  /** Last instant already evaluated (exclusive). */
  from: number;
  /** Newest instant the data covers (inclusive). */
  to: number;
  series: ChannelSeries[];
  events: SiteEventPoint[];
  bands: ReferenceBand[];
  occupantOf: (zoneId: string | null, at: number) => OccupantInfo | null;
  params: (rule: DecisionRule) => RuleParams;
  /** Keyed by `${rule}|${subjectKey}`. */
  states: Map<string, SubjectState>;
  evaluators?: RuleEvaluator[];
  stepSeconds?: number;
}

export interface Transition {
  rule: DecisionRule;
  raisesAlerts: boolean;
  from: RuleState;
  to: RuleState;
  at: number;
  verdict: Verdict;
}

export interface RunOutput {
  transitions: Transition[];
  /** Latest verdict per subject, for the "current state" screens. */
  lastVerdicts: Map<string, { rule: DecisionRule; at: number; verdict: Verdict }>;
  derivedEvents: (NonNullable<Verdict["derivedEvents"]>[number] & { rule: DecisionRule })[];
  /** Last instant evaluated — the new watermark. Equals `from` when no full step fitted. */
  evaluatedUntil: number;
  steps: number;
}

export const stateKey = (rule: string, subjectKey: string) => `${rule}|${subjectKey}`;

/**
 * Replays the rules over (from, to] at the gateway's report pace. Run live it does one step;
 * run after a three-day outage it does three days of steps, and every alert carries the instant
 * it would have fired, not the instant the data arrived. Only changes of state come out
 * (document 3, ch. 3: "une règle qui reste dans sa bande produit zéro ligne").
 */
export function runRules(input: RunInput): RunOutput {
  const step = (input.stepSeconds ?? EVALUATION_STEP_SECONDS) * 1000;
  const evaluators = input.evaluators ?? EVALUATORS;
  const states = input.states;
  const transitions: Transition[] = [];
  const lastVerdicts: RunOutput["lastVerdicts"] = new Map();
  const derivedEvents: RunOutput["derivedEvents"] = [];
  let at = Math.floor(input.from / step) * step + step;
  let evaluatedUntil = input.from;
  let steps = 0;

  while (at <= input.to) {
    const ctx: EvalContext = {
      buildingId: input.buildingId,
      buildingName: input.buildingName,
      at,
      series: input.series,
      events: input.events,
      bands: input.bands,
      occupantOf: input.occupantOf,
      params: input.params,
      previousState: (rule, subject) => states.get(stateKey(rule, subject))?.state ?? "NORMAL",
      memory: (rule, subject) => states.get(stateKey(rule, subject))?.memory ?? null,
    };
    for (const evaluator of evaluators) {
      for (const verdict of evaluator.evaluate(ctx)) {
        const key = stateKey(evaluator.code, verdict.subjectKey);
        const prev = states.get(key) ?? { state: "NORMAL" as RuleState, since: at, memory: null };
        if (verdict.state !== prev.state) {
          transitions.push({ rule: evaluator.code, raisesAlerts: evaluator.raisesAlerts, from: prev.state, to: verdict.state, at, verdict });
        }
        states.set(key, {
          state: verdict.state,
          since: verdict.state !== prev.state ? at : prev.since,
          memory: verdict.memory ?? prev.memory,
        });
        lastVerdicts.set(key, { rule: evaluator.code, at, verdict });
        for (const e of verdict.derivedEvents ?? []) derivedEvents.push({ ...e, rule: evaluator.code });
      }
    }
    evaluatedUntil = at;
    steps++;
    at += step;
  }
  return { transitions, lastVerdicts, derivedEvents, evaluatedUntil, steps };
}
