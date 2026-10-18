import { Egg } from "lucide-react";
import Link from "next/link";
import { FormDialog, type FormField } from "@/components/domain/FormDialog";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { hatchRate } from "@/domain/hatchery/balance";
import { CHICK_GRADE, DATA_STATUS } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { HATCH_CYCLE_STATUS_LABEL, HATCH_CYCLE_STATUS_TONE, pct } from "@/lib/hatchery-labels";
import { DATA_STATUS_LABEL } from "@/lib/status-colors";
import { requireModuleAccess } from "@/services/auth/guard";
import { getHatcheryOverview } from "@/services/hatchery/hatchery";
import {
  createChickLotAction,
  createEggLotAction,
  createHatchCycleAction,
  createParentFlockAction,
  placeChicksAction,
} from "./actions";

const dataStatusField: FormField = {
  name: "dataStatus",
  label: "Statut des données",
  type: "select",
  defaultValue: "SIMULATION",
  options: DATA_STATUS.map((s) => ({ value: s, label: DATA_STATUS_LABEL[s] })),
  half: true,
};

function d(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "—";
}

function n(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("fr-FR");
}

export default async function HatcheryPage() {
  const session = await requireModuleAccess("HATCHERY");
  const o = await getHatcheryOverview(session);
  const canCreate = can(session, "CREATE", "HATCHERY");
  const hatched = o.cycles.filter((c) => c.status === "ECLOS");
  const totalSet = hatched.reduce((s, c) => s + c.eggsSet, 0);
  const totalHatched = hatched.reduce((s, c) => s + (c.chicksHatched ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Couvoir & amont"
        description="Génétique, troupeaux reproducteurs, lots d'œufs à couver, cycles d'incubation et lots de poussins — jusqu'au lot d'élevage."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Troupeaux reproducteurs" value={o.flocks.length} icon={Egg} />
        <StatCard label="Lots d'œufs" value={o.eggLots.length} />
        <StatCard label="Cycles en cours" value={o.cycles.filter((c) => c.status !== "ECLOS").length} />
        <StatCard label="Taux d'éclosion (cycles éclos)" value={pct(hatchRate(totalSet, totalHatched))} hint={`${n(totalHatched)} poussins / ${n(totalSet)} œufs`} />
      </div>

      <nav aria-label="Sections" className="flex flex-wrap gap-3 text-sm">
        <a href="#reproducteurs" className="text-bio-green underline">Reproducteurs</a>
        <a href="#oeufs" className="text-bio-green underline">Lots d&apos;œufs</a>
        <a href="#incubation" className="text-bio-green underline">Incubation</a>
        <a href="#poussins" className="text-bio-green underline">Poussins</a>
      </nav>

      <Card id="reproducteurs">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Troupeaux reproducteurs</CardTitle>
          {canCreate ? (
            <FormDialog
              title="Mettre en place un troupeau reproducteur"
              description="L'origine génétique est enregistrée une fois et ne peut plus être modifiée."
              triggerLabel="Nouveau troupeau"
              action={createParentFlockAction}
              fields={[
                { name: "code", label: "Code", type: "text", required: true, placeholder: "PF-2026-01", half: true },
                { name: "buildingId", label: "Bâtiment", type: "select", required: true, options: o.flockBuildings.map((b) => ({ value: b.id, label: b.label })), half: true },
                { name: "strain", label: "Souche", type: "text", required: true, placeholder: "Ross 308 PS", half: true },
                { name: "geneticSupplier", label: "Fournisseur génétique", type: "text", required: true, half: true },
                { name: "originCountry", label: "Pays d'origine", type: "text", required: true, half: true },
                { name: "importReference", label: "Référence d'import", type: "text", half: true },
                { name: "placedAt", label: "Mise en place", type: "date", required: true, half: true },
                { name: "femaleCount", label: "Femelles", type: "number", required: true, half: true },
                { name: "maleCount", label: "Mâles", type: "number", required: true, half: true },
                dataStatusField,
              ]}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {o.flocks.length === 0 ? (
            <EmptyState title="Aucun troupeau" description="Les troupeaux reproducteurs enregistrés apparaîtront ici." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Souche</TableHead>
                  <TableHead>Origine génétique</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Effectif ♀ / ♂</TableHead>
                  <TableHead>Lots d&apos;œufs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.flocks.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">
                      <Link href={`/couvoir/reproducteurs/${f.id}`} className="text-bio-green underline">{f.code}</Link>
                    </TableCell>
                    <TableCell>{f.strain}</TableCell>
                    <TableCell>{f.geneticSupplier} — {f.originCountry}</TableCell>
                    <TableCell>{f.buildingLabel}</TableCell>
                    <TableCell>{n(f.femaleCount)} / {n(f.maleCount)}</TableCell>
                    <TableCell>{f.eggLotCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="oeufs">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Lots d&apos;œufs à couver</CardTitle>
          {canCreate && o.flocks.length > 0 ? (
            <FormDialog
              title="Enregistrer un lot d'œufs"
              triggerLabel="Nouveau lot d'œufs"
              action={createEggLotAction}
              fields={[
                { name: "code", label: "Code", type: "text", required: true, placeholder: "OAC-2026-0601", half: true },
                { name: "parentFlockId", label: "Troupeau d'origine", type: "select", required: true, options: o.flocks.map((f) => ({ value: f.id, label: `${f.code} — ${f.strain}` })), half: true },
                { name: "collectedAt", label: "Date de collecte", type: "date", required: true, half: true },
                { name: "quantity", label: "Nombre d'œufs", type: "number", required: true, half: true },
                { name: "storageBuildingId", label: "Lieu de stockage", type: "select", options: [...o.couvoirBuildings, ...o.flockBuildings].map((b) => ({ value: b.id, label: b.label })), half: true },
                dataStatusField,
              ]}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {o.eggLots.length === 0 ? (
            <EmptyState title="Aucun lot d'œufs" description="Enregistrez d'abord un troupeau reproducteur." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Troupeau</TableHead>
                  <TableHead>Collecte</TableHead>
                  <TableHead>Œufs</TableHead>
                  <TableHead>Mis en incubation</TableHead>
                  <TableHead>Restants</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.eggLots.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.code}</TableCell>
                    <TableCell>{e.flockCode}</TableCell>
                    <TableCell>{d(e.collectedAt)}</TableCell>
                    <TableCell>{n(e.quantity)}</TableCell>
                    <TableCell>{n(e.allocated)}</TableCell>
                    <TableCell>{n(e.quantity - e.allocated)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="incubation">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Cycles d&apos;incubation</CardTitle>
          {canCreate && o.couvoirBuildings.length > 0 && o.eggLots.length > 0 ? (
            <FormDialog
              title="Mettre en incubation"
              description="Indiquez chaque lot d'œufs chargé et sa quantité. Un cycle peut regrouper plusieurs lots."
              triggerLabel="Nouveau cycle"
              action={createHatchCycleAction}
              fields={[
                { name: "code", label: "Code du cycle", type: "text", required: true, placeholder: "INC-2026-23", half: true },
                { name: "buildingId", label: "Couvoir", type: "select", required: true, options: o.couvoirBuildings.map((b) => ({ value: b.id, label: b.label })), half: true },
                { name: "incubatorRef", label: "Incubateur", type: "text", required: true, placeholder: "Incubateur 3", half: true },
                { name: "setAt", label: "Mise en incubation", type: "date", required: true, half: true },
                { name: "allocations", label: "Lots chargés (code:quantité ; …)", type: "textarea", required: true, placeholder: "OAC-2026-0601:3000; OAC-2026-0602:2000", hint: `Disponibles : ${o.eggLots.filter((e) => e.quantity > e.allocated).map((e) => `${e.code} (${e.quantity - e.allocated})`).join(", ") || "aucun"}` },
                dataStatusField,
              ]}
            />
          ) : null}
        </CardHeader>
        <CardContent>
          {o.couvoirBuildings.length === 0 ? (
            <p className="mb-3 text-sm text-secondary">Aucun bâtiment de type « couvoir » dans votre périmètre : créez-en un pour lancer un cycle.</p>
          ) : null}
          {o.cycles.length === 0 ? (
            <EmptyState title="Aucun cycle" description="Les cycles d'incubation apparaîtront ici." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Couvoir / incubateur</TableHead>
                  <TableHead>Mise en incubation</TableHead>
                  <TableHead>Œufs</TableHead>
                  <TableHead>Éclos</TableHead>
                  <TableHead>Taux</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.cycles.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/couvoir/cycles/${c.id}`} className="text-bio-green underline">{c.code}</Link>
                    </TableCell>
                    <TableCell>{c.buildingLabel} · {c.incubatorRef}</TableCell>
                    <TableCell>{d(c.setAt)}</TableCell>
                    <TableCell>{n(c.eggsSet)}</TableCell>
                    <TableCell>{n(c.chicksHatched)}</TableCell>
                    <TableCell>{c.chicksHatched === null ? "—" : pct(hatchRate(c.eggsSet, c.chicksHatched))}</TableCell>
                    <TableCell><Badge tone={HATCH_CYCLE_STATUS_TONE[c.status]}>{HATCH_CYCLE_STATUS_LABEL[c.status]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="poussins">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Lots de poussins</CardTitle>
          <div className="flex flex-wrap gap-2">
            {canCreate && o.chickLots.length > 0 ? (
              <FormDialog
                title="Placer des poussins dans un lot d'élevage"
                description="Relie le lot d'élevage à son lot de poussins d'origine : la traçabilité remonte alors jusqu'à la génétique."
                triggerLabel="Placer en élevage"
                triggerVariant="secondary"
                action={placeChicksAction}
                fields={[
                  { name: "chickLotId", label: "Lot de poussins", type: "select", required: true, options: o.chickLots.filter((c) => c.quantity > c.placed).map((c) => ({ value: c.id, label: `${c.code} (${c.quantity - c.placed} à placer)` })), half: true },
                  { name: "lotCode", label: "Code du lot d'élevage", type: "text", required: true, placeholder: "BU-2026-014", half: true },
                  { name: "quantity", label: "Poussins placés", type: "number", required: true, half: true },
                ]}
              />
            ) : null}
            {canCreate && o.cycles.some((c) => c.status === "ECLOS") ? (
              <FormDialog
                title="Sortie couvoir — lot de poussins"
                triggerLabel="Nouveau lot de poussins"
                action={createChickLotAction}
                fields={[
                  { name: "code", label: "Code", type: "text", required: true, placeholder: "PSS-2026-23A", half: true },
                  { name: "hatchCycleId", label: "Cycle éclos", type: "select", required: true, options: o.cycles.filter((c) => c.status === "ECLOS").map((c) => ({ value: c.id, label: `${c.code} (${(c.chicksHatched ?? 0) - (c.culls ?? 0) - c.dispatched} dispo.)` })), half: true },
                  { name: "quantity", label: "Poussins", type: "number", required: true, half: true },
                  { name: "grade", label: "Qualité", type: "select", required: true, defaultValue: "A", options: CHICK_GRADE.map((g) => ({ value: g, label: `Qualité ${g}` })), half: true },
                  { name: "dispatchedAt", label: "Sortie", type: "date", required: true, half: true },
                  dataStatusField,
                ]}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {o.chickLots.length === 0 ? (
            <EmptyState title="Aucun lot de poussins" description="Les sorties couvoir apparaîtront ici." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Poussins</TableHead>
                  <TableHead>Qualité</TableHead>
                  <TableHead>Sortie</TableHead>
                  <TableHead>Placés en élevage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.chickLots.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.code}</TableCell>
                    <TableCell>{c.cycleCode}</TableCell>
                    <TableCell>{n(c.quantity)}</TableCell>
                    <TableCell>{c.grade}</TableCell>
                    <TableCell>{d(c.dispatchedAt)}</TableCell>
                    <TableCell>{n(c.placed)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
