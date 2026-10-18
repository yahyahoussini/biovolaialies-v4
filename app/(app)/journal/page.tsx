import { Download, Link2 } from "lucide-react";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { listRecentLedgerEvents, verifyLedger } from "@/services/ledger/ledger";
import { AnchorVerifier } from "./AnchorVerifier";

export default async function LedgerPage() {
  const session = await requireModuleAccess("INTEGRITY");
  const [verification, recent] = await Promise.all([verifyLedger(session), listRecentLedgerEvents(session, 100)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Journal chaîné" }]}
        title="Journal d'événements chaîné"
        description="Chaque mutation est inscrite en ajout seul ; chaque entrée contient l'empreinte de la précédente. Toute modification, suppression ou réordonnancement est détecté."
        actions={
          can(session, "EXPORT", "INTEGRITY") && verification.ok ? (
            <Button asChild size="sm" variant="secondary">
              <a href="/journal/ancre">
                <Download className="size-4" aria-hidden="true" />
                Télécharger une ancre signée
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Intégrité" value={verification.ok ? "Intègre" : "Rompue"} icon={Link2} tone={verification.ok ? "success" : "critical"} hint={verification.reason ?? undefined} />
        <StatCard label="Événements" value={verification.count} />
        <StatCard label="Empreinte de tête" value={`${verification.headHash.slice(0, 12)}…`} hint={`n° ${verification.headSeq}`} />
      </div>

      {!verification.ok ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-4 text-sm text-critical-strong">
          Rupture détectée à l&apos;événement n° {verification.brokenAtSeq} : {verification.reason} Les ancres ne peuvent plus être
          émises tant que l&apos;écart n&apos;est pas expliqué.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Vérification externe</CardTitle>
          <p className="text-xs text-secondary">
            Une ancre conservée hors de la plateforme (archivée, envoyée à un auditeur) permet de prouver que l&apos;historique
            n&apos;a pas été entièrement réécrit depuis sa date d&apos;émission.
          </p>
        </CardHeader>
        <CardContent>
          <AnchorVerifier />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>100 derniers événements</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Enregistré le</TableHead>
                <TableHead>Événement</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Acteur</TableHead>
                <TableHead>Empreinte</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.seq}</TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(e.recordedAt).toLocaleString("fr-FR")}</TableCell>
                  <TableCell>{e.eventType}</TableCell>
                  <TableCell className="font-mono text-xs">{e.objectType}</TableCell>
                  <TableCell>{e.actorKind === "USER" ? "Utilisateur" : e.actorKind === "API_CLIENT" ? "Client API" : "Système"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.hash.slice(0, 16)}…</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
