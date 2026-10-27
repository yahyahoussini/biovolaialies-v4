import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { SEASON, type SensorType } from "@/domain/shared/enums";
import { MIN_HOURS_TO_LEARN, MIN_LOTS_TO_LEARN, SEASON_LABEL } from "@/domain/telemetry/bands";
import { SENSOR_TYPE_LABEL, unitLabel } from "@/domain/telemetry/labels";
import type { ReferenceBand } from "@/domain/telemetry/types";
import { requireModuleAccess } from "@/services/auth/guard";
import { listBands } from "@/services/telemetry/bands";
import { decideBandAction, saveBandAction } from "../actions";
import { LearnButton } from "./LearnButton";

const STATUS = {
  ACTIVE: { label: "En vigueur", tone: "success" },
  PROPOSEE: { label: "Proposée", tone: "info" },
  REMPLACEE: { label: "Remplacée", tone: "neutral" },
  REJETEE: { label: "Refusée", tone: "neutral" },
} as const;

const BAND_TYPES: SensorType[] = ["TEMPERATURE", "HUMIDITE", "CO2", "POIDS"];

function bandFields(b?: ReferenceBand) {
  return [
    ...(b ? [{ name: "bandId", label: "Bande remplacée", type: "select" as const, defaultValue: b.id, options: [{ value: b.id, label: `v${b.version}` }] }] : []),
    { name: "sensorType", label: "Grandeur", type: "select" as const, defaultValue: b?.sensorType ?? "TEMPERATURE", options: BAND_TYPES.map((t) => ({ value: t, label: SENSOR_TYPE_LABEL[t] })), half: true },
    { name: "productionLine", label: "Ligne de production", type: "text" as const, defaultValue: b?.productionLine ?? "CHAIR_FERMIER", half: true },
    { name: "ageDayFrom", label: "Âge de (jours)", type: "number" as const, defaultValue: String(b?.ageDayFrom ?? 0), half: true },
    { name: "ageDayTo", label: "Âge à (jours)", type: "number" as const, defaultValue: String(b?.ageDayTo ?? 150), half: true },
    { name: "season", label: "Saison", type: "select" as const, defaultValue: b?.season ?? "TOUTES", options: SEASON.map((s) => ({ value: s, label: SEASON_LABEL[s] })), half: true },
    { name: "unit", label: "Unité", type: "text" as const, defaultValue: b?.unit ?? "C", half: true },
    { name: "low", label: "Borne basse", type: "text" as const, defaultValue: b ? String(b.low) : "", half: true },
    { name: "high", label: "Borne haute", type: "text" as const, defaultValue: b ? String(b.high) : "", half: true },
    { name: "note", label: "Origine de la bande (technicien, essai, référence)", type: "textarea" as const, required: true },
  ];
}

export default async function BandsPage() {
  const session = await requireModuleAccess("IOT");
  const bands = await listBands(session);
  const canDecide = can(session, "VALIDATE", "IOT");
  const active = bands.filter((b) => b.status === "ACTIVE");
  const proposals = bands.filter((b) => b.status === "PROPOSEE");
  const history = bands.filter((b) => b.status === "REMPLACEE" || b.status === "REJETEE");
  const byId = new Map(bands.map((b) => [b.id, b]));
  const range = (b: ReferenceBand) => `${b.low.toLocaleString("fr-FR")} – ${b.high.toLocaleString("fr-FR")} ${unitLabel(b.unit)}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Bandes de référence" }]}
        title="Bandes de référence"
        description={`Aucune courbe publiée ne couvre le beldi (98 à 150 jours). Les premiers lots tournent sur des bandes larges du technicien, resserrées à chaque cycle terminé à partir de l'historique de l'exploitation — au moins ${MIN_LOTS_TO_LEARN} lots et ${MIN_HOURS_TO_LEARN} heures par fenêtre. Une bande apprise n'entre en vigueur qu'acceptée par un technicien.`}
        actions={canDecide ? <FormDialog title="Nouvelle bande du technicien" triggerLabel="Nouvelle bande" triggerVariant="secondary" action={saveBandAction} fields={bandFields()} /> : null}
      />
      <TelemetryTabs active="/telemetrie/bandes" />

      {canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>Apprentissage</CardTitle>
            <CardDescription>
              Percentiles 5–95 des moyennes horaires des lots terminés, par fenêtre d&apos;âge et saison. Les bons lots comme les mauvais comptent ; seules les heures
              d&apos;une alerte close comme « justifiée » sont écartées.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LearnButton />
          </CardContent>
        </Card>
      ) : null}

      {proposals.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Propositions à trancher ({proposals.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bande</TableHead>
                  <TableHead>En vigueur</TableHead>
                  <TableHead>Proposée</TableHead>
                  <TableHead>Base</TableHead>
                  {canDecide ? <TableHead className="text-right">Décision</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => {
                  const current = p.supersedesId ? byId.get(p.supersedesId) : undefined;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        {SENSOR_TYPE_LABEL[p.sensorType]} · {p.productionLine} · J{p.ageDayFrom}–J{p.ageDayTo} · {SEASON_LABEL[p.season]}
                      </TableCell>
                      <TableCell>{current ? range(current) : "—"}</TableCell>
                      <TableCell className="font-medium">{range(p)}</TableCell>
                      <TableCell className="text-xs">{p.note}</TableCell>
                      {canDecide ? (
                        <TableCell className="text-right">
                          <FormDialog
                            title="Trancher la proposition"
                            description={`${current ? range(current) : "—"} → ${range(p)}`}
                            triggerLabel="Trancher"
                            triggerVariant="ghost"
                            action={decideBandAction}
                            fields={[
                              { name: "proposalId", label: "Proposition", type: "select", defaultValue: p.id, options: [{ value: p.id, label: `v${p.version}` }] },
                              { name: "decision", label: "Décision", type: "select", required: true, options: [{ value: "ACCEPTER", label: "Mettre en vigueur" }, { value: "REFUSER", label: "Refuser" }] },
                            ]}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>En vigueur ({active.length})</CardTitle>
          <CardDescription>La plus précise s&apos;applique : ligne du lot avant « * », saison avant « toutes ». Sans bande, une valeur n&apos;est pas jugée — jamais de seuil par défaut inventé.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grandeur</TableHead>
                <TableHead>Ligne</TableHead>
                <TableHead>Âge</TableHead>
                <TableHead>Saison</TableHead>
                <TableHead>Bande</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Version</TableHead>
                {canDecide ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{SENSOR_TYPE_LABEL[b.sensorType]}</TableCell>
                  <TableCell>{b.productionLine}</TableCell>
                  <TableCell>
                    J{b.ageDayFrom}–J{b.ageDayTo}
                  </TableCell>
                  <TableCell>{SEASON_LABEL[b.season]}</TableCell>
                  <TableCell className="font-medium">{range(b)}</TableCell>
                  <TableCell>
                    <Badge tone={b.source === "APPRIS" ? "success" : "warning"}>{b.source === "APPRIS" ? `Apprise (${b.lotsUsed} lots)` : "Technicien"}</Badge>
                    {b.note ? <span className="block max-w-xs text-xs text-secondary">{b.note}</span> : null}
                  </TableCell>
                  <TableCell>v{b.version}</TableCell>
                  {canDecide ? (
                    <TableCell className="text-right">
                      <FormDialog title="Remplacer la bande" triggerLabel="Modifier" triggerVariant="ghost" action={saveBandAction} fields={bandFields(b)} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
            <CardDescription>Les versions remplacées sont conservées : une alerte passée se relit avec la bande qui était en vigueur à son instant.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-xs">
              {history.map((b) => (
                <li key={b.id}>
                  <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge> {SENSOR_TYPE_LABEL[b.sensorType]} · {b.productionLine} · J{b.ageDayFrom}–J{b.ageDayTo} · v{b.version} : {range(b)}
                  {b.decidedAt ? ` — ${new Date(b.decidedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
