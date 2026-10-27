import { EggFried } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { repositories } from "@/data/repositories";
import { DATA_STATUS, EGG_TYPE } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { isGlobalScope } from "@/domain/shared/scope";
import { day, EGG_TYPE_LABEL, TABLE_EGG_STATUS_LABEL as STATUS_LABEL } from "@/lib/flow-labels";
import { DATA_STATUS_LABEL } from "@/lib/status-colors";
import { requireModuleAccess } from "@/services/auth/guard";
import { buildHierarchyIndex, isWithinScope } from "@/services/identity/scope-check";
import { listTableEggLots } from "@/services/production/table-eggs";
import { createTableEggLotAction } from "../lots/flow-actions";


export default async function TableEggsPage() {
  const session = await requireModuleAccess("LOTS");
  const [rows, lots, index] = await Promise.all([listTableEggLots(session), repositories.lots.list(), buildHierarchyIndex()]);
  const layerLots = lots.filter((l) => l.purpose === "PONTE" && l.status === "ACTIF" && (isGlobalScope(session) || isWithinScope(session, index.building.get(l.buildingId) ?? {})));
  const canCreate = can(session, "CREATE", "EVENTS") && layerLots.length > 0;
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  const saleable = rows.reduce((s, r) => s + r.saleable, 0);
  const byType = (t: string) => rows.filter((r) => r.eggType === t).reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Œufs de consommation"
        description="Collectes quotidiennes des pondeuses plein air, œuf blanc et œuf « Pistache », classées à la collecte. Chaque collecte est un objet tracé : la ligne de marquage y rattache ses codes et un blocage du lot de pondeuses la bloque."
        actions={
          canCreate ? (
            <FormDialog
              title="Nouvelle collecte"
              description="Chaque œuf collecté est classé une seule fois : vendable, fêlé, sale ou petit."
              triggerLabel="Nouvelle collecte"
              action={createTableEggLotAction}
              fields={[
                { name: "lotId", label: "Lot de pondeuses", type: "select", required: true, options: layerLots.map((l) => ({ value: l.id, label: `${l.code} (${l.productionLine ?? "—"})` })) },
                { name: "code", label: "Code de la collecte", type: "text", required: true, placeholder: "OEC-2026-10-19-P01", half: true },
                { name: "collectedOn", label: "Jour de collecte", type: "date", required: true, half: true },
                { name: "eggType", label: "Type d'œuf", type: "select", options: [{ value: "", label: "Celui de la ligne" }, ...EGG_TYPE.map((t) => ({ value: t, label: EGG_TYPE_LABEL[t] }))], half: true },
                { name: "quantity", label: "Œufs collectés", type: "number", required: true, half: true },
                { name: "saleable", label: "Vendables", type: "number", required: true, half: true },
                { name: "cracked", label: "Fêlés", type: "number", defaultValue: "0", half: true },
                { name: "dirty", label: "Sales", type: "number", defaultValue: "0", half: true },
                { name: "small", label: "Petits", type: "number", defaultValue: "0", half: true },
                { name: "dataStatus", label: "Statut des données", type: "select", defaultValue: "REEL", options: DATA_STATUS.map((s) => ({ value: s, label: DATA_STATUS_LABEL[s] })) },
              ]}
            />
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Œufs collectés" value={total.toLocaleString("fr-FR")} icon={EggFried} />
        <StatCard label="Vendables" value={total ? `${((saleable / total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—"} />
        <StatCard label="Œuf blanc" value={byType("BLANC").toLocaleString("fr-FR")} />
        <StatCard label="Œuf « Pistache »" value={byType("PISTACHE").toLocaleString("fr-FR")} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Collectes</CardTitle>
          <CardDescription>Le déclassement compte les œufs fêlés, sales et petits sur le total collecté.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Aucune collecte" description="Les collectes des lots de pondeuses en ponte apparaîtront ici." />
          ) : (
            <Table caption="Collectes d'œufs de consommation">
              <TableHeader>
                <TableRow>
                  <TableHead>Collecte</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Jour</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Collectés</TableHead>
                  <TableHead>Vendables</TableHead>
                  <TableHead>Déclassement</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/oeufs-consommation/${r.id}`} className="font-medium text-bio-green underline">
                        {r.code}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/lots/${r.lotId}`} className="underline">
                        {r.lotCode}
                      </Link>
                      <span className="block text-xs text-secondary">{r.farmName}</span>
                    </TableCell>
                    <TableCell>{day(r.collectedOn)}</TableCell>
                    <TableCell>{EGG_TYPE_LABEL[r.eggType]}</TableCell>
                    <TableCell>{r.quantity.toLocaleString("fr-FR")}</TableCell>
                    <TableCell>{r.saleable.toLocaleString("fr-FR")}</TableCell>
                    <TableCell>
                      <Badge tone={r.downgradePct > 10 ? "warning" : "success"}>{r.downgradePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</Badge>
                    </TableCell>
                    <TableCell>{STATUS_LABEL[r.status]}</TableCell>
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
