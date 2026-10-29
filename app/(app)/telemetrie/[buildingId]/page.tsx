import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MultiLineChart } from "@/components/domain/LazyCharts";
import { PageHeader } from "@/components/domain/PageHeader";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { recipeFor } from "@/domain/equipment/recipes";
import { AuthorizationError, NotFoundError } from "@/domain/shared/errors";
import { canAccessModule } from "@/domain/shared/permissions";
import { READING_FLAG_LABEL } from "@/domain/telemetry/ingest";
import { RULE_STATE_LABEL, SENSOR_TYPE_LABEL, SITE_EVENT_LABEL, ZONE_KIND_LABEL, unitLabel } from "@/domain/telemetry/labels";
import { RULE_LABEL } from "@/domain/telemetry/rules/index";
import { requireModuleAccess } from "@/services/auth/guard";
import { commissioningResults } from "@/services/equipment/commissioning";
import { buildingTelemetry } from "@/services/telemetry/queries";

const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" }) : "—");
const fmt = (v: number | null, digits = 1) => (v === null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: digits }));

export default async function BuildingTelemetryPage({ params }: PageProps<"/telemetrie/[buildingId]">) {
  const session = await requireModuleAccess("IOT");
  const { buildingId } = await params;
  let data: Awaited<ReturnType<typeof buildingTelemetry>>;
  try {
    data = await buildingTelemetry(buildingId, session);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthorizationError) redirect("/non-autorise");
    throw error;
  }
  const { building, farm, gateway, channels, zoneRows, states, transitions, events, windowEnd, temperatureSeries } = data;
  // Document 2, annex A: a sensor whose commissioning test is not recorded does not count as installed.
  const { latest: tests, status: reception } = await commissioningResults(building.id);
  const receptionBadge = reception.applicable ? (
    <Badge tone={reception.complete ? "success" : "warning"}>
      Recettes : {reception.conforming} / {reception.applicable} conformes
    </Badge>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: building.code }]}
        title={`${building.name} (${building.code})`}
        description={`${farm?.name ?? "—"} · passerelle ${gateway?.code ?? "aucune"} · dernière communication ${when(gateway?.lastCommunicationAt)} · horloge ${gateway?.clockOffsetSeconds ?? "—"} s`}
        meta={
          receptionBadge && canAccessModule(session, "EQUIPMENT") ? (
            <Link href={`/equipements/recette?batiment=${building.id}`} className="focus-ring rounded-full">
              {receptionBadge}
            </Link>
          ) : (
            receptionBadge
          )
        }
      />
      <TelemetryTabs active="/telemetrie" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Température par zone — moyennes horaires sur 3 jours</CardTitle>
            <CardDescription>Capteurs A01 à 8,5 m, 25 m et 41,5 m du pignon : l&apos;écart entre zones est ce qu&apos;une moyenne unique cache.</CardDescription>
          </CardHeader>
          <CardContent>
            <MultiLineChart series={temperatureSeries} unit="°C" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Zones et occupation</CardTitle>
            <CardDescription>Lot présent au {when(windowEnd)} selon la table d&apos;occupation.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {zoneRows.map(({ zone, lot }) => (
                <li key={zone.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span>
                    {zone.name}
                    <span className="block text-xs text-secondary">
                      {zone.code} · {ZONE_KIND_LABEL[zone.kind]}
                    </span>
                  </span>
                  {lot ? (
                    <Link href={`/lots/${lot.id}`} className="text-xs font-medium text-bio-green hover:underline">
                      {lot.code}
                    </Link>
                  ) : (
                    <span className="text-xs text-secondary">Aucun lot</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Voies de mesure ({channels.length})</CardTitle>
          <CardDescription>
            Statistiques des 24 h précédant la dernière mesure, calculées sur les agrégats de 15 minutes (minimum, maximum, moyenne, écart-type et disponibilité — pas
            seulement la moyenne).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Réf.</TableHead>
                <TableHead>Voie</TableHead>
                <TableHead>Pose</TableHead>
                <TableHead>Fréquence</TableHead>
                <TableHead>Dernière valeur</TableHead>
                <TableHead>Moy. · min–max · σ (24 h)</TableHead>
                <TableHead>Disponibilité</TableHead>
                <TableHead>Recette</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c) => {
                const u = unitLabel(c.sensor.unit);
                const flag = c.last?.qualityFlag;
                return (
                  <TableRow key={c.sensor.id}>
                    <TableCell className="font-medium">{c.ref}</TableCell>
                    <TableCell>
                      {SENSOR_TYPE_LABEL[c.sensor.sensorType]}
                      <span className="block text-xs text-secondary">{c.sensor.code}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.zone?.name ?? "—"}
                      <span className="block text-secondary">
                        {c.sensor.position ?? ""}
                        {c.sensor.mountingHeightM ? ` · h ${c.sensor.mountingHeightM.toLocaleString("fr-FR")} m` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 text-xs">{c.frequency}</TableCell>
                    <TableCell>
                      {c.last ? `${fmt(c.last.value, 2)} ${u}` : "—"}
                      <span className="block text-xs text-secondary">{when(c.last?.capturedAt)}</span>
                      {flag && flag !== "OK" ? <Badge tone="warning">{READING_FLAG_LABEL[flag as keyof typeof READING_FLAG_LABEL]}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {fmt(c.stats24h.mean, 2)} · {fmt(c.stats24h.min, 2)}–{fmt(c.stats24h.max, 2)} · σ {fmt(c.stats24h.stddev, 2)}
                    </TableCell>
                    <TableCell>
                      {c.availability24h === null ? (
                        <span className="text-xs text-secondary">Non périodique</span>
                      ) : (
                        <Badge tone={c.availability24h >= 0.98 ? "success" : c.availability24h >= 0.9 ? "warning" : "critical"}>{fmt(c.availability24h * 100)} %</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!c.ref || !recipeFor(c.ref) ? (
                        <span className="text-xs text-secondary">—</span>
                      ) : tests.get(c.ref)?.result === "CONFORME" ? (
                        <Badge tone="success">Conforme</Badge>
                      ) : tests.get(c.ref)?.result === "NON_CONFORME" ? (
                        <Badge tone="critical">Non conforme</Badge>
                      ) : (
                        <Badge tone="warning">Non réceptionné</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Règles hors normale</CardTitle>
          </CardHeader>
          <CardContent>
            {states.length === 0 ? (
              <p className="text-sm text-secondary">Aucune.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {states.map((s) => (
                  <li key={s.id}>
                    <Badge tone={s.state === "CRITIQUE" ? "critical" : "warning"}>{RULE_STATE_LABEL[s.state]}</Badge> {RULE_LABEL[s.ruleCode as keyof typeof RULE_LABEL] ?? s.ruleCode}
                    <span className="block text-xs text-secondary">depuis le {when(s.since)}</span>
                    {s.openAlertId ? (
                      <Link className="text-xs text-bio-green hover:underline" href={`/alertes/${s.openAlertId}`}>
                        Alerte →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-4 text-sm font-semibold">Changements d&apos;état</h3>
            <ol className="mt-2 flex flex-col gap-2 text-xs">
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
        <Card>
          <CardHeader>
            <CardTitle>Événements de site</CardTitle>
            <CardDescription>Accès, alarme GSM autonome, thermostat de sécurité, livraisons détectées. La vidéo reste sur site : seule sa référence remonte.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-xs">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{when(e.occurredAt)}</span> — {SITE_EVENT_LABEL[e.kind]}
                  {e.badge ? ` · badge ${e.badge}` : ""}
                  {e.payload && "deliveredKg" in e.payload ? ` · ${String(e.payload.deliveredKg)} kg` : ""}
                  {e.mediaRef ? ` · ${e.mediaRef}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
