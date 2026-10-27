import { GitBranch } from "lucide-react";
import Link from "next/link";
import { FormDialog, type FormField } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { formatAge, LINE_PURPOSE_LABEL, MONTH_DAYS, PHASE_LABEL } from "@/domain/production/lines";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { listProductionLines } from "@/services/production/lines";
import { lotsDueForAction } from "@/services/production/phases";
import { updateLineAction } from "../lots/flow-actions";

const asMonths = (days: number) => `${(days / MONTH_DAYS).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois`;
const window = (w: [number, number] | null) => (w ? (w[0] === w[1] ? `J${w[0]} (${asMonths(w[0])})` : `J${w[0]}–J${w[1]} (${asMonths(w[0])} à ${asMonths(w[1])})`) : "jusqu'à la sortie");

export default async function LinesPage() {
  const session = await requireModuleAccess("LOTS");
  const [lines, due] = await Promise.all([listProductionLines(), lotsDueForAction(session)]);
  const canEdit = can(session, "EDIT", "SETTINGS");
  const overdue = due.filter((d) => d.due.overdueDays > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lignes & phases"
        description="Les lignes du schéma de traçabilité : reproducteurs importés, élevés en cages puis au sol, distribués par ligne ; poussins de la ligne chair et de la ligne ponte ; pondeuses œuf blanc et œuf « Pistache ». Chaque lot suit le plan de sa ligne, et l'écart au plan est enregistré, jamais masqué."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Lignes actives" value={lines.filter((l) => l.active).length} icon={GitBranch} />
        <StatCard label="Lots attendant une étape" value={due.length} />
        <StatCard label="Étapes en retard" value={overdue.length} tone={overdue.length ? "warning" : "success"} />
        <StatCard label="Réformes et abattages dus" value={due.filter((d) => d.due.kind === "SORTIE").length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Échéances du plan</CardTitle>
          <CardDescription>Lots dont l&apos;âge appelle la phase suivante, l&apos;abattage ou la réforme. Le retard compte au-delà de la fenêtre du plan et d&apos;une tolérance de 7 jours.</CardDescription>
        </CardHeader>
        <CardContent>
          {due.length === 0 ? (
            <EmptyState title="Rien d'attendu" description="Aucun lot n'a atteint l'âge d'une étape de son plan." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead>Ligne</TableHead>
                  <TableHead>Phase actuelle</TableHead>
                  <TableHead>Âge</TableHead>
                  <TableHead>Étape attendue</TableHead>
                  <TableHead>Retard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {due.map((d) => (
                  <TableRow key={d.lot.id}>
                    <TableCell>
                      <Link href={`/lots/${d.lot.id}`} className="font-medium text-bio-green underline">
                        {d.lot.code}
                      </Link>
                      <span className="block text-xs text-secondary">{d.buildingLabel}</span>
                    </TableCell>
                    <TableCell>{d.line.label}</TableCell>
                    <TableCell>{d.phase ? PHASE_LABEL[d.phase] : "—"}</TableCell>
                    <TableCell>{formatAge(d.ageDays)}</TableCell>
                    <TableCell>
                      {d.due.label}
                      <span className="block text-xs text-secondary">{window([d.due.dueFromDay, d.due.dueByDay])}</span>
                    </TableCell>
                    <TableCell>{d.due.overdueDays > 0 ? <Badge tone="warning">{d.due.overdueDays} j</Badge> : <Badge tone="info">Dans la fenêtre</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {lines.map((line) => {
          const fields: FormField[] = [
            { name: "code", label: "Ligne", type: "select", defaultValue: line.code, options: [{ value: line.code, label: line.code }] },
            { name: "label", label: "Libellé", type: "text", defaultValue: line.label, required: true },
            ...line.phasePlan.slice(0, -1).flatMap((step, i) => [
              { name: `step${i}_min`, label: `${PHASE_LABEL[step.phase]} : fin au plus tôt (jours)`, type: "number" as const, defaultValue: String(step.endsBetween?.[0] ?? ""), half: true },
              { name: `step${i}_max`, label: "fin au plus tard (jours)", type: "number" as const, defaultValue: String(step.endsBetween?.[1] ?? ""), half: true },
            ]),
            { name: "exitMinDays", label: "Sortie au plus tôt (jours)", type: "number", defaultValue: line.exitMinDays === null ? "" : String(line.exitMinDays), half: true },
            { name: "exitMaxDays", label: "Sortie au plus tard (jours)", type: "number", defaultValue: line.exitMaxDays === null ? "" : String(line.exitMaxDays), half: true },
            { name: "exitLabel", label: "Libellé de la sortie", type: "text", defaultValue: line.exitLabel },
            { name: "active", label: "Ligne active", type: "select", defaultValue: String(line.active), options: [{ value: "true", label: "Oui" }, { value: "false", label: "Non" }], half: true },
            { name: "reason", label: "Pourquoi ce changement", type: "textarea", required: true, placeholder: "Décision du technicien avicole du …" },
          ];
          return (
            <Card key={line.code}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{line.label}</CardTitle>
                  <div className="flex items-center gap-2">
                    {line.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                    {canEdit ? <FormDialog title={`Plan — ${line.label}`} description="S'applique aux phases enregistrées à partir de maintenant ; les valeurs avant et après sont journalisées." triggerLabel="Modifier" triggerVariant="secondary" action={updateLineAction} fields={fields} /> : null}
                  </div>
                </div>
                <CardDescription>
                  {line.code} · {LINE_PURPOSE_LABEL[line.purpose]}
                  {line.parentLineCode ? ` · poussins issus de ${line.parentLineCode}` : ""}
                  {line.eggType ? ` · œuf ${line.eggType === "PISTACHE" ? "« Pistache »" : line.eggType.toLowerCase()}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ol className="flex flex-col gap-2 text-sm">
                  {line.phasePlan.map((step, i) => (
                    <li key={step.phase} className="flex flex-wrap justify-between gap-2 border-l-2 border-bio-green/50 pl-3">
                      <span className="font-medium">
                        {i + 1}. {PHASE_LABEL[step.phase]}
                      </span>
                      <span className="text-secondary">fin {window(step.endsBetween)}</span>
                    </li>
                  ))}
                  <li className="flex flex-wrap justify-between gap-2 border-l-2 border-warning/60 pl-3">
                    <span className="font-medium">Sortie — {line.exitLabel}</span>
                    <span className="text-secondary">{line.exitMaxDays === null ? "—" : window([line.exitMinDays ?? 0, line.exitMaxDays])}</span>
                  </li>
                </ol>
                <p className="text-xs text-secondary">
                  Source : {line.source}
                  {line.updatedAt ? ` · modifié le ${new Date(line.updatedAt).toLocaleDateString("fr-FR")}` : ""}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
