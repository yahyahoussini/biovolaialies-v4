import { ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { EquipmentTabs } from "@/components/domain/EquipmentTabs";
import { FormDialog } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { RECEPTION_RULE } from "@/domain/equipment/recipes";
import { can } from "@/domain/shared/permissions";
import { cn } from "@/lib/cn";
import { requireModuleAccess } from "@/services/auth/guard";
import { buildingCommissioning, commissioningOverview } from "@/services/equipment/commissioning";
import { recordCommissioningAction } from "../actions";

const day = (v: string) => new Date(`${v.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR");

export default async function CommissioningPage({ searchParams }: PageProps<"/equipements/recette">) {
  const session = await requireModuleAccess("EQUIPMENT");
  const { batiment } = await searchParams;
  const overview = await commissioningOverview(session);
  const selectedId = typeof batiment === "string" && overview.some((b) => b.buildingId === batiment) ? batiment : overview[0]?.buildingId;
  const selected = selectedId ? await buildingCommissioning(selectedId, session) : null;
  const canRecord = can(session, "VALIDATE", "IOT");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ label: "Équipements", href: "/equipements" }, { label: "Mise en service" }]}
        title="Recettes de mise en service"
        description={`Document 2, annexe A : le test qui prouve, à la mise en service, qu'un capteur est correctement posé et raccordé — sans lui, les erreurs d'implantation se découvrent en analysant le premier lot, quatre mois trop tard. ${RECEPTION_RULE.rule} ${RECEPTION_RULE.payment}`}
      />
      <EquipmentTabs active="/equipements/recette" />

      {overview.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Aucun bâtiment instrumenté dans votre périmètre" description="Les recettes s'appliquent aux équipements posés : équipez un bâtiment depuis l'écran Télémétrie." />
      ) : (
        <Table caption="Réception par bâtiment">
          <TableHeader>
            <TableRow>
              <TableHead>Bâtiment</TableHead>
              <TableHead>Recettes applicables</TableHead>
              <TableHead>Conformes</TableHead>
              <TableHead>Non conformes</TableHead>
              <TableHead>À faire</TableHead>
              <TableHead>Réception</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.map((b) => (
              <TableRow key={b.buildingId} className={cn(b.buildingId === selectedId && "bg-bio-green/5")}>
                <TableCell>
                  <Link className="focus-ring font-medium text-bio-green hover:underline" href={`/equipements/recette?batiment=${b.buildingId}`} aria-current={b.buildingId === selectedId ? "true" : undefined}>
                    {b.buildingLabel}
                  </Link>
                </TableCell>
                <TableCell>{b.status.applicable}</TableCell>
                <TableCell>{b.status.conforming}</TableCell>
                <TableCell>{b.status.nonConforming.length ? <Badge tone="critical">{b.status.nonConforming.join(", ")}</Badge> : 0}</TableCell>
                <TableCell className="text-xs">{b.status.missing.length ? b.status.missing.join(", ") : 0}</TableCell>
                <TableCell>{b.status.complete ? <Badge tone="success">Réception prononçable</Badge> : <Badge tone="warning">Solde de l&apos;installateur bloqué</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && selectedId ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label={`Recettes conformes — ${selected.buildingLabel}`} value={`${selected.status.conforming} / ${selected.status.applicable}`} icon={ClipboardCheck} tone={selected.status.complete ? "success" : "warning"} />
            <StatCard label="Non conformes" value={selected.status.nonConforming.length} tone={selected.status.nonConforming.length ? "critical" : "default"} hint="À reprendre, puis à refaire" />
            <StatCard label="Jamais exécutées" value={selected.status.missing.length} tone={selected.status.missing.length ? "warning" : "default"} hint="Capteurs non réputés posés" />
          </div>
          <Table caption={`Recettes — ${selected.buildingLabel}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Réf.</TableHead>
                <TableHead>Équipement et test (annexe A)</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Exécutée</TableHead>
                <TableHead>Mesure et preuve</TableHead>
                {canRecord ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.items.map((item) => (
                <TableRow key={item.recipe.code}>
                  <TableCell className="font-mono text-caption font-semibold">{item.recipe.code}</TableCell>
                  <TableCell className="max-w-xl">
                    <span className="font-medium">{item.recipe.equipment}</span>
                    <span className="block text-caption text-secondary">
                      {item.devices.length} appareil{item.devices.length > 1 ? "s" : ""} : {item.devices.join(", ")}
                    </span>
                    <span className="mt-1 block text-caption">{item.recipe.test}</span>
                  </TableCell>
                  <TableCell>
                    {item.latest ? <Badge tone={item.latest.result === "CONFORME" ? "success" : "critical"}>{item.latest.result === "CONFORME" ? "Conforme" : "Non conforme"}</Badge> : <Badge tone="neutral">À faire</Badge>}
                    {item.history.length > 1 ? <span className="mt-1 block text-caption text-secondary">{item.history.length} essais</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {item.latest ? (
                      <>
                        {day(item.latest.performedAt)}
                        <span className="block">{item.latest.performedBy}</span>
                        <span className="block text-secondary">consignée par {item.history[0]?.recordedByName}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs">
                    {item.latest ? (
                      <>
                        {item.latest.measured ? <span className="block">{item.latest.measured}</span> : null}
                        <span className="block text-secondary">{item.latest.evidence}</span>
                        {item.history.length > 1 ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-bio-green">Essais précédents</summary>
                            <ul className="mt-1 flex flex-col gap-1">
                              {item.history.slice(1).map((h) => (
                                <li key={h.id}>
                                  {day(h.performedAt)} — {h.result === "CONFORME" ? "conforme" : "non conforme"} — {h.performedBy}
                                  {h.measured ? ` — ${h.measured}` : ""}
                                  {h.notes ? <span className="block text-secondary">{h.notes}</span> : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {canRecord ? (
                    <TableCell className="text-right">
                      <FormDialog
                        title={`Recette ${item.recipe.code} — ${selected.buildingLabel}`}
                        description={item.recipe.test}
                        triggerLabel={item.latest ? "Nouvel essai" : "Consigner"}
                        triggerVariant="ghost"
                        action={recordCommissioningAction}
                        fields={[
                          { name: "buildingId", label: "Bâtiment", type: "select", defaultValue: selectedId, options: [{ value: selectedId, label: selected.buildingLabel }], half: true },
                          { name: "code", label: "Recette", type: "select", defaultValue: item.recipe.code, options: [{ value: item.recipe.code, label: item.recipe.code }], half: true },
                          { name: "result", label: "Résultat", type: "select", required: true, options: [{ value: "CONFORME", label: "Conforme" }, { value: "NON_CONFORME", label: "Non conforme" }], half: true },
                          { name: "performedAt", label: "Exécutée le", type: "date", required: true, defaultValue: today, half: true },
                          { name: "performedBy", label: "Exécutée par (nom)", type: "text", required: true, placeholder: "Technicien de l'installateur ou de BVU Tech" },
                          { name: "measured", label: "Mesure relevée", type: "text", placeholder: "Écart maximal 0,3 °C…" },
                          { name: "evidence", label: "Preuve (PV, photo, relevé)", type: "text", required: true },
                          { name: "notes", label: "Observations", type: "textarea" },
                        ]}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-caption text-secondary">{RECEPTION_RULE.why}</p>
        </>
      ) : null}
    </div>
  );
}
