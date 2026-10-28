import { randomUUID } from "node:crypto";
import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import {
  CLOCK_AHEAD_TOLERANCE_MS,
  CORRECTION_WINDOW_DAYS,
  decideDailyMortality,
  FIELD_BATCH_MAX,
  feedPayload,
  fieldOpSchema,
  mortalityDayKey,
  mortalityPayload,
  receptionPayload,
  waterPayload,
  weighingPayload,
  type FieldDiscrepancy,
  type FieldEntry,
  type FieldOp,
  type FieldStatus,
} from "../../domain/field/field";
import type { Lot } from "../../domain/production/types";
import { farmDay } from "../../domain/sanitary/health";
import { AppError, AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { withLock } from "../../lib/keyed-lock";
import { logger } from "../../lib/logger";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { createFeedUsageRecord, createMortalityRecord, createWaterUsageRecord, createWeightMeasurementRecord, recordMortalityCorrection } from "../production/data-records";
import { receiveTransfer } from "../production/transfers";
import { recordObservation, recordTreatment, recordVaccination } from "../sanitary/health";

/**
 * The server side of the field app (document 3, ch. 05): "un téléphone qui saisit hors ligne
 * pendant trois jours doit renvoyer trois jours de saisies, dans l'ordre, sans doublon, et sans
 * écraser ce qu'un autre a saisi entre-temps."
 *
 * - In order: a batch is applied in the phone's sequence order, one entry at a time.
 * - Without duplicates: an entry carries its own id; sending it again returns what happened the
 *   first time, and applies nothing.
 * - Without overwriting: every entry becomes a new record. Two people's numbers for the same day
 *   are both kept, the most recent is shown, the gap is flagged (decideDailyMortality).
 * - Nothing is dropped: an entry the rules refuse is stored with the reason, for its author and
 *   for the manager. Only a server fault stops the batch — the phone keeps the rest and retries.
 *
 * Every entry goes through the same service as the web form, under the author's own session, so
 * scope, permissions, holds and withdrawal periods apply exactly as they do in the office.
 */

export type SyncStatus = FieldStatus | "AUTRE_COMPTE" | "A_REESSAYER";

export interface FieldOpResult {
  opId: string;
  status: SyncStatus;
  message: string | null;
  /** True when this entry had already reached the server: the stored outcome is returned, nothing is applied. */
  replayed: boolean;
}

const MEASURED_IN_FIELD = "Saisie terrain (application hors ligne)";

interface Outcome {
  status: FieldStatus;
  message: string | null;
  resultType: string | null;
  resultId: string | null;
  dayKey: string | null;
  appliedCount: number;
}

const applied = (resultType: string, resultId: string): Outcome => ({ status: "APPLIQUEE", message: null, resultType, resultId, dayKey: null, appliedCount: 0 });

function provenance(op: FieldOp, lot: Lot) {
  return { sourceType: "MANUEL" as const, sourceId: op.opId, dataStatus: lot.dataStatus, measurementMethod: MEASURED_IN_FIELD, deviceId: op.deviceId, documentId: null };
}

async function lotOf(op: FieldOp): Promise<Lot> {
  if (!op.lotId) throw new ValidationError("Lot manquant sur cette saisie.");
  const lot = await repositories.lots.findById(op.lotId);
  if (!lot) throw new NotFoundError("Lot", op.lotId);
  return lot;
}

async function storeEntry(op: FieldOp, outcome: Outcome, receivedAt: string): Promise<FieldEntry> {
  return repositories.fieldEntries.create({
    opId: op.opId,
    deviceId: op.deviceId,
    deviceSeq: op.seq,
    authorId: op.authorId,
    kind: op.kind,
    lotId: op.lotId ?? null,
    transferId: op.transferId ?? null,
    payload: op.payload,
    capturedAt: new Date(op.capturedAt).toISOString(),
    receivedAt,
    status: outcome.status,
    message: outcome.message,
    resultType: outcome.resultType,
    resultId: outcome.resultId,
    dayKey: outcome.dayKey,
    appliedCount: outcome.appliedCount,
  });
}

/** Daily mortality: decided, applied and stored under the lot's lock, so two phones cannot both apply the same day. */
async function applyDailyMortality(op: FieldOp, lot: Lot, session: Session, receivedAt: string): Promise<Outcome> {
  const data = parseInput(mortalityPayload, op.payload);
  const day = farmDay(op.capturedAt);
  const dayKey = mortalityDayKey(lot.id, day);
  const prior = (await repositories.fieldEntries.listByDayKey(dayKey)).filter((e) => e.status !== "REFUSEE");
  const alreadyApplied = prior.reduce((sum, e) => sum + e.appliedCount, 0);
  const decision = decideDailyMortality(
    prior.map((e) => ({ authorId: e.authorId, count: (e.payload as { count: number }).count, capturedAt: e.capturedAt })),
    { authorId: session.userId, count: data.count, capturedAt: new Date(op.capturedAt).toISOString() },
    alreadyApplied
  );
  let resultId: string | null = null;
  if (decision.apply > 0) {
    const { record } = await createMortalityRecord(lot.id, { occurredAt: new Date(op.capturedAt).toISOString(), count: decision.apply, suspectedCause: data.cause, ...provenance(op, lot) }, session);
    resultId = record.id;
  }
  if (decision.status === "EN_ECART") {
    const discrepancy = await repositories.fieldDiscrepancies.open({ dayKey, lotId: lot.id, day, reason: decision.reason!, openedAt: receivedAt });
    await recordAudit({
      actorId: session.userId,
      entityType: "field_discrepancy",
      entityId: discrepancy.id,
      field: "status",
      oldValue: null,
      newValue: "OUVERT",
      reason: decision.reason,
      relatedLotId: lot.id,
      relatedEventId: null,
    });
  }
  return { status: decision.status, message: decision.reason, resultType: resultId ? "mortality_record" : null, resultId, dayKey, appliedCount: decision.apply };
}

async function applyOp(op: FieldOp, session: Session, receivedAt: string): Promise<Outcome> {
  const at = new Date(op.capturedAt).toISOString();
  switch (op.kind) {
    case "MORTALITE": {
      const lot = await lotOf(op);
      return applyDailyMortality(op, lot, session, receivedAt);
    }
    case "PESEE": {
      const lot = await lotOf(op);
      const data = parseInput(weighingPayload, op.payload);
      const { record } = await createWeightMeasurementRecord(lot.id, { occurredAt: at, averageWeight: data.averageWeightKg, unit: "KG", sampleCount: data.sampleCount, ...provenance(op, lot) }, session);
      return applied("weight_measurement_record", record.id);
    }
    case "ALIMENT": {
      const lot = await lotOf(op);
      const data = parseInput(feedPayload, op.payload);
      const { record } = await createFeedUsageRecord(lot.id, { occurredAt: at, quantity: data.quantityKg, unit: "KG", feedType: data.feedType, ...provenance(op, lot) }, session);
      return applied("feed_usage_record", record.id);
    }
    case "EAU": {
      const lot = await lotOf(op);
      const data = parseInput(waterPayload, op.payload);
      const { record } = await createWaterUsageRecord({ buildingId: lot.buildingId, lotId: lot.id, occurredAt: at, quantity: data.quantityL, unit: "L", ...provenance(op, lot) }, session);
      return applied("water_usage_record", record.id);
    }
    case "VACCINATION": {
      const lot = await lotOf(op);
      const event = await recordVaccination(lot.id, { administeredAt: at, ...op.payload }, session);
      return applied("lot_event", event.id);
    }
    case "TRAITEMENT": {
      const lot = await lotOf(op);
      const { event } = await recordTreatment(lot.id, { startedAt: at, ...op.payload }, session);
      return applied("lot_event", event.id);
    }
    case "OBSERVATION": {
      const lot = await lotOf(op);
      const { event } = await recordObservation(lot.id, { observedAt: at, ...op.payload }, session);
      return applied("lot_event", event.id);
    }
    case "RECEPTION": {
      if (!op.transferId) throw new ValidationError("Transfert manquant sur cette réception.");
      const data = parseInput(receptionPayload, op.payload);
      const transfer = await receiveTransfer({ transferId: op.transferId, ...data, receivedAt: at }, session);
      return applied("transfer", transfer.id);
    }
  }
}

/** The key that serialises entries touching the same lot (or transfer) across phones. */
function lockKey(op: FieldOp): string {
  return op.lotId ? `field-lot:${op.lotId}` : `field-transfer:${op.transferId ?? op.opId}`;
}

async function processOp(op: FieldOp, session: Session): Promise<FieldOpResult> {
  return withLock(lockKey(op), async () => {
    const existing = await repositories.fieldEntries.findByOpId(op.opId);
    if (existing) return { opId: op.opId, status: existing.status, message: existing.message, replayed: true };
    if (await repositories.fieldEntries.findByDeviceSeq(op.deviceId, op.seq)) {
      // A phone never reuses a number; this one is damaged. Refused without storing: storing it would break the phone's order.
      return { opId: op.opId, status: "REFUSEE", message: "Numéro d'ordre déjà utilisé sur ce téléphone : réinstallez l'application avant de continuer.", replayed: false };
    }
    const receivedAt = new Date().toISOString();
    let outcome: Outcome;
    if (Date.parse(op.capturedAt) > Date.now() + CLOCK_AHEAD_TOLERANCE_MS) {
      outcome = { status: "REFUSEE", message: "L'horloge du téléphone est en avance : corrigez la date et l'heure, puis saisissez à nouveau.", resultType: null, resultId: null, dayKey: null, appliedCount: 0 };
    } else {
      try {
        outcome = await applyOp(op, session, receivedAt);
      } catch (error) {
        // A rule said no: kept with its reason. A fault of the server itself stops the batch instead.
        if (!(error instanceof AppError) || error.kind === "DATABASE" || error.kind === "UNEXPECTED") throw error;
        outcome = { status: "REFUSEE", message: error.message, resultType: null, resultId: null, dayKey: null, appliedCount: 0 };
      }
    }
    const entry = await storeEntry(op, outcome, receivedAt);
    return { opId: op.opId, status: entry.status, message: entry.message, replayed: false };
  });
}

const batchSchema = z.object({ ops: z.array(z.unknown()).max(FIELD_BATCH_MAX, `${FIELD_BATCH_MAX} saisies au plus par envoi.`) });

/**
 * Applies a phone's queued entries in its order. Stops at the first server fault and marks the
 * rest A_REESSAYER: the phone keeps them, in order, for the next attempt.
 */
export async function syncFieldOps(input: unknown, session: Session): Promise<{ results: FieldOpResult[]; serverTime: string }> {
  if (!can(session, "VIEW", "EVENTS")) throw new AuthorizationError("Ce compte n'a pas accès à la saisie terrain.");
  const { ops } = parseInput(batchSchema, input);
  const parsed = ops.map((raw) => ({ raw, parsed: fieldOpSchema.safeParse(raw) }));
  const valid = parsed.flatMap((p) => (p.parsed.success ? [p.parsed.data] : [])).sort((a, b) => (a.deviceId === b.deviceId ? a.seq - b.seq : a.deviceId.localeCompare(b.deviceId)));

  const results: FieldOpResult[] = parsed
    .filter((p) => !p.parsed.success)
    .map((p) => ({ opId: String((p.raw as { opId?: unknown })?.opId ?? "?"), status: "REFUSEE" as const, message: "Saisie illisible par le serveur : mettez l'application à jour.", replayed: false }));

  let failed = false;
  for (const op of valid) {
    if (failed) {
      results.push({ opId: op.opId, status: "A_REESSAYER", message: null, replayed: false });
      continue;
    }
    if (op.authorId !== session.userId) {
      results.push({ opId: op.opId, status: "AUTRE_COMPTE", message: "Saisie faite sous un autre compte : elle partira quand ce compte se reconnectera sur ce téléphone.", replayed: false });
      continue;
    }
    try {
      results.push(await processOp(op, session));
    } catch (error) {
      logger.error("general", `Saisie terrain ${op.opId} non appliquée, envoi interrompu`, error);
      failed = true;
      results.push({ opId: op.opId, status: "A_REESSAYER", message: "Serveur indisponible : nouvel essai automatique.", replayed: false });
    }
  }
  return { results, serverTime: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Arbitration of a disputed day
// ---------------------------------------------------------------------------

export const resolveDiscrepancySchema = z.object({
  discrepancyId: z.string().min(1),
  count: z.number().int().nonnegative("La mortalité retenue ne peut pas être négative."),
  note: z.string().trim().min(10, "Expliquez l'arbitrage (10 caractères au moins)."),
});

/**
 * A manager settles the day's mortality. The settlement is itself a declaration — the most recent,
 * so it is the one shown — and only the difference with what was applied moves the population:
 * more deaths are added, too many are corrected by a counter-entry. Nothing already written changes.
 */
export async function resolveMortalityDiscrepancy(input: unknown, session: Session): Promise<FieldDiscrepancy> {
  if (!can(session, "VALIDATE", "EVENTS")) throw new AuthorizationError("Seul un responsable arbitre un écart de saisie.");
  const data = parseInput(resolveDiscrepancySchema, input);
  const discrepancy = await repositories.fieldDiscrepancies.findById(data.discrepancyId);
  if (!discrepancy) throw new NotFoundError("Écart de saisie", data.discrepancyId);
  if (discrepancy.status !== "OUVERT") throw new ConflictError("Cet écart a déjà été arbitré.");
  const lot = (await repositories.lots.findById(discrepancy.lotId))!;
  assertInScope(session, await resolveLotHierarchy(lot.id));
  const ageDays = (Date.now() - Date.parse(`${discrepancy.day}T12:00:00Z`)) / 86_400_000;
  if (ageDays > CORRECTION_WINDOW_DAYS && session.role !== "SUPER_ADMIN") {
    throw new AuthorizationError(`Au-delà de ${CORRECTION_WINDOW_DAYS} jours, seul l'administrateur corrige une journée passée.`);
  }

  return withLock(`field-lot:${lot.id}`, async () => {
    const entries = (await repositories.fieldEntries.listByDayKey(discrepancy.dayKey)).filter((e) => e.status !== "REFUSEE");
    const alreadyApplied = entries.reduce((sum, e) => sum + e.appliedCount, 0);
    const delta = data.count - alreadyApplied;
    const now = new Date().toISOString();
    // Dated on the disputed day, so period figures put the deaths where they happened.
    const onTheDay = `${discrepancy.day}T12:00:00.000Z`;
    const opId = randomUUID();
    let resultId: string | null = null;
    const cause = `Arbitrage d'écart de saisie terrain : ${data.note}`;
    if (delta > 0) {
      const { record } = await createMortalityRecord(lot.id, { occurredAt: onTheDay, count: delta, suspectedCause: cause.slice(0, 200), sourceType: "MANUEL", sourceId: opId, dataStatus: lot.dataStatus, measurementMethod: "Arbitrage d'un écart de saisie terrain" }, session);
      resultId = record.id;
    } else if (delta < 0) {
      const record = await recordMortalityCorrection(lot.id, -delta, cause, session, opId, onTheDay);
      resultId = record.id;
    }
    await repositories.fieldEntries.create({
      opId,
      deviceId: `arbitrage:${session.userId}`,
      deviceSeq: Date.now(),
      authorId: session.userId,
      kind: "MORTALITE",
      lotId: lot.id,
      transferId: null,
      payload: { count: data.count, cause: data.note },
      capturedAt: now,
      receivedAt: now,
      status: "APPLIQUEE",
      message: `Arbitrage : ${data.count} retenus (${alreadyApplied} enregistrés auparavant).`,
      resultType: resultId ? "mortality_record" : null,
      resultId,
      dayKey: discrepancy.dayKey,
      appliedCount: delta,
    });
    const resolved = await repositories.fieldDiscrepancies.resolve(discrepancy.id, { resolvedBy: session.userId, resolvedAt: now, resolvedCount: data.count, resolutionNote: data.note });
    if (!resolved) throw new ConflictError("Cet écart vient d'être arbitré par quelqu'un d'autre.");
    await recordAudit({
      actorId: session.userId,
      entityType: "field_discrepancy",
      entityId: discrepancy.id,
      field: "mortalité du jour",
      oldValue: String(alreadyApplied),
      newValue: String(data.count),
      reason: data.note,
      relatedLotId: lot.id,
      relatedEventId: null,
    });
    return resolved;
  });
}
