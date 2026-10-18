import { z } from "zod";
import { repositories } from "../../data/repositories";
import {
  chicksAvailable,
  hatchRate,
  validateCandling,
  validateEggAllocation,
  validateHatchBalance,
} from "../../domain/hatchery/balance";
import type { ChickLot, EggLot, HatchCycle, ParentFlock } from "../../domain/hatchery/types";
import { CHICK_GRADE, DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import {
  assertInScope,
  buildHierarchyIndex,
  isWithinScope,
  resolveBuildingHierarchy,
  resolveLotHierarchy,
} from "../identity/scope-check";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "../traceability/relations";

/**
 * Upstream chain (client spec A03–A07): parent flock → egg lot → incubation cycle → chick lot →
 * farm lot. Each step is its own record with provenance, linked through the generic relations
 * graph so the existing traceability views, holds and recalls cover it with no special case.
 * Every quantity that moves between steps is checked against what the previous step holds.
 */

const provenance = {
  dataStatus: z.enum(DATA_STATUS),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE).default("MANUEL"),
  measurementMethod: z.string().trim().max(200).optional().nullable(),
  documentId: z.string().trim().max(200).optional().nullable(),
};

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(" "));
  return parsed.data;
}

function requireHatchery(session: Session, action: "CREATE" | "EDIT"): void {
  if (!can(session, action, "HATCHERY")) throw new AuthorizationError("Vous n'avez pas les droits sur le module couvoir.");
}

function provenanceFields(data: { dataStatus: z.infer<typeof provenance.dataStatus>; sourceType: z.infer<typeof provenance.sourceType>; measurementMethod?: string | null; documentId?: string | null }, session: Session) {
  return {
    dataStatus: data.dataStatus,
    sourceType: data.sourceType,
    sourceId: null,
    actorId: session.userId,
    measurementMethod: data.measurementMethod || null,
    deviceId: null,
    documentId: data.documentId || null,
    validationStatus: null,
  };
}

async function assertUniqueCode(kind: string, existing: unknown | null, code: string): Promise<void> {
  if (existing) throw new ConflictError(`Le code ${kind} "${code}" est déjà utilisé.`);
}

async function audit(session: Session, entityType: string, entityId: string, newValue: string, reason: string, relatedLotId: string | null = null) {
  await recordAudit({ actorId: session.userId, entityType, entityId, field: null, oldValue: null, newValue, reason, relatedLotId, relatedEventId: null });
}

// ---------------------------------------------------------------------------
// Parent flock (reproducteurs) — genetic origin set once, never overwritten
// ---------------------------------------------------------------------------

export const createParentFlockSchema = z.object({
  code: z.string().trim().min(3).max(50),
  buildingId: z.string().min(1),
  strain: z.string().trim().min(1).max(100),
  geneticSupplier: z.string().trim().min(1).max(200),
  originCountry: z.string().trim().min(2).max(100),
  importReference: z.string().trim().max(200).optional().nullable(),
  placedAt: z.string().trim().min(1),
  femaleCount: z.number().int().positive(),
  maleCount: z.number().int().nonnegative(),
  ...provenance,
});

export async function createParentFlock(input: unknown, session: Session): Promise<ParentFlock> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createParentFlockSchema, input);
  assertInScope(session, await resolveBuildingHierarchy(data.buildingId));
  await assertUniqueCode("de troupeau", await repositories.parentFlocks.findByCode(data.code), data.code);

  const flock = await repositories.parentFlocks.create({
    code: data.code,
    buildingId: data.buildingId,
    strain: data.strain,
    geneticSupplier: data.geneticSupplier,
    originCountry: data.originCountry,
    importReference: data.importReference || null,
    placedAt: data.placedAt,
    femaleCount: data.femaleCount,
    maleCount: data.maleCount,
    ...provenanceFields(data, session),
  });
  await audit(session, "parent_flock", flock.id, `${flock.strain} — ${flock.geneticSupplier} (${flock.originCountry}), ${flock.femaleCount}♀/${flock.maleCount}♂`, "Mise en place d'un troupeau reproducteur");
  return flock;
}

// ---------------------------------------------------------------------------
// Egg lot (lot OAC)
// ---------------------------------------------------------------------------

export const createEggLotSchema = z.object({
  code: z.string().trim().min(3).max(50),
  parentFlockId: z.string().min(1),
  collectedAt: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  storageBuildingId: z.string().trim().min(1).optional().nullable(),
  ...provenance,
});

export async function createEggLot(input: unknown, session: Session): Promise<EggLot> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createEggLotSchema, input);
  const flock = await repositories.parentFlocks.findById(data.parentFlockId);
  if (!flock) throw new NotFoundError("Troupeau reproducteur", data.parentFlockId);
  assertInScope(session, await resolveBuildingHierarchy(flock.buildingId));
  if (data.storageBuildingId) assertInScope(session, await resolveBuildingHierarchy(data.storageBuildingId));
  await assertNotOnHold("PARENT_FLOCK", flock.id);
  await assertUniqueCode("de lot d'œufs", await repositories.eggLots.findByCode(data.code), data.code);

  const egg = await repositories.eggLots.create({
    code: data.code,
    parentFlockId: flock.id,
    collectedAt: data.collectedAt,
    quantity: data.quantity,
    storageBuildingId: data.storageBuildingId || null,
    ...provenanceFields(data, session),
  });
  await createRelation({ fromType: "EGG_LOT", fromId: egg.id, relationType: "PROVIENT_DE", toType: "PARENT_FLOCK", toId: flock.id, metadata: { quantity: egg.quantity }, actorId: session.userId });
  await audit(session, "egg_lot", egg.id, `${egg.quantity} œufs du troupeau ${flock.code}`, "Collecte d'un lot d'œufs à couver");
  return egg;
}

/** Eggs of a lot already loaded into incubation cycles. */
export async function eggsAllocated(eggLotId: string): Promise<number> {
  const edges = await repositories.relations.listTo("EGG_LOT", eggLotId);
  return edges.filter((e) => e.fromType === "HATCH_CYCLE").reduce((sum, e) => sum + Number((e.metadata as { quantity?: number }).quantity ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Incubation cycle: set → candle → hatch
// ---------------------------------------------------------------------------

export const createHatchCycleSchema = z.object({
  code: z.string().trim().min(3).max(50),
  buildingId: z.string().min(1),
  incubatorRef: z.string().trim().min(1).max(100),
  setAt: z.string().trim().min(1),
  allocations: z
    .array(z.object({ eggLotId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1, "Chargez au moins un lot d'œufs."),
  ...provenance,
});

export async function createHatchCycle(input: unknown, session: Session): Promise<HatchCycle> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createHatchCycleSchema, input);
  const building = await repositories.buildings.findById(data.buildingId);
  if (!building) throw new NotFoundError("Bâtiment", data.buildingId);
  if (building.zoneType !== "COUVOIR") throw new ValidationError("Un cycle d'incubation doit se dérouler dans un bâtiment de type couvoir.");
  assertInScope(session, await resolveBuildingHierarchy(building.id));
  await assertUniqueCode("de cycle", await repositories.hatchCycles.findByCode(data.code), data.code);

  const seen = new Set<string>();
  for (const allocation of data.allocations) {
    if (seen.has(allocation.eggLotId)) throw new ValidationError("Un même lot d'œufs est listé deux fois.");
    seen.add(allocation.eggLotId);
    const egg = await repositories.eggLots.findById(allocation.eggLotId);
    if (!egg) throw new NotFoundError("Lot d'œufs", allocation.eggLotId);
    await assertNotOnHold("EGG_LOT", egg.id);
    const check = validateEggAllocation(egg.quantity, await eggsAllocated(egg.id), allocation.quantity);
    if (!check.ok) throw new ValidationError(`${egg.code} : ${check.error}`);
  }

  const eggsSet = data.allocations.reduce((sum, a) => sum + a.quantity, 0);
  const cycle = await repositories.hatchCycles.create({
    code: data.code,
    buildingId: building.id,
    incubatorRef: data.incubatorRef,
    setAt: data.setAt,
    eggsSet,
    status: "EN_INCUBATION",
    candledAt: null,
    clearsRemoved: null,
    hatchedAt: null,
    chicksHatched: null,
    unhatched: null,
    culls: null,
    ...provenanceFields(data, session),
  });
  for (const allocation of data.allocations) {
    await createRelation({ fromType: "HATCH_CYCLE", fromId: cycle.id, relationType: "PROVIENT_DE", toType: "EGG_LOT", toId: allocation.eggLotId, metadata: { quantity: allocation.quantity }, actorId: session.userId });
  }
  await audit(session, "hatch_cycle", cycle.id, `${eggsSet} œufs chargés — ${cycle.incubatorRef}`, "Mise en incubation");
  return cycle;
}

async function getCycleInScope(cycleId: string, session: Session): Promise<HatchCycle> {
  const cycle = await repositories.hatchCycles.findById(cycleId);
  if (!cycle) throw new NotFoundError("Cycle d'incubation", cycleId);
  assertInScope(session, await resolveBuildingHierarchy(cycle.buildingId));
  return cycle;
}

export const recordCandlingSchema = z.object({
  cycleId: z.string().min(1),
  candledAt: z.string().trim().min(1),
  clearsRemoved: z.number().int().nonnegative(),
});

export async function recordCandling(input: unknown, session: Session): Promise<HatchCycle> {
  requireHatchery(session, "EDIT");
  const data = parseOrThrow(recordCandlingSchema, input);
  const cycle = await getCycleInScope(data.cycleId, session);
  if (cycle.status !== "EN_INCUBATION") throw new ConflictError("Le mirage a déjà été enregistré pour ce cycle.");
  const check = validateCandling(cycle.eggsSet, data.clearsRemoved);
  if (!check.ok) throw new ValidationError(check.error);

  const updated = await repositories.hatchCycles.update(cycle.id, { status: "MIRE", candledAt: data.candledAt, clearsRemoved: data.clearsRemoved });
  await recordAudit({ actorId: session.userId, entityType: "hatch_cycle", entityId: cycle.id, field: "status", oldValue: "EN_INCUBATION", newValue: `MIRE — ${data.clearsRemoved} œufs clairs retirés`, reason: "Mirage", relatedLotId: null, relatedEventId: null });
  return updated;
}

export const recordHatchSchema = z.object({
  cycleId: z.string().min(1),
  hatchedAt: z.string().trim().min(1),
  chicksHatched: z.number().int().nonnegative(),
  unhatched: z.number().int().nonnegative(),
  culls: z.number().int().nonnegative(),
});

export async function recordHatch(input: unknown, session: Session): Promise<HatchCycle> {
  requireHatchery(session, "EDIT");
  const data = parseOrThrow(recordHatchSchema, input);
  const cycle = await getCycleInScope(data.cycleId, session);
  if (cycle.status !== "MIRE") throw new ConflictError("L'éclosion s'enregistre après le mirage, une seule fois.");
  const check = validateHatchBalance({ eggsSet: cycle.eggsSet, clearsRemoved: cycle.clearsRemoved ?? 0, unhatched: data.unhatched, chicksHatched: data.chicksHatched, culls: data.culls });
  if (!check.ok) throw new ValidationError(check.error);

  const updated = await repositories.hatchCycles.update(cycle.id, { status: "ECLOS", hatchedAt: data.hatchedAt, chicksHatched: data.chicksHatched, unhatched: data.unhatched, culls: data.culls });
  const rate = hatchRate(cycle.eggsSet, data.chicksHatched);
  await recordAudit({ actorId: session.userId, entityType: "hatch_cycle", entityId: cycle.id, field: "status", oldValue: "MIRE", newValue: `ECLOS — ${data.chicksHatched} éclos (${rate !== null ? (rate * 100).toFixed(1) : "—"} %), ${data.culls} écartés`, reason: "Éclosion", relatedLotId: null, relatedEventId: null });
  return updated;
}

// ---------------------------------------------------------------------------
// Chick lot, and its placement into a farm lot
// ---------------------------------------------------------------------------

export const createChickLotSchema = z.object({
  code: z.string().trim().min(3).max(50),
  hatchCycleId: z.string().min(1),
  quantity: z.number().int().positive(),
  grade: z.enum(CHICK_GRADE),
  dispatchedAt: z.string().trim().min(1),
  ...provenance,
});

export async function createChickLot(input: unknown, session: Session): Promise<ChickLot> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createChickLotSchema, input);
  const cycle = await getCycleInScope(data.hatchCycleId, session);
  if (cycle.status !== "ECLOS") throw new ConflictError("Un lot de poussins ne peut sortir que d'un cycle éclos.");
  await assertNotOnHold("HATCH_CYCLE", cycle.id);
  await assertUniqueCode("de lot de poussins", await repositories.chickLots.findByCode(data.code), data.code);

  const dispatched = (await repositories.chickLots.listByCycle(cycle.id)).reduce((sum, c) => sum + c.quantity, 0);
  const available = chicksAvailable(cycle.chicksHatched ?? 0, cycle.culls ?? 0, dispatched);
  if (data.quantity > available) throw new ValidationError(`Seulement ${available} poussins restent disponibles sur ce cycle.`);

  const chicks = await repositories.chickLots.create({
    code: data.code,
    hatchCycleId: cycle.id,
    quantity: data.quantity,
    grade: data.grade,
    dispatchedAt: data.dispatchedAt,
    ...provenanceFields(data, session),
  });
  await createRelation({ fromType: "CHICK_LOT", fromId: chicks.id, relationType: "PROVIENT_DE", toType: "HATCH_CYCLE", toId: cycle.id, metadata: { quantity: chicks.quantity }, actorId: session.userId });
  await audit(session, "chick_lot", chicks.id, `${chicks.quantity} poussins (qualité ${chicks.grade})`, "Sortie couvoir d'un lot de poussins");
  return chicks;
}

/** Chicks of a lot already placed into farm lots. */
export async function chicksPlaced(chickLotId: string): Promise<number> {
  const edges = await repositories.relations.listTo("CHICK_LOT", chickLotId);
  return edges.filter((e) => e.fromType === "LOT").reduce((sum, e) => sum + Number((e.metadata as { quantity?: number }).quantity ?? 0), 0);
}

export const placeChicksSchema = z.object({
  lotId: z.string().min(1),
  chickLotId: z.string().min(1),
  quantity: z.number().int().positive(),
});

/** Links a farm lot to the chick lot it was placed from — the join between hatchery and farm. */
export async function placeChicksIntoLot(input: unknown, session: Session): Promise<void> {
  if (!can(session, "EDIT", "LOTS") && !can(session, "CREATE", "HATCHERY")) throw new AuthorizationError();
  const data = parseOrThrow(placeChicksSchema, input);
  const lot = await repositories.lots.findById(data.lotId);
  if (!lot) throw new NotFoundError("Lot", data.lotId);
  assertInScope(session, await resolveLotHierarchy(lot.id));
  const chicks = await repositories.chickLots.findById(data.chickLotId);
  if (!chicks) throw new NotFoundError("Lot de poussins", data.chickLotId);
  await assertNotOnHold("CHICK_LOT", chicks.id);

  const existing = await repositories.relations.findExact("LOT", lot.id, "PROVIENT_DE", "CHICK_LOT", chicks.id);
  if (existing) throw new ConflictError("Ce lot est déjà relié à ce lot de poussins.");
  const remaining = chicks.quantity - (await chicksPlaced(chicks.id));
  if (data.quantity > remaining) throw new ValidationError(`Seulement ${remaining} poussins de ${chicks.code} restent à placer.`);
  if (data.quantity > lot.initialPopulation) throw new ValidationError("Plus de poussins placés que l'effectif initial du lot.");

  await createRelation({ fromType: "LOT", fromId: lot.id, relationType: "PROVIENT_DE", toType: "CHICK_LOT", toId: chicks.id, metadata: { quantity: data.quantity }, actorId: session.userId });
}

// ---------------------------------------------------------------------------
// Overview for the /couvoir screens
// ---------------------------------------------------------------------------

export interface HatcheryOverview {
  flocks: (ParentFlock & { buildingLabel: string; eggLotCount: number })[];
  eggLots: (EggLot & { flockCode: string; allocated: number })[];
  cycles: (HatchCycle & { buildingLabel: string; dispatched: number })[];
  chickLots: (ChickLot & { cycleCode: string; placed: number })[];
  couvoirBuildings: { id: string; label: string }[];
  flockBuildings: { id: string; label: string }[];
}

export async function getHatcheryOverview(session: Session): Promise<HatcheryOverview> {
  if (!can(session, "VIEW", "HATCHERY")) throw new AuthorizationError();
  const [index, buildings, farms, flocks, eggs, cycles, chicks] = await Promise.all([
    buildHierarchyIndex(),
    repositories.buildings.list(),
    repositories.farms.list(),
    repositories.parentFlocks.list(),
    repositories.eggLots.list(),
    repositories.hatchCycles.list(),
    repositories.chickLots.list(),
  ]);
  const visibleBuilding = (id: string) => isGlobalScope(session) || isWithinScope(session, index.building.get(id) ?? {});
  const farmName = new Map(farms.map((f) => [f.id, f.name]));
  const buildingLabel = new Map(buildings.map((b) => [b.id, `${farmName.get(b.farmId) ?? "?"} — ${b.code}`]));

  const visibleFlocks = flocks.filter((f) => visibleBuilding(f.buildingId));
  const flockById = new Map(visibleFlocks.map((f) => [f.id, f]));
  const visibleEggs = eggs.filter((e) => flockById.has(e.parentFlockId));
  const visibleCycles = cycles.filter((c) => visibleBuilding(c.buildingId));
  const cycleById = new Map(visibleCycles.map((c) => [c.id, c]));
  const visibleChicks = chicks.filter((c) => cycleById.has(c.hatchCycleId));

  return {
    flocks: visibleFlocks.map((f) => ({ ...f, buildingLabel: buildingLabel.get(f.buildingId) ?? "—", eggLotCount: visibleEggs.filter((e) => e.parentFlockId === f.id).length })),
    eggLots: await Promise.all(visibleEggs.map(async (e) => ({ ...e, flockCode: flockById.get(e.parentFlockId)?.code ?? "—", allocated: await eggsAllocated(e.id) }))),
    cycles: visibleCycles.map((c) => ({ ...c, buildingLabel: buildingLabel.get(c.buildingId) ?? "—", dispatched: visibleChicks.filter((k) => k.hatchCycleId === c.id).reduce((s, k) => s + k.quantity, 0) })),
    chickLots: await Promise.all(visibleChicks.map(async (c) => ({ ...c, cycleCode: cycleById.get(c.hatchCycleId)?.code ?? "—", placed: await chicksPlaced(c.id) }))),
    couvoirBuildings: buildings.filter((b) => b.zoneType === "COUVOIR" && visibleBuilding(b.id)).map((b) => ({ id: b.id, label: buildingLabel.get(b.id)! })),
    flockBuildings: buildings.filter((b) => b.zoneType !== "COUVOIR" && visibleBuilding(b.id)).map((b) => ({ id: b.id, label: buildingLabel.get(b.id)! })),
  };
}

// ---------------------------------------------------------------------------
// Detail reads
// ---------------------------------------------------------------------------

export interface HatchCycleDetail {
  cycle: HatchCycle;
  buildingLabel: string;
  loadedEggLots: { id: string; code: string; quantity: number; flockCode: string }[];
  chickLots: ChickLot[];
  dispatched: number;
  available: number | null;
}

export async function getHatchCycleDetail(cycleId: string, session: Session): Promise<HatchCycleDetail> {
  if (!can(session, "VIEW", "HATCHERY")) throw new AuthorizationError();
  const cycle = await getCycleInScope(cycleId, session);
  const building = await repositories.buildings.findById(cycle.buildingId);
  const farm = building ? await repositories.farms.findById(building.farmId) : null;
  const edges = (await repositories.relations.listFrom("HATCH_CYCLE", cycle.id)).filter((e) => e.toType === "EGG_LOT");
  const loadedEggLots = [];
  for (const edge of edges) {
    const egg = await repositories.eggLots.findById(edge.toId);
    if (!egg) continue;
    const flock = await repositories.parentFlocks.findById(egg.parentFlockId);
    loadedEggLots.push({ id: egg.id, code: egg.code, quantity: Number((edge.metadata as { quantity?: number }).quantity ?? 0), flockCode: flock?.code ?? "—" });
  }
  const chickLots = await repositories.chickLots.listByCycle(cycle.id);
  const dispatched = chickLots.reduce((s, c) => s + c.quantity, 0);
  return {
    cycle,
    buildingLabel: `${farm?.name ?? "—"} — ${building?.code ?? "—"}`,
    loadedEggLots,
    chickLots,
    dispatched,
    available: cycle.status === "ECLOS" ? chicksAvailable(cycle.chicksHatched ?? 0, cycle.culls ?? 0, dispatched) : null,
  };
}

export async function getParentFlockDetail(flockId: string, session: Session): Promise<{ flock: ParentFlock; buildingLabel: string; eggLots: (EggLot & { allocated: number })[] }> {
  if (!can(session, "VIEW", "HATCHERY")) throw new AuthorizationError();
  const flock = await repositories.parentFlocks.findById(flockId);
  if (!flock) throw new NotFoundError("Troupeau reproducteur", flockId);
  assertInScope(session, await resolveBuildingHierarchy(flock.buildingId));
  const building = await repositories.buildings.findById(flock.buildingId);
  const farm = building ? await repositories.farms.findById(building.farmId) : null;
  const eggs = await repositories.eggLots.listByParentFlock(flock.id);
  return {
    flock,
    buildingLabel: `${farm?.name ?? "—"} — ${building?.code ?? "—"}`,
    eggLots: await Promise.all(eggs.map(async (e) => ({ ...e, allocated: await eggsAllocated(e.id) }))),
  };
}
