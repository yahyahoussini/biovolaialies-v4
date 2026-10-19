import type { RuleState, SiteEventKind } from "../../shared/enums";
import type { DecisionRule } from "../catalog";
import type { ReferenceBand } from "../types";
import type { ChannelSeries } from "./series";

export type RuleParams = Record<string, number | string>;
export type RuleMemory = Record<string, number | string | null>;

export interface OccupantInfo {
  lotId: string;
  lotCode: string;
  productionLine: string | null;
  startedAt: string;
}

export interface SiteEventPoint {
  deviceId: string;
  deviceCode: string;
  kind: SiteEventKind;
  at: number;
  badge: string | null;
}

/** Everything a rule may read at one evaluation instant. */
export interface EvalContext {
  buildingId: string;
  buildingName: string;
  at: number;
  /** Channels of the building, plus the farm's site-level channels (weather, tank, run). */
  series: ChannelSeries[];
  events: SiteEventPoint[];
  bands: ReferenceBand[];
  occupantOf(zoneId: string | null, at: number): OccupantInfo | null;
  params(rule: DecisionRule): RuleParams;
  previousState(rule: DecisionRule, subjectKey: string): RuleState;
  memory(rule: DecisionRule, subjectKey: string): RuleMemory | null;
}

/** A rule's judgement on one subject at one instant. No verdict for a subject means "nothing to say" and leaves its state as it was. */
export interface Verdict {
  subjectKey: string;
  subjectLabel: string;
  state: RuleState;
  value: number | null;
  unit?: string | null;
  low?: number | null;
  high?: number | null;
  /** What the value is compared with when it is not simply a bound (an expected consumption, a crossed band edge). */
  reference?: number | null;
  /** How that comparison reads in the alert ("Attendu 186 L : mêmes heures des 3 jours précédents"). */
  referenceLabel?: string;
  bandId?: string | null;
  lotId: string | null;
  diagnosis: string;
  context?: Record<string, unknown>;
  memory?: RuleMemory;
  /** Facts a rule detects without being a state, e.g. a silo delivery. Stored as site events. */
  derivedEvents?: { kind: SiteEventKind; at: number; sensorId: string; payload: Record<string, unknown> }[];
}

export interface RuleEvaluator {
  code: DecisionRule;
  label: string;
  /** False for indicators (run availability): their changes of state are kept, but nobody is paged. */
  raisesAlerts: boolean;
  evaluate(ctx: EvalContext): Verdict[];
}
