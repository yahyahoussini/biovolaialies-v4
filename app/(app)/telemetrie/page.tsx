import { Radio } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { repositories } from "@/data/repositories";
import { can } from "@/domain/shared/permissions";
import { READING_FLAG_LABEL } from "@/domain/telemetry/ingest";
import { RULE_STATE_LABEL } from "@/domain/telemetry/labels";
import { RULE_LABEL } from "@/domain/telemetry/rules/index";
import { requireModuleAccess } from "@/services/auth/guard";
import { activeRuleStates, recentTransitions, telemetryOverview } from "@/services/telemetry/queries";
import { provisionBuildingAction } from "./actions";

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);
const when = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" }) : "—");

export default async function TelemetryPage() {
  const session = await requireModuleAccess("IOT");
  const [buildings, states, transitions] = await Promise.all([telemetryOverview(session), activeRuleStates(session), recentTransitions(session, 40)]);
  const allBuildings = await repositories.buildings.list();
  const equipped = new Set(buildings.map((b) => b.buildingId));
  const buildingName = new Map(allBuildings.map((b) => [b.id, `${b.name} (${b.code})`]));
  const canProvision = can(session, "EDIT", "IOT") && can(session, "VIEW", "EQUIPMENT");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Télémétrie"
        description="Capteurs du document 2, reçus par passerelle, contrôlés, rattachés au lot par la table d'occupation, agrégés et jugés par les règles. Seuls les changements d'état sont enregistrés."
        actions={
          canProvision ? (
            <FormDialog
              title="Équiper un bâtiment"
              description="Crée la passerelle, les zones et les capteurs du cas de référence du document 2 (quantités à recalculer après relevé)."
              triggerLabel="Équiper un bâtiment"
              action={provisionBuildingAction}
              fields={[
                {
                  name: "buildingId",
                  label: "Bâtiment",
                  type: "select",
                  required: true,
                  options: allBuildings.filter((b) => !equipped.has(b.id)).map((b) => ({ value: b.id, label: `${b.name} (${b.code}) — ${b.zoneType}` })),
                },
                { name: "drinkingLines", label: "Lignes d'abreuvement", type: "number", defaultValue: "4", half: true },
                { name: "feedLines", label: "Lignes d'alimentation", type: "number", defaultValue: "2", half: true },
                { name: "incubators", label: "Incubateurs (couvoir uniquement)", type: "text", placeholder: "INC-1, INC-2" },
              ]}
            />
          ) : null
        }
      />
      <TelemetryTabs active="/telemetrie" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bâtiments raccordés" value={buildings.length} icon={Radio} />
        <StatCard label="Voies de mesure" value={buildings.reduce((n, b) => n + b.channels, 0)} />
        <StatCard label="Règles hors normale" value={states.length} tone={states.length ? "warning" : "success"} />
        <StatCard label="États critiques" value={states.filter((s) => s.state === "CRITIQUE").length} tone={states.some((s) => s.state === "CRITIQUE") ? "critical" : "success"} />
      </div>

      {buildings.length === 0 ? (
        <EmptyState icon={Radio} title="Aucun bâtiment raccordé" description="Équipez un bâtiment pour créer sa passerelle et ses capteurs." />
      ) : (
        <Table caption="Bâtiments raccordés">
          <TableHeader>
            <TableRow>
              <TableHead>Bâtiment</TableHead>
              <TableHead>Passerelle</TableHead>
              <TableHead>Horloge</TableHead>
              <TableHead>Voies</TableHead>
              <TableHead>Dernière mesure</TableHead>
              <TableHead>Disponibilité 24 h</TableHead>
              <TableHead>Mesures signalées 24 h</TableHead>
              <TableHead>Règles hors normale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.map((b) => (
              <TableRow key={b.buildingId}>
                <TableCell>
                  <Link href={`/telemetrie/${b.buildingId}`} className="focus-ring font-medium text-bio-green hover:underline">
                    {b.buildingLabel}
                  </Link>
                  <span className="block text-xs text-secondary">{b.farmName}</span>
                </TableCell>
                <TableCell>
                  {b.gateway?.code}
                  <span className="block text-xs text-secondary">{when(b.gateway?.lastCommunicationAt ?? null)}</span>
                </TableCell>
                <TableCell>
                  {b.gateway?.clockOffsetSeconds === null || b.gateway?.clockOffsetSeconds === undefined ? (
                    "—"
                  ) : Math.abs(b.gateway.clockOffsetSeconds) > 300 ? (
                    <Badge tone="critical">Dérive {b.gateway.clockOffsetSeconds} s</Badge>
                  ) : (
                    <Badge tone="success">{b.gateway.clockOffsetSeconds} s</Badge>
                  )}
                </TableCell>
                <TableCell>{b.channels}</TableCell>
                <TableCell>{when(b.lastReadingAt)}</TableCell>
                <TableCell>{pct(b.availability24h)}</TableCell>
                <TableCell className="text-xs">
                  {Object.keys(b.flagged24h).length === 0
                    ? "Aucune"
                    : Object.entries(b.flagged24h).map(([flag, n]) => (
                        <span key={flag} className="block">
                          {READING_FLAG_LABEL[flag as keyof typeof READING_FLAG_LABEL]} : {n}
                        </span>
                      ))}
                </TableCell>
                <TableCell>
                  {b.activeStates === 0 ? <Badge tone="success">Aucune</Badge> : <Badge tone={b.critical ? "critical" : "warning"}>{b.activeStates}</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-secondary">
        La disponibilité se calcule sur les 24 h précédant la dernière mesure reçue du bâtiment, contre l&apos;intervalle d&apos;acquisition de chaque capteur. Une
        mesure signalée (horloge, hors plage physique, capteur hors service, étalonnage échu, saut non physique) est conservée mais exclue des moyennes et des règles.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hors normale maintenant</CardTitle>
            <CardDescription>État courant de chaque règle sur chaque sujet surveillé.</CardDescription>
          </CardHeader>
          <CardContent>
            {states.length === 0 ? (
              <p className="text-sm text-secondary">Toutes les règles sont à l&apos;état normal.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {states.map((s) => (
                  <li key={s.id} className="rounded-md border border-border p-2">
                    <Badge tone={s.state === "CRITIQUE" ? "critical" : "warning"}>{RULE_STATE_LABEL[s.state]}</Badge>{" "}
                    <strong>{RULE_LABEL[s.ruleCode as keyof typeof RULE_LABEL] ?? s.ruleCode}</strong> — {buildingName.get(s.buildingId)}
                    <span className="block text-xs text-secondary">depuis le {when(s.since)}</span>
                    {s.openAlertId ? (
                      <Link href={`/alertes/${s.openAlertId}`} className="text-xs text-bio-green hover:underline">
                        Alerte ouverte →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Derniers changements d&apos;état</CardTitle>
            <CardDescription>Horodatés à l&apos;instant où la règle a basculé, y compris quand les données sont arrivées en rattrapage.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-xs">
              {transitions.map((t) => (
                <li key={t.id} className="border-l-2 border-border pl-3">
                  <p className="font-medium">
                    {when(t.at)} · {RULE_LABEL[t.ruleCode as keyof typeof RULE_LABEL] ?? t.ruleCode} · {RULE_STATE_LABEL[t.fromState]} → {RULE_STATE_LABEL[t.toState]}
                  </p>
                  <p className="text-secondary">{t.diagnosis}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
