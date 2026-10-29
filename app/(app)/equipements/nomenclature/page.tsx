import { Download } from "lucide-react";
import Link from "next/link";
import { EquipmentTabs } from "@/components/domain/EquipmentTabs";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { CABLING_SHARE_RANGE, NOMENCLATURE_FAMILIES, ORIGIN_LABEL, REFERENCE_CASE, SHEET_FIELDS } from "@/domain/equipment/nomenclature";
import { cn } from "@/lib/cn";
import { requireModuleAccess } from "@/services/auth/guard";
import { getNomenclature } from "@/services/equipment/nomenclature";

const mad = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} MAD`;
const range = (lo: number, hi: number) => `${Math.round(lo).toLocaleString("fr-FR")} à ${mad(hi)}`;
const pct = (v: number) => `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const CONFIDENCE_TONE = { haute: "success", moyenne: "info", faible: "warning" } as const;

export default async function NomenclaturePage({ searchParams }: PageProps<"/equipements/nomenclature">) {
  const session = await requireModuleAccess("EQUIPMENT");
  const { famille } = await searchParams;
  const view = await getNomenclature(session);
  const family = typeof famille === "string" && NOMENCLATURE_FAMILIES[famille] ? famille : null;
  const articles = family ? view.articles.filter((a) => a.family === family) : view.articles;
  const total = view.budget.find((b) => b.origin === "total")!;
  const gaps = view.budget.filter((b) => b.origin !== "total" && !b.agrees);
  const forgotten = SHEET_FIELDS.filter((f) => f.forgotten);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nomenclature d'achat"
        description={`Document 2, ch. 09 à 11 : les articles à acheter pour le cas de référence (${REFERENCE_CASE}), décrits par la fiche à quinze champs. Une ligne est achetable le jour où un fournisseur peut la chiffrer sans poser de question. Le budget est calculé ici, article par article : une quantité recalculée après relevé le change aussitôt.`}
        actions={
          <Button asChild size="sm" variant="secondary">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file served by a route handler, not a page */}
            <a href="/exports/nomenclature">
              <Download className="size-4" aria-hidden="true" />
              Exporter (CSV enregistré)
            </a>
          </Button>
        }
      />
      <EquipmentTabs active="/equipements/nomenclature" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Articles" value={view.articles.length} hint={`${total.units.toLocaleString("fr-FR")} unités au cas de référence`} />
        <StatCard label="Achetables tels quels" value={`${view.purchasable} / ${view.articles.length}`} tone={view.purchasable === view.articles.length ? "success" : "warning"} hint="Les quinze champs renseignés" />
        <StatCard label="Matériel, départ fournisseur" value={range(total.lowMad, total.highMad)} hint="Hors transport, assurance, douane et TVA" />
        <StatCard
          label="Câblage et connectique"
          value={`${pct(view.cabling.low)} à ${pct(view.cabling.high)}`}
          tone={view.cabling.withinRange ? "success" : "warning"}
          hint={`Courant : ${pct(CABLING_SHARE_RANGE[0])} à ${pct(CABLING_SHARE_RANGE[1])} du matériel (ch. 10)`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget par origine</CardTitle>
          <CardDescription>Quantité × bande de prix unitaire, article par article, comparé au chapitre 11 tel qu&apos;imprimé (arrondi au millier). Le bas de bande est le premier prix acceptable, le haut un matériel de marque établie.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table caption="Budget par origine">
            <TableHeader>
              <TableRow>
                <TableHead>Origine</TableHead>
                <TableHead>Articles</TableHead>
                <TableHead>Unités</TableHead>
                <TableHead>Calculé sur les articles</TableHead>
                <TableHead>Annoncé au ch. 11</TableHead>
                <TableHead>Concordance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.budget.map((b) => (
                <TableRow key={b.origin}>
                  <TableCell className={b.origin === "total" ? "font-semibold" : undefined}>{b.origin === "total" ? "Total" : ORIGIN_LABEL[b.origin]}</TableCell>
                  <TableCell>{b.articles}</TableCell>
                  <TableCell>{b.units.toLocaleString("fr-FR")}</TableCell>
                  <TableCell className={b.origin === "total" ? "font-semibold" : undefined}>{range(b.lowMad, b.highMad)}</TableCell>
                  <TableCell>{range(b.document.lowMad, b.document.highMad)}</TableCell>
                  <TableCell>{b.agrees ? <Badge tone="success">Concorde</Badge> : <Badge tone="warning">À clarifier</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {gaps.length ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong">
              Le total du chapitre 11 ne se déduit pas du tableau des articles du chapitre 09 pour {gaps.map((g) => (g.origin === "UE" ? "l'Union européenne" : `le ${g.origin}`)).join(" et ")}. La planche du chapitre 11 range dans le bloc Maroc des silos et des réservoirs qui ne
              figurent pas parmi les 106 articles. Écart à faire expliquer par le rédacteur du document avant les consultations : ce tableau ne choisit pas entre les deux.
            </p>
          ) : null}
          <p className="text-caption text-secondary">
            Transport (ch. 11) : groupage maritime 6 486 MAD, 33 à 49 jours ; fret aérien 25 856 MAD, 3 à 5 jours. Six semaines de retard décalent un cycle de production entier : l&apos;écart de fret se compare à la valeur d&apos;un cycle, pas au prix du matériel.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ce qui manque pour acheter</CardTitle>
            <CardDescription>
              Combien d&apos;articles ont chaque champ de la fiche. Les champs {forgotten.map((f) => f.no).join(", ")} sont ceux que tout le monde oublie — et qui font exploser le coût : le raccordement se chiffre mal, parce qu&apos;il dépend de distances que personne n&apos;a mesurées.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5">
              {SHEET_FIELDS.map((f) => {
                const n = view.coverage[f.key];
                return (
                  <li key={f.key} className="grid grid-cols-[2.5rem_minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-sm">
                    <span className="font-mono text-caption text-secondary">{f.no}</span>
                    <span className={cn("truncate", f.forgotten && "font-semibold text-warning-strong")} title={f.why}>
                      {f.label}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
                      <span className={cn("block h-full rounded-full", n === view.articles.length ? "bg-success" : f.forgotten ? "bg-warning" : "bg-bio-green")} style={{ width: `${(n / Math.max(1, view.articles.length)) * 100}%` }} />
                    </span>
                    <span className="text-right text-caption">
                      {n} / {view.articles.length}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Les seize familles</CardTitle>
            <CardDescription>Les familles marquées n&apos;existaient pas dans le budget d&apos;origine ; ce sont pourtant elles qui couvrent les risques les plus graves : la coupure de courant, la panne silencieuse, le couvoir aveugle.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table caption="Familles d'équipement">
              <TableHeader>
                <TableRow>
                  <TableHead>Famille</TableHead>
                  <TableHead>Art.</TableHead>
                  <TableHead>Unités</TableHead>
                  <TableHead>Achetables</TableHead>
                  <TableHead>Budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.families.map((f) => (
                  <TableRow key={f.family}>
                    <TableCell>
                      <Link className="focus-ring font-medium text-bio-green hover:underline" href={`/equipements/nomenclature?famille=${f.family}`}>
                        {f.family} · {NOMENCLATURE_FAMILIES[f.family].name}
                      </Link>
                      {NOMENCLATURE_FAMILIES[f.family].absentFromOriginalBudget ? (
                        <Badge tone="warning" className="ml-1.5">
                          absente du budget d&apos;origine
                        </Badge>
                      ) : null}
                      <span className="block text-caption text-secondary">{NOMENCLATURE_FAMILIES[f.family].purpose}</span>
                    </TableCell>
                    <TableCell>{f.articles}</TableCell>
                    <TableCell>{f.units}</TableCell>
                    <TableCell>{f.purchasable}</TableCell>
                    <TableCell className="text-xs">{range(f.lowMad, f.highMad)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Filtrer par famille">
        <Link href="/equipements/nomenclature" className={cn("focus-ring rounded-md px-2.5 py-1", !family ? "bg-bio-green/10 font-semibold text-bio-green" : "text-secondary hover:text-text")}>
          Toutes
        </Link>
        {Object.keys(NOMENCLATURE_FAMILIES).map((f) => (
          <Link
            key={f}
            href={`/equipements/nomenclature?famille=${f}`}
            className={cn("focus-ring rounded-md px-2.5 py-1", family === f ? "bg-bio-green/10 font-semibold text-bio-green" : "text-secondary hover:text-text")}
            title={NOMENCLATURE_FAMILIES[f].name}
          >
            {f}
          </Link>
        ))}
      </div>

      <Table caption={family ? `Articles — ${family} · ${NOMENCLATURE_FAMILIES[family].name}` : "Les 106 articles"}>
        <TableHeader>
          <TableRow>
            <TableHead>Réf.</TableHead>
            <TableHead>Article</TableHead>
            <TableHead>Qté</TableHead>
            <TableHead>Prix unitaire</TableHead>
            <TableHead>Confiance</TableHead>
            <TableHead>Origine</TableHead>
            <TableHead>Fiche</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {articles.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-caption">
                <Link className="focus-ring font-semibold text-bio-green hover:underline" href={`/equipements/nomenclature/${a.ref}`}>
                  {a.ref}
                </Link>
              </TableCell>
              <TableCell>
                {a.designation}
                {a.quantityFormula ? <span className="block text-caption text-secondary">Quantité : {a.quantityFormula}</span> : null}
              </TableCell>
              <TableCell>{a.quantity.toLocaleString("fr-FR")}</TableCell>
              <TableCell className="text-xs">{range(a.priceLowMad, a.priceHighMad)}</TableCell>
              <TableCell>
                <Badge tone={CONFIDENCE_TONE[a.priceConfidence]}>{a.priceConfidence}</Badge>
              </TableCell>
              <TableCell className="text-xs">{a.origin}</TableCell>
              <TableCell>{a.purchasable ? <Badge tone="success">Achetable</Badge> : <Badge tone="neutral">{a.filled} / 15</Badge>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
