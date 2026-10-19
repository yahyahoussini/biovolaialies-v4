import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertSeverityBadge } from "@/components/domain/AlertSeverityBadge";
import { AlertStatusBadge } from "@/components/domain/AlertStatusBadge";
import { ExplanationPanel } from "@/components/domain/ExplanationPanel";
import { PageHeader } from "@/components/domain/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { repositories } from "@/data/repositories";
import { AuthorizationError, NotFoundError } from "@/domain/shared/errors";
import type { AlertSeverity } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { getAlertDetail } from "@/services/intelligence/queries";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { RULE_STATE_LABEL } from "@/domain/telemetry/labels";
import { AlertActionsPanel } from "./AlertActionsPanel";

const OUTCOME_LABEL = { JUSTIFIEE: "Justifiée", FAUSSE_ALERTE: "Fausse alerte", INDETERMINEE: "Indéterminée" } as const;
const CHANNEL_LABEL = { EMAIL: "E-mail", SMS: "SMS", APPEL: "Appel" } as const;
const NOTIF_LABEL = { ENVOYE: "Envoyé", NON_CONFIGURE: "Non configuré", ECHEC: "Échec" } as const;

export default async function AlertDetailPage({ params }: PageProps<"/alertes/[alertId]">) {
  const session = await requireModuleAccess("ALERTS");
  const { alertId } = await params;

  let detail: Awaited<ReturnType<typeof getAlertDetail>>;
  try {
    detail = await getAlertDetail(alertId, session);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthorizationError) redirect("/non-autorise");
    throw error;
  }

  const { alert, anomaly, rule, lotCode, lotId, buildingCode, farmName, actions } = detail;
  const context = lotCode ? `Lot ${lotCode} — ${farmName ?? "—"}` : buildingCode ? `${buildingCode} — ${farmName ?? "—"}` : "—";

  const actorIds = Array.from(new Set(actions.map((a) => a.actorId)));
  const actors = await Promise.all(actorIds.map((id) => repositories.users.findById(id)));
  const actorNameById = new Map(actorIds.map((id, index) => [id, actors[index]?.fullName ?? "Utilisateur"]));

  const kpiEvidence = anomaly.kpiValueId ? await repositories.kpiValues.listByLot(lotId ?? "").then((rows) => rows.find((r) => r.id === anomaly.kpiValueId)) : null;
  const kpiDefinition = kpiEvidence ? (await repositories.kpiDefinitions.list()).find((d) => d.id === kpiEvidence.kpiDefinitionId) : null;

  const canAct = can(session, "ACKNOWLEDGE", "ALERTS");
  const isTelemetry = !!rule?.target.startsWith("telemetry:");
  const [transitions, notifications] = isTelemetry
    ? await Promise.all([repositories.ruleTransitions.listByAlert(alert.id), repositories.alertNotifications.listByAlert(alert.id)])
    : [[], []];
  const recipients = new Map((await repositories.users.list()).map((u) => [u.id, u.fullName]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Alertes", href: "/alertes" }, { label: rule?.name ?? anomaly.explanation.what }]}
        title={rule?.name ?? anomaly.explanation.what}
        meta={
          <>
            <AlertSeverityBadge severity={anomaly.severity} />
            <AlertStatusBadge status={alert.status} />
          </>
        }
        description={`${context} · Détectée le ${new Date(anomaly.detectedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}`}
        actions={
          lotId ? (
            <Link href={`/lots/${lotId}`} className="focus-ring text-sm font-medium text-bio-green hover:underline">
              Voir le lot →
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Explication</CardTitle>
              <CardDescription>{rule?.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ExplanationPanel explanation={anomaly.explanation} severity={anomaly.severity} confidence={anomaly.confidence} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Valeurs</CardTitle>
              <CardDescription>Observée vs référence, telles que calculées par le moteur de règles.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
              <ValueBlock label="Observée" value={anomaly.observedValue} unit={anomaly.unit} emphasis />
              <ValueBlock label="Référence attendue" value={anomaly.referenceValue} unit={anomaly.unit} />
              <ValueBlock label="Écart" value={anomaly.deviationPercent} unit="%" signed severity={anomaly.severity} />
            </CardContent>
          </Card>

          {kpiEvidence && kpiDefinition ? (
            <Card>
              <CardHeader>
                <CardTitle>Preuve KPI associée</CardTitle>
                <CardDescription>Valeur figée au moment de la détection — voir Phase 3 pour le modèle de provenance.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-secondary">
                <span>
                  <strong className="text-text">{kpiDefinition.label}</strong> : {kpiEvidence.value} {kpiDefinition.unit}
                </span>
                <span>Période : {kpiEvidence.period}</span>
                {/* Was printing the raw enum ("CALCULE") into a French interface. */}
                <span className="flex items-center gap-1.5">
                  Statut : <DataStatusBadge status={kpiEvidence.dataStatus} />
                </span>
                <span>Calculé le {new Date(kpiEvidence.calculatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}</span>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Traiter cette alerte</CardTitle>
              <CardDescription>Action recommandée : {recommendedAction(rule?.target)}</CardDescription>
            </CardHeader>
            <CardContent>
              {canAct ? (
                <AlertActionsPanel alertId={alert.id} status={alert.status} requiresOutcome={isTelemetry} />
              ) : (
                <p className="text-caption text-secondary">Lecture seule — votre rôle ne permet pas de traiter les alertes.</p>
              )}
              {alert.outcome ? <p className="mt-3 text-sm">Issue enregistrée : <strong>{OUTCOME_LABEL[alert.outcome]}</strong></p> : null}
            </CardContent>
          </Card>

          {isTelemetry ? (
            <Card>
              <CardHeader>
                <CardTitle>Escalade</CardTitle>
                <CardDescription>
                  Niveau {alert.escalationLevel ?? 1}
                  {alert.nextEscalationAt ? ` · niveau suivant le ${new Date(alert.nextEscalationAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} sans prise en compte` : " · aucune escalade en attente"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {notifications.length === 0 ? (
                  <p className="text-xs text-secondary">Aucune notification.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {notifications.map((n) => (
                      <li key={n.id}>
                        N{n.level} · {CHANNEL_LABEL[n.channel]} · {n.recipientId ? recipients.get(n.recipientId) ?? "—" : "—"} ·{" "}
                        <span className={n.status === "ENVOYE" ? "text-success-strong" : "text-warning-strong"}>{NOTIF_LABEL[n.status]}</span>
                        {n.detail ? <span className="block text-secondary">{n.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {isTelemetry ? (
            <Card>
              <CardHeader>
                <CardTitle>Changements d&apos;état</CardTitle>
                <CardDescription>Seuls les changements sont enregistrés ; l&apos;état à tout instant s&apos;en déduit.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-2 text-xs">
                  {transitions.map((t) => (
                    <li key={t.id} className="border-l-2 border-border pl-3">
                      <p className="font-medium">
                        {new Date(t.at).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })} — {RULE_STATE_LABEL[t.fromState]} → {RULE_STATE_LABEL[t.toState]}
                      </p>
                      <p className="text-secondary">{t.diagnosis}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Historique des actions</CardTitle>
            </CardHeader>
            <CardContent>
              {actions.length === 0 ? (
                <EmptyState title="Aucune action" description="Cette alerte n'a pas encore été traitée." />
              ) : (
                <ol className="flex flex-col gap-3">
                  {actions.map((action) => (
                    <li key={action.id} className="border-l-2 border-border pl-3 text-xs">
                      <p className="font-medium text-text">{actorNameById.get(action.actorId)}</p>
                      <p className="text-secondary">{new Date(action.performedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}</p>
                      <p className="mt-1 text-secondary">{action.description}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ValueBlock({
  label,
  value,
  unit,
  signed,
  emphasis,
  severity,
}: {
  label: string;
  value: number | null;
  unit: string | null;
  signed?: boolean;
  /** The measured value — the one the reader is looking for. */
  emphasis?: boolean;
  /** Colours the deviation to match the anomaly's own severity, rather than guessing from its sign. */
  severity?: AlertSeverity;
}) {
  const display = value === null ? "—" : `${signed && value > 0 ? "+" : ""}${value.toLocaleString("fr-FR")}${unit ? ` ${unit}` : ""}`;
  const tone =
    severity === "CRITICAL" ? "text-critical-strong" : severity === "WARNING" ? "text-warning-strong" : "text-text";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3">
      <span className="text-overline">{label}</span>
      <span className={`text-metric ${severity ? tone : ""} ${emphasis ? "" : "font-semibold"}`}>{display}</span>
    </div>
  );
}

function recommendedAction(target: string | undefined): string {
  if (!target) return "Vérifier la situation et documenter la décision.";
  if (target.startsWith("telemetry:")) return "Suivre le diagnostic ci-contre sur place, puis consigner l'intervention et son issue.";
  if (target.startsWith("sensor:")) return "Vérifier le capteur et le bâtiment concerné.";
  if (target === "iot:staleness") return "Vérifier la connectivité de l'appareil.";
  if (target === "population") return "Vérifier l'historique des événements du lot (mortalité, transferts).";
  if (target.startsWith("kpi:")) return "Examiner les enregistrements d'aliment et de pesée du lot.";
  return "Vérifier la situation et documenter la décision.";
}
