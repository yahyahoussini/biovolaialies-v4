import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { TelemetryTabs } from "@/components/domain/TelemetryTabs";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { CLOCK_TOLERANCE_SECONDS, GATEWAY_BUFFER_DAYS } from "@/domain/telemetry/ingest";
import { requireModuleAccess } from "@/services/auth/guard";
import { ingestLog } from "@/services/telemetry/queries";
import { VerifyButton } from "./VerifyButton";

export default async function IngestionPage() {
  const session = await requireModuleAccess("IOT");
  const { gateways, messages } = await ingestLog(session);
  const backlog = messages.filter((m) => Date.parse(m.receivedAt) - Date.parse(m.sentAt) > CLOCK_TOLERANCE_SECONDS * 1000).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Télémétrie", href: "/telemetrie" }, { label: "Ingestion" }]}
        title="Journal d'ingestion"
        description={`Chaque message de passerelle reçu : horloge mesurée, mesures acceptées, doublons, rejets et mesures signalées. La passerelle conserve ${GATEWAY_BUFFER_DAYS} jours en tampon et les renvoie après une coupure ; un message déjà reçu est reconnu et n'est pas réappliqué. L'empreinte des mesures stockées est écrite au journal chaîné : « Vérifier » la recalcule depuis la base.`}
      />
      <TelemetryTabs active="/telemetrie/ingestion" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Passerelles" value={gateways.length} />
        <StatCard label="Messages affichés" value={messages.length} />
        <StatCard label="Mesures acceptées" value={messages.reduce((n, m) => n + m.accepted, 0).toLocaleString("fr-FR")} />
        <StatCard label="Messages hors tolérance d'horloge" value={backlog} hint={`Écart envoi/réception > ${CLOCK_TOLERANCE_SECONDS} s`} />
      </div>
      <Table caption="Derniers messages reçus">
        <TableHeader>
          <TableRow>
            <TableHead>Passerelle · n°</TableHead>
            <TableHead>Envoyé (passerelle)</TableHead>
            <TableHead>Reçu (serveur)</TableHead>
            <TableHead>Horloge</TableHead>
            <TableHead>Mesures / événements</TableHead>
            <TableHead>Acceptées</TableHead>
            <TableHead>Doublons</TableHead>
            <TableHead>Rejets</TableHead>
            <TableHead>Signalées</TableHead>
            <TableHead>Intégrité</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">
                {m.gatewayCode} · {m.seq}
              </TableCell>
              <TableCell className="text-xs">{new Date(m.sentAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}</TableCell>
              <TableCell className="text-xs">{new Date(m.receivedAt).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca" })}</TableCell>
              <TableCell>
                {m.clockOffsetSeconds === null ? "—" : <Badge tone={Math.abs(m.clockOffsetSeconds) > CLOCK_TOLERANCE_SECONDS ? "critical" : "success"}>{m.clockOffsetSeconds} s</Badge>}
              </TableCell>
              <TableCell>
                {m.readingCount} / {m.eventCount}
              </TableCell>
              <TableCell>{m.accepted}</TableCell>
              <TableCell>{m.duplicates}</TableCell>
              <TableCell>{m.rejected ? <Badge tone="critical">{m.rejected}</Badge> : 0}</TableCell>
              <TableCell>{m.flagged ? <Badge tone="warning">{m.flagged}</Badge> : 0}</TableCell>
              <TableCell>
                <VerifyButton messageId={m.id} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
