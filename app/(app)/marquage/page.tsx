import { ScanLine } from "lucide-react";
import Link from "next/link";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { MARKING_ROUTE_LABEL, MARKING_RUN_STATUS_LABEL } from "@/domain/marking/marking";
import { when } from "@/lib/flow-labels";
import { ratePct as pct, ROUTE_SHORT, RUN_TONE } from "@/lib/marking-labels";
import { requireModuleAccess } from "@/services/auth/guard";
import { getMarkingOverview } from "@/services/marking/marking";
import { createLineAction, startRunAction, updateLineAction } from "./actions";

/**
 * The egg-marking lines (document 3, lot 15): each machine, the run it is printing for, and every
 * run with what its camera read back. "Un marquage non relu n'est pas une preuve : c'est une intention."
 */
export default async function MarkingPage() {
  const session = await requireModuleAccess("MARKING");
  const overview = await getMarkingOverview(session);
  const freeLines = overview.lines.filter((l) => l.active && !l.openRun);
  const sourceOptions = [
    ...overview.sources.B_CONSOMMATION.map((s) => ({ value: `B:${s.value}`, label: `Voie B — ${s.label}` })),
    ...overview.sources.A_COUVER.map((s) => ({ value: `A:${s.value}`, label: `Voie A — ${s.label}` })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marquage des œufs"
        description="Chaque coquille reçoit un code court que la caméra de la ligne relit ; chaque code est rattaché à sa collecte et à son plateau. Quand la relecture faiblit, la ligne s'arrête d'elle-même : un code non relu n'est pas une preuve."
        actions={
          <>
            {overview.can.start && freeLines.length > 0 ? (
              <FormDialog
                title="Démarrer une campagne de marquage"
                description="La ligne reçoit ses codes une fois la campagne ouverte. Les œufs retirés de la vente ou sous blocage qualité ne sont pas proposés."
                triggerLabel="Démarrer une campagne"
                action={startRunAction}
                fields={[
                  { name: "lineId", label: "Ligne", type: "select", required: true, options: freeLines.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) },
                  { name: "source", label: "Œufs à marquer", type: "select", required: true, options: sourceOptions, hint: "Voie B : une collecte calibrée. Voie A : un lot d'œufs à couver, marqué au ramassage." },
                  { name: "notes", label: "Notes", type: "textarea" },
                ]}
              />
            ) : null}
            {overview.can.configure ? (
              <FormDialog
                title="Mettre en service une ligne de marquage"
                description="Le préfixe est imprimé sur chaque coquille et n'appartient qu'à cette ligne. Le seuil de relecture décide quand la ligne s'arrête."
                triggerLabel="Nouvelle ligne"
                triggerVariant="secondary"
                action={createLineAction}
                fields={[
                  { name: "code", label: "Code", type: "text", required: true, half: true, placeholder: "LM-FAS-01" },
                  { name: "name", label: "Nom", type: "text", required: true, half: true },
                  { name: "buildingId", label: "Emplacement", type: "select", required: true, options: overview.buildings },
                  { name: "routes", label: "Voies", type: "select", required: true, half: true, options: [{ value: "B_CONSOMMATION", label: "Voie B — consommation" }, { value: "A_COUVER", label: "Voie A — à couver" }, { value: "LES_DEUX", label: "Les deux" }] },
                  { name: "shellPrefix", label: "Préfixe (2 caractères)", type: "text", required: true, half: true, hint: "0-9 et A-Z sans I, L, O ni U." },
                  { name: "readThresholdPct", label: "Seuil de relecture (%)", type: "number", required: true, half: true, defaultValue: "98" },
                  { name: "readWindow", label: "Sur les derniers… œufs", type: "number", required: true, half: true, defaultValue: "500" },
                  { name: "trayCapacity", label: "Œufs par plateau", type: "number", required: true, half: true, defaultValue: "30" },
                  { name: "protocol", label: "Liaison avec la machine", type: "text", half: true, placeholder: "Série RS-232, Ethernet…" },
                ]}
              />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Codes imprimés aujourd'hui" value={overview.printedToday.toLocaleString("fr-FR")} icon={ScanLine} hint="présentés à la caméra" />
        <StatCard label="Taux de relecture aujourd'hui" value={pct(overview.rateToday)} />
        <StatCard label="Lignes à l'arrêt" value={overview.stopped.toLocaleString("fr-FR")} tone={overview.stopped > 0 ? "critical" : "default"} hint="contrôle de lecture en défaut" />
        <StatCard label="Lignes" value={overview.lines.length.toLocaleString("fr-FR")} hint={`${overview.lines.filter((l) => l.openRun).length} en campagne`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lignes de marquage</CardTitle>
          <CardDescription>Une machine à jet d&apos;encre et sa caméra de relecture. Le seuil et la fenêtre de relecture sont fixés par le responsable qualité.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ligne</TableHead>
                <TableHead>Emplacement</TableHead>
                <TableHead>Voies</TableHead>
                <TableHead>Préfixe</TableHead>
                <TableHead>Contrôle de lecture</TableHead>
                <TableHead>État</TableHead>
                {overview.can.configure ? <TableHead className="sr-only">Réglages</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.lines.length === 0 ? <TableEmpty colSpan={7}>Aucune ligne de marquage dans votre périmètre.</TableEmpty> : null}
              {overview.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <p className="font-semibold">{l.code}</p>
                    <p className="text-caption text-secondary">{l.name}</p>
                  </TableCell>
                  <TableCell>{l.place}</TableCell>
                  <TableCell>{l.routes.map((r) => ROUTE_SHORT[r]).join(", ")}</TableCell>
                  <TableCell className="font-mono">{l.shellPrefix}</TableCell>
                  <TableCell>
                    ≥ {pct(l.readThreshold)} sur {l.readWindow.toLocaleString("fr-FR")} œufs
                    <p className="text-caption text-secondary">{l.protocol ?? "Liaison machine à documenter"}</p>
                  </TableCell>
                  <TableCell>
                    {!l.active ? (
                      <Badge tone="neutral">Hors service</Badge>
                    ) : l.openRun ? (
                      <Link href={`/marquage/${l.openRun.id}`}>
                        <Badge tone={RUN_TONE[l.openRun.status]}>{MARKING_RUN_STATUS_LABEL[l.openRun.status]}</Badge>
                      </Link>
                    ) : (
                      <Badge tone="success">Libre</Badge>
                    )}
                  </TableCell>
                  {overview.can.configure ? (
                    <TableCell>
                      <FormDialog
                        title={`Régler ${l.code}`}
                        description="Changer le seuil change ce que le marquage prouve : le changement est justifié et tracé."
                        triggerLabel="Régler"
                        triggerVariant="ghost"
                        submitLabel="Enregistrer les réglages"
                        action={updateLineAction}
                        fields={[
                          { name: "lineId", label: "Ligne", type: "select", defaultValue: l.id, options: [{ value: l.id, label: l.code }] },
                          { name: "readThresholdPct", label: "Seuil de relecture (%)", type: "number", required: true, half: true, defaultValue: String(Math.round(l.readThreshold * 1000) / 10) },
                          { name: "readWindow", label: "Sur les derniers… œufs", type: "number", required: true, half: true, defaultValue: String(l.readWindow) },
                          { name: "trayCapacity", label: "Œufs par plateau", type: "number", required: true, half: true, defaultValue: String(l.trayCapacity) },
                          { name: "active", label: "En service", type: "select", half: true, defaultValue: l.active ? "OUI" : "NON", options: [{ value: "OUI", label: "Oui" }, { value: "NON", label: "Non" }] },
                          { name: "protocol", label: "Liaison avec la machine", type: "text", defaultValue: l.protocol ?? "" },
                          { name: "reason", label: "Justification", type: "textarea", required: true },
                        ]}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campagnes</CardTitle>
          <CardDescription>Une campagne = une ligne, une source, une plage de codes. Les codes attribués et jamais imprimés ne resservent jamais.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campagne</TableHead>
                <TableHead>Œufs marqués</TableHead>
                <TableHead>Voie</TableHead>
                <TableHead>Début</TableHead>
                <TableHead>État</TableHead>
                <TableHead className="text-right">Relus</TableHead>
                <TableHead className="text-right">Rejetés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.runs.length === 0 ? <TableEmpty colSpan={7}>Aucune campagne de marquage.</TableEmpty> : null}
              {overview.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/marquage/${r.id}`} className="font-semibold text-deep-green underline-offset-2 hover:underline">
                      {r.code}
                    </Link>
                    <p className="text-caption text-secondary">
                      {r.lineCode} · {r.farmName}
                    </p>
                  </TableCell>
                  <TableCell>{r.sourceCode}</TableCell>
                  <TableCell title={MARKING_ROUTE_LABEL[r.route]}>{ROUTE_SHORT[r.route]}</TableCell>
                  <TableCell>{when(r.startedAt)}</TableCell>
                  <TableCell>
                    <Badge tone={RUN_TONE[r.status]}>{MARKING_RUN_STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.readOk.toLocaleString("fr-FR")}
                    <p className="text-caption text-secondary">{pct(r.rate)}</p>
                  </TableCell>
                  <TableCell className="text-right">{r.readKo.toLocaleString("fr-FR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>À fixer avec le fournisseur et le propriétaire</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-secondary">
          <p>
            <span className="font-semibold text-text">Liaison avec la machine.</span> Le jeu de commandes de l&apos;imprimante et de la caméra (liaison série ou Ethernet) n&apos;est pas encore connu. Le contrôleur de ligne le traduit vers l&apos;API documentée (codes, relectures, plateaux) ; tant qu&apos;il manque, la séquence de codes ne peut pas être pilotée.
          </p>
          <p>
            <span className="font-semibold text-text">Lisibilité sur œuf beldi.</span> Le code de 9 caractères est prévu pour l&apos;œil et la caméra ; l&apos;essai d&apos;impression sur un échantillon réel, avec lecture au téléphone, reste à faire avant tout engagement.
          </p>
          <p>
            <span className="font-semibold text-text">Voies retenues.</span> À couver, consommation, ou les deux : décision du propriétaire, qui change la machine et son emplacement. Le logiciel traite les deux.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
