import { notFound } from "next/navigation";
import { EquipmentTabs } from "@/components/domain/EquipmentTabs";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { NOMENCLATURE_FAMILIES, ORIGIN_LABEL, PRICE_CONFIDENCE, PRICE_CONFIDENCE_LABEL, SHEET_FIELDS, type NomenclatureArticle, type SheetFieldKey } from "@/domain/equipment/nomenclature";
import { AppError } from "@/domain/shared/errors";
import { can } from "@/domain/shared/permissions";
import { isGlobalScope } from "@/domain/shared/scope";
import { cn } from "@/lib/cn";
import { requireModuleAccess } from "@/services/auth/guard";
import { getNomenclatureArticle } from "@/services/equipment/nomenclature";
import { updateNomenclatureAction } from "../../actions";

const when = (v: string) => new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "short" });

/** What each field shows, and what an empty field means for the buyer. */
function valueOf(a: NomenclatureArticle, key: SheetFieldKey): string | null {
  switch (key) {
    case "ref":
      return a.ref;
    case "designation":
      return a.designation;
    case "quantity":
      return `${a.quantity.toLocaleString("fr-FR")} au cas de référence${a.quantityFormula ? ` — ${a.quantityFormula}` : " — formule à établir après relevé"}`;
    case "price":
      return `${a.priceLowMad.toLocaleString("fr-FR")} à ${a.priceHighMad.toLocaleString("fr-FR")} MAD l'unité, départ fournisseur — confiance ${a.priceConfidence} — ${a.priceDate ? `bande du ${new Date(a.priceDate).toLocaleDateString("fr-FR")}` : "date de la bande à renseigner"}`;
    default:
      return a[key];
  }
}

export default async function NomenclatureArticlePage({ params }: { params: Promise<{ ref: string }> }) {
  const session = await requireModuleAccess("EQUIPMENT");
  const { ref } = await params;
  let sheet: Awaited<ReturnType<typeof getNomenclatureArticle>>;
  try {
    sheet = await getNomenclatureArticle(decodeURIComponent(ref), session);
  } catch (error) {
    if (error instanceof AppError && error.kind === "NOT_FOUND") notFound();
    throw error;
  }
  const { article: a, status, implantation, recipe, history } = sheet;
  const filled = Object.values(status).filter(Boolean).length;
  const canEdit = can(session, "EDIT", "EQUIPMENT") && isGlobalScope(session);
  const family = NOMENCLATURE_FAMILIES[a.family];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Équipements", href: "/equipements" }, { label: "Nomenclature", href: "/equipements/nomenclature" }, { label: a.ref }]}
        title={`${a.ref} — ${a.designation}`}
        description={`Famille ${a.family} · ${family?.name ?? ""} : ${family?.purpose ?? ""}. ${ORIGIN_LABEL[a.origin]}.`}
        meta={filled === SHEET_FIELDS.length ? <Badge tone="success">Achetable telle quelle</Badge> : <Badge tone="warning">{filled} / 15 champs renseignés</Badge>}
        actions={
          canEdit ? (
            <FormDialog
              title={`Compléter la fiche ${a.ref}`}
              description="Après relevé, consultation ou essai. Chaque champ modifié est tracé avec sa valeur avant et après."
              triggerLabel="Compléter la fiche"
              action={updateNomenclatureAction}
              submitLabel="Enregistrer la fiche"
              fields={[
                { name: "ref", label: "Article", type: "select", defaultValue: a.ref, options: [{ value: a.ref, label: a.ref }], half: true },
                { name: "manufacturer", label: "03 Fabricant / type", type: "text", defaultValue: a.manufacturer ?? "", placeholder: "Marque et modèle, ou « équivalent » + caractéristiques", half: true },
                { name: "quantity", label: "04 Quantité (cas de référence)", type: "number", defaultValue: String(a.quantity), required: true, half: true },
                { name: "quantityFormula", label: "04 Formule", type: "text", defaultValue: a.quantityFormula ?? "", placeholder: "2 par zone + 2 par bâtiment", half: true },
                { name: "location", label: "05 Emplacement", type: "textarea", defaultValue: a.location ?? "" },
                { name: "function", label: "06 Fonction (la décision permise)", type: "textarea", defaultValue: a.function ?? "" },
                { name: "specifications", label: "07 Spécifications", type: "text", defaultValue: a.specifications ?? "", placeholder: "Étendue · précision · protection · alimentation" },
                { name: "communication", label: "08 Communication", type: "text", defaultValue: a.communication ?? "", placeholder: "Modbus RTU sur RS-485", half: true },
                { name: "power", label: "09 Alimentation", type: "text", defaultValue: a.power ?? "", placeholder: "24 V continu depuis l'armoire", half: true },
                { name: "connectors", label: "10 Connecteurs", type: "text", defaultValue: a.connectors ?? "", half: true },
                { name: "cables", label: "11 Câbles", type: "text", defaultValue: a.cables ?? "", placeholder: "Nature, section, blindage, longueur, chemin", half: true },
                { name: "priceLowMad", label: "12 Prix unitaire bas (MAD)", type: "number", defaultValue: String(a.priceLowMad), required: true, half: true },
                { name: "priceHighMad", label: "12 Prix unitaire haut (MAD)", type: "number", defaultValue: String(a.priceHighMad), required: true, half: true },
                { name: "priceConfidence", label: "12 Confiance", type: "select", defaultValue: a.priceConfidence, options: PRICE_CONFIDENCE.map((c) => ({ value: c, label: PRICE_CONFIDENCE_LABEL[c] })), half: true },
                { name: "priceDate", label: "12 Date de la bande", type: "date", defaultValue: a.priceDate ?? "", half: true },
                { name: "installation", label: "13 Installation", type: "textarea", defaultValue: a.installation ?? "", placeholder: "Qui pose, avec quoi, en combien de temps, ce qu'il faut couper" },
                { name: "spares", label: "14 Pièces de rechange", type: "text", defaultValue: a.spares ?? "", half: true },
                { name: "maintenance", label: "15 Maintenance", type: "text", defaultValue: a.maintenance ?? "", half: true },
                { name: "reason", label: "D'où vient la modification", type: "text", required: true, placeholder: "Relevé du 12/11, consultation fournisseur n°2…" },
              ]}
            />
          ) : null
        }
      />
      <EquipmentTabs active="/equipements/nomenclature" />

      <Table caption="Fiche à quinze champs (document 2, ch. 10)">
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead>
            <TableHead>Champ</TableHead>
            <TableHead>Valeur</TableHead>
            <TableHead>Pourquoi ce champ existe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SHEET_FIELDS.map((f) => {
            const value = valueOf(a, f.key);
            return (
              <TableRow key={f.key}>
                <TableCell className="font-mono text-caption">{f.no}</TableCell>
                <TableCell className={cn("font-medium", f.forgotten && "text-warning-strong")}>
                  {f.label}
                  {f.forgotten ? <span className="block text-caption font-normal">souvent oublié</span> : null}
                </TableCell>
                <TableCell>
                  {value ? <span className={status[f.key] ? undefined : "text-secondary"}>{value}</span> : <Badge tone="warning">À renseigner</Badge>}
                  {value && !status[f.key] ? (
                    <Badge tone="warning" className="ml-1.5">
                      incomplet
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-caption text-secondary">{f.why}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {implantation ? (
          <Card>
            <CardHeader>
              <CardTitle>Fiche d&apos;implantation (ch. 02)</CardTitle>
              <CardDescription>Où il se pose, la décision qu&apos;il alimente, et l&apos;erreur classique qui le rend inutile.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-secondary">Emplacement</dt>
                <dd>{implantation.placement}</dd>
                <dt className="text-secondary">Décision</dt>
                <dd>{implantation.decision}</dd>
                <dt className="text-secondary">Fréquence</dt>
                <dd>{implantation.frequency}</dd>
                <dt className="text-secondary">Erreur classique</dt>
                <dd className="text-warning-strong">{implantation.classicError}</dd>
              </dl>
            </CardContent>
          </Card>
        ) : null}
        {recipe ? (
          <Card>
            <CardHeader>
              <CardTitle>Recette de mise en service (annexe A)</CardTitle>
              <CardDescription>Le test qui prouve que la pose est bonne, consigné bâtiment par bâtiment sous « Mise en service ».</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">{recipe.test}</CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historique de la fiche</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-secondary">Aucune modification depuis le chargement du document 2.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {history.map((h) => (
                <li key={`${h.at}-${h.field}`}>
                  <span className="text-secondary">{when(h.at)}</span> — {h.actor} — <span className="font-medium">{h.field}</span> : {h.oldValue ?? "—"} → {h.newValue ?? "—"}
                  {h.reason ? <span className="block text-caption text-secondary">{h.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
