import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { needsDecision, RESULT_INTERPRETATION, RESULT_INTERPRETATION_LABEL, SAMPLE_MATRIX_LABEL, SAMPLE_OBJECT_LABEL, SAMPLE_REASON_LABEL, SAMPLE_STATUS_LABEL } from "@/domain/lab/lab";
import { AppError } from "@/domain/shared/errors";
import { day, when } from "@/lib/flow-labels";
import { INTERPRETATION_TONE, SAMPLE_STATUS_TONE } from "@/lib/lab-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getLabSample } from "@/services/lab/lab";
import { OpenHoldDialog } from "../../qualite/OpenHoldDialog";
import { markSentAction, recordResultAction, reviewResultAction } from "../actions";

export default async function LabSamplePage({ params }: PageProps<"/laboratoire/[sampleId]">) {
  const session = await requireModuleAccess("LAB");
  const { sampleId } = await params;
  let sample;
  try {
    sample = await getLabSample(sampleId, session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.kind === "AUTHORIZATION") redirect("/non-autorise");
    throw error;
  }
  const sampleField = { name: "sampleId", label: "Prélèvement", type: "select" as const, defaultValue: sample.id, options: [{ value: sample.id, label: sample.code }] };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Laboratoire", href: "/laboratoire" }, { label: sample.code }]}
        title={`Prélèvement ${sample.code}`}
        description={`${SAMPLE_MATRIX_LABEL[sample.matrix]} sur ${SAMPLE_OBJECT_LABEL[sample.objectType].toLowerCase()} ${sample.object?.code ?? "—"} — ${SAMPLE_REASON_LABEL[sample.reason].toLowerCase()}. Prélevé le ${when(sample.sampledAt)} par ${sample.sampledByName}.`}
        meta={
          <>
            <Badge tone={SAMPLE_STATUS_TONE[sample.status]}>{SAMPLE_STATUS_LABEL[sample.status]}</Badge>
            <DataStatusBadge status={sample.dataStatus} />
          </>
        }
        actions={
          <>
            {sample.can.send ? (
              <FormDialog title="Envoi au laboratoire" triggerLabel="Envoyé" triggerVariant="secondary" action={markSentAction} fields={[sampleField, { name: "sentAt", label: "Envoyé le", type: "datetime-local", required: true }]} />
            ) : null}
            {sample.can.record ? (
              <FormDialog
                title="Enregistrer un résultat"
                description="Un résultat par analyse, tel que le laboratoire l'a écrit. Un rapport rectifié s'ajoute sous sa propre référence ; rien n'est réécrit."
                triggerLabel="Résultat"
                action={recordResultAction}
                fields={[
                  sampleField,
                  { name: "analyte", label: "Analyse", type: "text", required: true, half: true, placeholder: "Salmonella spp., E. coli…" },
                  { name: "method", label: "Méthode", type: "text", half: true, placeholder: "PCR, ISO 6579-1…" },
                  { name: "value", label: "Résultat (tel que rendu)", type: "text", required: true, half: true, placeholder: "Non détecté, 0 UFC/100 mL…" },
                  { name: "interpretation", label: "Interprétation", type: "select", required: true, half: true, options: RESULT_INTERPRETATION.map((i) => ({ value: i, label: RESULT_INTERPRETATION_LABEL[i] })) },
                  { name: "numericValue", label: "Valeur chiffrée", type: "number", half: true },
                  { name: "unit", label: "Unité", type: "text", half: true },
                  { name: "resultAt", label: "Date du résultat", type: "datetime-local", required: true, half: true },
                  { name: "reportRef", label: "N° de rapport", type: "text", half: true },
                  { name: "complete", label: "Rapport complet", type: "select", half: true, defaultValue: "OUI", options: [{ value: "OUI", label: "Oui, toutes les analyses sont rendues" }, { value: "NON", label: "Non, d'autres résultats suivront" }] },
                ]}
              />
            ) : null}
            {sample.can.hold && sample.object ? <OpenHoldDialog defaultType={sample.objectType} defaultCode={sample.object.code} triggerLabel="Bloquer" /> : null}
          </>
        }
      />

      {sample.toReview > 0 ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning-strong">
          {sample.toReview} résultat{sample.toReview > 1 ? "s" : ""} défavorable{sample.toReview > 1 ? "s" : ""} ou à interpréter attend{sample.toReview > 1 ? "ent" : ""} la lecture du vétérinaire.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Prélèvement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <p>
              <span className="text-secondary">Sur : </span>
              {sample.object?.href ? (
                <Link href={sample.object.href} className="font-semibold text-deep-green underline-offset-2 hover:underline">
                  {sample.object.code}
                </Link>
              ) : (
                (sample.object?.code ?? "—")
              )}
            </p>
            <p>
              <span className="text-secondary">Laboratoire : </span>
              {sample.laboratory}
            </p>
            <p>
              <span className="text-secondary">Envoyé : </span>
              {sample.sentAt ? when(sample.sentAt) : "pas encore"}
            </p>
            {sample.sampleCount ? (
              <p>
                <span className="text-secondary">Échantillons : </span>
                {sample.sampleCount}
              </p>
            ) : null}
            {sample.bvuId ? <p className="font-mono text-caption text-secondary">{sample.bvuId}</p> : null}
            {sample.observation ? (
              <p className="mt-2 rounded-md border border-border bg-background p-2 text-caption">
                Suite à l&apos;observation du {day(sample.observation.observedAt)} : {sample.observation.signs}
              </p>
            ) : null}
            {sample.notes ? <p className="text-caption text-secondary">{sample.notes}</p> : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Résultats</CardTitle>
            <CardDescription>Tels que rendus par le laboratoire, avec la lecture du vétérinaire.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Analyse</TableHead>
                  <TableHead>Résultat</TableHead>
                  <TableHead>Lecture</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sample.results.length === 0 ? <TableEmpty colSpan={3}>Aucun résultat reçu.</TableEmpty> : null}
                {sample.results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-semibold">{r.analyte}</p>
                      <p className="text-caption text-secondary">
                        {[r.method, r.reportRef ? `rapport ${r.reportRef}` : null, day(r.resultAt)].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{r.value}</p>
                      <Badge tone={INTERPRETATION_TONE[r.interpretation]}>{RESULT_INTERPRETATION_LABEL[r.interpretation]}</Badge>
                    </TableCell>
                    <TableCell>
                      {r.reviewedAt ? (
                        <>
                          <p className="text-caption">{r.reviewNote}</p>
                          <p className="text-caption text-secondary">
                            {sample.reviewers[r.reviewedBy ?? ""] ?? "—"}, {day(r.reviewedAt)}
                          </p>
                        </>
                      ) : sample.can.review ? (
                        <FormDialog
                          title={`Lire le résultat : ${r.analyte}`}
                          description={needsDecision(r.interpretation) ? "Résultat défavorable ou à interpréter : dites ce qui en découle — traitement, blocage, nouveau prélèvement…" : "Résultat favorable : prendre connaissance."}
                          triggerLabel="Lire"
                          triggerVariant={needsDecision(r.interpretation) ? "primary" : "ghost"}
                          action={reviewResultAction}
                          fields={[
                            { name: "resultId", label: "Résultat", type: "select", defaultValue: r.id, options: [{ value: r.id, label: r.analyte }] },
                            { name: "note", label: "Ce qui en découle", type: "textarea", required: needsDecision(r.interpretation) },
                          ]}
                        />
                      ) : needsDecision(r.interpretation) ? (
                        <Badge tone="warning">En attente du vétérinaire</Badge>
                      ) : (
                        <span className="text-caption text-secondary">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
