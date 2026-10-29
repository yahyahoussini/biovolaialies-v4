import { notFound } from "next/navigation";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { AppError } from "@/domain/shared/errors";
import { LOG_TIME_ZONE_LABEL, type LogProfile } from "@/domain/telemetry/machine-log";
import { SENSOR_TYPE_LABEL } from "@/domain/telemetry/labels";
import type { SensorType } from "@/domain/shared/enums";
import { requireModuleAccess } from "@/services/auth/guard";
import { getMachineImport, MACHINE_FEED_LABEL } from "@/services/telemetry/machine-import";
import { VerifyImportButton } from "../VerifyImportButton";

const when = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" }) : "—");
const hour = (v: string) => new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const deg = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} °C`);
const DELIMITER_LABEL: Record<string, string> = { ";": "point-virgule", ",": "virgule", "\t": "tabulation" };

export default async function MachineImportPage({ params }: { params: Promise<{ importId: string }> }) {
  const session = await requireModuleAccess("IOT");
  const { importId } = await params;
  let data: Awaited<ReturnType<typeof getMachineImport>>;
  try {
    data = await getMachineImport(importId, session);
  } catch (error) {
    // Another site's import is answered like one that does not exist.
    if (error instanceof AppError && (error.kind === "NOT_FOUND" || error.kind === "AUTHORIZATION")) notFound();
    throw error;
  }
  const { row, comparison, feed } = data;
  const profile = row.profile as unknown as LogProfile;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Journaux machine", href: "/telemetrie/journaux-machine" }, { label: row.fileName }]}
        title={`Journal ${row.zoneCode} — ${row.fileName}`}
        description={`${row.zoneName}, ${row.buildingLabel}. Importé le ${when(row.importedAt)} par ${row.importedByName}. Lecture actuelle de la machine : ${MACHINE_FEED_LABEL[feed].toLowerCase()}.`}
        meta={<DataStatusBadge status={row.dataStatus} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Lignes de données" value={row.lines.toLocaleString("fr-FR")} />
        <StatCard label="Mesures enregistrées" value={row.accepted.toLocaleString("fr-FR")} tone="success" />
        <StatCard label="Déjà en base" value={row.duplicates.toLocaleString("fr-FR")} hint="Même voie, même instant : non réécrites" />
        <StatCard label="Lignes non lues" value={row.rejected.toLocaleString("fr-FR")} tone={row.rejected ? "warning" : "default"} />
        <StatCard label="Mesures signalées" value={row.flagged.toLocaleString("fr-FR")} tone={row.flagged ? "warning" : "default"} hint="Stockées, exclues des moyennes" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Machine face aux sondes indépendantes</CardTitle>
          <CardDescription>
            Moyennes horaires de la température affichée par la machine et des sondes H06 du chariot (haut, milieu, bas ; la reprise d&apos;air est écartée, comme dans la règle). Tolérance de la règle COUVOIR_POSITIONS pour ce bâtiment :{" "}
            {comparison ? `${comparison.tolerance.toLocaleString("fr-FR")} °C` : "—"}. Les règles avancent dans le temps : un journal importé après coup est jugé ici, sans alerte rétroactive.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!comparison ? (
            <p className="text-sm text-secondary">Pas de comparaison possible : il manque la voie machine, les sondes indépendantes, ou des mesures utilisables sur la période.</p>
          ) : (
            <>
              <p className="text-sm">
                {comparison.hours.length} heure(s) comparée(s){comparison.machineOnly ? `, ${comparison.machineOnly} sans mesure des sondes` : ""}. Écart moyen {deg(comparison.meanGap)}, écart le plus fort {deg(comparison.maxGap)}.{" "}
                {comparison.beyond ? (
                  <strong className="text-critical-strong">
                    {comparison.beyond} heure(s) au-delà de la tolérance, à partir de {hour(comparison.firstBeyondAt!)} : la machine régule peut-être sur une sonde qui dérive. Contrôlez sa sonde contre l&apos;étalon.
                  </strong>
                ) : (
                  <span className="text-success-strong">Machine et sondes concordent sur toute la période.</span>
                )}
              </p>
              <Table caption="Comparaison heure par heure">
                <TableHeader>
                  <TableRow>
                    <TableHead>Heure (Maroc)</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Sondes du chariot</TableHead>
                    <TableHead>Écart machine − sondes</TableHead>
                    <TableHead>Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.hours.map((h) => (
                    <TableRow key={h.at}>
                      <TableCell className="text-xs">{hour(h.at)}</TableCell>
                      <TableCell>{h.machine.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} °C</TableCell>
                      <TableCell>
                        {h.probes.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} °C <span className="text-caption text-secondary">({h.probeCount} sondes)</span>
                      </TableCell>
                      <TableCell className={h.beyond ? "font-semibold text-critical-strong" : undefined}>{deg(h.gap)}</TableCell>
                      <TableCell>{h.beyond ? <Badge tone="critical">Hors tolérance</Badge> : <Badge tone="success">Conforme</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fichier et lecture</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-secondary">Période</dt>
              <dd>
                {when(row.fromAt)} → {when(row.toAt)}
              </dd>
              <dt className="text-secondary">Taille, encodage</dt>
              <dd>
                {Math.round(row.bytes / 1024).toLocaleString("fr-FR")} Ko, {row.encoding}
              </dd>
              <dt className="text-secondary">Séparateur</dt>
              <dd>
                {DELIMITER_LABEL[profile.delimiter] ?? profile.delimiter}, décimales « {profile.decimal} »
              </dd>
              <dt className="text-secondary">Horodatage</dt>
              <dd>
                {profile.timeColumns.join(" + ")} ({profile.timeFormat}), {LOG_TIME_ZONE_LABEL[profile.timeZone] ?? profile.timeZone}
              </dd>
              <dt className="text-secondary">Colonnes importées</dt>
              <dd>
                {Object.entries(profile.channels)
                  .map(([type, column]) => `${column} → ${SENSOR_TYPE_LABEL[type as SensorType] ?? type}`)
                  .join(" ; ")}
              </dd>
              <dt className="text-secondary">SHA-256</dt>
              <dd className="break-all font-mono text-caption">{row.sha256}</dd>
              <dt className="text-secondary">Intégrité</dt>
              <dd>
                <VerifyImportButton importId={row.id} />
              </dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lignes non lues</CardTitle>
            <CardDescription>Signalées avec leur numéro dans le fichier ({row.errors.length >= 200 ? "200 premières" : "toutes"}).</CardDescription>
          </CardHeader>
          <CardContent>
            {row.errors.length === 0 ? (
              <p className="text-sm text-secondary">Toutes les lignes ont été lues.</p>
            ) : (
              <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto text-caption">
                {row.errors.map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    <span className="font-semibold">Ligne {e.line}</span> : {e.message}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
