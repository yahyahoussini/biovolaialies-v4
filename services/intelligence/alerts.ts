import { z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { ALERT_OUTCOME, type AlertOutcome, type AlertStatus, type AnomalyStatus } from "../../domain/shared/enums";
import { AuthorizationError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import type { Alert } from "../../domain/intelligence/types";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveBuildingHierarchy, resolveLotHierarchy } from "../identity/scope-check";

/**
 * Alert lifecycle (phase-6 brief §14-§16). Every transition: (1) checks the anomaly's own
 * lot/building is in the caller's scope, (2) updates the alert row, (3) records an
 * ActionRecord (the "action foundation" the schema already has a table for), (4) writes the
 * SAME action into the lot's existing event timeline when it has a lot, and (5) writes an
 * audit_log entry — reusing the three architectures that already exist, never a fourth,
 * isolated history (brief's explicit instruction).
 */

const commentSchema = z.string().trim().max(500).optional();

type Transition = { from: AlertStatus[]; to: AlertStatus; anomalyStatus: AnomalyStatus; actionType: string; defaultDescription: string };

const TRANSITIONS: Record<"ACKNOWLEDGE" | "RESOLVE" | "DISMISS", Transition> = {
  ACKNOWLEDGE: {
    from: ["OPEN"],
    to: "ACKNOWLEDGED",
    anomalyStatus: "OPEN",
    actionType: "ACKNOWLEDGE_ALERT",
    defaultDescription: "Alerte prise en compte.",
  },
  RESOLVE: {
    from: ["OPEN", "ACKNOWLEDGED"],
    to: "RESOLVED",
    anomalyStatus: "REVIEWED",
    actionType: "RESOLVE_ALERT",
    defaultDescription: "Alerte résolue.",
  },
  DISMISS: {
    from: ["OPEN", "ACKNOWLEDGED"],
    to: "DISMISSED",
    anomalyStatus: "DISMISSED",
    actionType: "DISMISS_ALERT",
    defaultDescription: "Alerte écartée.",
  },
};

/** Shortest intervention text accepted when closing a telemetry alert. */
export const MIN_INTERVENTION_LENGTH = 10;

async function transitionAlert(alertId: string, session: Session, kind: keyof typeof TRANSITIONS, comment: unknown, outcome?: unknown): Promise<Alert> {
  if (!can(session, "ACKNOWLEDGE", "ALERTS")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour traiter cette alerte.");
  }
  const parsedComment = commentSchema.safeParse(comment);
  if (!parsedComment.success) throw new ValidationError("Le commentaire est invalide.");

  const alert = await repositories.alerts.findById(alertId);
  if (!alert) throw new NotFoundError("Alert", alertId);
  const anomaly = await repositories.anomalies.findById(alert.anomalyId);
  if (!anomaly) throw new NotFoundError("Anomaly", alert.anomalyId);

  if (anomaly.lotId) {
    assertInScope(session, await resolveLotHierarchy(anomaly.lotId));
  } else if (anomaly.buildingId) {
    assertInScope(session, await resolveBuildingHierarchy(anomaly.buildingId));
  }

  const transition = TRANSITIONS[kind];
  if (!transition.from.includes(alert.status)) {
    throw new ValidationError(`Transition invalide : une alerte "${alert.status}" ne peut pas passer à "${transition.to}".`);
  }

  // A telemetry alert is closed only with what was done and whether it was right (document 3,
  // ch. 4): "une alerte sans suite enregistrée produit un historique inexploitable".
  const rule = await repositories.rules.findById(anomaly.ruleId);
  const isTelemetry = !!rule?.target.startsWith("telemetry:");
  const closing = kind === "RESOLVE" || kind === "DISMISS";
  let parsedOutcome: AlertOutcome | null = null;
  if (closing && isTelemetry) {
    if ((parsedComment.data?.trim().length ?? 0) < MIN_INTERVENTION_LENGTH) {
      throw new ValidationError(`Décrivez l'intervention réalisée (${MIN_INTERVENTION_LENGTH} caractères minimum) : sans elle, l'historique n'apprend rien.`);
    }
    const o = (ALERT_OUTCOME as readonly string[]).includes(String(outcome)) ? (outcome as AlertOutcome) : null;
    if (!o) throw new ValidationError("Indiquez si l'alerte était justifiée, fausse ou indéterminée.");
    parsedOutcome = o;
  }

  const now = new Date().toISOString();
  const description = parsedComment.data?.trim() ? parsedComment.data.trim() : transition.defaultDescription;

  const updated = await repositories.alerts.updateStatus(
    alertId,
    transition.to,
    transition.to === "RESOLVED" || transition.to === "DISMISSED" ? now : alert.resolvedAt
  );
  await repositories.anomalies.updateStatus(anomaly.id, transition.anomalyStatus);
  // Any human action stops the escalation; closing frees the rule to open a new alert next time.
  await repositories.alerts.setEscalation(alertId, alert.escalationLevel ?? 1, null);
  if (parsedOutcome) await repositories.alerts.setOutcome(alertId, parsedOutcome);
  if (closing) await repositories.ruleStates.clearOpenAlert(alertId);

  await repositories.actionRecords.create({
    alertId,
    lotId: anomaly.lotId,
    actionType: transition.actionType,
    description,
    actorId: session.userId,
    performedAt: now,
  });

  if (anomaly.lotId) {
    await repositories.lotEvents.create({
      lotId: anomaly.lotId,
      eventType: "ALERT_ACTION",
      payload: { alertId, actionType: transition.actionType, description },
      occurredAt: now,
      actorId: session.userId,
      dataStatus: "REEL",
      sourceType: "MANUEL",
      sourceId: null,
      deviceId: null,
      measurementMethod: null,
      validationStatus: null,
    });
  }

  await recordAudit({
    actorId: session.userId,
    entityType: "alert",
    entityId: alertId,
    field: "status",
    oldValue: alert.status,
    newValue: parsedOutcome ? `${transition.to} (${parsedOutcome})` : transition.to,
    reason: description,
    relatedLotId: anomaly.lotId,
    relatedEventId: null,
  });

  return updated;
}

export async function acknowledgeAlert(alertId: string, session: Session, comment?: unknown): Promise<Alert> {
  return transitionAlert(alertId, session, "ACKNOWLEDGE", comment);
}

export async function resolveAlert(alertId: string, session: Session, comment?: unknown, outcome?: unknown): Promise<Alert> {
  return transitionAlert(alertId, session, "RESOLVE", comment, outcome);
}

export async function dismissAlert(alertId: string, session: Session, comment?: unknown, outcome?: unknown): Promise<Alert> {
  return transitionAlert(alertId, session, "DISMISS", comment, outcome);
}
