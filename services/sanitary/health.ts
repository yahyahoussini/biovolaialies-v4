import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import { recordLotEventWithPopulationUpdate } from "../../data/repositories/transactions";
import type { TableEggLot } from "../../domain/production/flow";
import type { Lot, LotEvent, NewLotEvent } from "../../domain/production/types";
import {
  activeWithdrawals,
  eggClearAt,
  eggWithdrawalsOnDay,
  farmDay,
  meatClearAt,
  observationSchema,
  treatmentError,
  treatmentSchema,
  vaccinationSchema,
  type Observation,
  type RecordedTreatment,
  type Treatment,
  type Vaccination,
  type Withdrawal,
} from "../../domain/sanitary/health";
import type { SanitaryObservation } from "../../domain/sanitary/types";
import { orderError } from "../../domain/shared/dates";
import type { EventType, LotStatus } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { getLotOrThrow } from "../production/lot";

/**
 * Vaccinations, treatments and health observations (document 3, ch. 02 "Santé"; ch. 05: the
 * field app records "sanitaire"). Each act is a lot event dated when it happened, not when it
 * was typed. A treatment carries its withdrawal periods, and they act: slaughter is refused
 * inside the meat window, and eggs collected inside the egg window are taken off sale.
 */

/** A lot that still has live birds: the only kind a health act can be recorded on. */
const LIVE_STATUSES: LotStatus[] = ["CREE", "ACTIF", "EN_TRANSFERT", "SUSPENDU", "BLOQUE", "LIBERE"];

async function liveLotForCare(lotId: string, session: Session): Promise<Lot> {
  if (!can(session, "CREATE", "SANITARY")) throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer un acte sanitaire.");
  const lot = await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));
  if (!LIVE_STATUSES.includes(lot.status)) throw new ValidationError(`Le lot ${lot.code} n'a plus d'animaux vivants : aucun acte sanitaire ne peut y être enregistré.`);
  return lot;
}

function assertAfterStart(lot: Lot, label: string, at: string): void {
  if (!lot.startedAt) return;
  const error = orderError("La mise en place du lot", lot.startedAt, label, at);
  if (error) throw new ValidationError(error);
}

async function writeHealthEvent(lot: Lot, eventType: EventType, payload: Record<string, unknown>, occurredAt: string, session: Session, sourceId: string | null = null): Promise<LotEvent> {
  const input: NewLotEvent = {
    lotId: lot.id,
    eventType,
    payload,
    occurredAt,
    actorId: session.userId,
    dataStatus: lot.dataStatus,
    sourceType: "MANUEL",
    sourceId,
    deviceId: null,
    measurementMethod: null,
    validationStatus: null,
  };
  const { event } = await recordLotEventWithPopulationUpdate(input, null);
  return event;
}

export async function recordVaccination(lotId: string, input: unknown, session: Session): Promise<LotEvent> {
  const lot = await liveLotForCare(lotId, session);
  const data = parseInput(vaccinationSchema, input);
  assertAfterStart(lot, "La vaccination", data.administeredAt);
  const event = await writeHealthEvent(lot, "VACCINATION", data, data.administeredAt, session);
  await recordAudit({
    actorId: session.userId,
    entityType: "lot_event",
    entityId: event.id,
    field: null,
    oldValue: null,
    newValue: `${data.vaccine} contre ${data.disease}`,
    reason: "Vaccination",
    relatedLotId: lot.id,
    relatedEventId: event.id,
  });
  return event;
}

export interface TreatmentResult {
  event: LotEvent;
  meatClearAt: string;
  eggClearAt: string | null;
  /** Collections inside the egg window that were still in stock: now off sale. */
  withdrawnCollections: TableEggLot[];
  /** Collections inside the egg window already shipped: a recall decision for the quality manager. */
  shippedCollections: TableEggLot[];
}

export async function recordTreatment(lotId: string, input: unknown, session: Session): Promise<TreatmentResult> {
  const lot = await liveLotForCare(lotId, session);
  const data = parseInput(treatmentSchema, input);
  const ruleError = treatmentError(data, lot);
  if (ruleError) throw new ValidationError(ruleError);
  assertAfterStart(lot, "Le début du traitement", data.startedAt);

  const event = await writeHealthEvent(lot, "TRAITEMENT", data, data.startedAt, session);
  const meatClear = meatClearAt(data);
  const eggClear = eggClearAt(data);
  await recordAudit({
    actorId: session.userId,
    entityType: "lot_event",
    entityId: event.id,
    field: null,
    oldValue: null,
    newValue: `${data.product} (${data.indication}), ${data.durationDays} j ; attente viande ${data.withdrawalMeatDays} j${data.withdrawalEggDays === null ? "" : `, œufs ${data.withdrawalEggDays} j`}`,
    reason: "Traitement",
    relatedLotId: lot.id,
    relatedEventId: event.id,
  });

  const withdrawnCollections: TableEggLot[] = [];
  const shippedCollections: TableEggLot[] = [];
  if (eggClear) {
    const recorded = [{ eventId: event.id, treatment: data }];
    for (const eggs of await repositories.tableEggLots.listByLot(lot.id)) {
      if (eggWithdrawalsOnDay(recorded, farmDay(eggs.collectedOn)).length === 0) continue;
      if (eggs.status === "EN_STOCK" || eggs.status === "CONDITIONNE") {
        const updated = await repositories.tableEggLots.updateStatusIf(eggs.id, eggs.status, "RETIRE");
        if (!updated) continue;
        withdrawnCollections.push(updated);
        await recordAudit({
          actorId: session.userId,
          entityType: "table_egg_lot",
          entityId: eggs.id,
          field: "status",
          oldValue: eggs.status,
          newValue: "RETIRE",
          reason: `Délai d'attente œufs du traitement ${data.product}`,
          relatedLotId: lot.id,
          relatedEventId: event.id,
        });
      } else if (eggs.status === "EXPEDIE") {
        shippedCollections.push(eggs);
      }
    }
  }
  return { event, meatClearAt: meatClear, eggClearAt: eggClear, withdrawnCollections, shippedCollections };
}

export async function recordObservation(lotId: string, input: unknown, session: Session): Promise<{ event: LotEvent; observation: SanitaryObservation }> {
  const lot = await liveLotForCare(lotId, session);
  const data = parseInput(observationSchema, input);
  assertAfterStart(lot, "L'observation", data.observedAt);
  const observation = await repositories.sanitaryObservations.create({
    lotId: lot.id,
    status: data.status,
    notes: data.signs,
    observedBy: session.userId,
    observedAt: data.observedAt,
    validatedBy: null,
    validationStatus: "EN_ATTENTE",
  });
  const event = await writeHealthEvent(lot, "OBSERVATION_SANITAIRE", data, data.observedAt, session, observation.id);
  await recordAudit({
    actorId: session.userId,
    entityType: "sanitary_observation",
    entityId: observation.id,
    field: null,
    oldValue: null,
    newValue: `${data.status} : ${data.signs}`,
    reason: "Observation sanitaire",
    relatedLotId: lot.id,
    relatedEventId: event.id,
  });
  return { event, observation };
}

export const reviewObservationSchema = z.object({
  observationId: z.string().min(1),
  decision: z.enum(["VALIDE", "REJETE"]),
  comment: z.string().trim().max(500).optional().nullable(),
});

/** A technician or veterinarian confirms or rejects what was seen — never the person who saw it. */
export async function reviewObservation(input: unknown, session: Session): Promise<SanitaryObservation> {
  if (!can(session, "VALIDATE", "SANITARY")) throw new AuthorizationError("Seuls le technicien et le vétérinaire valident une observation sanitaire.");
  const data = parseInput(reviewObservationSchema, input);
  const observation = await repositories.sanitaryObservations.findById(data.observationId);
  if (!observation) throw new NotFoundError("Observation sanitaire", data.observationId);
  assertInScope(session, await resolveLotHierarchy(observation.lotId));
  if (observation.observedBy === session.userId) throw new ValidationError("Une observation se valide par une autre personne que celle qui l'a faite.");
  const reviewed = await repositories.sanitaryObservations.review(observation.id, session.userId, data.decision);
  if (!reviewed) throw new ConflictError("Cette observation a déjà été examinée.");
  await recordAudit({
    actorId: session.userId,
    entityType: "sanitary_observation",
    entityId: observation.id,
    field: "validationStatus",
    oldValue: observation.validationStatus,
    newValue: data.decision,
    reason: data.comment ?? null,
    relatedLotId: observation.lotId,
    relatedEventId: null,
  });
  return reviewed;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function isTreatment(payload: unknown): payload is Treatment {
  const p = payload as Partial<Treatment> | null;
  return !!p && typeof p.product === "string" && typeof p.startedAt === "string" && typeof p.durationDays === "number" && typeof p.withdrawalMeatDays === "number";
}

/** Treatments recorded on a lot, as written by recordTreatment. Used by the slaughter and egg checks. */
export async function lotTreatments(lotId: string): Promise<RecordedTreatment[]> {
  const events = await repositories.lotEvents.listByLot(lotId);
  return events.filter((e) => e.eventType === "TRAITEMENT" && isTreatment(e.payload)).map((e) => ({ eventId: e.id, treatment: e.payload as Treatment }));
}

export async function meatWithdrawalsAt(lotId: string, at: string): Promise<Withdrawal[]> {
  return activeWithdrawals(await lotTreatments(lotId), at, "meat");
}

export async function eggWithdrawalsOn(lotId: string, at: string): Promise<Withdrawal[]> {
  return eggWithdrawalsOnDay(await lotTreatments(lotId), farmDay(at));
}

export interface HealthEntry<T> {
  eventId: string;
  occurredAt: string;
  authorName: string;
  data: T;
}

export interface LotHealth {
  vaccinations: HealthEntry<Vaccination>[];
  treatments: (HealthEntry<Treatment> & { meatClearAt: string; eggClearAt: string | null })[];
  observations: (HealthEntry<Observation> & { observationId: string | null; review: SanitaryObservation["validationStatus"] | null; reviewerName: string | null; observedBy: string | null })[];
  activeMeat: Withdrawal[];
  activeEggs: Withdrawal[];
  canRecord: boolean;
  canReview: boolean;
}

export async function getLotHealth(lotId: string, session: Session): Promise<LotHealth> {
  if (!can(session, "VIEW", "SANITARY")) throw new AuthorizationError();
  const lot = await getLotOrThrow(lotId);
  assertInScope(session, await resolveLotHierarchy(lotId));
  const [events, observations, users] = await Promise.all([repositories.lotEvents.listByLot(lot.id), repositories.sanitaryObservations.listByLot(lot.id), repositories.users.list()]);
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const reviewOf = new Map(observations.map((o) => [o.id, o]));
  const author = (id: string | null) => (id ? (nameOf.get(id) ?? "—") : "—");
  const byDateDesc = <T extends { occurredAt: string }>(a: T, b: T) => b.occurredAt.localeCompare(a.occurredAt);

  const vaccinations = events
    .filter((e) => e.eventType === "VACCINATION")
    .map((e) => ({ eventId: e.id, occurredAt: e.occurredAt, authorName: author(e.actorId), data: e.payload as Vaccination }))
    .sort(byDateDesc);
  const treatments = events
    .filter((e) => e.eventType === "TRAITEMENT" && isTreatment(e.payload))
    .map((e) => {
      const data = e.payload as Treatment;
      return { eventId: e.id, occurredAt: e.occurredAt, authorName: author(e.actorId), data, meatClearAt: meatClearAt(data), eggClearAt: eggClearAt(data) };
    })
    .sort(byDateDesc);
  const healthObservations = events
    .filter((e) => e.eventType === "OBSERVATION_SANITAIRE")
    .map((e) => {
      const review = e.sourceId ? reviewOf.get(e.sourceId) : undefined;
      return {
        eventId: e.id,
        occurredAt: e.occurredAt,
        authorName: author(e.actorId),
        data: e.payload as Observation,
        observationId: review?.id ?? null,
        review: review?.validationStatus ?? null,
        reviewerName: review?.validatedBy ? author(review.validatedBy) : null,
        observedBy: review?.observedBy ?? null,
      };
    })
    .sort(byDateDesc);

  const recorded = treatments.map((t) => ({ eventId: t.eventId, treatment: t.data }));
  const now = new Date().toISOString();
  return {
    vaccinations,
    treatments,
    observations: healthObservations,
    activeMeat: activeWithdrawals(recorded, now, "meat"),
    activeEggs: eggWithdrawalsOnDay(recorded, farmDay(now)),
    canRecord: can(session, "CREATE", "SANITARY") && LIVE_STATUSES.includes(lot.status),
    canReview: can(session, "VALIDATE", "SANITARY"),
  };
}
