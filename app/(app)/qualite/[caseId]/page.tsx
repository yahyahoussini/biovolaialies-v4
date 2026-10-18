import { Download } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { AppError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { ENTITY_TYPE_LABEL } from "@/lib/labels";
import { QUALITY_REASON_LABEL, QUALITY_SCOPE_LABEL, QUALITY_STATUS_LABEL, QUALITY_STATUS_TONE } from "@/lib/quality-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { listLedgerEventsForObject } from "@/services/ledger/ledger";
import { getQualityCase } from "@/services/quality/holds";
import { buildRecallReportForCase } from "@/services/quality/recall";
import { DecisionForm } from "./DecisionForm";

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString("fr-FR") : "—";
}

function qty(value: number | null, unit: string | null): string {
  return value === null ? "—" : `${value.toLocaleString("fr-FR")} ${unit ?? ""}`.trim();
}

export default async function QualityCasePage({ params }: PageProps<"/qualite/[caseId]">) {
  const session = await requireModuleAccess("QUALITY");
  const { caseId } = await params;

  let view;
  try {
    view = await getQualityCase(caseId, session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.kind === "AUTHORIZATION") redirect("/non-autorise");
    throw error;
  }
  const { qualityCase: qc } = view;
  const [report, ledger] = await Promise.all([
    buildRecallReportForCase(caseId, session),
    listLedgerEventsForObject(session, "quality_case", qc.id),
  ]);
  const canDecide = qc.status === "EN_BLOCAGE" && can(session, "VALIDATE", "QUALITY");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Qualité & rappels", href: "/qualite" }, { label: qc.code }]}
        title={`Dossier ${qc.code}`}
        description={`${view.root?.label ?? qc.rootType} — ${QUALITY_REASON_LABEL[qc.reason]}`}
        meta={<Badge tone={QUALITY_STATUS_TONE[qc.status]}>{QUALITY_STATUS_LABEL[qc.status]}</Badge>}
        actions={
          can(session, "EXPORT", "QUALITY") ? (
            <Button asChild size="sm" variant="secondary">
              <a href={`/qualite/${qc.id}/rappel`}>
                <Download className="size-4" aria-hidden="true" />
                Exporter le rappel (CSV)
              </a>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ouverture</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-secondary">Ouvert par</dt>
              <dd>{view.openedByName}</dd>
              <dt className="text-secondary">Le</dt>
              <dd>{fmt(qc.openedAt)}</dd>
              <dt className="text-secondary">Portée</dt>
              <dd>{QUALITY_SCOPE_LABEL[qc.scope]}</dd>
              <dt className="text-secondary">Cause</dt>
              <dd className="whitespace-pre-wrap">{qc.description}</dd>
              <dt className="text-secondary">Preuves</dt>
              <dd>{qc.evidenceRefs.length > 0 ? qc.evidenceRefs.join(", ") : "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Décision</CardTitle>
          </CardHeader>
          <CardContent>
            {qc.status !== "EN_BLOCAGE" ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-secondary">Décidé par</dt>
                <dd>{view.decidedByName}</dd>
                <dt className="text-secondary">Le</dt>
                <dd>{fmt(qc.decidedAt)}</dd>
                <dt className="text-secondary">Justification</dt>
                <dd className="whitespace-pre-wrap">{qc.decisionJustification}</dd>
                <dt className="text-secondary">Preuves</dt>
                <dd>{qc.decisionEvidenceRefs?.join(", ") ?? "—"}</dd>
              </dl>
            ) : canDecide ? (
              <DecisionForm caseId={qc.id} />
            ) : (
              <p className="text-sm text-secondary">
                En attente de décision d&apos;un responsable qualité (personne différente de celle qui a ouvert le dossier).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Objets couverts par le blocage ({view.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profondeur</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.depth === 0 ? "Racine" : item.depth}</TableCell>
                  <TableCell>{ENTITY_TYPE_LABEL[item.objectType as keyof typeof ENTITY_TYPE_LABEL] ?? item.objectType}</TableCell>
                  <TableCell>
                    {item.node?.href ? (
                      <Link href={item.node.href} className="text-bio-green underline">
                        {item.node.label}
                      </Link>
                    ) : (
                      (item.node?.label ?? item.objectId)
                    )}
                  </TableCell>
                  <TableCell>{item.active ? <Badge tone="critical">Bloqué</Badge> : <Badge tone="neutral">Levé</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Périmètre de rappel</CardTitle>
          <p className="text-xs text-secondary">
            Calculé le {fmt(report.computedAt)} en {report.durationMs} ms · {report.upstream.length} objet(s) en amont ·{" "}
            {report.downstream.length} en aval · {report.totals.destinationCount} destination(s)
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {report.totals.byUnit.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {report.totals.byUnit.map((t) => (
                <div key={t.unit} className="contents">
                  <div className="rounded-md border border-border p-3 text-sm">
                    <p className="text-secondary">Conditionné</p>
                    <p className="text-lg font-semibold">{qty(t.packaged, t.unit)}</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-sm">
                    <p className="text-secondary">Expédié (à rappeler)</p>
                    <p className="text-lg font-semibold text-critical-strong">{qty(t.shipped, t.unit)}</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-sm">
                    <p className="text-secondary">En stock (à retirer)</p>
                    <p className="text-lg font-semibold">{qty(t.onHand, t.unit)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {report.shipments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expédition</TableHead>
                  <TableHead>Produit</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Quantité</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.shipments.map((s) => (
                  <TableRow key={s.code}>
                    <TableCell>{s.code}</TableCell>
                    <TableCell>{s.productCode}</TableCell>
                    <TableCell>
                      {s.destinationName} — {s.destinationCity}
                    </TableCell>
                    <TableCell>{qty(s.quantity, s.unit)}</TableCell>
                    <TableCell>{new Date(s.shippedAt).toLocaleDateString("fr-FR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-card-title">Amont (origine possible de la cause)</p>
              <ul className="flex flex-col gap-1 text-sm">
                {report.upstream.length === 0 ? <li className="text-secondary">Aucun ascendant enregistré.</li> : null}
                {report.upstream.map((n) => (
                  <li key={`${n.type}:${n.id}`}>
                    <span className="text-secondary">{ENTITY_TYPE_LABEL[n.type]} ·</span> {n.code}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-card-title">Aval (à stopper ou retirer)</p>
              <ul className="flex flex-col gap-1 text-sm">
                {report.downstream.length === 0 ? <li className="text-secondary">Aucun dérivé enregistré.</li> : null}
                {report.downstream.map((n) => (
                  <li key={`${n.type}:${n.id}`}>
                    <span className="text-secondary">{ENTITY_TYPE_LABEL[n.type]} ·</span> {n.code}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {report.limits.length > 0 ? (
            <ul className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
              {report.limits.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trace au journal chaîné</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 font-mono text-xs">
            {ledger.map((e) => (
              <li key={e.id}>
                n° {e.seq} · {fmt(e.recordedAt)} · {String(e.payload.newValue ?? "")} · <span className="text-secondary">{e.hash.slice(0, 16)}…</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
