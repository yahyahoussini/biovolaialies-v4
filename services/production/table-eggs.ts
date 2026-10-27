import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { downgradeRate, tableEggCountError, type TableEggLot } from "../../domain/production/flow";
import { DATA_STATUS, EGG_TYPE, MEASUREMENT_SOURCE_TYPE, TABLE_EGG_LOT_STATUS } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { businessDate, orderError } from "../../domain/shared/dates";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assignBvuId } from "../identity/bvu-ids";
import { assertInScope, buildHierarchyIndex, isWithinScope, resolveLotHierarchy } from "../identity/scope-check";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "../traceability/relations";
import { getProductionLine } from "./lines";

/**
 * Table eggs (handwritten flow, branches B and C): each day's collection from a layer lot, white
 * or "Pistache", graded at collection. Each collection is a traced object of its own — the egg
 * marking line prints its codes against it, and a hold on the layer lot blocks it.
 */

export const createTableEggLotSchema = z.object({
  code: z.string().trim().min(3).max(50),
  lotId: z.string().min(1),
  collectedOn: businessDate("Collecte"),
  eggType: z.enum(EGG_TYPE).optional().nullable(),
  quantity: z.number().int().nonnegative(),
  saleable: z.number().int().nonnegative(),
  cracked: z.number().int().nonnegative(),
  dirty: z.number().int().nonnegative(),
  small: z.number().int().nonnegative(),
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE).default("MANUEL"),
  measurementMethod: z.string().trim().max(200).optional().nullable(),
});

export async function createTableEggLot(input: unknown, session: Session): Promise<TableEggLot> {
  if (!can(session, "CREATE", "EVENTS")) throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer une collecte.");
  const data = parseInput(createTableEggLotSchema, input);
  const lot = await repositories.lots.findById(data.lotId);
  if (!lot) throw new NotFoundError("Lot", data.lotId);
  assertInScope(session, await resolveLotHierarchy(lot.id));
  await assertNotOnHold("LOT", lot.id);
  const line = await getProductionLine(lot.productionLine);
  if (lot.purpose !== "PONTE" && line?.purpose !== "PONTE") throw new ValidationError("Les œufs de consommation se collectent sur un lot de pondeuses.");
  const phase = await repositories.lotPhases.current(lot.id);
  if (phase && phase.phase !== "PONTE") throw new ValidationError("Ce lot n'est pas en phase de ponte : passez-le en ponte avant d'enregistrer des collectes.");
  if (lot.startedAt) {
    const order = orderError("La mise en place du lot", lot.startedAt, "La collecte", data.collectedOn);
    if (order) throw new ValidationError(order);
  }
  const countError = tableEggCountError(data);
  if (countError) throw new ValidationError(countError);
  const eggType = data.eggType ?? line?.eggType ?? null;
  if (!eggType) throw new ValidationError("Précisez le type d'œuf : la ligne du lot ne l'indique pas.");
  if (line?.eggType && line.eggType !== eggType) throw new ValidationError(`Le lot ${lot.code} pond des œufs ${line.eggType.toLowerCase()} selon sa ligne.`);
  if (await repositories.tableEggLots.findByCode(data.code)) throw new ConflictError(`Le code ${data.code} est déjà utilisé.`);
  const day = data.collectedOn.slice(0, 10);
  if ((await repositories.tableEggLots.listByLot(lot.id)).some((e) => e.collectedOn.slice(0, 10) === day)) {
    throw new ConflictError(`Une collecte est déjà enregistrée pour ${lot.code} le ${new Date(data.collectedOn).toLocaleDateString("fr-FR")} : corrigez-la plutôt que d'en créer une seconde.`);
  }

  const eggs = await repositories.tableEggLots.create({
    code: data.code,
    lotId: lot.id,
    collectedOn: data.collectedOn,
    eggType,
    quantity: data.quantity,
    saleable: data.saleable,
    cracked: data.cracked,
    dirty: data.dirty,
    small: data.small,
    status: "EN_STOCK",
    sourceType: data.sourceType,
    sourceId: null,
    actorId: session.userId,
    dataStatus: data.dataStatus,
    measurementMethod: data.measurementMethod ?? null,
    deviceId: null,
    documentId: null,
    validationStatus: null,
  });
  await createRelation({ fromType: "TABLE_EGG_LOT", fromId: eggs.id, relationType: "COLLECTE_DE", toType: "LOT", toId: lot.id, metadata: { quantity: eggs.quantity }, actorId: session.userId });
  await assignBvuId("TABLE_EGG_LOT", eggs.id);
  await recordAudit({
    actorId: session.userId,
    entityType: "table_egg_lot",
    entityId: eggs.id,
    field: null,
    oldValue: null,
    newValue: `${eggs.quantity} œufs ${eggType.toLowerCase()} (${eggs.saleable} vendables, déclassement ${(downgradeRate(eggs) * 100).toFixed(1)} %)`,
    reason: "Collecte d'œufs de consommation",
    relatedLotId: lot.id,
    relatedEventId: null,
  });
  return eggs;
}

const NEXT_STATUS: Record<TableEggLot["status"], TableEggLot["status"][]> = {
  EN_STOCK: ["CONDITIONNE", "DETRUIT"],
  CONDITIONNE: ["EXPEDIE", "DETRUIT"],
  EXPEDIE: [],
  DETRUIT: [],
};

export const tableEggStatusSchema = z.object({ id: z.string().min(1), status: z.enum(TABLE_EGG_LOT_STATUS), reason: z.string().trim().max(500).optional().nullable() });

export async function changeTableEggLotStatus(input: unknown, session: Session): Promise<TableEggLot> {
  if (!can(session, "EDIT", "TRACEABILITY")) throw new AuthorizationError();
  const data = parseInput(tableEggStatusSchema, input);
  const eggs = await repositories.tableEggLots.findById(data.id);
  if (!eggs) throw new NotFoundError("Lot d'œufs de consommation", data.id);
  assertInScope(session, await resolveLotHierarchy(eggs.lotId));
  if (!NEXT_STATUS[eggs.status].includes(data.status)) throw new ValidationError(`Passage impossible de ${eggs.status} à ${data.status}.`);
  if (data.status !== "DETRUIT") await assertNotOnHold("TABLE_EGG_LOT", eggs.id);
  if (data.status === "DETRUIT" && (data.reason ?? "").length < 10) throw new ValidationError("Une destruction se justifie (10 caractères au moins).");
  const updated = await repositories.tableEggLots.updateStatusIf(eggs.id, eggs.status, data.status);
  if (!updated) throw new ConflictError("Ce lot vient de changer d'état.");
  await recordAudit({ actorId: session.userId, entityType: "table_egg_lot", entityId: eggs.id, field: "status", oldValue: eggs.status, newValue: data.status, reason: data.reason ?? null, relatedLotId: eggs.lotId, relatedEventId: null });
  return updated;
}

export interface TableEggOverviewRow extends TableEggLot {
  lotCode: string;
  farmName: string;
  downgradePct: number;
}

export async function listTableEggLots(session: Session): Promise<TableEggOverviewRow[]> {
  if (!can(session, "VIEW", "LOTS")) throw new AuthorizationError();
  const [eggs, lots, index, buildings, farms] = await Promise.all([repositories.tableEggLots.list(), repositories.lots.list(), buildHierarchyIndex(), repositories.buildings.list(), repositories.farms.list()]);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const farmOfBuilding = new Map(buildings.map((b) => [b.id, farms.find((f) => f.id === b.farmId)?.name ?? "—"]));
  return eggs
    .filter((e) => {
      const lot = lotById.get(e.lotId);
      return lot && (isGlobalScope(session) || isWithinScope(session, index.building.get(lot.buildingId) ?? {}));
    })
    .map((e) => {
      const lot = lotById.get(e.lotId)!;
      return { ...e, lotCode: lot.code, farmName: farmOfBuilding.get(lot.buildingId) ?? "—", downgradePct: downgradeRate(e) * 100 };
    });
}

export async function getTableEggLot(id: string, session: Session): Promise<TableEggOverviewRow> {
  const row = (await listTableEggLots(session)).find((e) => e.id === id);
  if (!row) throw new NotFoundError("Lot d'œufs de consommation", id);
  return row;
}
