import { notFound, redirect } from "next/navigation";
import { DataStatusBadge } from "@/components/domain/DataStatusBadge";
import { PageHeader } from "@/components/domain/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { AppError } from "@/domain/shared/errors";
import { requireModuleAccess } from "@/services/auth/guard";
import { getParentFlockDetail } from "@/services/hatchery/hatchery";

export default async function ParentFlockPage({ params }: PageProps<"/couvoir/reproducteurs/[flockId]">) {
  const session = await requireModuleAccess("HATCHERY");
  const { flockId } = await params;
  let detail;
  try {
    detail = await getParentFlockDetail(flockId, session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    if (error instanceof AppError && error.kind === "AUTHORIZATION") redirect("/non-autorise");
    throw error;
  }
  const { flock } = detail;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Couvoir & amont", href: "/couvoir" }, { label: flock.code }]}
        title={`Troupeau reproducteur ${flock.code}`}
        description={`${flock.strain} · ${detail.buildingLabel}`}
        meta={<DataStatusBadge status={flock.dataStatus} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>Origine génétique</CardTitle>
          <p className="text-xs text-secondary">Enregistrée à la mise en place ; non modifiable (une correction passe par un nouvel enregistrement motivé).</p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-secondary">Fournisseur</dt>
            <dd>{flock.geneticSupplier}</dd>
            <dt className="text-secondary">Pays d&apos;origine</dt>
            <dd>{flock.originCountry}</dd>
            <dt className="text-secondary">Référence d&apos;import</dt>
            <dd>{flock.importReference ?? "—"}</dd>
            <dt className="text-secondary">Mise en place</dt>
            <dd>{new Date(flock.placedAt).toLocaleDateString("fr-FR")}</dd>
            <dt className="text-secondary">Effectif</dt>
            <dd>
              {flock.femaleCount.toLocaleString("fr-FR")} femelles · {flock.maleCount.toLocaleString("fr-FR")} mâles
            </dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lots d&apos;œufs issus du troupeau</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot</TableHead>
                <TableHead>Collecte</TableHead>
                <TableHead>Œufs</TableHead>
                <TableHead>Mis en incubation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.eggLots.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.code}</TableCell>
                  <TableCell>{new Date(e.collectedAt).toLocaleDateString("fr-FR")}</TableCell>
                  <TableCell>{e.quantity.toLocaleString("fr-FR")}</TableCell>
                  <TableCell>{e.allocated.toLocaleString("fr-FR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
