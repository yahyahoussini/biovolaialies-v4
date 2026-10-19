import type {
  ActionRecord,
  Alert,
  Anomaly,
  KpiDefinition,
  KpiValue,
  NewActionRecord,
  NewAlert,
  NewAnomaly,
  NewKpiDefinition,
  NewKpiValue,
  NewRule,
  Rule,
} from "./types";
import type { AnomalyStatus } from "../shared/enums";

/** Thin persisted mirror of domain/intelligence/kpi-definitions.ts — see that file for the real formula/eligibility logic. */
export interface KpiDefinitionRepository {
  findByCode(code: string): Promise<KpiDefinition | null>;
  list(): Promise<KpiDefinition[]>;
  create(input: NewKpiDefinition): Promise<KpiDefinition>;
}

/**
 * KPI values are NOT written on every dashboard/lot-page render (that would be a KPI row
 * per view). A row is only persisted as evidence when a rule fires and needs a durable
 * snapshot to point `anomalies.kpiValueId` at — see services/intelligence/kpi-service.ts.
 */
export interface KpiValueRepository {
  listByLot(lotId: string): Promise<KpiValue[]>;
  create(input: NewKpiValue): Promise<KpiValue>;
}

/** Thin persisted mirror of domain/intelligence/rule-definitions.ts. */
export interface RuleRepository {
  findById(id: string): Promise<Rule | null>;
  findByName(name: string): Promise<Rule | null>;
  list(): Promise<Rule[]>;
  create(input: NewRule): Promise<Rule>;
}

export interface AnomalyRepository {
  findById(id: string): Promise<Anomaly | null>;
  list(): Promise<Anomaly[]>;
  listByLot(lotId: string): Promise<Anomaly[]>;
  listByBuilding(buildingId: string): Promise<Anomaly[]>;
  create(input: NewAnomaly): Promise<Anomaly>;
  updateStatus(id: string, status: AnomalyStatus): Promise<Anomaly>;
  updateSeverity(id: string, severity: Anomaly["severity"]): Promise<void>;
}

export interface AlertRepository {
  findById(id: string): Promise<Alert | null>;
  list(): Promise<Alert[]>;
  findByAnomalyId(anomalyId: string): Promise<Alert | null>;
  /** Batched, not a per-anomaly loop — see services/intelligence/queries.ts. */
  listByAnomalyIds(anomalyIds: string[]): Promise<Alert[]>;
  create(input: NewAlert): Promise<Alert>;
  updateStatus(id: string, status: Alert["status"], resolvedAt: string | null): Promise<Alert>;
  setEscalation(id: string, level: number, nextEscalationAt: string | null): Promise<void>;
  setOutcome(id: string, outcome: NonNullable<Alert["outcome"]>): Promise<void>;
  /** Open (not acknowledged) alerts whose next escalation has fallen due. */
  listDueForEscalation(now: string): Promise<Alert[]>;
}

export interface ActionRecordRepository {
  listByAlert(alertId: string): Promise<ActionRecord[]>;
  create(input: NewActionRecord): Promise<ActionRecord>;
}
