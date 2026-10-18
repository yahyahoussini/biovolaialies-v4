import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { can } from "@/domain/shared/permissions";
import { QUALITY_REASON_LABEL, QUALITY_STATUS_LABEL, QUALITY_STATUS_TONE } from "@/lib/quality-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { listQualityCases } from "@/services/quality/holds";
import { OpenHoldDialog } from "./OpenHoldDialog";

export default async function QualityPage() {
  const session = await requireModuleAccess("QUALITY");
  const cases = await listQualityCases(session);
  const open = cases.filter((c) => c.status === "EN_BLOCAGE");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Qualité & rappels"
        description="Blocages qualité (HOLD), décisions de levée et périmètres de rappel amont / aval."
        actions={can(session, "CREATE", "QUALITY") ? <OpenHoldDialog /> : null}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Blocages en cours" value={open.length} icon={ShieldAlert} tone={open.length > 0 ? "critical" : "success"} />
        <StatCard label="Objets bloqués" value={open.reduce((s, c) => s + c.itemCount, 0)} />
        <StatCard label="Dossiers au total" value={cases.length} />
      </div>

      <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary">
        Règles appliquées : un objet bloqué ne peut plus produire de dérivé (collecte, abattage, transformation, produit,
        expédition). La levée exige le rôle « Responsable qualité », une personne différente de celle qui a ouvert le
        blocage, une justification écrite et au moins une preuve. Chaque étape est inscrite au journal chaîné.
      </p>

      {cases.length === 0 ? (
        <EmptyState title="Aucun dossier qualité" description="Les blocages ouverts apparaîtront ici." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dossier</TableHead>
              <TableHead>Objet</TableHead>
              <TableHead>Motif</TableHead>
              <TableHead>Objets bloqués</TableHead>
              <TableHead>Ouvert le</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link href={`/qualite/${c.id}`} className="text-bio-green underline">
                    {c.code}
                  </Link>
                </TableCell>
                <TableCell>{c.rootLabel}</TableCell>
                <TableCell>{QUALITY_REASON_LABEL[c.reason]}</TableCell>
                <TableCell>{c.itemCount}</TableCell>
                <TableCell className="whitespace-nowrap">{new Date(c.openedAt).toLocaleDateString("fr-FR")}</TableCell>
                <TableCell>
                  <Badge tone={QUALITY_STATUS_TONE[c.status]}>{QUALITY_STATUS_LABEL[c.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
