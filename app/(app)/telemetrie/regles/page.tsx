import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { SENSOR_CATALOG } from "@/domain/telemetry/catalog";
import { EVALUATORS, RULE_LABEL } from "@/domain/telemetry/rules/index";
import { requireModuleAccess } from "@/services/auth/guard";
import { activeRuleStates } from "@/services/telemetry/queries";
import { listRuleSettings } from "@/services/telemetry/settings";
import { saveRuleSettingsAction } from "../actions";

const ORIGIN = {
  CLIENT: { label: "Document client", tone: "success" },
  REGLEMENT_UE: { label: "Réf. UE 2007/43/CE", tone: "info" },
  HYPOTHESE: { label: "Hypothèse à valider", tone: "warning" },
} as const;

export default async function RulesPage() {
  const session = await requireModuleAccess("IOT");
  const [settings, states] = await Promise.all([listRuleSettings(session), activeRuleStates(session)]);
  const canEdit = can(session, "VALIDATE", "IOT");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Règles" }]}
        title="Moteur de règles"
        description="Chaque capteur alimente une décision (document 2). Les seuils se changent ici, sans redéploiement ; chaque changement est journalisé avec les valeurs avant et après. Chaque valeur dit d'où elle vient."
      />
      <TelemetryTabs active="/telemetrie/regles" />
      <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-strong">
        Les valeurs marquées « hypothèse à valider » sont des points de départ : les documents du client n&apos;en donnent pas. Elles doivent être fixées par le
        technicien avicole avant la mise en service. Seuls le seuil d&apos;ammoniac et de CO₂ reprennent une référence réglementaire (poulet de chair, UE) — à
        confirmer pour le beldi.
      </p>

      {settings.map(({ rule, params, effective, updatedAt }) => {
        const evaluator = EVALUATORS.find((e) => e.code === rule);
        const sensors = SENSOR_CATALOG.filter((s) => s.rules.includes(rule));
        const open = states.filter((s) => s.ruleCode === rule);
        return (
          <Card key={rule}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{RULE_LABEL[rule]}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {evaluator && !evaluator.raisesAlerts ? <Badge tone="info">Indicateur — n&apos;alerte personne</Badge> : null}
                  {open.length ? <Badge tone={open.some((s) => s.state === "CRITIQUE") ? "critical" : "warning"}>{open.length} hors normale</Badge> : <Badge tone="success">Normal</Badge>}
                  {canEdit && params.length ? (
                    <FormDialog
                      title={`Paramètres — ${RULE_LABEL[rule]}`}
                      description="Valeurs applicables à tous les bâtiments à partir de la prochaine évaluation."
                      triggerLabel="Modifier"
                      triggerVariant="secondary"
                      action={saveRuleSettingsAction}
                      fields={[
                        { name: "rule", label: "Règle", type: "select", defaultValue: rule, options: [{ value: rule, label: RULE_LABEL[rule] }] },
                        ...params.map((p) => ({
                          name: p.key,
                          label: `${p.label}${p.unit ? ` (${p.unit})` : ""}`,
                          type: "text" as const,
                          defaultValue: String(effective[p.key]),
                          half: true,
                        })),
                      ]}
                    />
                  ) : null}
                </div>
              </div>
              <CardDescription>
                {sensors.length ? `Capteurs : ${sensors.map((s) => `${s.ref} ${s.label}`).join(" · ")}` : "Santé des capteurs et des passerelles, jugée contre l'horloge."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {sensors.map((s) => (
                <p key={s.ref} className="text-sm">
                  <span className="font-medium">{s.ref} — décision déclenchée :</span> {s.decision}
                </p>
              ))}
              {params.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paramètre</TableHead>
                      <TableHead>En vigueur</TableHead>
                      <TableHead>Défaut</TableHead>
                      <TableHead>Origine du défaut</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {params.map((p) => (
                      <TableRow key={p.key}>
                        <TableCell>{p.label}</TableCell>
                        <TableCell className="font-medium">
                          {String(effective[p.key])} {p.unit}
                        </TableCell>
                        <TableCell className="text-secondary">
                          {String(p.default)} {p.unit}
                        </TableCell>
                        <TableCell>
                          <Badge tone={ORIGIN[p.origin].tone}>{ORIGIN[p.origin].label}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              {updatedAt ? <p className="text-xs text-secondary">Modifié le {new Date(updatedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}</p> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
