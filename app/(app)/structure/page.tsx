import Link from "next/link";
import { PageHeader } from "@/components/domain/PageHeader";
import { StatCard } from "@/components/domain/StatCard";
import { can, type Module } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { structureTree, type StructureLevel } from "@/services/identity/structure";
import { StructureEditor, type Rights } from "./StructureEditor";

const MODULE_OF: Record<StructureLevel, Module> = { organization: "ORGANIZATIONS", cooperative: "COOPERATIVES", producer: "PRODUCERS", farm: "FARMS", building: "BUILDINGS" };

export default async function StructurePage() {
  const session = await requireModuleAccess("FARMS");
  const tree = await structureTree(session);
  const rights = Object.fromEntries(
    (Object.keys(MODULE_OF) as StructureLevel[]).map((level) => [
      level,
      { create: can(session, "CREATE", MODULE_OF[level]) && (level !== "organization" || session.scopeType === "GLOBAL"), edit: can(session, "EDIT", MODULE_OF[level]) },
    ])
  ) as Rights;
  const coops = tree.organizations.flatMap((o) => o.cooperatives);
  const producers = coops.flatMap((c) => c.producers);
  const farms = producers.flatMap((p) => p.farms);
  const buildings = farms.flatMap((f) => f.buildings);
  const canImport = Object.values(rights).some((r) => r.create);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Structure des élevages"
        description="Organisations, coopératives, producteurs, fermes et bâtiments — saisis ici un par un, ou importés d'un tableur. Chaque création et modification est tracée au journal d'audit."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Organisations" value={String(tree.organizations.length)} />
        <StatCard label="Coopératives" value={String(coops.length)} />
        <StatCard label="Producteurs" value={String(producers.length)} />
        <StatCard label="Fermes" value={String(farms.length)} />
        <StatCard label="Bâtiments" value={String(buildings.length)} />
      </div>
      {canImport ? (
        <p className="text-sm text-text">
          Beaucoup de bâtiments à saisir ?{" "}
          <Link href="/structure/import" className="font-medium text-bio-green underline underline-offset-2">
            Importer le fichier de structure
          </Link>{" "}
          (un tableur, une ligne par bâtiment).
        </p>
      ) : null}
      <StructureEditor tree={tree} rights={rights} />
    </div>
  );
}
