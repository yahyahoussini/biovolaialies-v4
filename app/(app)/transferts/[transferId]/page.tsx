import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { DetailRow } from "@/components/domain/StatGrid";
import { repositories } from "@/data/repositories";
import { PHASE_LABEL } from "@/domain/production/lines";
import { TRANSFER_OBJECT_LABEL, TRANSFER_STATUS_LABEL } from "@/domain/production/flow";
import { AuthorizationError, NotFoundError } from "@/domain/shared/errors";
import { can, canAccessModule } from "@/domain/shared/permissions";
import { TRANSFER_TONE, when } from "@/lib/flow-labels";
import { getCurrentSession } from "@/services/auth/session";
import { getTransfer } from "@/services/production/transfers";
import { cancelTransferAction, disputeTransferAction, receiveTransferAction } from "../../lots/flow-actions";

export default async function TransferDetailPage({ params }: PageProps<"/transferts/[transferId]">) {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!canAccessModule(session, "LOTS") && !canAccessModule(session, "HATCHERY")) redirect("/non-autorise");
  const { transferId } = await params;
  let t: Awaited<ReturnType<typeof getTransfer>>;
  try {
    t = await getTransfer(transferId, session);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthorizationError) redirect("/non-autorise");
    throw error;
  }
  const [me, bvu, ledger] = await Promise.all([
    repositories.users.findById(session.userId),
    repositories.bvuIds.findByObject("TRANSFER", t.id),
    can(session, "VIEW", "INTEGRITY") ? repositories.ledger.listByObject("TRANSFER", t.id) : Promise.resolve([]),
  ]);
  const received = t.status !== "EN_TRANSIT" && t.status !== "ANNULE";
  const counted = received ? (t.quantityReceived ?? 0) + (t.deadOnArrival ?? 0) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Transferts", href: "/transferts" }, { label: t.code }]}
        title={`Transfert ${t.code}`}
        meta={<Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>}
        description={`${TRANSFER_OBJECT_LABEL[t.objectType]} ${t.objectLabel} · ${t.sourceLabel} → ${t.destinationLabel}${bvu ? ` · ${bvu.bvuId}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {t.canReceive ? (
              <FormDialog
                title="Réception — comptage contradictoire"
                description={`Comptez les ${t.objectType === "EGG_LOT" ? "œufs" : "animaux"} à l'arrivée sans regarder le bon : votre comptage est comparé à celui du départ (${t.quantitySent.toLocaleString("fr-FR")}).`}
                triggerLabel="Réceptionner"
                submitLabel="Signer la réception"
                action={receiveTransferAction}
                fields={[
                  { name: "transferId", label: "Transfert", type: "select", defaultValue: t.id, options: [{ value: t.id, label: t.code }] },
                  { name: "quantityReceived", label: t.objectType === "EGG_LOT" ? "Œufs reçus intacts" : "Reçus vivants", type: "number", required: true, half: true },
                  { name: "deadOnArrival", label: t.objectType === "EGG_LOT" ? "Œufs cassés" : "Morts à l'arrivée", type: "number", defaultValue: "0", half: true },
                  { name: "receivedAt", label: "Arrivée", type: "datetime-local", required: true },
                  { name: "discrepancyReason", label: "Explication de l'écart, s'il y en a un", type: "textarea" },
                  { name: "signerName", label: "Signature : votre nom complet", type: "text", required: true, placeholder: me?.fullName ?? "" },
                ]}
              />
            ) : null}
            {t.canCancel ? (
              <FormDialog
                title="Annuler le transfert"
                description="Seulement avant l'arrivée. Les animaux sont réintégrés au lot de départ."
                triggerLabel="Annuler"
                triggerVariant="secondary"
                action={cancelTransferAction}
                fields={[
                  { name: "transferId", label: "Transfert", type: "select", defaultValue: t.id, options: [{ value: t.id, label: t.code }] },
                  { name: "reason", label: "Motif", type: "textarea", required: true },
                ]}
              />
            ) : null}
            {received && t.status !== "LITIGE" ? (
              <FormDialog
                title="Contester ce transfert"
                description="Les comptages signés ne changent pas. La contestation s'ajoute, avec son motif, et le transfert passe en litige."
                triggerLabel="Contester"
                triggerVariant="secondary"
                action={disputeTransferAction}
                fields={[
                  { name: "transferId", label: "Transfert", type: "select", defaultValue: t.id, options: [{ value: t.id, label: t.code }] },
                  { name: "reason", label: "Motif", type: "textarea", required: true },
                ]}
              />
            ) : null}
          </div>
        }
      />

      {t.status === "RECU_AVEC_ECART" || t.status === "LITIGE" ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong">
          {t.quantitySent.toLocaleString("fr-FR")} comptés au départ, {counted?.toLocaleString("fr-FR")} comptés à l&apos;arrivée : écart de {t.discrepancy}. {t.discrepancyReason ? `Explication : ${t.discrepancyReason}.` : ""}
          {t.status === "LITIGE" && t.statusReason ? ` Litige : ${t.statusReason}.` : ""}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Départ</CardTitle>
            <CardDescription>Compté et signé par l&apos;expéditeur.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col text-sm">
            <DetailRow label="Quantité comptée" value={t.quantitySent.toLocaleString("fr-FR")} />
            <DetailRow label="Date" value={when(t.sentAt)} />
            <DetailRow label="Signé par" value={t.senderName} />
            <DetailRow label="Empreinte de signature" value={<code className="text-xs">{t.senderSignature.slice(0, 16)}…</code>} />
            <DetailRow label="Bon de livraison" value={t.documentRef ?? "—"} />
            <DetailRow label="Transport" value={[t.transporter, t.vehicle].filter(Boolean).join(" · ") || "—"} />
            <DetailRow label="Caisses" value={t.crates?.toLocaleString("fr-FR") ?? "—"} />
            {t.notes ? <DetailRow label="Observations" value={t.notes} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Arrivée</CardTitle>
            <CardDescription>Comptée et signée par une autre personne, du côté du destinataire.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col text-sm">
            {received ? (
              <>
                <DetailRow label={t.objectType === "EGG_LOT" ? "Reçus intacts" : "Reçus vivants"} value={t.quantityReceived?.toLocaleString("fr-FR") ?? "—"} />
                <DetailRow label={t.objectType === "EGG_LOT" ? "Cassés" : "Morts à l'arrivée"} value={t.deadOnArrival?.toLocaleString("fr-FR") ?? "0"} />
                <DetailRow label="Écart inexpliqué par les comptages" value={t.discrepancy === 0 ? "Aucun" : String(t.discrepancy)} />
                <DetailRow label="Date" value={when(t.receivedAt)} />
                <DetailRow label="Signé par" value={t.receiverName ?? "—"} />
                <DetailRow label="Empreinte de signature" value={t.receiverSignature ? <code className="text-xs">{t.receiverSignature.slice(0, 16)}…</code> : "—"} />
                {t.destinationLotId ? (
                  <DetailRow
                    label="Lot qui a reçu"
                    value={
                      <Link href={`/lots/${t.destinationLotId}`} className="text-bio-green underline">
                        {t.destinationLotLabel}
                      </Link>
                    }
                  />
                ) : null}
                {t.phaseOnArrival ? <DetailRow label="Phase à l'arrivée" value={PHASE_LABEL[t.phaseOnArrival]} /> : null}
              </>
            ) : t.status === "ANNULE" ? (
              <p className="text-secondary">Annulé avant l&apos;arrivée{t.statusReason ? ` : ${t.statusReason}` : ""}.</p>
            ) : (
              <p className="text-secondary">
                En attente du comptage à l&apos;arrivée{t.destinationLotLabel ? ` — lot ${t.destinationLotLabel}` : ""}
                {t.phaseOnArrival ? `, phase « ${PHASE_LABEL[t.phaseOnArrival]} »` : ""}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {ledger.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Journal chaîné</CardTitle>
            <CardDescription>Les deux signatures sont inscrites dans le journal : les modifier casserait la chaîne.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-xs">
              {ledger.map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3">
                  <span className="font-medium">#{e.seq} {e.eventType}</span> · {when(e.occurredAt)} · <code>{e.hash.slice(0, 12)}…</code>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
