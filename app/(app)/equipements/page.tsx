import { Download } from "lucide-react";
import { FormDialog } from "@/components/domain/FormDialog";
import { EquipmentTabs } from "@/components/domain/EquipmentTabs";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { EQUIPMENT_STATUS_LABEL } from "@/domain/equipment/types";
import { can } from "@/domain/shared/permissions";
import type { BadgeTone } from "@/lib/status-colors";
import { requireModuleAccess } from "@/services/auth/guard";
import { listEquipment, summarize } from "@/services/equipment/equipment";
import { updateEquipmentAction } from "./actions";

const CATEGORY_TONE: Record<string, BadgeTone> = {
  "Existant client": "neutral",
  "BVU Tech — base": "success",
  "BVU Tech — option": "info",
  Consommable: "gold",
};

function qty(value: number | null, category: string): string {
  if (value !== null) return value.toLocaleString("fr-FR");
  return category === "Consommable" ? "À dimensionner" : "—";
}

export default async function EquipmentPage({ searchParams }: PageProps<"/equipements">) {
  const session = await requireModuleAccess("EQUIPMENT");
  const { unite, categorie } = await searchParams;
  const all = await listEquipment(session);
  const items = all.filter((i) => (typeof unite !== "string" || i.unitCode === unite) && (typeof categorie !== "string" || i.category === categorie));
  const summary = summarize(all);
  const categories = [...new Set(all.map((i) => i.category))];
  const canEdit = can(session, "EDIT", "EQUIPMENT");

  const filterHref = (u?: string, c?: string) => {
    const params = new URLSearchParams();
    if (u) params.set("unite", u);
    if (c) params.set("categorie", c);
    const q = params.toString();
    return q ? `/equipements?${q}` : "/equipements";
  };
  const u = typeof unite === "string" ? unite : undefined;
  const c = typeof categorie === "string" ? categorie : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Équipements par unité"
        description="Matériel existant chez le client et matériel à installer par BVU Tech, avec les caractéristiques à exiger. Quantités de référence à confirmer par l'audit de site."
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href={`/equipements/export${filterHref(u, c).replace("/equipements", "")}`}>
              <Download className="size-4" aria-hidden="true" />
              Exporter (CSV)
            </a>
          </Button>
        }
      />
      <EquipmentTabs active="/equipements" />

      <Card>
        <CardHeader>
          <CardTitle>Synthèse par unité de référence</CardTitle>
          <p className="text-xs text-secondary">Recalculée en direct — mêmes indicateurs que la feuille « Synthese » du classeur client.</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unité</TableHead>
                <TableHead>Existant client</TableHead>
                <TableHead>Base BVU (réf. / qté)</TableHead>
                <TableHead>Options (réf. / qté réf. / max)</TableHead>
                <TableHead>Consommables</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((s) => (
                <TableRow key={s.unitCode}>
                  <TableCell className="font-medium">{s.unitLabel}</TableCell>
                  <TableCell>{s.existing}</TableCell>
                  <TableCell>
                    {s.baseRefs} / {s.baseQty}
                  </TableCell>
                  <TableCell>
                    {s.optionRefs} / {s.optionQtyRef} / {s.optionQtyMax}
                  </TableCell>
                  <TableCell>{s.consumables}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
        Règle de sécurité : interfaces avec les automates en lecture seule. Aucune commande machine sans autorisation écrite et
        étude de risques. Aucun modèle, prix ni délai n&apos;est fixé ici : à obtenir par demande de devis.
      </p>

      <nav aria-label="Filtres" className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-3">
          <span className="text-secondary">Unité :</span>
          <a href={filterHref(undefined, c)} className={!u ? "font-semibold" : "text-bio-green underline"}>Toutes</a>
          {summary.map((s) => (
            <a key={s.unitCode} href={filterHref(s.unitCode, c)} className={u === s.unitCode ? "font-semibold" : "text-bio-green underline"}>
              {s.unitLabel}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <span className="text-secondary">Catégorie :</span>
          <a href={filterHref(u, undefined)} className={!c ? "font-semibold" : "text-bio-green underline"}>Toutes</a>
          {categories.map((cat) => (
            <a key={cat} href={filterHref(u, cat)} className={c === cat ? "font-semibold" : "text-bio-green underline"}>
              {cat}
            </a>
          ))}
        </div>
      </nav>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unité</TableHead>
            <TableHead>Équipement</TableHead>
            <TableHead>Catégorie</TableHead>
            <TableHead>Qté réf. / max</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Caractéristiques à exiger</TableHead>
            {canEdit ? <TableHead className="text-right">Action</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              <TableCell>{i.unitCode}</TableCell>
              <TableCell>
                <span className="font-medium">{i.name}</span>
                {i.reference ? <span className="block text-xs text-secondary">{i.reference}</span> : null}
                {i.decisionRule ? <span className="block text-xs text-secondary">{i.decisionRule}</span> : null}
              </TableCell>
              <TableCell>
                <Badge tone={CATEGORY_TONE[i.category] ?? "neutral"}>{i.category}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {qty(i.quantityRef, i.category)} / {qty(i.quantityMax, i.category)}
              </TableCell>
              <TableCell>{i.status ? `${i.status} — ${EQUIPMENT_STATUS_LABEL[i.status] ?? ""}` : "—"}</TableCell>
              <TableCell className="max-w-md text-xs text-secondary">
                {i.characteristics}
                {i.candidates && i.candidates !== "Client" ? <span className="mt-1 block">Candidats : {i.candidates}</span> : null}
              </TableCell>
              {canEdit ? (
                <TableCell className="text-right">
                  <FormDialog
                    title={`Mettre à jour après audit — ${i.name}`}
                    triggerLabel="Modifier"
                    triggerVariant="ghost"
                    submitLabel="Enregistrer"
                    action={updateEquipmentAction}
                    fields={[
                      { name: "id", label: "Ligne", type: "select", defaultValue: i.id, options: [{ value: i.id, label: `${i.unitCode} · ${i.name}` }] },
                      { name: "quantityRef", label: "Qté réf.", type: "number", defaultValue: i.quantityRef?.toString() ?? "", half: true },
                      { name: "quantityMax", label: "Qté max", type: "number", defaultValue: i.quantityMax?.toString() ?? "", half: true },
                      { name: "status", label: "Statut", type: "select", defaultValue: i.status ?? "N", options: Object.entries(EQUIPMENT_STATUS_LABEL).map(([k, v]) => ({ value: k, label: `${k} — ${v}` })) },
                      { name: "decisionRule", label: "Remarque / règle de décision", type: "textarea", defaultValue: i.decisionRule ?? "" },
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
