import { PageHeader } from "@/components/domain/PageHeader";
import { requireModuleAccess } from "@/services/auth/guard";
import { STRUCTURE_COLUMNS } from "@/services/identity/structure";
import { StructureImport } from "./StructureImport";

export default async function StructureImportPage() {
  await requireModuleAccess("FARMS");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Structure des élevages", href: "/structure" }, { label: "Import" }]}
        title="Importer la structure"
        description="Un tableur, une ligne par bâtiment. Le fichier est d'abord vérifié en entier ; une seule ligne fausse et rien n'est enregistré. Ce qui existe déjà (même nom sous le même parent, même code de bâtiment) est retrouvé, jamais dupliqué."
      />
      <div className="rounded-md border border-border bg-surface p-4 text-sm text-text">
        <p>
          <a href="/structure/modele" className="font-medium text-bio-green underline underline-offset-2">
            Télécharger le modèle
          </a>{" "}
          (séparateur « ; », ouvert directement par Excel). La ligne commençant par « EXEMPLE » est ignorée.
        </p>
        <p className="mt-2 text-xs text-secondary">Colonnes : {STRUCTURE_COLUMNS.join(" ; ")}</p>
        <p className="mt-1 text-xs text-secondary">
          type_organisation : Interne, Coopérative ou Groupement de producteurs (vide = Interne) · type_zone : Élevage, Couvoir, Stockage ou Autre ·
          region_cooperative vide = région de la ferme · latitude et longitude facultatives.
        </p>
      </div>
      <StructureImport />
    </div>
  );
}
