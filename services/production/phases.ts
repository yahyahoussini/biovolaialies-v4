import { parseInput, z } from "../../lib/zod";
import { withLock } from "../../lib/keyed-lock";
import { repositories } from "../../data/repositories";
import {
  ageInDays,
  allowedPhases,
  checkPhaseStart,
  dueAction,
  PHASE_LABEL,
  PLAN_CHECK_LABEL,
  type DueAction,
  type LotPhaseRecord,
  type ProductionLine,
} from "../../domain/production/lines";
import type { Lot } from "../../domain/production/types";
import { LOT_PHASE, type LotPhase } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { businessDate, orderError } from "../../domain/shared/dates";
import { findOverlap } from "../../domain/telemetry/occupation";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, buildHierarchyIndex, isWithinScope, resolveBuildingHierarchy, resolveLotHierarchy } from "../identity/scope-check";
import { reattributeReadings } from "../telemetry/reattribute";
import { getProductionLine } from "./lines";

/** Every write that changes a lot's phase, site or head count from the flow services takes this lock. */
export const lotFlowLock = (lotId: string) => `lot-flow:${lotId}`;

const CLOSED: Lot["status"][] = ["ABATTU", "TRANSFORME", "CLOTURE", "ARCHIVE"];

/**
 * Moves a lot's zone occupation with the lot: the open occupation ends, and one opens in the
 * new building when that building has exactly one rearing zone and nobody else occupies it.
 * Otherwise the occupation is left for a person to enter — never guessed.
 */
export async function moveLotOccupancy(lotId: string, toBuildingId: string, at: string, actorId: string, headCount: number | null): Promise<void> {
  for (const occupation of await repositories.zoneOccupations.listByLot(lotId)) {
    if (occupation.endedAt === null && occupation.startedAt < at) {
      await repositories.zoneOccupations.close(occupation.id, at);
      await reattributeReadings(occupation.zoneId, at, null);
    }
  }
  const zones = (await repositories.zones.listByBuilding(toBuildingId)).filter((z) => z.kind === "ELEVAGE");
  if (zones.length !== 1) return;
  const zone = zones[0];
  const existing = await repositories.zoneOccupations.listByZones([zone.id]);
  if (findOverlap(existing, { zoneId: zone.id, lotId, startedAt: at, endedAt: null })) return;
  await repositories.zoneOccupations.create({ zoneId: zone.id, lotId, startedAt: at, endedAt: null, headCount, note: "Ouverte avec le changement de bâtiment du lot", recordedBy: actorId });
  await reattributeReadings(zone.id, at, null);
}

export const startPhaseSchema = z.object({
  lotId: z.string().min(1),
  phase: z.enum(LOT_PHASE),
  startedAt: businessDate("Début de phase"),
  buildingId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * Records that a lot enters a phase of its line. The line decides which phases exist and in which
 * order; the birds' age is compared with the plan and the result kept with the phase — a phase
 * entered late is recorded as late, not refused. A move to another building of the same farm can
 * come with it; a move to another farm is a transfer, counted and signed on both sides.
 */
export function startLotPhase(input: unknown, session: Session): Promise<LotPhaseRecord> {
  const data = parseInput(startPhaseSchema, input);
  return withLock(lotFlowLock(data.lotId), () => startLotPhaseUnlocked(data, session, false));
}

/** For flow services that already hold the lot's lock and checked the caller's rights (import, reception). */
export async function startLotPhaseUnlocked(data: z.infer<typeof startPhaseSchema>, session: Session, trusted: boolean): Promise<LotPhaseRecord> {
  if (!trusted && !can(session, "EDIT", "LOTS")) throw new AuthorizationError("Vous n'avez pas les droits pour faire évoluer ce lot.");
  const lot = await repositories.lots.findById(data.lotId);
  if (!lot) throw new NotFoundError("Lot", data.lotId);
  if (!trusted) assertInScope(session, await resolveLotHierarchy(lot.id));
  if (CLOSED.includes(lot.status)) throw new ConflictError("Ce lot est terminé : il ne change plus de phase.");

  const line = await getProductionLine(lot.productionLine);
  const allowed = line ? allowedPhases(line) : null;
  if (allowed && !allowed.includes(data.phase)) throw new ValidationError(`La ligne ${line!.label} ne prévoit pas la phase « ${PHASE_LABEL[data.phase]} ».`);

  const current = await repositories.lotPhases.current(lot.id);
  if (current?.phase === data.phase) throw new ConflictError(`Le lot est déjà en phase « ${PHASE_LABEL[data.phase]} ».`);
  if (allowed && current && allowed.indexOf(data.phase) < allowed.indexOf(current.phase)) {
    throw new ValidationError(`Un lot ne revient pas en arrière : il est en « ${PHASE_LABEL[current.phase]} ».`);
  }
  if (current) {
    const order = orderError(`Le début de « ${PHASE_LABEL[current.phase]} »`, current.startedAt, "Le début de la nouvelle phase", data.startedAt);
    if (order) throw new ValidationError(order);
  }
  if (lot.hatchedAt) {
    const order = orderError("L'éclosion des animaux", lot.hatchedAt, "Le début de phase", data.startedAt);
    if (order) throw new ValidationError(order);
  }

  const buildingId = data.buildingId || lot.buildingId;
  if (buildingId !== lot.buildingId) {
    const [from, to] = await Promise.all([repositories.buildings.findById(lot.buildingId), repositories.buildings.findById(buildingId)]);
    if (!to) throw new NotFoundError("Bâtiment", buildingId);
    if (!from || from.farmId !== to.farmId) throw new ValidationError("Un changement de ferme passe par un transfert, compté et signé des deux côtés.");
    if (!trusted) assertInScope(session, await resolveBuildingHierarchy(buildingId));
  }

  const ageDays = ageInDays(lot.hatchedAt ?? null, data.startedAt);
  const planCheck = checkPhaseStart(line, data.phase, ageDays);
  const record = await repositories.lotPhases.startNext(
    { lotId: lot.id, phase: data.phase, buildingId, startedAt: data.startedAt, endedAt: null, ageDaysAtStart: ageDays, planCheck, notes: data.notes ?? null, actorId: session.userId },
    current ? { id: current.id, endedAt: data.startedAt } : null
  );
  if (buildingId !== lot.buildingId) {
    await repositories.lots.updateFlow(lot.id, { buildingId });
    await moveLotOccupancy(lot.id, buildingId, data.startedAt, session.userId, lot.currentPopulation);
  }
  const label = `${PHASE_LABEL[data.phase]}${ageDays !== null ? ` à J${ageDays}` : ""} — ${PLAN_CHECK_LABEL[planCheck].toLowerCase()}`;
  await repositories.lotEvents.create({
    lotId: lot.id,
    eventType: "CHANGEMENT_PHASE",
    payload: { phase: data.phase, label, ageDays, planCheck, buildingId },
    occurredAt: data.startedAt,
    actorId: session.userId,
    dataStatus: lot.dataStatus,
    sourceType: "MANUEL",
    sourceId: record.id,
    deviceId: null,
    measurementMethod: null,
    validationStatus: null,
  });
  await recordAudit({
    actorId: session.userId,
    entityType: "lot_phase",
    entityId: record.id,
    field: "phase",
    oldValue: current?.phase ?? null,
    newValue: data.phase,
    reason: data.notes || label,
    relatedLotId: lot.id,
    relatedEventId: null,
  });
  return record;
}

export interface LotFlowView {
  line: ProductionLine | null;
  phases: LotPhaseRecord[];
  current: LotPhaseRecord | null;
  ageDays: number | null;
  due: DueAction | null;
  /** Phases the lot can still enter, in the line's order. */
  nextPhases: LotPhase[];
}

export async function getLotFlow(lotId: string, session: Session, at = new Date().toISOString()): Promise<LotFlowView> {
  if (!can(session, "VIEW", "LOTS")) throw new AuthorizationError();
  const lot = await repositories.lots.findById(lotId);
  if (!lot) throw new NotFoundError("Lot", lotId);
  assertInScope(session, await resolveLotHierarchy(lot.id));
  const [line, phases] = await Promise.all([getProductionLine(lot.productionLine), repositories.lotPhases.listByLot(lot.id)]);
  const current = phases.find((p) => p.endedAt === null) ?? null;
  const reference = lot.endedAt ?? at;
  const ageDays = ageInDays(lot.hatchedAt ?? null, reference);
  const allowed = line ? allowedPhases(line) : [];
  const nextPhases = current ? allowed.slice(allowed.indexOf(current.phase) + 1) : allowed;
  return {
    line,
    phases,
    current,
    ageDays,
    due: line && !CLOSED.includes(lot.status) ? dueAction(line, current?.phase ?? null, ageDays) : null,
    nextPhases,
  };
}

export interface DueLot {
  lot: Lot;
  line: ProductionLine;
  phase: LotPhase | null;
  ageDays: number;
  due: DueAction;
  buildingLabel: string;
}

/** Lots whose plan expects a step now — next phase, slaughter or reform — most overdue first. */
export async function lotsDueForAction(session: Session, at = new Date().toISOString()): Promise<DueLot[]> {
  if (!can(session, "VIEW", "LOTS")) throw new AuthorizationError();
  const [lots, lines, open, index, buildings, farms] = await Promise.all([
    repositories.lots.list(),
    repositories.productionLines.list(),
    repositories.lotPhases.listOpen(),
    buildHierarchyIndex(),
    repositories.buildings.list(),
    repositories.farms.list(),
  ]);
  const lineByCode = new Map(lines.map((l) => [l.code, l]));
  const phaseByLot = new Map(open.map((p) => [p.lotId, p.phase]));
  const farmName = new Map(farms.map((f) => [f.id, f.name]));
  const buildingLabel = new Map(buildings.map((b) => [b.id, `${farmName.get(b.farmId) ?? "—"} — ${b.code}`]));
  const out: DueLot[] = [];
  for (const lot of lots) {
    if (CLOSED.includes(lot.status) || !lot.productionLine || !lot.hatchedAt) continue;
    if (!isGlobalScope(session) && !isWithinScope(session, index.building.get(lot.buildingId) ?? {})) continue;
    const line = lineByCode.get(lot.productionLine);
    if (!line) continue;
    const ageDays = ageInDays(lot.hatchedAt, at)!;
    const phase = phaseByLot.get(lot.id) ?? null;
    const due = dueAction(line, phase, ageDays);
    if (due) out.push({ lot, line, phase, ageDays, due, buildingLabel: buildingLabel.get(lot.buildingId) ?? "—" });
  }
  return out.sort((a, b) => b.due.overdueDays - a.due.overdueDays || a.due.dueByDay - a.ageDays - (b.due.dueByDay - b.ageDays));
}
