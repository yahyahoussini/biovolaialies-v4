import type { AlertOutcome, AlertSeverity, AlertStatus, AnomalyStatus, DataStatus } from "../shared/enums";

export interface KpiDefinition {
  id: string;
  code: string;
  label: string;
  unit: string;
  formulaDesc: string;
}

export interface KpiValue {
  id: string;
  kpiDefinitionId: string;
  lotId: string | null;
  buildingId: string | null;
  /** Human-readable period the value covers, e.g. "2026-08-09/2026-08-16". */
  period: string;
  value: number;
  dataStatus: DataStatus;
  calculatedAt: string;
}

export interface RuleCondition {
  operator: "LT" | "LTE" | "GT" | "GTE" | "EQ" | "OUT_OF_RANGE" | "COMPOUND";
  threshold: number;
  /** Only for OUT_OF_RANGE (e.g. a sensor's valid band). */
  min?: number;
  max?: number;
  /** Only for COMPOUND (phase-6 brief §10/§11's performance-decline rule: two conditions must both hold). */
  secondaryThreshold?: number;
}

export interface Rule {
  id: string;
  name: string;
  /** e.g. "sensor:TEMPERATURE", "kpi:FEED_CONSUMPTION", "population", "iot:staleness" */
  target: string;
  condition: RuleCondition;
  severity: AlertSeverity;
  active: boolean;
  description: string;
  /** Human-readable template the rule engine fills with real numbers — never shown as raw code. */
  explanationTemplate: string;
}

/**
 * Answers the eight questions phase-6 brief §12 requires of every anomaly — rendered by
 * the reusable ExplanationPanel component. Always built from real computed numbers, never
 * a canned "AI detected anomaly" string.
 */
export interface AnomalyExplanation {
  what: string;
  where: string;
  when: string;
  whatChanged: string;
  comparedTo: string;
  byHowMuch: string;
  basedOnData: string;
  whyTriggered: string;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface Anomaly {
  id: string;
  ruleId: string;
  measurementId: string | null;
  kpiValueId: string | null;
  lotId: string | null;
  buildingId: string | null;
  severity: AlertSeverity;
  observedValue: number | null;
  referenceValue: number | null;
  deviationPercent: number | null;
  unit: string | null;
  confidence: Confidence;
  explanation: AnomalyExplanation;
  detectedAt: string;
  status: AnomalyStatus;
}

export interface Alert {
  id: string;
  anomalyId: string;
  status: AlertStatus;
  assignedTo: string | null;
  raisedAt: string;
  resolvedAt: string | null;
  /** Escalation reached and next due (telemetry alerts); defaults to level 1, none due. */
  escalationLevel?: number;
  nextEscalationAt?: string | null;
  /** Whether the alert was right, recorded when it is closed. */
  outcome?: AlertOutcome | null;
}

/** A human's response to an alert/anomaly. Named ActionRecord to avoid clashing with the RBAC `Action` verb type. */
export interface ActionRecord {
  id: string;
  alertId: string | null;
  lotId: string | null;
  actionType: string;
  description: string;
  actorId: string;
  performedAt: string;
}

export type NewKpiDefinition = Omit<KpiDefinition, "id">;
export type NewKpiValue = Omit<KpiValue, "id">;
export type NewRule = Omit<Rule, "id">;
export type NewAnomaly = Omit<Anomaly, "id">;
export type NewAlert = Omit<Alert, "id">;
export type NewActionRecord = Omit<ActionRecord, "id">;
