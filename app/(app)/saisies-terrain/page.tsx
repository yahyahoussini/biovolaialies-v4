import { Smartphone } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { CORRECTION_WINDOW_DAYS, FIELD_KIND_LABEL, FIELD_STATUS_LABEL, type FieldStatus } from "@/domain/field/field";
import { day, when } from "@/lib/flow-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getFieldActivity } from "@/services/field/activity";
import { resolveDiscrepancyAction } from "./actions";

const STATUS_TONE: Record<FieldStatus, "success" | "warning" | "critical" | "neutral"> = { APPLIQUEE: "success", CONFIRMEE: "success", EN_ECART: "warning", REFUSEE: "critical" };

/**
 * What the phones sent (document 3, ch. 05): every entry kept with its outcome, and the days whose
 * mortality declarations disagree, for a manager to settle. Nothing here edits an entry.
 */
export default async function FieldEntriesPage() {
  const session = await requireModuleAccess("EVENTS");
  const activity = await getFieldActivity(session);
  const open = activity.discrepancies.filter((d) => d.status === "OUVERT");
  const settled = activity.discrepancies.filter((d) => d.status === "RESOLU").slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Saisies terrain"
        description="Ce que les téléphones ont envoyé, dans l'ordre où ils l'ont saisi. Une saisie n'est jamais effacée ni écrasée : appliquée, confirmée, signalée en écart ou refusée avec sa raison."
        actions={
          <Link href="/terrain" className="inline-flex h-10 items-center gap-2 rounded-lg bg-bio-green px-4 text-sm font-semibold text-white">
            <Smartphone className="size-4" aria-hidden="true" /> Ouvrir l&apos;application terrain
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Reçues aujourd'hui" value={activity.stats.receivedToday.toLocaleString("fr-FR")} icon={Smartphone} />
        <StatCard label="Écarts à arbitrer" value={activity.stats.openDiscrepancies.toLocaleString("fr-FR")} tone={activity.stats.openDiscrepancies > 0 ? "warning" : "default"} />
        <StatCard label="Refusées sur 7 jours" value={activity.stats.refusedWeek.toLocaleString("fr-FR")} hint="avec la raison, visible aussi sur le téléphone" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Écarts de mortalité à arbitrer</CardTitle>
          <CardDescription>
            Deux déclarations différentes pour le même lot et le même jour : les deux sont gardées, la plus récente s&apos;affiche, et l&apos;effectif attend votre arbitrage. Le système ne rend jamais de sujets de lui-même. Arbitrage possible pendant {CORRECTION_WINDOW_DAYS} jours, ensuite par l&apos;administrateur seulement (règle à confirmer par le propriétaire).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {open.length === 0 ? <p className="text-sm text-secondary">Aucun écart ouvert.</p> : null}
          {open.map((d) => (
            <div key={d.id} className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {d.lotCode} · {day(`${d.day}T12:00:00Z`)}
                  </p>
                  <p className="text-sm text-secondary">{d.farmName}</p>
                </div>
                {d.canResolve ? (
                  <FormDialog
                    title={`Arbitrer la mortalité du ${day(`${d.day}T12:00:00Z`)}`}
                    description={`${d.lotCode} : ${d.applied} morts sont enregistrés pour ce jour. Indiquez le chiffre retenu ; seule la différence est passée, en plus ou en contre-passation.`}
                    triggerLabel="Arbitrer"
                    action={resolveDiscrepancyAction}
                    fields={[
                      { name: "discrepancyId", label: "Écart", type: "select", defaultValue: d.id, options: [{ value: d.id, label: `${d.lotCode} — ${d.day}` }] },
                      { name: "count", label: "Mortalité retenue pour le jour", type: "number", required: true },
                      { name: "note", label: "Justification", type: "textarea", required: true, placeholder: "Recompté avec l'éleveur, registre papier…" },
                    ]}
                  />
                ) : d.windowClosed ? (
                  <Badge tone="neutral">Délai d&apos;arbitrage dépassé</Badge>
                ) : null}
              </div>
              <p className="text-sm">{d.reason}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Déclaré par</TableHead>
                    <TableHead>Saisi le</TableHead>
                    <TableHead>Morts</TableHead>
                    <TableHead>Suite</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.declarations.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell>{x.authorName}</TableCell>
                      <TableCell className="text-xs">{when(x.capturedAt)}</TableCell>
                      <TableCell>{x.count.toLocaleString("fr-FR")}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[x.status]}>{FIELD_STATUS_LABEL[x.status]}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          {settled.length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-secondary">Derniers arbitrages ({settled.length})</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {settled.map((d) => (
                  <li key={d.id}>
                    {d.lotCode} · {d.day} : {d.resolvedCount} retenus — {d.resolutionNote}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dernières saisies reçues</CardTitle>
          <CardDescription>Heure de saisie sur le téléphone, puis heure de réception : l&apos;écart dit combien de temps le téléphone est resté sans réseau.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Saisie</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Par</TableHead>
                <TableHead>Saisie le</TableHead>
                <TableHead>Reçue le</TableHead>
                <TableHead>Suite</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.entries.length === 0 ? <TableEmpty colSpan={6}>Aucune saisie terrain reçue pour l&apos;instant.</TableEmpty> : null}
              {activity.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{FIELD_KIND_LABEL[e.kind]}</TableCell>
                  <TableCell>{e.lotId && e.lotCode ? <Link href={`/lots/${e.lotId}`} className="text-bio-green underline">{e.lotCode}</Link> : "—"}</TableCell>
                  <TableCell className="text-xs">{e.authorName}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{when(e.capturedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{when(e.receivedAt)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[e.status]}>{FIELD_STATUS_LABEL[e.status]}</Badge>
                    {e.message ? <span className="mt-1 block max-w-xs text-xs text-secondary">{e.message}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
