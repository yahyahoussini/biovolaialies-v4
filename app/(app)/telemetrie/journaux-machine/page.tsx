import { FileDown } from "lucide-react";
import Link from "next/link";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { env } from "@/lib/env";
import { requireModuleAccess } from "@/services/auth/guard";
import { incubatorTargets, listMachineImports, MACHINE_FEED_LABEL, MAX_LOG_BYTES } from "@/services/telemetry/machine-import";
import { FeedSwitch } from "./FeedSwitch";
import { MachineLogImport } from "./MachineLogImport";
import { VerifyImportButton } from "./VerifyImportButton";

const short = (v: string | null) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function MachineLogsPage() {
  const session = await requireModuleAccess("IOT");
  const [targets, imports] = await Promise.all([incubatorTargets(session), listMachineImports(session, 50)]);
  const canEdit = can(session, "EDIT", "IOT");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Journaux machine" }]}
        title="Journaux des incubateurs"
        description="Ce que la machine affiche, face à ce que mesurent les sondes indépendantes H06. Trois chemins (document 3, lot 13) : la passerelle lit la machine en Modbus RTU quand sa plaque indique une sortie de communication ; l'API du constructeur, à confirmer sur les plaques ; à défaut, le journal exporté par la machine (clé USB) est importé ici. Chaque fichier est enregistré avec l'empreinte SHA-256 des octets reçus, et les mesures stockées sont ancrées au journal chaîné."
      />
      <TelemetryTabs active="/telemetrie/journaux-machine" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Incubateurs" value={targets.length} />
        <StatCard label="Lus par fichier" value={targets.filter((t) => t.feed === "FICHIER").length} hint="Sans lecture directe de la machine" />
        <StatCard label="Imports affichés" value={imports.length} />
        <StatCard label="Mesures importées" value={imports.reduce((n, i) => n + i.accepted, 0).toLocaleString("fr-FR")} />
      </div>

      {targets.length === 0 ? (
        <EmptyState title="Aucun incubateur raccordé" description="Équipez un couvoir depuis l'écran Télémétrie : chaque incubateur reçoit ses sondes indépendantes et sa voie machine." />
      ) : (
        <Table caption="Incubateurs et lecture de la machine">
          <TableHeader>
            <TableRow>
              <TableHead>Incubateur</TableHead>
              <TableHead>Bâtiment</TableHead>
              <TableHead>Lecture de la machine</TableHead>
              <TableHead>Sondes indépendantes</TableHead>
              <TableHead>Dernier import</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((t) => (
              <TableRow key={t.zone.id}>
                <TableCell className="font-medium">
                  {t.zone.name}
                  <span className="block font-mono text-caption text-secondary">{t.zone.code}</span>
                </TableCell>
                <TableCell>{t.buildingLabel}</TableCell>
                <TableCell>
                  <Badge tone={t.feed === "FICHIER" ? "info" : "success"}>{MACHINE_FEED_LABEL[t.feed]}</Badge>
                </TableCell>
                <TableCell>{t.probes}</TableCell>
                <TableCell className="text-xs">
                  {t.lastImport ? (
                    <Link className="focus-ring text-bio-green hover:underline" href={`/telemetrie/journaux-machine/${t.lastImport.id}`}>
                      {short(t.lastImport.fromAt)} → {short(t.lastImport.toAt)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-start gap-2">
                    {canEdit ? <FeedSwitch zoneId={t.zone.id} feed={t.feed} /> : null}
                    <a className="focus-ring inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption font-medium text-bio-green hover:underline" href={`/api/journaux-machine/exemple?zone=${encodeURIComponent(t.zone.id)}`}>
                      <FileDown className="size-3.5" aria-hidden="true" />
                      Exemple de journal
                    </a>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canEdit && targets.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Importer un journal</CardTitle>
            <CardDescription>
              Le fichier est lu dans le navigateur avec le même lecteur que le serveur : vérifiez le séparateur, les colonnes et l&apos;horloge de la machine sur l&apos;aperçu, puis importez. Les lignes illisibles sont signalées avec leur numéro, jamais
              ignorées en silence. {Math.round(MAX_LOG_BYTES / 1024 / 1024)} Mo au plus par fichier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MachineLogImport
              maxBytes={MAX_LOG_BYTES}
              demo={env.DEMO_MODE}
              targets={targets.map((t) => ({ zoneId: t.zone.id, label: `${t.zone.name} (${t.zone.code})`, channels: t.machine.map((m) => ({ sensorType: m.sensorType, label: m.label })), lastProfile: t.lastProfile }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Table caption="Registre des imports">
        <TableHeader>
          <TableRow>
            <TableHead>Importé le, par</TableHead>
            <TableHead>Incubateur, fichier</TableHead>
            <TableHead>Période</TableHead>
            <TableHead>Lignes</TableHead>
            <TableHead>Enregistrées</TableHead>
            <TableHead>Déjà en base</TableHead>
            <TableHead>Non lues</TableHead>
            <TableHead>Signalées</TableHead>
            <TableHead>Nature</TableHead>
            <TableHead>Intégrité</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-secondary">
                Aucun import pour l&apos;instant.
              </TableCell>
            </TableRow>
          ) : (
            imports.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="text-xs">
                  <Link className="focus-ring font-medium text-bio-green hover:underline" href={`/telemetrie/journaux-machine/${i.id}`}>
                    {short(i.importedAt)}
                  </Link>
                  <span className="block text-secondary">{i.importedByName}</span>
                </TableCell>
                <TableCell className="max-w-56 text-xs">
                  <span className="font-mono">{i.zoneCode}</span>
                  <span className="block truncate text-secondary" title={i.fileName}>
                    {i.fileName}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {short(i.fromAt)} → {short(i.toAt)}
                </TableCell>
                <TableCell>{i.lines.toLocaleString("fr-FR")}</TableCell>
                <TableCell>{i.accepted.toLocaleString("fr-FR")}</TableCell>
                <TableCell>{i.duplicates.toLocaleString("fr-FR")}</TableCell>
                <TableCell>{i.rejected ? <Badge tone="warning">{i.rejected}</Badge> : 0}</TableCell>
                <TableCell>{i.flagged ? <Badge tone="warning">{i.flagged}</Badge> : 0}</TableCell>
                <TableCell>
                  <DataStatusBadge status={i.dataStatus} />
                </TableCell>
                <TableCell>
                  <VerifyImportButton importId={i.id} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
