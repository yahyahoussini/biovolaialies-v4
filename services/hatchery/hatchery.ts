import { z } from "../../lib/zod";
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
import { businessDate, orderError } from "../../domain/shared/dates";
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
import { withLock } from "../../lib/keyed-lock";
import { allowedPhases, PHASE_LABEL } from "../../domain/production/lines";
import type { LotPhase } from "../../domain/shared/enums";
import { assignBvuId } from "../identity/bvu-ids";
import { requireProductionLine } from "../production/lines";
import { startLotPhaseUnlocked } from "../production/phases";

/**
 * Every write that draws on hatchery stock (eggs left in a lot, chicks left in a cycle or a
 * chick lot) runs under one lock, so concurrent submissions see each other's consumption.
 */
export const HATCHERY_STOCK_LOCK = "hatchery-stock";

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
  placedAt: businessDate("Mise en place"),
  femaleCount: z.number().int().positive(),
  maleCount: z.number().int().nonnegative(),
  /** Breeder line of the handwritten flow; optional for flocks registered after the fact. */
  lineCode: z.string().trim().max(40).optional().nullable(),
  /** Hatch date of the breeders, when known — their age drives the phase plan. */
  hatchedAt: businessDate("Éclosion des reproducteurs").optional().nullable(),
  /** The flock's own code at its genetic supplier, kept as an alias of our identifier. */
  supplierFlockCode: z.string().trim().max(120).optional().nullable(),
  ...provenance,
});

/**
 * Registers a flock of breeders already laying. The flock is carried by a lot of breeders (so its
 * mortality, feed, sensors and phases are recorded like any lot) opened in the hatching-egg
 * production phase. Day-old parent stock that still has to be reared goes through
 * `importParentStock` instead, which opens the lot at the first rearing phase.
 */
export async function createParentFlock(input: unknown, session: Session): Promise<ParentFlock> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createParentFlockSchema, input);
  return registerParentFlock(data, "PRODUCTION_OAC", session);
}

export async function registerParentFlock(data: z.infer<typeof createParentFlockSchema>, firstPhase: LotPhase, session: Session): Promise<ParentFlock> {
  const building = await repositories.buildings.findById(data.buildingId);
  if (!building) throw new NotFoundError("Bâtiment", data.buildingId);
  assertInScope(session, await resolveBuildingHierarchy(data.buildingId));
  await assertUniqueCode("de troupeau", await repositories.parentFlocks.findByCode(data.code), data.code);
  if (await repositories.lots.findByCode(data.code)) throw new ConflictError(`Le code ${data.code} est déjà utilisé par un lot.`);
  const line = data.lineCode ? await requireProductionLine(data.lineCode) : null;
  if (line && line.purpose !== "REPRODUCTION") throw new ValidationError(`La ligne ${line.label} n'est pas une ligne de reproducteurs.`);
  if (data.hatchedAt) {
    const order = orderError("L'éclosion des reproducteurs", data.hatchedAt, "La mise en place", data.placedAt);
    if (order) throw new ValidationError(order);
  }

  const headCount = data.femaleCount + data.maleCount;
  const lot = await repositories.lots.create({
    buildingId: building.id,
    code: data.code,
    species: "Poulet",
    breed: data.strain,
    status: "ACTIF",
    initialPopulation: headCount,
    currentPopulation: headCount,
    plannedStartAt: null,
    startedAt: data.placedAt,
    endedAt: null,
    dataStatus: data.dataStatus,
    productionLine: line?.code ?? null,
    purpose: "REPRODUCTION",
    hatchedAt: data.hatchedAt ?? null,
  });
  await repositories.lotEvents.create({ lotId: lot.id, eventType: "CREATION_LOT", payload: { initialPopulation: headCount }, occurredAt: data.placedAt, actorId: session.userId, dataStatus: data.dataStatus, sourceType: data.sourceType, sourceId: null, deviceId: null, measurementMethod: null, validationStatus: null });
  await repositories.lotEvents.create({ lotId: lot.id, eventType: "MISE_EN_PLACE", payload: { notes: `${data.femaleCount} femelles, ${data.maleCount} mâles — ${data.geneticSupplier} (${data.originCountry})` }, occurredAt: data.placedAt, actorId: session.userId, dataStatus: data.dataStatus, sourceType: data.sourceType, sourceId: null, deviceId: null, measurementMethod: null, validationStatus: null });

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
    lotId: lot.id,
    productionLine: line?.code ?? null,
    ...provenanceFields(data, session),
  });
  await createRelation({ fromType: "PARENT_FLOCK", fromId: flock.id, relationType: "PROVIENT_DE", toType: "LOT", toId: lot.id, metadata: { quantity: headCount }, actorId: session.userId });
  await assignBvuId("LOT", lot.id);
  const flockBvuId = await assignBvuId("PARENT_FLOCK", flock.id);
  if (data.supplierFlockCode) {
    await repositories.identifierAliases.create({ bvuId: flockBvuId, scheme: "FOURNISSEUR", issuer: data.geneticSupplier, value: data.supplierFlockCode, validFrom: new Date().toISOString(), validTo: null, reason: "Code du troupeau chez le fournisseur génétique", createdBy: session.userId });
  }
  if (!line || allowedPhases(line).includes(firstPhase)) {
    await startLotPhaseUnlocked({ lotId: lot.id, phase: firstPhase, startedAt: data.placedAt, buildingId: null, notes: "Mise en place" }, session, true);
  }
  await audit(session, "parent_flock", flock.id, `${flock.strain} — ${flock.geneticSupplier} (${flock.originCountry}), ${flock.femaleCount}♀/${flock.maleCount}♂`, "Mise en place d'un troupeau reproducteur", lot.id);
  return flock;
}

/**
 * Import of day-old parent chicks (handwritten flow, step 1): the start of the chain. Opens the
 * breeders' lot in its first rearing phase — cages to 6 weeks — so the plan follows them to the
 * floor at 6 weeks, to laying at 7 months, and to reform at 30 months.
 */
export const importParentStockSchema = createParentFlockSchema.extend({
  lineCode: z.string().trim().min(1, "La ligne de reproducteurs est requise."),
  hatchedAt: businessDate("Éclosion des reproducteurs"),
});

export async function importParentStock(input: unknown, session: Session): Promise<ParentFlock> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(importParentStockSchema, input);
  const line = await requireProductionLine(data.lineCode);
  return registerParentFlock(data, line.phasePlan[0].phase, session);
}

// ---------------------------------------------------------------------------
// Egg lot (lot OAC)
// ---------------------------------------------------------------------------

export const createEggLotSchema = z.object({
  code: z.string().trim().min(3).max(50),
  parentFlockId: z.string().min(1),
  collectedAt: businessDate("Collecte"),
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
  const eggOrder = orderError("Mise en place du troupeau", flock.placedAt, "La collecte", data.collectedAt);
  if (eggOrder) throw new ValidationError(eggOrder);
  if (flock.lotId) {
    const phases = await repositories.lotPhases.listByLot(flock.lotId);
    const at = Date.parse(data.collectedAt);
    const phaseAt = phases.filter((p) => Date.parse(p.startedAt) <= at && (p.endedAt === null || Date.parse(p.endedAt) > at)).pop();
    if (phases.length && phaseAt?.phase !== "PRODUCTION_OAC") {
      throw new ValidationError(`Le troupeau ${flock.code} n'était pas en production d'œufs à couver à cette date (${phaseAt ? PHASE_LABEL[phaseAt.phase].toLowerCase() : "pas encore en place"}).`);
    }
  }
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

/** Eggs of an egg lot broken or missing in transport — no longer there to be set. */
export async function eggsLostInTransfers(eggLotId: string): Promise<number> {
  return (await repositories.transfers.listByObject("EGG_LOT", eggLotId))
    .filter((t) => t.status !== "EN_TRANSIT" && t.status !== "ANNULE")
    .reduce((s, t) => s + (t.deadOnArrival ?? 0) + Math.max(0, t.discrepancy ?? 0), 0);
}

export async function eggLotInTransit(eggLotId: string): Promise<boolean> {
  return (await repositories.transfers.listByObject("EGG_LOT", eggLotId)).some((t) => t.status === "EN_TRANSIT");
}

/**
 * Chicks of a chick lot already gone: every transfer not cancelled (whatever arrived alive), plus
 * placements recorded directly, before transfers existed.
 */
export async function chicksCommitted(chickLotId: string): Promise<number> {
  const [moves, edges] = await Promise.all([repositories.transfers.listByObject("CHICK_LOT", chickLotId), repositories.relations.listTo("CHICK_LOT", chickLotId)]);
  const viaTransfers = moves.filter((t) => t.status !== "ANNULE").reduce((s, t) => s + t.quantitySent, 0);
  const direct = edges
    .filter((e) => e.fromType === "LOT" && !(e.metadata as { transferId?: string }).transferId)
    .reduce((s, e) => s + Number((e.metadata as { quantity?: number }).quantity ?? 0), 0);
  return viaTransfers + direct;
}

// ---------------------------------------------------------------------------
// Incubation cycle: set → candle → hatch
// ---------------------------------------------------------------------------

export const createHatchCycleSchema = z.object({
  code: z.string().trim().min(3).max(50),
  buildingId: z.string().min(1),
  incubatorRef: z.string().trim().min(1).max(100),
  setAt: businessDate("Mise en incubation"),
  allocations: z
    .array(z.object({ eggLotId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1, "Chargez au moins un lot d'œufs."),
  ...provenance,
});

async function createHatchCycleUnlocked(input: unknown, session: Session): Promise<HatchCycle> {
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
    // The eggs must belong to the caller's perimeter too, not only the incubator.
    const eggFlock = await repositories.parentFlocks.findById(egg.parentFlockId);
    assertInScope(session, await resolveBuildingHierarchy(egg.storageBuildingId ?? eggFlock?.buildingId ?? ""));
    await assertNotOnHold("EGG_LOT", egg.id);
    if (await eggLotInTransit(egg.id)) throw new ConflictError(`${egg.code} est en transit : réceptionnez-le au couvoir avant de le mettre en incubation.`);
    const setOrder = orderError(`La collecte de ${egg.code}`, egg.collectedAt, "La mise en incubation", data.setAt);
    if (setOrder) throw new ValidationError(setOrder);
    const check = validateEggAllocation(egg.quantity - (await eggsLostInTransfers(egg.id)), await eggsAllocated(egg.id), allocation.quantity);
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
  candledAt: businessDate("Mirage"),
  clearsRemoved: z.number().int().nonnegative(),
});

export async function recordCandling(input: unknown, session: Session): Promise<HatchCycle> {
  requireHatchery(session, "EDIT");
  const data = parseOrThrow(recordCandlingSchema, input);
  const cycle = await getCycleInScope(data.cycleId, session);
  if (cycle.status !== "EN_INCUBATION") throw new ConflictError("Le mirage a déjà été enregistré pour ce cycle.");
  const candleOrder = orderError("La mise en incubation", cycle.setAt, "Le mirage", data.candledAt);
  if (candleOrder) throw new ValidationError(candleOrder);
  const check = validateCandling(cycle.eggsSet, data.clearsRemoved);
  if (!check.ok) throw new ValidationError(check.error);

  const updated = await repositories.hatchCycles.update(cycle.id, { status: "MIRE", candledAt: data.candledAt, clearsRemoved: data.clearsRemoved });
  await recordAudit({ actorId: session.userId, entityType: "hatch_cycle", entityId: cycle.id, field: "status", oldValue: "EN_INCUBATION", newValue: `MIRE — ${data.clearsRemoved} œufs clairs retirés`, reason: "Mirage", relatedLotId: null, relatedEventId: null });
  return updated;
}

export const recordHatchSchema = z.object({
  cycleId: z.string().min(1),
  hatchedAt: businessDate("Éclosion"),
  chicksHatched: z.number().int().nonnegative(),
  unhatched: z.number().int().nonnegative(),
  culls: z.number().int().nonnegative(),
});

export async function recordHatch(input: unknown, session: Session): Promise<HatchCycle> {
  requireHatchery(session, "EDIT");
  const data = parseOrThrow(recordHatchSchema, input);
  const cycle = await getCycleInScope(data.cycleId, session);
  if (cycle.status !== "MIRE") throw new ConflictError("L'éclosion s'enregistre après le mirage, une seule fois.");
  const hatchOrder = orderError("Le mirage", cycle.candledAt ?? cycle.setAt, "L'éclosion", data.hatchedAt);
  if (hatchOrder) throw new ValidationError(hatchOrder);
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
  dispatchedAt: businessDate("Sortie"),
  ...provenance,
});

async function createChickLotUnlocked(input: unknown, session: Session): Promise<ChickLot> {
  requireHatchery(session, "CREATE");
  const data = parseOrThrow(createChickLotSchema, input);
  const cycle = await getCycleInScope(data.hatchCycleId, session);
  if (cycle.status !== "ECLOS") throw new ConflictError("Un lot de poussins ne peut sortir que d'un cycle éclos.");
  await assertNotOnHold("HATCH_CYCLE", cycle.id);
  const dispatchOrder = orderError("L'éclosion", cycle.hatchedAt ?? cycle.setAt, "La sortie", data.dispatchedAt);
  if (dispatchOrder) throw new ValidationError(dispatchOrder);
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
async function placeChicksIntoLotUnlocked(input: unknown, session: Session): Promise<void> {
  if (!can(session, "EDIT", "LOTS") && !can(session, "CREATE", "HATCHERY")) throw new AuthorizationError();
  const data = parseOrThrow(placeChicksSchema, input);
  const lot = await repositories.lots.findById(data.lotId);
  if (!lot) throw new NotFoundError("Lot", data.lotId);
  assertInScope(session, await resolveLotHierarchy(lot.id));
  const chicks = await repositories.chickLots.findById(data.chickLotId);
  if (!chicks) throw new NotFoundError("Lot de poussins", data.chickLotId);
  // The chicks must come from a hatchery in the caller's perimeter, not only go to one of its lots.
  const sourceCycle = await repositories.hatchCycles.findById(chicks.hatchCycleId);
  assertInScope(session, await resolveBuildingHierarchy(sourceCycle?.buildingId ?? ""));
  await assertNotOnHold("CHICK_LOT", chicks.id);

  const existing = await repositories.relations.findExact("LOT", lot.id, "PROVIENT_DE", "CHICK_LOT", chicks.id);
  if (existing) throw new ConflictError("Ce lot est déjà relié à ce lot de poussins.");
  const remaining = chicks.quantity - (await chicksCommitted(chicks.id));
  if (data.quantity > remaining) throw new ValidationError(`Seulement ${remaining} poussins de ${chicks.code} restent à placer.`);
  // Total across every chick lot already placed into this farm lot, not this placement alone.
  const alreadyInLot = (await repositories.relations.listFrom("LOT", lot.id))
    .filter((e) => e.toType === "CHICK_LOT")
    .reduce((sum, e) => sum + Number((e.metadata as { quantity?: number }).quantity ?? 0), 0);
  if (alreadyInLot + data.quantity > lot.initialPopulation) {
    throw new ValidationError(`Le lot compte ${lot.initialPopulation} sujets au départ ; ${alreadyInLot} y sont déjà placés.`);
  }


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
    chickLots: await Promise.all(visibleChicks.map(async (c) => ({ ...c, cycleCode: cycleById.get(c.hatchCycleId)?.code ?? "—", placed: await chicksCommitted(c.id) }))),
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

export function createHatchCycle(input: unknown, session: Session): Promise<HatchCycle> {
  return withLock(HATCHERY_STOCK_LOCK, () => createHatchCycleUnlocked(input, session));
}

export function createChickLot(input: unknown, session: Session): Promise<ChickLot> {
  return withLock(HATCHERY_STOCK_LOCK, () => createChickLotUnlocked(input, session));
}

export function placeChicksIntoLot(input: unknown, session: Session): Promise<void> {
  return withLock(HATCHERY_STOCK_LOCK, () => placeChicksIntoLotUnlocked(input, session));
}
