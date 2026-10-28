import { notFound, redirect } from "next/navigation";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { hatchRate } from "@/domain/hatchery/balance";
import { AppError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { HATCH_CYCLE_STATUS_LABEL, HATCH_CYCLE_STATUS_TONE, pct } from "@/lib/hatchery-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getHatchCycleDetail } from "@/services/hatchery/hatchery";
import { OpenHoldDialog } from "../../../qualite/OpenHoldDialog";
import { recordCandlingAction, recordHatchAction } from "../../actions";
import { CycleMarkingSection } from "./CycleMarkingSection";

function n(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("fr-FR");
}

export default async function HatchCyclePage({ params }: PageProps<"/couvoir/cycles/[cycleId]">) {
  const session = await requireModuleAccess("HATCHERY");
  const { cycleId } = await params;
  let detail;
  try {
    detail = await getHatchCycleDetail(cycleId, session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.kind === "AUTHORIZATION") redirect("/non-autorise");
    throw error;
  }
  const { cycle } = detail;
  const canEdit = can(session, "EDIT", "HATCHERY");
  const balanced = cycle.status === "ECLOS" && (cycle.clearsRemoved ?? 0) + (cycle.unhatched ?? 0) + (cycle.chicksHatched ?? 0) === cycle.eggsSet;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Couvoir & amont", href: "/couvoir" }, { label: cycle.code }]}
        title={`Cycle d'incubation ${cycle.code}`}
        description={`${detail.buildingLabel} · ${cycle.incubatorRef} · mis en incubation le ${new Date(cycle.setAt).toLocaleDateString("fr-FR")}`}
        meta={
          <>
            <Badge tone={HATCH_CYCLE_STATUS_TONE[cycle.status]}>{HATCH_CYCLE_STATUS_LABEL[cycle.status]}</Badge>
            <DataStatusBadge status={cycle.dataStatus} />
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && cycle.status === "EN_INCUBATION" ? (
              <FormDialog
                title="Enregistrer le mirage"
                triggerLabel="Mirage"
                action={recordCandlingAction}
                fields={[
                  { name: "cycleId", label: "Cycle", type: "select", defaultValue: cycle.id, options: [{ value: cycle.id, label: cycle.code }], half: true },
                  { name: "candledAt", label: "Date du mirage", type: "date", required: true, half: true },
                  { name: "clearsRemoved", label: "Œufs clairs retirés", type: "number", required: true, half: true },
                ]}
              />
            ) : null}
            {canEdit && cycle.status === "MIRE" ? (
              <FormDialog
                title="Enregistrer l'éclosion"
                description={`Bilan à solder : ${n(cycle.eggsSet)} œufs = ${n(cycle.clearsRemoved)} clairs + non éclos + éclos.`}
                triggerLabel="Éclosion"
                action={recordHatchAction}
                fields={[
                  { name: "cycleId", label: "Cycle", type: "select", defaultValue: cycle.id, options: [{ value: cycle.id, label: cycle.code }], half: true },
                  { name: "hatchedAt", label: "Date d'éclosion", type: "date", required: true, half: true },
                  { name: "chicksHatched", label: "Poussins éclos", type: "number", required: true, half: true },
                  { name: "unhatched", label: "Œufs non éclos", type: "number", required: true, half: true },
                  { name: "culls", label: "Poussins écartés (déclassés)", type: "number", required: true, half: true },
                ]}
              />
            ) : null}
            {can(session, "CREATE", "QUALITY") ? <OpenHoldDialog defaultType="HATCH_CYCLE" defaultCode={cycle.code} triggerLabel="Bloquer" /> : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Œufs mis en incubation" value={n(cycle.eggsSet)} />
        <StatCard label="Clairs retirés (mirage)" value={n(cycle.clearsRemoved)} />
        <StatCard label="Non éclos" value={n(cycle.unhatched)} />
        <StatCard label="Éclos" value={n(cycle.chicksHatched)} hint={cycle.chicksHatched === null ? undefined : `Taux ${pct(hatchRate(cycle.eggsSet, cycle.chicksHatched))}`} />
        <StatCard label="Disponibles à sortir" value={n(detail.available)} hint={`${n(detail.dispatched)} déjà sortis, ${n(cycle.culls)} écartés`} />
      </div>

      {cycle.status === "ECLOS" ? (
        <p className={`rounded-lg border px-4 py-3 text-sm ${balanced ? "border-success/40 bg-success/10 text-success-strong" : "border-critical/40 bg-critical/10 text-critical-strong"}`}>
          {balanced ? "Bilan œufs soldé : chaque œuf mis en incubation est compté (clair, non éclos ou éclos)." : "Bilan œufs non soldé."}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lots d&apos;œufs chargés</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot d&apos;œufs</TableHead>
                  <TableHead>Troupeau</TableHead>
                  <TableHead>Quantité</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.loadedEggLots.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.code}</TableCell>
                    <TableCell>{e.flockCode}</TableCell>
                    <TableCell>{n(e.quantity)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Lots de poussins sortis</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.chickLots.length === 0 ? (
              <p className="text-sm text-secondary">Aucune sortie enregistrée.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot</TableHead>
                    <TableHead>Poussins</TableHead>
                    <TableHead>Qualité</TableHead>
                    <TableHead>Sortie</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.chickLots.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.code}</TableCell>
                      <TableCell>{n(c.quantity)}</TableCell>
                      <TableCell>{c.grade}</TableCell>
                      <TableCell>{new Date(c.dispatchedAt).toLocaleDateString("fr-FR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CycleMarkingSection cycleId={cycle.id} cycleCode={cycle.code} session={session} />
    </div>
  );
}
