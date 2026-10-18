import { PageHeader } from "@/components/domain/PageHeader";
import { repositories } from "@/data/repositories";
import { can } from "@/domain/shared/permissions";
import { requireModuleAccess } from "@/services/auth/guard";
import { listBuildingsInScope } from "@/services/identity/queries";
import { listLotsWithContext } from "@/services/production/lot-queries";
import { LotCreateDialog } from "@/components/domain/LazyDialogs";
import { LotListClient } from "./LotListClient";

export default async function LotListPage() {
  const session = await requireModuleAccess("LOTS");
  const [lots, buildings, farms] = await Promise.all([
    listLotsWithContext(session),
    listBuildingsInScope(session),
    repositories.farms.list(),
  ]);
  const farmNameById = new Map(farms.map((farm) => [farm.id, farm.name]));
  const buildingOptions = buildings.map((building) => ({
    id: building.id,
    label: `${farmNameById.get(building.farmId) ?? "—"} — ${building.code} (${building.name})`,
  }));
  const canCreate = can(session, "CREATE", "LOTS");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lots"
        description="Le lot est l'objet central de traçabilité — chaque bâtiment héberge un ou plusieurs lots."
        actions={canCreate ? <LotCreateDialog buildings={buildingOptions} /> : null}
      />

      <LotListClient lots={lots} />
    </div>
  );
}
