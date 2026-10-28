import { ScanLine } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { repositories } from "@/data/repositories";
import { BVU_KIND } from "@/domain/identity/bvu-id";
import { ID_ALIAS_SCHEME } from "@/domain/shared/enums";
import { ValidationError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { day } from "@/lib/flow-labels";
import { ENTITY_TYPE_LABEL } from "@/lib/labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { type ResolvedIdentifier } from "@/services/identity/bvu-ids";
import { resolveIdentifierInScope } from "@/services/identity/resolve-scoped";
import { addAliasAction, retireAliasAction } from "../lots/flow-actions";

const SCHEME_LABEL: Record<string, string> = { FOURNISSEUR: "Code fournisseur", RFID: "Puce RFID", BAGUE: "Bague", ANCIEN_CODE: "Ancien code", EAN: "Code EAN", AUTRE: "Autre" };
const VIA_LABEL: Record<ResolvedIdentifier["via"], string> = { BVU: "Identifiant BIOVOLAILLES", ALIAS: "Code externe rattaché", CODE_METIER: "Code métier", COQUILLE: "Code imprimé sur la coquille" };
const TYPE_LABEL: Record<string, string> = {
  ...ENTITY_TYPE_LABEL,
  SUBJECT: "Sujet identifié",
  TRANSFER: "Transfert",
  QUALITY_CASE: "Blocage qualité",
  SAMPLE: "Échantillon",
  PACKAGE: "Plateau ou colis",
  CRATE: "Caisse",
  SENSOR: "Capteur",
  ASSET: "Équipement",
};

async function hrefFor(r: ResolvedIdentifier): Promise<string | null> {
  switch (r.objectType) {
    case "LOT":
      return `/lots/${r.objectId}`;
    case "PARENT_FLOCK":
      return `/couvoir/reproducteurs/${r.objectId}`;
    case "HATCH_CYCLE":
      return `/couvoir/cycles/${r.objectId}`;
    case "TABLE_EGG_LOT":
      return r.markingRunId ? `/marquage/${r.markingRunId}` : `/oeufs-consommation/${r.objectId}`;
    case "EGG_LOT":
      return r.markingRunId ? `/marquage/${r.markingRunId}` : null;
    case "PACKAGE": {
      const tray = await repositories.marking.findTray(r.objectId);
      return tray ? `/marquage/${tray.runId}` : null;
    }
    case "TRANSFER":
      return `/transferts/${r.objectId}`;
    case "SUBJECT": {
      const subject = await repositories.subjects.findById(r.objectId);
      return subject ? `/lots/${subject.lotId}/sujets` : null;
    }
    default:
      return null;
  }
}

export default async function IdentifiersPage({ searchParams }: PageProps<"/identifiants">) {
  const session = await requireModuleAccess("TRACEABILITY");
  const q = String((await searchParams).q ?? "").trim();
  let results: ResolvedIdentifier[] = [];
  let error: string | null = null;
  if (q) {
    try {
      results = await resolveIdentifierInScope(q, session);
    } catch (e) {
      if (e instanceof ValidationError) error = e.message;
      else throw e;
    }
  }
  const enriched = await Promise.all(
    results.map(async (r) => ({ ...r, href: await hrefFor(r), aliases: r.bvuId ? await repositories.identifierAliases.listByBvuId(r.bvuId) : [] }))
  );
  const canEdit = can(session, "EDIT", "TRACEABILITY") || can(session, "CREATE", "HATCHERY");
  const canRetire = can(session, "VALIDATE", "TRACEABILITY") || can(session, "EDIT", "HATCHERY");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Identifiants"
        description="L'identifiant BIOVOLAILLES est l'objet auquel toutes les données se rattachent, du premier œuf jusqu'au point de vente. Les codes des fournisseurs, bagues et puces y sont rattachés comme alias : ils ne le remplacent jamais."
      />
      <Card>
        <CardHeader>
          <CardTitle>Retrouver un objet</CardTitle>
          <CardDescription>Tapez ou scannez un identifiant BIOVOLAILLES, un code fournisseur, une bague, une puce ou un code de lot. Un identifiant au chiffre de contrôle faux est refusé, jamais deviné.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap gap-2" action="/identifiants">
            <label htmlFor="q" className="sr-only">
              Code
            </label>
            <input id="q" name="q" defaultValue={q} autoFocus placeholder="BVU-FLK-… ou HB-77812" className="focus-ring min-w-64 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm" />
            <button type="submit" className="focus-ring inline-flex items-center gap-2 rounded-md bg-bio-green px-4 py-2 text-sm font-medium text-white">
              <ScanLine className="size-4" aria-hidden="true" />
              Rechercher
            </button>
          </form>
          <p className="mt-2 text-xs text-secondary">Préfixes : {Object.entries(BVU_KIND).map(([type, kind]) => `${kind} = ${TYPE_LABEL[type] ?? type.toLowerCase()}`).join(" · ")}</p>
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical-strong">
          {error}
        </p>
      ) : null}
      {q && !error && enriched.length === 0 ? <EmptyState title="Aucun objet" description={`Le code « ${q} » ne désigne aucun objet connu.`} /> : null}
      {enriched.length > 1 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong">Ce code désigne plusieurs objets : vérifiez lequel vous cherchez avant d&apos;agir.</p>
      ) : null}

      {enriched.map((r) => (
        <Card key={`${r.objectType}:${r.objectId}`}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {TYPE_LABEL[r.objectType] ?? r.objectType} {r.href ? <Link href={r.href} className="text-bio-green underline">ouvrir →</Link> : null}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">{VIA_LABEL[r.via]}</Badge>
                {canEdit && r.bvuId ? (
                  <FormDialog
                    title="Rattacher un code externe"
                    description="Le code d'un fournisseur, une bague ou une puce désignant cet objet. Une puce ou une bague active ne peut désigner qu'un seul objet."
                    triggerLabel="Rattacher un code"
                    triggerVariant="secondary"
                    action={addAliasAction}
                    fields={[
                      { name: "bvuId", label: "Identifiant", type: "select", defaultValue: r.bvuId, options: [{ value: r.bvuId, label: r.bvuId }] },
                      { name: "scheme", label: "Nature du code", type: "select", required: true, half: true, options: ID_ALIAS_SCHEME.map((s) => ({ value: s, label: SCHEME_LABEL[s] })) },
                      { name: "issuer", label: "Émetteur (fournisseur…)", type: "text", half: true },
                      { name: "value", label: "Code", type: "text", required: true },
                      { name: "reason", label: "Contexte", type: "textarea" },
                    ]}
                  />
                ) : null}
              </div>
            </div>
            <CardDescription>
              {r.bvuId ? (
                <code className="text-sm">{r.bvuId}</code>
              ) : (
                "Pas encore d'identifiant BIOVOLAILLES : il est attribué à la création des nouveaux objets."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {r.aliases.length === 0 ? (
              <p className="text-sm text-secondary">Aucun code externe rattaché.</p>
            ) : (
              <Table caption="Codes externes rattachés">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nature</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Émetteur</TableHead>
                    <TableHead>Validité</TableHead>
                    <TableHead>Motif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.aliases.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{SCHEME_LABEL[a.scheme]}</TableCell>
                      <TableCell className="font-medium">{a.value}</TableCell>
                      <TableCell>{a.issuer || "—"}</TableCell>
                      <TableCell>
                        {day(a.validFrom)} → {a.validTo ? day(a.validTo) : <Badge tone="success">actif</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.reason ?? "—"}
                        {canRetire && !a.validTo ? (
                          <span className="ml-2 inline-block">
                            <FormDialog
                              title="Retirer ce code"
                              description="Le code reste dans l'historique de l'objet avec sa période de validité."
                              triggerLabel="Retirer"
                              triggerVariant="ghost"
                              action={retireAliasAction}
                              fields={[
                                { name: "aliasId", label: "Code", type: "select", defaultValue: a.id, options: [{ value: a.id, label: a.value }] },
                                { name: "reason", label: "Motif", type: "textarea", required: true },
                              ]}
                            />
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
