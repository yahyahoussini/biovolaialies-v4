import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { MARKING_ROUTE_LABEL, MARKING_RUN_STATUS_LABEL, shellCode } from "@/domain/marking/marking";
import { AppError } from "@/domain/shared/errors";
import { env } from "@/lib/env";
import { when } from "@/lib/flow-labels";
import { ratePct as pct, RUN_TONE } from "@/lib/marking-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getMarkingRun } from "@/services/marking/marking";
import { closeRunAction, liftStopAction, packTrayAction } from "../actions";
import { SimulateButtons } from "../SimulateButtons";

const n = (v: number) => v.toLocaleString("fr-FR");

export default async function MarkingRunPage({ params }: PageProps<"/marquage/[runId]">) {
  const session = await requireModuleAccess("MARKING");
  const { runId } = await params;
  let detail;
  try {
    detail = await getMarkingRun(runId, session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.kind === "AUTHORIZATION") redirect("/non-autorise");
    throw error;
  }
  const { run, line } = detail;
  const runField = { name: "runId", label: "Campagne", type: "select" as const, defaultValue: run.id, options: [{ value: run.id, label: run.code }] };
  const openStop = detail.stops.find((s) => !s.liftedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Marquage des œufs", href: "/marquage" }, { label: run.code }]}
        title={`Campagne ${run.code}`}
        description={`${line.code} — ${line.name}, ${detail.place}. ${MARKING_ROUTE_LABEL[run.route]}. Démarrée le ${when(run.startedAt)} par ${detail.startedByName}${run.endedAt ? `, close le ${when(run.endedAt)} par ${detail.endedByName ?? "—"}` : ""}.`}
        meta={<Badge tone={RUN_TONE[run.status]}>{MARKING_RUN_STATUS_LABEL[run.status]}</Badge>}
        actions={
          <>
            {detail.can.lift ? (
              <FormDialog
                title="Lever l'arrêt de lecture"
                description="Dites ce qui a été fait sur la tête d'impression et la caméra. La relecture repart sur une fenêtre neuve : les œufs mal lus avant le nettoyage ne comptent plus contre la ligne, mais restent enregistrés."
                triggerLabel="Lever l'arrêt"
                submitLabel="Relancer la ligne"
                action={liftStopAction}
                fields={[runField, { name: "note", label: "Ce qui a été fait", type: "textarea", required: true, placeholder: "Tête nettoyée, buse débouchée, essai sur 20 œufs relus…" }]}
              />
            ) : null}
            {detail.can.pack ? (
              <FormDialog
                title="Déclarer un plateau"
                description="Lisez le code du premier et du dernier œuf du plateau. Les œufs rejetés par la caméra entre les deux ne sont pas comptés."
                triggerLabel="Plateau"
                triggerVariant="secondary"
                action={packTrayAction}
                fields={[
                  runField,
                  { name: "firstCode", label: "Premier œuf", type: "text", required: true, half: true, placeholder: `${line.shellPrefix}…` },
                  { name: "lastCode", label: "Dernier œuf", type: "text", required: true, half: true },
                  { name: "capacity", label: "Œufs par plateau", type: "number", half: true, defaultValue: String(line.trayCapacity) },
                ]}
              />
            ) : null}
            {detail.can.close ? (
              <FormDialog
                title="Clore la campagne"
                description={`Les codes attribués et jamais imprimés (${n(detail.unused)}) ne resserviront pas. Plus d'œufs relus que la source n'en déclare : expliquez l'écart.`}
                triggerLabel="Clore"
                triggerVariant="secondary"
                submitLabel="Clore la campagne"
                action={closeRunAction}
                fields={[runField, { name: "note", label: "Note de clôture", type: "textarea" }]}
              />
            ) : null}
          </>
        }
      />

      {run.status === "ARRET_LECTURE" ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm font-medium text-critical-strong">
          Ligne arrêtée par le contrôle de lecture{openStop ? ` le ${when(openStop.stoppedAt)} : ${pct(openStop.rate)} des ${n(openStop.considered)} derniers œufs relus` : ""}, pour un seuil de {pct(line.readThreshold)}. Aucun code n&apos;est attribué tant que l&apos;arrêt n&apos;est pas levé : nettoyez la tête, vérifiez la caméra, puis levez l&apos;arrêt en disant ce qui a été fait.
        </p>
      ) : null}
      {detail.source.blocked ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning-strong">
          La ligne ne reçoit plus de codes pour ces œufs : {detail.source.blocked}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Imprimés et présentés à la caméra" value={n(run.printed)} hint={`${n(run.allocated)} codes attribués`} />
        <StatCard label="Relus" value={pct(detail.rate)} hint={`${n(run.readOk)} œufs`} tone={detail.rate !== null && detail.rate < line.readThreshold ? "warning" : "default"} />
        <StatCard label="Rejetés à la caméra" value={n(run.readKo)} hint="sortis par le rejet" tone={run.readKo > 0 ? "warning" : "default"} />
        {run.route === "B_CONSOMMATION" ? (
          <StatCard label="Plateaux" value={n(detail.trayTotals.trays)} hint={`${n(detail.trayTotals.eggs)} œufs conditionnés${run.readOk > detail.trayTotals.eggs ? `, ${n(run.readOk - detail.trayTotals.eggs)} relus hors plateau` : ""}`} />
        ) : (
          <StatCard label="Source" value={detail.source.code} hint={detail.source.detail} />
        )}
        <StatCard label="Fenêtre de relecture" value={pct(detail.guard.rate)} hint={`${n(detail.guard.considered)} derniers œufs, seuil ${pct(line.readThreshold)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Œufs marqués</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              <span className="text-secondary">Source : </span>
              <Link href={detail.source.href} className="font-semibold text-deep-green underline-offset-2 hover:underline">
                {detail.source.code}
              </Link>{" "}
              — {detail.source.detail}
            </p>
            <p>
              <span className="text-secondary">Codes : </span>
              {detail.firstCode ? (
                <span className="font-mono">
                  {detail.firstCode} → {detail.lastCode}
                </span>
              ) : (
                "aucun code attribué"
              )}
            </p>
            <p className="text-secondary">
              Code de coquille : préfixe de ligne <span className="font-mono text-text">{line.shellPrefix}</span>, numéro de 6 caractères, 1 caractère de contrôle — un caractère mal lu ou deux caractères inversés sont refusés, jamais devinés.
            </p>
            {run.notes ? <p>Notes : {run.notes}</p> : null}
            {run.closeNote ? <p>Clôture : {run.closeNote}</p> : null}
            {detail.can.simulate && env.DEMO_MODE ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-gold/45 bg-gold/10 p-3">
                <p className="text-caption font-medium text-deep-forest">Démonstration : le serveur joue le contrôleur de ligne, par les mêmes fonctions que l&apos;API de la machine.</p>
                <SimulateButtons runId={run.id} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Arrêts de lecture</CardTitle>
            <CardDescription>Chaque arrêt automatique, et qui a relancé la ligne après avoir fait quoi.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arrêt</TableHead>
                  <TableHead>Relecture</TableHead>
                  <TableHead>Relance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.stops.length === 0 ? <TableEmpty colSpan={3}>Aucun arrêt.</TableEmpty> : null}
                {detail.stops.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{when(s.stoppedAt)}</TableCell>
                    <TableCell>
                      {pct(s.rate)} sur {n(s.considered)} œufs
                    </TableCell>
                    <TableCell>
                      {s.liftedAt ? (
                        <>
                          {when(s.liftedAt)} — {s.liftedByName ?? "—"}
                          <p className="text-caption text-secondary">{s.liftNote}</p>
                        </>
                      ) : (
                        <Badge tone="critical">En attente</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Relevés de la caméra</CardTitle>
          <CardDescription>Les 30 derniers envois du contrôleur de ligne : une plage de codes imprimés, et ceux que la caméra n&apos;a pas pu relire.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lu le</TableHead>
                <TableHead>Codes</TableHead>
                <TableHead className="text-right">Relus</TableHead>
                <TableHead className="text-right">Rejetés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.batches.length === 0 ? <TableEmpty colSpan={4}>Aucun relevé reçu.</TableEmpty> : null}
              {detail.batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{when(b.readAt)}</TableCell>
                  <TableCell className="font-mono text-caption">
                    {shellCode(line.shellPrefix, b.firstSerial)} → {shellCode(line.shellPrefix, b.lastSerial)}
                  </TableCell>
                  <TableCell className="text-right">{n(b.ok)}</TableCell>
                  <TableCell className={`text-right ${b.ko > 0 ? "font-semibold text-warning-strong" : ""}`}>{n(b.ko)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Codes à part</CardTitle>
            <CardDescription>
              {n(detail.rejectedCount)} œuf{detail.rejectedCount > 1 ? "s" : ""} rejeté{detail.rejectedCount > 1 ? "s" : ""} par la caméra{run.route === "A_COUVER" ? ", et les rebuts du mirage identifiés par leur code" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.rejected.length === 0 ? <p className="text-sm text-secondary">Aucun.</p> : null}
            <ul className="flex flex-wrap gap-1.5">
              {detail.rejected.map((r) => (
                <li key={`${r.code}-${r.kind}`} className={`rounded-md border px-2 py-0.5 font-mono text-caption ${r.kind === "ILLISIBLE" ? "border-warning/40 bg-warning/10" : "border-border bg-background"}`} title={r.kind === "ILLISIBLE" ? `Illisible — ${when(r.at)}` : `Rebut au mirage — ${when(r.at)}`}>
                  {r.code}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {run.route === "B_CONSOMMATION" ? (
          <Card>
            <CardHeader>
              <CardTitle>Plateaux</CardTitle>
              <CardDescription>Chaque plateau a son identifiant BIOVOLAILLES ; le QR de son étiquette ouvre la page publique de l&apos;œuf.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plateau</TableHead>
                    <TableHead>Codes</TableHead>
                    <TableHead className="text-right">Œufs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.trays.length === 0 ? <TableEmpty colSpan={3}>Aucun plateau.</TableEmpty> : null}
                  {detail.trays.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/tracabilite/oeuf/${t.bvuId}`} className="font-mono text-caption text-deep-green underline-offset-2 hover:underline">
                          {t.bvuId}
                        </Link>
                        <p className="text-caption text-secondary">{when(t.packedAt)}</p>
                      </TableCell>
                      <TableCell className="font-mono text-caption">
                        {t.firstCode} → {t.lastCode}
                      </TableCell>
                      <TableCell className="text-right">
                        {t.eggCount}/{t.capacity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
