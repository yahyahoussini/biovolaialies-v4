import { ClipboardCheck } from "lucide-react";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { listCommissioningTests } from "@/services/equipment/equipment";
import { recordCommissioningAction } from "../actions";

const RESULT = {
  A_FAIRE: { label: "À faire", tone: "neutral" },
  CONFORME: { label: "Conforme", tone: "success" },
  NON_CONFORME: { label: "Non conforme", tone: "critical" },
} as const;

export default async function CommissioningPage() {
  const session = await requireModuleAccess("EQUIPMENT");
  const tests = await listCommissioningTests(session);
  const canEdit = can(session, "EDIT", "EQUIPMENT");
  const done = tests.filter((t) => t.result !== "A_FAIRE").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Équipements", href: "/equipements" }, { label: "Mise en service" }]}
        title="Recette de mise en service"
        description="Une procédure de contrôle par famille d'instrument. Un résultat n'existe que s'il est enregistré avec sa preuve ; rien n'est réputé conforme par défaut."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Recettes réalisées" value={`${done} / ${tests.length}`} icon={ClipboardCheck} />
        <StatCard label="Conformes" value={tests.filter((t) => t.result === "CONFORME").length} tone="success" />
        <StatCard label="Non conformes" value={tests.filter((t) => t.result === "NON_CONFORME").length} tone={tests.some((t) => t.result === "NON_CONFORME") ? "critical" : "default"} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Équipement</TableHead>
            <TableHead>Procédure</TableHead>
            <TableHead>Résultat</TableHead>
            <TableHead>Preuve</TableHead>
            <TableHead>Réalisé par</TableHead>
            {canEdit ? <TableHead className="text-right">Action</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tests.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.code}</TableCell>
              <TableCell>{t.equipment}</TableCell>
              <TableCell>{t.procedure}</TableCell>
              <TableCell>
                <Badge tone={RESULT[t.result].tone}>{RESULT[t.result].label}</Badge>
              </TableCell>
              <TableCell className="text-xs">{t.evidence ?? "—"}</TableCell>
              <TableCell className="text-xs">
                {t.executedByName ?? "—"}
                {t.executedAt ? <span className="block text-secondary">{new Date(t.executedAt).toLocaleDateString("fr-FR")}</span> : null}
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <FormDialog
                    title={`Recette ${t.code} — ${t.equipment}`}
                    description={`Procédure : ${t.procedure}`}
                    triggerLabel="Enregistrer"
                    triggerVariant="ghost"
                    action={recordCommissioningAction}
                    fields={[
                      { name: "id", label: "Recette", type: "select", defaultValue: t.id, options: [{ value: t.id, label: t.code }], half: true },
                      { name: "result", label: "Résultat", type: "select", required: true, options: [{ value: "CONFORME", label: "Conforme" }, { value: "NON_CONFORME", label: "Non conforme" }], half: true },
                      { name: "evidence", label: "Preuve (PV, photo, relevé)", type: "text", required: true },
                      { name: "notes", label: "Observations", type: "textarea" },
                    ]}
                  />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
