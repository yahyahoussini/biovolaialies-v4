import type { FormField } from "@/components/domain/FormDialog";
import { repositories } from "@/data/repositories";
import { PHASE_LABEL } from "@/domain/production/lines";
import { LOT_PHASE } from "@/domain/shared/enums";
import { can } from "@/domain/shared/permissions";
import { isGlobalScope } from "@/domain/shared/scope";
import type { Session } from "@/services/auth/session";
import { chicksCommitted } from "@/services/hatchery/hatchery";
import { buildHierarchyIndex, isWithinScope } from "@/services/identity/scope-check";

/**
 * Fields of the departure form. What can leave is limited to the sender's own perimeter; where it
 * can go is any rearing site, hatchery or store — the receiving side signs for it at arrival.
 */
export async function dispatchFields(session: Session, preset?: { objectType: string; objectId: string }): Promise<FormField[] | null> {
  const canLots = can(session, "EDIT", "LOTS");
  const canHatchery = can(session, "CREATE", "HATCHERY");
  if (!canLots && !canHatchery) return null;
  const [index, lots, chickLots, eggLots, cycles, buildings, farms, lines, users] = await Promise.all([
    buildHierarchyIndex(),
    repositories.lots.list(),
    repositories.chickLots.list(),
    repositories.eggLots.list(),
    repositories.hatchCycles.list(),
    repositories.buildings.list(),
    repositories.farms.list(),
    repositories.productionLines.list(),
    repositories.users.findById(session.userId),
  ]);
  const inScope = (buildingId: string) => isGlobalScope(session) || isWithinScope(session, index.building.get(buildingId) ?? {});
  const farmName = new Map(farms.map((f) => [f.id, f.name]));
  const buildingLabel = (id: string) => {
    const b = buildings.find((x) => x.id === id);
    return b ? `${farmName.get(b.farmId) ?? "—"} — ${b.code}` : "—";
  };
  const flocks = await repositories.parentFlocks.list();

  const objects: { value: string; label: string }[] = [];
  if (canLots) {
    for (const lot of lots.filter((l) => ["ACTIF", "LIBERE"].includes(l.status) && l.currentPopulation > 0 && inScope(l.buildingId))) {
      objects.push({ value: `LOT:${lot.id}`, label: `Lot ${lot.code} — ${lot.currentPopulation.toLocaleString("fr-FR")} animaux, ${buildingLabel(lot.buildingId)}` });
    }
  }
  if (canHatchery) {
    for (const chicks of chickLots) {
      const cycle = cycles.find((c) => c.id === chicks.hatchCycleId);
      if (!cycle || !inScope(cycle.buildingId)) continue;
      const left = chicks.quantity - (await chicksCommitted(chicks.id));
      if (left > 0) objects.push({ value: `CHICK_LOT:${chicks.id}`, label: `Poussins ${chicks.code} — ${left.toLocaleString("fr-FR")} restants, ${buildingLabel(cycle.buildingId)}` });
    }
    for (const egg of eggLots) {
      const flock = flocks.find((f) => f.id === egg.parentFlockId);
      const where = egg.storageBuildingId ?? flock?.buildingId;
      if (!where || !inScope(where)) continue;
      objects.push({ value: `EGG_LOT:${egg.id}`, label: `Œufs à couver ${egg.code} — ${egg.quantity.toLocaleString("fr-FR")}, ${buildingLabel(where)}` });
    }
  }
  const presetValue = preset ? `${preset.objectType}:${preset.objectId}` : undefined;
  const openLots = lots.filter((l) => !["ABATTU", "TRANSFORME", "CLOTURE", "ARCHIVE"].includes(l.status));

  return [
    { name: "object", label: "Ce qui part", type: "select", required: true, defaultValue: presetValue, options: objects },
    { name: "destinationBuildingId", label: "Destination", type: "select", required: true, options: buildings.filter((b) => b.zoneType !== "AUTRE").map((b) => ({ value: b.id, label: `${buildingLabel(b.id)} (${b.zoneType.toLowerCase()})` })) },
    { name: "quantity", label: "Quantité comptée au départ", type: "number", required: true, half: true },
    { name: "sentAt", label: "Départ", type: "datetime-local", required: true, half: true },
    { name: "destinationLotCode", label: "Code du lot à créer à l'arrivée", type: "text", placeholder: "PAR-2026-014", half: true, hint: "Ou choisissez un lot existant ci-dessous." },
    { name: "destinationLotId", label: "Ou lot existant qui reçoit", type: "select", half: true, options: [{ value: "", label: "—" }, ...openLots.map((l) => ({ value: l.id, label: `${l.code} — ${buildingLabel(l.buildingId)}` }))] },
    { name: "destinationLineCode", label: "Ligne (obligatoire pour des poussins)", type: "select", half: true, options: [{ value: "", label: "Celle du lot de départ" }, ...lines.filter((l) => l.active).map((l) => ({ value: l.code, label: l.label }))] },
    { name: "phaseOnArrival", label: "Phase à l'arrivée", type: "select", half: true, options: [{ value: "", label: "—" }, ...LOT_PHASE.map((p) => ({ value: p, label: PHASE_LABEL[p] }))] },
    { name: "documentRef", label: "Bon de livraison", type: "text", half: true },
    { name: "crates", label: "Caisses", type: "number", half: true },
    { name: "transporter", label: "Transporteur", type: "text", half: true },
    { name: "vehicle", label: "Véhicule", type: "text", half: true },
    { name: "notes", label: "Observations au départ", type: "textarea" },
    { name: "signerName", label: "Signature : votre nom complet", type: "text", required: true, placeholder: users?.fullName ?? "", hint: "Votre signature atteste le comptage au départ." },
  ];
}
