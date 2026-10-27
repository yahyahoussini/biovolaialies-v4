import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { DetailRow } from "@/components/domain/StatGrid";
import { repositories } from "@/data/repositories";
import { AuthorizationError, NotFoundError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { day, EGG_TYPE_LABEL, TABLE_EGG_STATUS_LABEL, when } from "@/lib/flow-labels";
import { DATA_STATUS_LABEL } from "@/lib/status-colors";
import { requireModuleAccess } from "@/services/auth/guard";
import { describeActiveHolds } from "@/services/quality/holds";
import { getTableEggLot } from "@/services/production/table-eggs";
import { changeTableEggStatusAction } from "../../lots/flow-actions";

const NEXT: Record<string, string[]> = { EN_STOCK: ["CONDITIONNE", "DETRUIT"], CONDITIONNE: ["EXPEDIE", "DETRUIT"], EXPEDIE: [], DETRUIT: [] };

export default async function TableEggLotPage({ params }: PageProps<"/oeufs-consommation/[eggLotId]">) {
  const session = await requireModuleAccess("LOTS");
  const { eggLotId } = await params;
  let eggs: Awaited<ReturnType<typeof getTableEggLot>>;
  try {
    eggs = await getTableEggLot(eggLotId, session);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthorizationError) redirect("/non-autorise");
    throw error;
  }
  const [bvu, holds] = await Promise.all([repositories.bvuIds.findByObject("TABLE_EGG_LOT", eggs.id), describeActiveHolds("TABLE_EGG_LOT", eggs.id)]);
  const next = NEXT[eggs.status];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Œufs de consommation", href: "/oeufs-consommation" }, { label: eggs.code }]}
        title={`Collecte ${eggs.code}`}
        meta={<Badge tone="info">{TABLE_EGG_STATUS_LABEL[eggs.status]}</Badge>}
        description={`Œuf ${EGG_TYPE_LABEL[eggs.eggType]} · lot ${eggs.lotCode} · ${eggs.farmName}${bvu ? ` · ${bvu.bvuId}` : ""}`}
        actions={
          can(session, "EDIT", "TRACEABILITY") && next.length ? (
            <FormDialog
              title="Changer l'état de la collecte"
              triggerLabel="Changer l'état"
              triggerVariant="secondary"
              action={changeTableEggStatusAction}
              fields={[
                { name: "id", label: "Collecte", type: "select", defaultValue: eggs.id, options: [{ value: eggs.id, label: eggs.code }] },
                { name: "status", label: "Nouvel état", type: "select", required: true, options: next.map((s) => ({ value: s, label: TABLE_EGG_STATUS_LABEL[s] })) },
                { name: "reason", label: "Motif (obligatoire pour une destruction)", type: "textarea" },
              ]}
            />
          ) : null
        }
      />
      {holds.length ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
          Sous blocage qualité ({holds.map((h) => h.code).join(", ")}) : ces œufs ne peuvent être ni conditionnés ni expédiés.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Classement à la collecte</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col text-sm">
            <DetailRow label="Collectés" value={eggs.quantity.toLocaleString("fr-FR")} />
            <DetailRow label="Vendables" value={eggs.saleable.toLocaleString("fr-FR")} />
            <DetailRow label="Fêlés" value={eggs.cracked.toLocaleString("fr-FR")} />
            <DetailRow label="Sales" value={eggs.dirty.toLocaleString("fr-FR")} />
            <DetailRow label="Petits" value={eggs.small.toLocaleString("fr-FR")} />
            <DetailRow label="Déclassement" value={`${eggs.downgradePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Origine et preuve</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col text-sm">
            <DetailRow
              label="Lot de pondeuses"
              value={
                <Link href={`/lots/${eggs.lotId}`} className="text-bio-green underline">
                  {eggs.lotCode}
                </Link>
              }
            />
            <DetailRow label="Jour de collecte" value={day(eggs.collectedOn)} />
            <DetailRow label="Identifiant BIOVOLAILLES" value={bvu?.bvuId ?? "—"} />
            <DetailRow label="Statut des données" value={DATA_STATUS_LABEL[eggs.dataStatus]} />
            <DetailRow label="Enregistré le" value={when(eggs.createdAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
