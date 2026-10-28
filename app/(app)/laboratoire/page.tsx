import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { RESULT_INTERPRETATION_LABEL, SAMPLE_MATRIX, SAMPLE_MATRIX_LABEL, SAMPLE_OBJECT_LABEL, SAMPLE_REASON, SAMPLE_REASON_LABEL, SAMPLE_STATUS_LABEL } from "@/domain/lab/lab";
import { can } from "@/domain/shared/permissions";
import { day } from "@/lib/flow-labels";
import { INTERPRETATION_TONE, SAMPLE_STATUS_TONE } from "@/lib/lab-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getLaboratoryPage } from "@/services/lab/lab";
import { createSampleAction } from "./actions";

/**
 * The laboratory (document 3, data sources): what was sampled, why, where it went, and what came
 * back — each result as the laboratory wrote it, with the veterinarian's reading when it calls for one.
 */
export default async function LaboratoryPage() {
  const session = await requireModuleAccess("LAB");
  const { samples, targets, pending, toReview, last30 } = await getLaboratoryPage(session);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Laboratoire"
        description="Prélèvements et résultats d'analyses : sur un lot, des œufs, un cycle d'incubation ou l'eau d'un bâtiment. Un résultat défavorable ou à interpréter attend la lecture du vétérinaire, qui dit ce qui en découle."
        actions={
          can(session, "CREATE", "LAB") && targets.length > 0 ? (
            <FormDialog
              title="Enregistrer un prélèvement"
              triggerLabel="Nouveau prélèvement"
              action={createSampleAction}
              fields={[
                { name: "target", label: "Prélevé sur", type: "select", required: true, options: targets },
                { name: "matrix", label: "Nature", type: "select", required: true, half: true, options: SAMPLE_MATRIX.map((m) => ({ value: m, label: SAMPLE_MATRIX_LABEL[m] })) },
                { name: "reason", label: "Motif", type: "select", required: true, half: true, options: SAMPLE_REASON.map((r) => ({ value: r, label: SAMPLE_REASON_LABEL[r] })) },
                { name: "sampledAt", label: "Prélevé le", type: "datetime-local", required: true, half: true },
                { name: "sampleCount", label: "Nombre d'échantillons", type: "number", half: true },
                { name: "laboratory", label: "Laboratoire destinataire", type: "text", required: true },
                { name: "notes", label: "Notes", type: "textarea" },
              ]}
            />
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="En attente de résultats" value={pending.toLocaleString("fr-FR")} icon={FlaskConical} />
        <StatCard label="Résultats à lire" value={toReview.toLocaleString("fr-FR")} tone={toReview > 0 ? "warning" : "default"} hint="défavorables ou à interpréter" />
        <StatCard label="Prélèvements sur 30 jours" value={last30.toLocaleString("fr-FR")} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Prélèvements</CardTitle>
          <CardDescription>Du plus récent au plus ancien. Un résultat rectifié par le laboratoire s&apos;ajoute ; aucun n&apos;est réécrit.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prélèvement</TableHead>
                <TableHead>Sur</TableHead>
                <TableHead>Nature et motif</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Résultats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {samples.length === 0 ? <TableEmpty colSpan={5}>Aucun prélèvement dans votre périmètre.</TableEmpty> : null}
              {samples.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/laboratoire/${s.id}`} className="font-semibold text-deep-green underline-offset-2 hover:underline">
                      {s.code}
                    </Link>
                    <p className="text-caption text-secondary">{day(s.sampledAt)}</p>
                  </TableCell>
                  <TableCell>
                    {s.object?.code ?? "—"}
                    <p className="text-caption text-secondary">{SAMPLE_OBJECT_LABEL[s.objectType]}</p>
                  </TableCell>
                  <TableCell>
                    {SAMPLE_MATRIX_LABEL[s.matrix]}
                    <p className="text-caption text-secondary">{SAMPLE_REASON_LABEL[s.reason]}</p>
                  </TableCell>
                  <TableCell>
                    <Badge tone={SAMPLE_STATUS_TONE[s.status]}>{SAMPLE_STATUS_LABEL[s.status]}</Badge>
                    {s.toReview > 0 ? (
                      <p className="mt-1">
                        <Badge tone="warning">À lire</Badge>
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <ul className="flex flex-col gap-1">
                      {s.results.length === 0 ? <li className="text-caption text-secondary">{s.laboratory}</li> : null}
                      {s.results.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-1.5 text-caption">
                          <span>{r.analyte}</span>
                          <Badge tone={INTERPRETATION_TONE[r.interpretation]}>{RESULT_INTERPRETATION_LABEL[r.interpretation]}</Badge>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
