import type { ReactNode } from "react";
import { FormDialog, type FormField } from "@/components/domain/FormDialog";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import type { Lot } from "@/domain/production/types";
import { ADMIN_ROUTE, ADMIN_ROUTE_LABEL, SANITARY_STATUS_LABEL } from "@/domain/sanitary/health";
import { SANITARY_STATUS } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { day, when } from "@/lib/flow-labels";
import type { Session } from "@/services/auth/session";
import { getLotHealth } from "@/services/sanitary/health";
import { recordObservationAction, recordTreatmentAction, recordVaccinationAction, reviewObservationAction } from "../health-actions";

const STATUS_TONE = { NORMAL: "success", SURVEILLANCE: "warning", ALERTE: "critical" } as const;
const REVIEW_LABEL = { EN_ATTENTE: "À examiner", VALIDE: "Confirmée", REJETE: "Écartée" } as const;
const REVIEW_TONE = { EN_ATTENTE: "warning", VALIDE: "success", REJETE: "neutral" } as const;

interface HealthRow {
  key: string;
  at: string;
  kind: string;
  detail: string;
  author: string;
  status: ReactNode;
}

/**
 * The lot's health record (document 3, ch. 02): vaccinations, treatments and what was observed,
 * with the withdrawal periods still running. A running meat window blocks slaughter, an egg
 * window takes the eggs laid in it off sale — said here so nobody learns it at the abattoir.
 */
export async function LotHealthSection({ lot, session }: { lot: Lot; session: Session }) {
  if (!can(session, "VIEW", "SANITARY")) return null;
  const health = await getLotHealth(lot.id, session);
  const laying = lot.purpose === "PONTE" || lot.purpose === "REPRODUCTION";
  const lotField: FormField = { name: "lotId", label: "Lot", type: "select", defaultValue: lot.id, options: [{ value: lot.id, label: lot.code }] };
  const routes = ADMIN_ROUTE.map((r) => ({ value: r, label: ADMIN_ROUTE_LABEL[r] }));

  const vaccinationFields: FormField[] = [
    lotField,
    { name: "vaccine", label: "Vaccin (nom commercial)", type: "text", required: true, half: true },
    { name: "disease", label: "Maladie visée", type: "text", required: true, half: true, placeholder: "Newcastle, Gumboro…" },
    { name: "route", label: "Voie", type: "select", required: true, half: true, options: routes },
    { name: "administeredAt", label: "Date et heure", type: "datetime-local", required: true, half: true },
    { name: "batchNumber", label: "N° de lot du vaccin", type: "text", half: true },
    { name: "dose", label: "Dose", type: "text", half: true },
    { name: "headcount", label: "Sujets vaccinés", type: "number", half: true, defaultValue: String(lot.currentPopulation) },
    { name: "operator", label: "Vacciné par", type: "text", half: true, hint: "Si ce n'est pas vous." },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const treatmentFields: FormField[] = [
    lotField,
    { name: "product", label: "Médicament", type: "text", required: true, half: true },
    { name: "activeSubstance", label: "Substance active", type: "text", half: true },
    { name: "indication", label: "Motif (diagnostic)", type: "text", required: true },
    { name: "route", label: "Voie", type: "select", required: true, half: true, options: routes },
    { name: "dose", label: "Dose", type: "text", half: true },
    { name: "startedAt", label: "Début", type: "datetime-local", required: true, half: true },
    { name: "durationDays", label: "Durée (jours)", type: "number", required: true, half: true },
    { name: "withdrawalMeatDays", label: "Délai d'attente viande (jours)", type: "number", required: true, half: true, hint: "0 s'il n'y en a pas." },
    { name: "withdrawalEggDays", label: "Délai d'attente œufs (jours)", type: "number", required: laying, half: true, hint: laying ? "Obligatoire sur des pondeuses ou des reproducteurs." : "Lot de chair : laissez vide." },
    { name: "prescriptionRef", label: "N° d'ordonnance", type: "text", half: true },
    { name: "prescriber", label: "Vétérinaire prescripteur", type: "text", half: true },
    { name: "headcount", label: "Sujets traités", type: "number", half: true, defaultValue: String(lot.currentPopulation) },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const observationFields: FormField[] = [
    lotField,
    { name: "status", label: "Appréciation", type: "select", required: true, half: true, options: SANITARY_STATUS.map((s) => ({ value: s, label: SANITARY_STATUS_LABEL[s] })) },
    { name: "observedAt", label: "Date et heure", type: "datetime-local", required: true, half: true },
    { name: "signs", label: "Ce qui a été observé", type: "textarea", required: true },
    { name: "affectedCount", label: "Sujets concernés", type: "number", half: true },
  ];

  const rows: HealthRow[] = [
    ...health.vaccinations.map((v) => ({ key: v.eventId, at: v.occurredAt, kind: "Vaccination", detail: `${v.data.vaccine} — ${v.data.disease} · ${ADMIN_ROUTE_LABEL[v.data.route]}${v.data.headcount ? ` · ${v.data.headcount.toLocaleString("fr-FR")} sujets` : ""}`, author: v.authorName, status: null })),
    ...health.treatments.map((t) => ({
      key: t.eventId,
      at: t.occurredAt,
      kind: "Traitement",
      detail: `${t.data.product} — ${t.data.indication} · ${t.data.durationDays} j${t.data.prescriptionRef ? ` · ordonnance ${t.data.prescriptionRef}` : ""}`,
      author: t.authorName,
      status: (
        <span className="text-xs text-secondary">
          Viande libre le {day(t.meatClearAt)}
          {t.eggClearAt ? ` · œufs le ${day(t.eggClearAt)}` : ""}
        </span>
      ),
    })),
    ...health.observations.map((o) => ({
      key: o.eventId,
      at: o.occurredAt,
      kind: "Observation",
      detail: `${o.data.signs}${o.data.affectedCount ? ` · ${o.data.affectedCount.toLocaleString("fr-FR")} sujets` : ""}`,
      author: o.authorName,
      status: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[o.data.status]}>{SANITARY_STATUS_LABEL[o.data.status]}</Badge>
          {o.review ? <Badge tone={REVIEW_TONE[o.review]}>{REVIEW_LABEL[o.review]}{o.reviewerName ? ` · ${o.reviewerName}` : ""}</Badge> : null}
          {health.canReview && o.review === "EN_ATTENTE" && o.observationId && o.observedBy !== session.userId ? (
            <FormDialog
              title="Examiner l'observation"
              description={o.data.signs}
              triggerLabel="Examiner"
              triggerVariant="ghost"
              submitLabel="Enregistrer l'avis"
              action={reviewObservationAction}
              fields={[
                { name: "observationId", label: "Observation", type: "select", defaultValue: o.observationId, options: [{ value: o.observationId, label: `${day(o.occurredAt)} — ${SANITARY_STATUS_LABEL[o.data.status]}` }] },
                { name: "decision", label: "Avis", type: "select", required: true, options: [{ value: "VALIDE", label: "Confirmée" }, { value: "REJETE", label: "Écartée" }] },
                { name: "comment", label: "Commentaire", type: "textarea" },
              ]}
            />
          ) : null}
        </div>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Santé</CardTitle>
            <CardDescription>Vaccinations, traitements et observations, datés du jour où ils ont eu lieu.</CardDescription>
          </div>
          {health.canRecord ? (
            <div className="flex flex-wrap gap-2">
              <FormDialog title="Enregistrer une vaccination" triggerLabel="Vaccination" triggerVariant="secondary" action={recordVaccinationAction} fields={vaccinationFields} />
              <FormDialog
                title="Enregistrer un traitement"
                description="Les délais d'attente agissent : l'abattage est refusé pendant celui de la viande, et les œufs pondus pendant celui des œufs sont retirés de la vente."
                triggerLabel="Traitement"
                triggerVariant="secondary"
                action={recordTreatmentAction}
                fields={treatmentFields}
              />
              <FormDialog title="Enregistrer une observation" description="Elle sera examinée par le technicien ou le vétérinaire." triggerLabel="Observation" triggerVariant="secondary" action={recordObservationAction} fields={observationFields} />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {health.activeMeat.length > 0 ? (
          <p role="status" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
            Délai d&apos;attente viande en cours jusqu&apos;au {when(health.activeMeat[0].until)} ({health.activeMeat[0].product}) : abattage refusé jusque-là.
          </p>
        ) : null}
        {health.activeEggs.length > 0 ? (
          <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong">
            Délai d&apos;attente œufs en cours jusqu&apos;au {when(health.activeEggs[0].until)} ({health.activeEggs[0].product}) : les œufs collectés sont retirés de la vente.
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Acte</TableHead>
              <TableHead>Détail</TableHead>
              <TableHead>Saisi par</TableHead>
              <TableHead>Suivi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty colSpan={5}>Aucun acte sanitaire enregistré sur ce lot.</TableEmpty> : null}
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap text-xs">{when(r.at)}</TableCell>
                <TableCell>{r.kind}</TableCell>
                <TableCell className="max-w-md text-sm">{r.detail}</TableCell>
                <TableCell className="text-xs">{r.author}</TableCell>
                <TableCell>{r.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
