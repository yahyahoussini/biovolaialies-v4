import { Truck } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { TRANSFER_OBJECT_LABEL, TRANSFER_STATUS_LABEL } from "@/domain/production/flow";
import { TRANSFER_TONE, when } from "@/lib/flow-labels";
import { canAccessModule } from "@/domain/shared/permissions";
import { getCurrentSession } from "@/services/auth/session";
import { listTransfers, type TransferRow } from "@/services/production/transfers";
import { redirect } from "next/navigation";
import { dispatchFromFormAction } from "./actions";
import { dispatchFields } from "./dispatch-fields";


function TransferTable({ rows, caption }: { rows: TransferRow[]; caption: string }) {
  return (
    <Table caption={caption}>
      <TableHeader>
        <TableRow>
          <TableHead>Transfert</TableHead>
          <TableHead>Objet</TableHead>
          <TableHead>De → vers</TableHead>
          <TableHead>Départ</TableHead>
          <TableHead>Arrivée</TableHead>
          <TableHead>État</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <Link href={`/transferts/${t.id}`} className="font-medium text-bio-green underline">
                {t.code}
              </Link>
              {t.documentRef ? <span className="block text-xs text-secondary">BL {t.documentRef}</span> : null}
            </TableCell>
            <TableCell>
              {TRANSFER_OBJECT_LABEL[t.objectType]}
              <span className="block text-xs text-secondary">{t.objectLabel}</span>
            </TableCell>
            <TableCell className="text-xs">
              {t.sourceLabel}
              <span className="block">→ {t.destinationLabel}</span>
              {t.destinationLotLabel ? <span className="block text-secondary">lot {t.destinationLotLabel}</span> : null}
            </TableCell>
            <TableCell className="text-xs">
              {t.quantitySent.toLocaleString("fr-FR")} comptés
              <span className="block text-secondary">
                {when(t.sentAt)} · {t.senderName}
              </span>
            </TableCell>
            <TableCell className="text-xs">
              {t.receivedAt ? (
                <>
                  {t.quantityReceived?.toLocaleString("fr-FR")} vivants{t.deadOnArrival ? ` + ${t.deadOnArrival} morts` : ""}
                  <span className="block text-secondary">
                    {when(t.receivedAt)} · {t.receiverName}
                  </span>
                </>
              ) : (
                <span className="text-secondary">en attente</span>
              )}
            </TableCell>
            <TableCell>
              <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>
              {t.discrepancy ? <span className="block text-xs text-warning-strong">écart {t.discrepancy > 0 ? "+" : ""}{t.discrepancy}</span> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function TransfersPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!canAccessModule(session, "LOTS") && !canAccessModule(session, "HATCHERY")) redirect("/non-autorise");
  const [rows, fields] = await Promise.all([listTransfers(session), dispatchFields(session)]);
  const toReceive = rows.filter((t) => t.canReceive);
  const inTransit = rows.filter((t) => t.status === "EN_TRANSIT");
  const issues = rows.filter((t) => t.status === "RECU_AVEC_ECART" || t.status === "LITIGE");
  const done = rows.filter((t) => t.status !== "EN_TRANSIT");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transferts"
        description="Tout changement de lieu ou de main : œufs vers le couvoir, poussins vers les élevages de croissance, animaux vers les élevages partenaires. Compté et signé au départ, compté et signé à l'arrivée par une autre personne ; l'écart entre les deux comptages reste enregistré."
        actions={fields ? <FormDialog title="Nouveau transfert — départ" description="Comptez avant de signer : votre comptage sera comparé à celui du destinataire." triggerLabel="Nouveau transfert" action={dispatchFromFormAction} fields={fields} submitLabel="Signer le départ" /> : null}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="À réceptionner par vous" value={toReceive.length} icon={Truck} tone={toReceive.length ? "warning" : "default"} />
        <StatCard label="En transit" value={inTransit.length} />
        <StatCard label="Écarts et litiges" value={issues.length} tone={issues.length ? "warning" : "success"} />
        <StatCard label="Réceptions concordantes" value={rows.filter((t) => t.status === "RECU_CONFORME").length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>À réceptionner</CardTitle>
          <CardDescription>Transferts arrivant dans votre périmètre. Ouvrez-en un pour saisir votre comptage et signer.</CardDescription>
        </CardHeader>
        <CardContent>{toReceive.length ? <TransferTable rows={toReceive} caption="Transferts à réceptionner" /> : <EmptyState title="Rien à réceptionner" description="Aucun transfert n'est en route vers vos sites." />}</CardContent>
      </Card>
      {issues.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Écarts et litiges</CardTitle>
            <CardDescription>Les deux comptages ne concordent pas, ou l&apos;une des parties conteste. Les comptages signés ne changent pas : l&apos;écart et son explication restent attachés au transfert.</CardDescription>
          </CardHeader>
          <CardContent>
            <TransferTable rows={issues} caption="Transferts avec écart ou litige" />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>En transit</CardTitle>
        </CardHeader>
        <CardContent>{inTransit.length ? <TransferTable rows={inTransit} caption="Transferts en transit" /> : <p className="text-sm text-secondary">Aucun transfert en route.</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
        </CardHeader>
        <CardContent>{done.length ? <TransferTable rows={done} caption="Historique des transferts" /> : <p className="text-sm text-secondary">Aucun transfert terminé.</p>}</CardContent>
      </Card>
    </div>
  );
}
