import { notFound } from "next/navigation";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { repositories } from "@/data/repositories";
import { DATA_STATUS, SUBJECT_EVENT_TYPE, SUBJECT_STATUS } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { day } from "@/lib/flow-labels";
import { DATA_STATUS_LABEL } from "@/lib/status-colors";
import { redirectIfOutOfScope, requireModuleAccess } from "@/services/auth/guard";
import { resolveLotHierarchy } from "@/services/identity/scope-check";
import { changeSubjectStatusAction, recordSubjectEventAction, registerSubjectsAction, releaseRfidAction } from "../../flow-actions";

const SEX_LABEL = { FEMELLE: "♀", MALE: "♂", INDETERMINE: "?" } as const;
const STATUS_LABEL: Record<string, string> = { ACTIF: "Actif", OBSERVATION: "Sous observation", MORT: "Mort", REFORME: "Réformé", SORTI: "Sorti" };
const EVENT_LABEL: Record<string, string> = { PESEE: "Pesée", OBSERVATION: "Observation", TRAITEMENT: "Traitement", MOUVEMENT: "Mouvement", STATUT: "Statut", LECTURE: "Lecture" };

export default async function SubjectsPage({ params }: PageProps<"/lots/[lotId]/sujets">) {
  const session = await requireModuleAccess("LOTS");
  const { lotId } = await params;
  const lot = await repositories.lots.findById(lotId);
  if (!lot) notFound();
  redirectIfOutOfScope(session, await resolveLotHierarchy(lot.id));
  const subjects = await repositories.subjects.listByLot(lot.id);
  const canEdit = can(session, "EDIT", "LOTS");
  const canRelease = can(session, "VALIDATE", "TRACEABILITY") || can(session, "EDIT", "HATCHERY");
  const present = subjects.filter((s) => s.status === "ACTIF" || s.status === "OBSERVATION");
  const options = present.map((s) => ({ value: s.id, label: `${s.visualId}${s.rfidUid ? ` · ${s.rfidUid}` : ""}` }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Lots", href: "/lots" }, { label: lot.code, href: `/lots/${lot.id}` }, { label: "Sujets identifiés" }]}
        title={`Sujets identifiés — ${lot.code}`}
        description="Suivi individuel des reproducteurs et des animaux sous observation : une identité BIOVOLAILLES permanente, une bague comme identifiant visuel de secours, une puce si posée. Une mesure n'est individuelle que si son rattachement au sujet est démontré."
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <FormDialog
                title="Baguer des sujets"
                description="Une ligne par sujet : bague;puce;sexe (F, M ou I). La puce peut rester vide : B-0012;;F"
                triggerLabel="Baguer"
                action={registerSubjectsAction}
                fields={[
                  { name: "lotId", label: "Lot", type: "select", defaultValue: lot.id, options: [{ value: lot.id, label: lot.code }] },
                  { name: "taggedAt", label: "Pose", type: "date", required: true, half: true },
                  { name: "dataStatus", label: "Statut des données", type: "select", defaultValue: "REEL", half: true, options: DATA_STATUS.map((s) => ({ value: s, label: DATA_STATUS_LABEL[s] })) },
                  { name: "subjects", label: "Sujets", type: "textarea", required: true, placeholder: "B-0001;E28011AA;F\nB-0002;;M" },
                ]}
              />
              {options.length ? (
                <>
                  <FormDialog
                    title="Mesure ou observation individuelle"
                    description="Pour une pesée ou une lecture, dites comment la valeur a été rattachée à ce sujet."
                    triggerLabel="Saisie individuelle"
                    triggerVariant="secondary"
                    action={recordSubjectEventAction}
                    fields={[
                      { name: "subjectId", label: "Sujet", type: "select", required: true, options },
                      { name: "eventType", label: "Nature", type: "select", required: true, half: true, options: SUBJECT_EVENT_TYPE.filter((t) => t !== "STATUT").map((t) => ({ value: t, label: EVENT_LABEL[t] })) },
                      { name: "occurredAt", label: "Date", type: "datetime-local", required: true, half: true },
                      { name: "value", label: "Valeur", type: "number", half: true },
                      { name: "unit", label: "Unité", type: "text", placeholder: "KG", half: true },
                      { name: "attributionProof", label: "Preuve de rattachement", type: "text", placeholder: "Puce lue à la station de pesée" },
                      { name: "notes", label: "Notes", type: "textarea" },
                    ]}
                  />
                  <FormDialog
                    title="Changer le statut d'un sujet"
                    triggerLabel="Statut"
                    triggerVariant="secondary"
                    action={changeSubjectStatusAction}
                    fields={[
                      { name: "subjectId", label: "Sujet", type: "select", required: true, options },
                      { name: "status", label: "Statut", type: "select", required: true, half: true, options: SUBJECT_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
                      { name: "at", label: "Date", type: "date", required: true, half: true },
                      { name: "reason", label: "Motif", type: "textarea", required: true },
                    ]}
                  />
                </>
              ) : null}
              {canRelease && subjects.some((s) => s.rfidUid) ? (
                <FormDialog
                  title="Retirer une puce"
                  description="Procédure contrôlée : la puce reste dans l'historique du sujet et ne pourra désigner un autre sujet qu'après ce retrait."
                  triggerLabel="Retirer une puce"
                  triggerVariant="secondary"
                  action={releaseRfidAction}
                  fields={[
                    { name: "subjectId", label: "Sujet", type: "select", required: true, options: subjects.filter((s) => s.rfidUid).map((s) => ({ value: s.id, label: `${s.visualId} · ${s.rfidUid}` })) },
                    { name: "reason", label: "Motif", type: "textarea", required: true },
                  ]}
                />
              ) : null}
            </div>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sujets identifiés" value={subjects.length} />
        <StatCard label="Présents" value={present.length} />
        <StatCard label="Avec puce" value={subjects.filter((s) => s.rfidUid).length} />
        <StatCard label="Effectif du lot" value={lot.currentPopulation.toLocaleString("fr-FR")} hint="Les sujets non bagués sont suivis au niveau du lot." />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Registre individuel</CardTitle>
          <CardDescription>Un sujet mort ou sorti garde son identité : elle ne sera jamais réattribuée.</CardDescription>
        </CardHeader>
        <CardContent>
          {subjects.length === 0 ? (
            <EmptyState title="Aucun sujet identifié" description="Ce lot est suivi au niveau du lot. Baguez des sujets pour un suivi individuel." />
          ) : (
            <Table caption="Sujets identifiés">
              <TableHeader>
                <TableRow>
                  <TableHead>Bague</TableHead>
                  <TableHead>Identifiant BIOVOLAILLES</TableHead>
                  <TableHead>Puce</TableHead>
                  <TableHead>Sexe</TableHead>
                  <TableHead>Posée le</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.visualId}</TableCell>
                    <TableCell>
                      <code className="text-xs">{s.bvuId}</code>
                    </TableCell>
                    <TableCell>{s.rfidUid ?? "—"}</TableCell>
                    <TableCell>{SEX_LABEL[s.sex]}</TableCell>
                    <TableCell>{day(s.taggedAt)}</TableCell>
                    <TableCell>
                      <Badge tone={s.status === "ACTIF" ? "success" : s.status === "OBSERVATION" ? "warning" : "neutral"}>{STATUS_LABEL[s.status]}</Badge>
                      {s.statusReason ? <span className="block text-xs text-secondary">{s.statusReason}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
