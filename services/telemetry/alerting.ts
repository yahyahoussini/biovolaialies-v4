import { repositories } from "../../data/repositories";
import type { Alert, Anomaly, AnomalyExplanation, Rule } from "../../domain/intelligence/types";
import { sensorSpec, type DecisionRule } from "../../domain/telemetry/catalog";
import { ESCALATION_POLICY, dueLevels, nextEscalationAt, stepFor, type EscalationStep } from "../../domain/telemetry/escalation";
import { RULE_STATE_LABEL, unitLabel } from "../../domain/telemetry/labels";
import { RULE_LABEL } from "../../domain/telemetry/rules/index";
import { fr } from "../../domain/telemetry/rules/series";
import type { Verdict } from "../../domain/telemetry/rules/types";
import type { RuleState } from "../../domain/shared/enums";
import { isWithinScope, resolveBuildingHierarchy } from "../identity/scope-check";
import { logger } from "../../lib/logger";

import { isAlertEmailConfigured, sendEmailTo } from "../notify/email";

const TARGET_PREFIX = "telemetry:";

/** The rules table mirrors the telemetry rules so anomalies can reference them; created on first use. */
export async function ensureTelemetryRule(code: DecisionRule): Promise<Rule> {
  const existing = (await repositories.rules.list()).find((r) => r.target === `${TARGET_PREFIX}${code}`);
  if (existing) return existing;
  const refs = ["A01", "A02", "A03", "A04", "A05", "A06", "B02", "C01", "C02", "C04", "D01", "D04", "E01", "H06", "H06b", "O01"]
    .filter((ref) => sensorSpec(ref)?.rules.includes(code))
    .join(", ");
  return repositories.rules.create({
    name: RULE_LABEL[code],
    target: `${TARGET_PREFIX}${code}`,
    condition: { operator: "OUT_OF_RANGE", threshold: 0 },
    severity: "WARNING",
    active: true,
    description: refs ? `Règle de télémétrie (capteurs ${refs}, document 2).` : "Règle de télémétrie (santé des capteurs et passerelles).",
    explanationTemplate: "{diagnosis}",
  });
}

export function isTelemetryRule(rule: Pick<Rule, "target">): boolean {
  return rule.target.startsWith(TARGET_PREFIX);
}

const severityOf = (state: RuleState): "WARNING" | "CRITICAL" => (state === "CRITIQUE" ? "CRITICAL" : "WARNING");

/** Alert times are read on a Moroccan farm: shown in Casablanca time, whatever the server's zone. */
export function farmTime(at: number): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(at));
}

function explanation(rule: DecisionRule, verdict: Verdict, buildingName: string, at: number, from: RuleState): AnomalyExplanation {
  const u = unitLabel(verdict.unit ?? null);
  const reference =
    verdict.referenceLabel ??
    (verdict.low !== undefined && verdict.low !== null && verdict.high !== undefined && verdict.high !== null
      ? `Bande ${fr(verdict.low)}–${fr(verdict.high)} ${u}${verdict.bandId ? " (version en vigueur à cet instant)" : ""}`
      : verdict.high !== undefined && verdict.high !== null
        ? `Seuil ${fr(verdict.high)} ${u}`
        : verdict.low !== undefined && verdict.low !== null
          ? `Seuil ${fr(verdict.low)} ${u}`
          : "Paramètres de la règle (écran Règles)");
  const r2 = (v: number) => fr(Math.round(v * 100) / 100);
  let byHowMuch = verdict.value !== null ? `${fr(verdict.value)} ${u}` : "—";
  if (verdict.value !== null && verdict.reference !== undefined && verdict.reference !== null && verdict.reference !== 0) {
    const gap = verdict.value - verdict.reference;
    byHowMuch = `${fr(verdict.value)} ${u}, soit ${r2(Math.abs(gap))} ${u} ${gap < 0 ? "en dessous" : "au-dessus"} (${gap < 0 ? "" : "+"}${fr(Math.round((gap / Math.abs(verdict.reference)) * 1000) / 10)} %)`;
  } else if (verdict.value !== null && verdict.high !== undefined && verdict.high !== null && verdict.value > verdict.high) {
    byHowMuch = `${fr(verdict.value)} ${u}, soit ${r2(verdict.value - verdict.high)} ${u} au-dessus du seuil`;
  } else if (verdict.value !== null && verdict.low !== undefined && verdict.low !== null && verdict.value < verdict.low) {
    byHowMuch = `${fr(verdict.value)} ${u}, soit ${r2(verdict.low - verdict.value)} ${u} en dessous du seuil`;
  }
  return {
    what: `${RULE_LABEL[rule]} — ${verdict.subjectLabel}`,
    where: buildingName,
    when: `${farmTime(at)} (heure du Maroc)`,
    whatChanged: `État ${RULE_STATE_LABEL[from]} → ${RULE_STATE_LABEL[verdict.state]}`,
    comparedTo: reference,
    byHowMuch,
    basedOnData: "Mesures valides des capteurs (les mesures signalées — horloge, hors plage, étalonnage échu — sont exclues).",
    whyTriggered: verdict.diagnosis,
  };
}

/** Opens an alert for a rule that just left NORMAL, and tells level 1. */
export async function raiseTelemetryAlert(input: {
  rule: DecisionRule;
  verdict: Verdict;
  at: number;
  from: RuleState;
  buildingId: string;
  buildingName: string;
}): Promise<Alert> {
  const rule = await ensureTelemetryRule(input.rule);
  const severity = severityOf(input.verdict.state);
  const reference = input.verdict.reference ?? input.verdict.high ?? input.verdict.low ?? null;
  const anomaly = await repositories.anomalies.create({
    ruleId: rule.id,
    measurementId: null,
    kpiValueId: null,
    lotId: input.verdict.lotId,
    buildingId: input.buildingId,
    severity,
    observedValue: input.verdict.value,
    referenceValue: reference,
    deviationPercent:
      input.verdict.value !== null && reference ? Math.round(((input.verdict.value - reference) / Math.abs(reference)) * 1000) / 10 : null,
    unit: input.verdict.unit ?? null,
    confidence: severity === "CRITICAL" ? "HIGH" : "MEDIUM",
    explanation: explanation(input.rule, input.verdict, input.buildingName, input.at, input.from),
    detectedAt: new Date(input.at).toISOString(),
    status: "OPEN",
  });
  const raisedAt = new Date(input.at).toISOString();
  const alert = await repositories.alerts.create({ anomalyId: anomaly.id, status: "OPEN", assignedTo: null, raisedAt, resolvedAt: null });
  // Level 1 is told at once. If nobody holds that role over this building, the gap is recorded
  // and the next level is told straight away: an alert must never reach no one in silence.
  let level = 1;
  for (let step = stepFor(severity, 1); step; step = stepFor(severity, level + 1)) {
    level = step.level;
    if ((await notifyStep(alert, anomaly, step, input.buildingId)) > 0) break;
  }
  await repositories.alerts.setEscalation(alert.id, level, nextEscalationAt(severity, raisedAt, level));
  return { ...alert, escalationLevel: level };
}

/** ALERTE → CRITIQUE on an open alert: the alert itself becomes critical and follows the critical schedule. */
export async function raiseAlertToCritical(alertId: string, buildingId: string): Promise<void> {
  const alert = await repositories.alerts.findById(alertId);
  if (!alert || alert.status === "RESOLVED" || alert.status === "DISMISSED") return;
  const anomaly = await repositories.anomalies.findById(alert.anomalyId);
  if (!anomaly || anomaly.severity === "CRITICAL") return;
  await repositories.anomalies.updateSeverity(anomaly.id, "CRITICAL");
  const level = alert.escalationLevel ?? 1;
  if (alert.status === "OPEN") {
    await repositories.alerts.setEscalation(alert.id, level, nextEscalationAt("CRITICAL", alert.raisedAt, level));
    const step = stepFor("CRITICAL", level);
    if (step) await notifyStep(alert, { ...anomaly, severity: "CRITICAL" }, step, buildingId);
  }
}

/** Tells one escalation level; returns how many people it reached (0 = nobody holds the role here). */
async function notifyStep(alert: Alert, anomaly: Anomaly, step: EscalationStep, buildingId: string): Promise<number> {
  const path = await resolveBuildingHierarchy(buildingId);
  const users = (await repositories.users.list()).filter((u) => u.active && step.roles.includes(u.role) && isWithinScope(u, path));
  const now = new Date().toISOString();
  if (users.length === 0) {
    await repositories.alertNotifications.create({
      alertId: alert.id,
      level: step.level,
      recipientId: null,
      channel: step.channels[0],
      status: "ECHEC",
      detail: `Aucun utilisateur actif (${step.roles.join(", ")}) n'a ce bâtiment dans son périmètre : niveau suivant prévenu.`,
      sentAt: now,
    });
    logger.warn("general", `Alert ${alert.id}: no recipient for escalation level ${step.level}.`);
    return 0;
  }
  const subject = `[${anomaly.severity === "CRITICAL" ? "CRITIQUE" : "ALERTE"}] ${anomaly.explanation.what}`;
  const text = `${anomaly.explanation.where} — ${anomaly.explanation.when}\n${anomaly.explanation.whyTriggered}\n\nNiveau d'escalade ${step.level}. Prendre en compte l'alerte dans la plateforme pour arrêter l'escalade.`;
  for (const channel of step.channels) {
    if (channel === "EMAIL") {
      const sent = isAlertEmailConfigured() ? await sendEmailTo(users.map((u) => u.email), { subject, text }) : false;
      for (const u of users) {
        await repositories.alertNotifications.create({
          alertId: alert.id,
          level: step.level,
          recipientId: u.id,
          channel,
          status: isAlertEmailConfigured() ? (sent ? "ENVOYE" : "ECHEC") : "NON_CONFIGURE",
          detail: isAlertEmailConfigured() ? null : "Aucun fournisseur d'e-mail configuré (RESEND_API_KEY, ALERTS_NOTIFY_FROM).",
          sentAt: now,
        });
      }
    } else {
      // No SMS or voice provider is integrated: the platform says so instead of pretending.
      for (const u of users) {
        await repositories.alertNotifications.create({
          alertId: alert.id,
          level: step.level,
          recipientId: u.id,
          channel,
          status: "NON_CONFIGURE",
          detail: "Aucun fournisseur SMS / appel vocal n'est intégré. L'alarme GSM autonome (L01) reste le canal d'urgence.",
          sentAt: now,
        });
      }
    }
  }
  return users.length;
}

/** Climbs every open, unacknowledged alert whose next level has fallen due. Run by the scheduler. */
export async function runEscalation(now = new Date()): Promise<{ escalated: number }> {
  const due = await repositories.alerts.listDueForEscalation(now.toISOString());
  let escalated = 0;
  for (const alert of due) {
    const anomaly = await repositories.anomalies.findById(alert.anomalyId);
    if (!anomaly || !anomaly.buildingId) continue;
    const severity = anomaly.severity === "CRITICAL" ? "CRITICAL" : "WARNING";
    const steps = dueLevels(severity, alert.raisedAt, alert.escalationLevel ?? 1, now.getTime());
    if (steps.length === 0) continue;
    const top = steps[steps.length - 1];
    for (const step of steps) await notifyStep(alert, anomaly, step, anomaly.buildingId);
    await repositories.alerts.setEscalation(alert.id, top.level, nextEscalationAt(severity, alert.raisedAt, top.level));
    escalated++;
  }
  return { escalated };
}

export { ESCALATION_POLICY };
