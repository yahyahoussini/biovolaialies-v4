import { Send } from "lucide-react";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { DATA_STATUS } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { DATA_STATUS_LABEL } from "@/lib/status-colors";
import { requireModuleAccess } from "@/services/auth/guard";
import { getShipmentOverview } from "@/services/traceability/shipment";
import { createShipmentAction } from "./actions";

function q(value: number | null, unit: string | null): string {
  return value === null ? "—" : `${value.toLocaleString("fr-FR")} ${unit ?? ""}`.trim();
}

export default async function ShipmentsPage() {
  const session = await requireModuleAccess("PRODUCTS");
  const o = await getShipmentOverview(session);
  const shippable = o.products.filter((p) => !p.onHold && (p.quantity === null || p.quantity - p.shipped > 0));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Produits & expéditions"
        description="Stock des produits conditionnés et expéditions commerciales — la base du chiffrage d'un rappel."
        actions={
          can(session, "CREATE", "EVENTS") && shippable.length > 0 && o.destinations.length > 0 ? (
            <FormDialog
              title="Enregistrer une expédition"
              description="Un produit sous blocage qualité ne peut pas être expédié."
              triggerLabel="Nouvelle expédition"
              action={createShipmentAction}
              fields={[
                { name: "code", label: "N° d'expédition / BL", type: "text", required: true, placeholder: "EXP-2026-0412", half: true },
                { name: "productId", label: "Produit", type: "select", required: true, options: shippable.map((p) => ({ value: p.id, label: `${p.code} — ${p.quantity === null ? "stock non chiffré" : q(p.quantity - p.shipped, p.unit)}` })), half: true },
                { name: "destinationId", label: "Destination", type: "select", required: true, options: o.destinations.map((d) => ({ value: d.id, label: d.label })), half: true },
                { name: "shippedAt", label: "Date d'expédition", type: "date", required: true, half: true },
                { name: "quantity", label: "Quantité", type: "number", required: true, half: true },
                { name: "unit", label: "Unité", type: "text", defaultValue: "kg", half: true },
                { name: "dataStatus", label: "Statut des données", type: "select", defaultValue: "SIMULATION", options: DATA_STATUS.map((s) => ({ value: s, label: DATA_STATUS_LABEL[s] })), half: true },
              ]}
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Produits conditionnés" value={o.products.length} />
        <StatCard label="Expéditions" value={o.shipments.length} icon={Send} />
        <StatCard label="Produits sous blocage" value={o.products.filter((p) => p.onHold).length} tone={o.products.some((p) => p.onHold) ? "critical" : "default"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock par produit</CardTitle>
        </CardHeader>
        <CardContent>
          {o.products.length === 0 ? (
            <EmptyState title="Aucun produit" description="Les produits conditionnés de votre périmètre apparaîtront ici." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead>
                  <TableHead>Conditionné</TableHead>
                  <TableHead>Expédié</TableHead>
                  <TableHead>En stock</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium">{p.code}</span>
                      <span className="block text-xs text-secondary">{p.name}</span>
                    </TableCell>
                    <TableCell>{q(p.quantity, p.unit)}</TableCell>
                    <TableCell>{q(p.shipped, p.unit ?? "kg")}</TableCell>
                    <TableCell>{p.quantity === null ? "Non chiffré" : q(p.quantity - p.shipped, p.unit)}</TableCell>
                    <TableCell>{p.onHold ? <Badge tone="critical">Bloqué</Badge> : <Badge tone="success">Disponible</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expéditions</CardTitle>
        </CardHeader>
        <CardContent>
          {o.shipments.length === 0 ? (
            <EmptyState title="Aucune expédition" description="Les expéditions enregistrées apparaîtront ici." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Produit</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Quantité</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.code}</TableCell>
                    <TableCell>{s.productCode}</TableCell>
                    <TableCell>{s.destinationLabel}</TableCell>
                    <TableCell>{q(s.quantity, s.unit)}</TableCell>
                    <TableCell>{new Date(s.shippedAt).toLocaleDateString("fr-FR")}</TableCell>
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
