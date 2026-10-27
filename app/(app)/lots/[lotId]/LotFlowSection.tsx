import Link from "next/link";
import { FormDialog, type FormField } from "@/components/domain/FormDialog";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { repositories } from "@/data/repositories";
import { formatAge, LINE_PURPOSE_LABEL, PHASE_LABEL, PLAN_CHECK_LABEL } from "@/domain/production/lines";
import { TRANSFER_STATUS_LABEL } from "@/domain/production/flow";
import type { Lot } from "@/domain/production/types";
import { can } from "@/domain/shared/permissions";
import { day, EGG_TYPE_LABEL, PLAN_CHECK_TONE, TRANSFER_TONE } from "@/lib/flow-labels";
import type { Session } from "@/services/auth/session";
import { getLotFlow } from "@/services/production/phases";
import { dispatchFromFormAction } from "../../transferts/actions";
import { dispatchFields } from "../../transferts/dispatch-fields";
import { startPhaseAction } from "../flow-actions";

/**
 * The lot's place in the client's flow: its line, its age against the line's plan, the phases it
 * went through, and the movements that brought birds in or took them out.
 */
export async function LotFlowSection({ lot, session }: { lot: Lot; session: Session }) {
  const [flow, outgoing, incoming, subjects, tableEggs, bvu, building] = await Promise.all([
    getLotFlow(lot.id, session),
    repositories.transfers.listByObject("LOT", lot.id),
    repositories.transfers.listByDestinationLot(lot.id),
    repositories.subjects.listByLot(lot.id),
    repositories.tableEggLots.listByLot(lot.id),
    repositories.bvuIds.findByObject("LOT", lot.id),
    repositories.buildings.findById(lot.buildingId),
  ]);
  const farmBuildings = building ? (await repositories.buildings.list()).filter((b) => b.farmId === building.farmId && b.zoneType === "ELEVAGE") : [];
  const canEdit = can(session, "EDIT", "LOTS") && !["ABATTU", "TRANSFORME", "CLOTURE", "ARCHIVE"].includes(lot.status);
  const phaseFields: FormField[] = [
    { name: "lotId", label: "Lot", type: "select", defaultValue: lot.id, options: [{ value: lot.id, label: lot.code }] },
    { name: "phase", label: "Nouvelle phase", type: "select", required: true, options: (flow.line ? flow.nextPhases : Object.keys(PHASE_LABEL)).map((p) => ({ value: p, label: PHASE_LABEL[p as keyof typeof PHASE_LABEL] })) },
    { name: "startedAt", label: "Début", type: "datetime-local", required: true, half: true },
    { name: "buildingId", label: "Bâtiment (même ferme)", type: "select", half: true, defaultValue: lot.buildingId, options: farmBuildings.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const sendFields = canEdit && lot.currentPopulation > 0 ? await dispatchFields(session, { objectType: "LOT", objectId: lot.id }) : null;
  const movements = [...incoming.map((t) => ({ t, way: "Entrée" as const })), ...outgoing.map((t) => ({ t, way: "Sortie" as const }))].sort((a, b) => a.t.sentAt.localeCompare(b.t.sentAt));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Cycle de vie</CardTitle>
          <div className="flex flex-wrap gap-2">
            {canEdit && (flow.nextPhases.length || !flow.line) ? <FormDialog title="Changer de phase" description="L'âge des animaux est comparé au plan de la ligne ; un écart est enregistré, pas refusé." triggerLabel="Changer de phase" triggerVariant="secondary" action={startPhaseAction} fields={phaseFields} /> : null}
            {sendFields ? <FormDialog title="Expédier des animaux de ce lot" description="Comptez avant de signer : le destinataire comptera et signera à l'arrivée." triggerLabel="Transférer" triggerVariant="secondary" action={dispatchFromFormAction} fields={sendFields} submitLabel="Signer le départ" /> : null}
          </div>
        </div>
        <CardDescription>
          {flow.line ? `${flow.line.label} · ${LINE_PURPOSE_LABEL[flow.line.purpose]}` : "Ligne non renseignée : le plan des phases ne s'applique pas."}
          {bvu ? <> · <code>{bvu.bvuId}</code></> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <span>
            <span className="text-secondary">Âge :</span> {formatAge(flow.ageDays)}
            {lot.hatchedAt ? <span className="text-secondary"> (éclos le {day(lot.hatchedAt)})</span> : null}
          </span>
          <span>
            <span className="text-secondary">Phase :</span> {flow.current ? PHASE_LABEL[flow.current.phase] : "—"}
          </span>
          {flow.due ? (
            <Badge tone={flow.due.overdueDays > 0 ? "warning" : "info"}>
              {flow.due.label}
              {flow.due.overdueDays > 0 ? ` — en retard de ${flow.due.overdueDays} j` : ` — attendu de J${flow.due.dueFromDay} à J${flow.due.dueByDay}`}
            </Badge>
          ) : null}
        </div>
        {flow.phases.length ? (
          <ol className="flex flex-col gap-1.5">
            {flow.phases.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-l-2 border-bio-green/50 pl-3">
                <span className="font-medium">{PHASE_LABEL[p.phase]}</span>
                <span className="text-xs text-secondary">
                  du {day(p.startedAt)} {p.endedAt ? `au ${day(p.endedAt)}` : "— en cours"}
                  {p.ageDaysAtStart !== null ? ` · début à J${p.ageDaysAtStart}` : ""}
                </span>
                <Badge tone={PLAN_CHECK_TONE[p.planCheck]}>{PLAN_CHECK_LABEL[p.planCheck]}</Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-secondary">Aucune phase enregistrée.</p>
        )}
        {movements.length ? (
          <div>
            <p className="mb-1 font-medium">Mouvements</p>
            <ul className="flex flex-col gap-1">
              {movements.map(({ t, way }) => (
                <li key={`${way}-${t.id}`} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="neutral">{way}</Badge>
                  <Link href={`/transferts/${t.id}`} className="text-bio-green underline">
                    {t.code}
                  </Link>
                  <span>
                    {t.quantitySent.toLocaleString("fr-FR")} au départ
                    {t.quantityReceived !== null ? ` · ${t.quantityReceived.toLocaleString("fr-FR")} reçus vivants` : ""}
                  </span>
                  <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-4 text-xs">
          <Link href={`/lots/${lot.id}/sujets`} className="text-bio-green underline">
            Sujets identifiés : {subjects.length}
          </Link>
          {lot.purpose === "PONTE" ? (
            <Link href="/oeufs-consommation" className="text-bio-green underline">
              Collectes d&apos;œufs : {tableEggs.length}
              {tableEggs[0] ? ` (dernière le ${day(tableEggs[0].collectedOn)}, œuf ${EGG_TYPE_LABEL[tableEggs[0].eggType].toLowerCase()})` : ""}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
