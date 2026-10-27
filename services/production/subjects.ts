import { parseInput, z } from "../../lib/zod";
import { withLock } from "../../lib/keyed-lock";
import { repositories } from "../../data/repositories";
import { newBvuId } from "../../domain/identity/bvu-id";
import { normalizeTag, type Subject, type SubjectEvent } from "../../domain/production/flow";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE, SUBJECT_EVENT_TYPE, SUBJECT_SEX, SUBJECT_STATUS } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { businessDate, orderError } from "../../domain/shared/dates";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assertInScope, resolveLotHierarchy } from "../identity/scope-check";
import { appendLedgerEvent } from "../ledger/ledger";

/**
 * Individually identified birds (document 3, "suivi individuel"): breeders and birds under
 * observation, each with a permanent BIOVOLAILLES identity, a ring as visual back-up, and
 * optionally a chip. The client's trace engine rules apply: one bird, one identity for life; a
 * chip is never silently reused; a reading is individual only when the attribution is shown.
 */

const SUBJECTS_LOCK = "subjects-tags";

async function lotInScope(lotId: string, session: Session, action: "VIEW" | "EDIT") {
  if (!can(session, action, "LOTS")) throw new AuthorizationError();
  const lot = await repositories.lots.findById(lotId);
  if (!lot) throw new NotFoundError("Lot", lotId);
  assertInScope(session, await resolveLotHierarchy(lot.id));
  return lot;
}

export const registerSubjectsSchema = z.object({
  lotId: z.string().min(1),
  taggedAt: businessDate("Pose des bagues"),
  dataStatus: z.enum(DATA_STATUS),
  subjects: z
    .array(
      z.object({
        visualId: z.string().trim().min(1, "Chaque sujet porte une bague (identifiant visuel).").max(40),
        rfidUid: z.string().trim().max(64).nullable().optional(),
        sex: z.enum(SUBJECT_SEX),
      })
    )
    .min(1, "Indiquez au moins un sujet.")
    .max(2000, "2 000 sujets au plus par saisie."),
});

/**
 * Tags birds of a lot. Every ring and chip is checked against every bird ever tagged, not only the
 * living ones: an identifier names one bird for life.
 */
export function registerSubjects(input: unknown, session: Session): Promise<Subject[]> {
  const data = parseInput(registerSubjectsSchema, input);
  return withLock(SUBJECTS_LOCK, async () => {
    const lot = await lotInScope(data.lotId, session, "EDIT");
    if (lot.status === "CLOTURE" || lot.status === "ARCHIVE" || lot.status === "ABATTU") throw new ConflictError("On ne bague pas les animaux d'un lot terminé.");
    const active = (await repositories.subjects.listByLot(lot.id)).filter((s) => s.status === "ACTIF" || s.status === "OBSERVATION").length;
    if (active + data.subjects.length > lot.currentPopulation) {
      throw new ValidationError(`Le lot compte ${lot.currentPopulation} animaux vivants, dont ${active} déjà identifiés : ${data.subjects.length} de plus dépasse l'effectif.`);
    }
    const visuals = new Set<string>();
    const chips = new Set<string>();
    const rows = [];
    for (const s of data.subjects) {
      const visualId = normalizeTag(s.visualId);
      const rfidUid = s.rfidUid ? normalizeTag(s.rfidUid) : null;
      if (visuals.has(visualId)) throw new ValidationError(`La bague ${visualId} apparaît deux fois dans la saisie.`);
      if (rfidUid && chips.has(rfidUid)) throw new ValidationError(`La puce ${rfidUid} apparaît deux fois dans la saisie.`);
      visuals.add(visualId);
      if (rfidUid) chips.add(rfidUid);
      if (await repositories.subjects.findByVisualId(visualId)) throw new ConflictError(`La bague ${visualId} est déjà portée par un autre sujet.`);
      if (rfidUid) {
        if (await repositories.subjects.findByRfid(rfidUid)) throw new ConflictError(`La puce ${rfidUid} est déjà attribuée à un autre sujet.`);
        const released = await repositories.identifierAliases.findActive("RFID", rfidUid);
        if (released.length) throw new ConflictError(`La puce ${rfidUid} est rattachée à un autre objet.`);
      }
      rows.push({
        bvuId: newBvuId("SUBJECT"),
        lotId: lot.id,
        sex: s.sex,
        visualId,
        rfidUid,
        taggedAt: data.taggedAt,
        status: "ACTIF" as const,
        statusAt: data.taggedAt,
        statusReason: null,
        notes: null,
        dataStatus: data.dataStatus,
        actorId: session.userId,
      });
    }
    const created = await repositories.subjects.createMany(rows);
    for (const subject of created) {
      await repositories.bvuIds.insertIfAbsent({ bvuId: subject.bvuId, objectType: "SUBJECT", objectId: subject.id });
    }
    await appendLedgerEvent({
      eventType: "SUBJECTS_TAGGED",
      objectType: "LOT",
      objectId: lot.id,
      actorKind: "USER",
      actorId: session.userId,
      source: "application",
      occurredAt: data.taggedAt,
      payload: { count: created.length, subjects: created.map((s) => ({ bvuId: s.bvuId, visualId: s.visualId, rfidUid: s.rfidUid, sex: s.sex })) },
    });
    await recordAudit({ actorId: session.userId, entityType: "lot", entityId: lot.id, field: "subjects", oldValue: String(active), newValue: String(active + created.length), reason: `${created.length} sujet(s) identifié(s)`, relatedLotId: lot.id, relatedEventId: null });
    return created;
  });
}

export const subjectStatusSchema = z.object({
  subjectId: z.string().min(1),
  status: z.enum(SUBJECT_STATUS),
  at: businessDate("Date"),
  reason: z.string().trim().min(3, "Motif requis.").max(500),
});

export async function changeSubjectStatus(input: unknown, session: Session): Promise<Subject> {
  const data = parseInput(subjectStatusSchema, input);
  const subject = await repositories.subjects.findById(data.subjectId);
  if (!subject) throw new NotFoundError("Sujet", data.subjectId);
  await lotInScope(subject.lotId, session, "EDIT");
  if (subject.status === data.status) throw new ConflictError("Le sujet a déjà ce statut.");
  if (["MORT", "SORTI"].includes(subject.status)) throw new ConflictError("Un sujet mort ou sorti ne change plus de statut : son identité reste dans l'historique.");
  const order = orderError("Le statut précédent", subject.statusAt, "Le nouveau statut", data.at);
  if (order) throw new ValidationError(order);
  const updated = await repositories.subjects.update(subject.id, { status: data.status, statusAt: data.at, statusReason: data.reason });
  await repositories.subjectEvents.create({ subjectId: subject.id, eventType: "STATUT", value: null, unit: null, payload: { from: subject.status, to: data.status, reason: data.reason }, attributionProof: "Saisie par une personne sur la fiche du sujet", occurredAt: data.at, actorId: session.userId, deviceId: null, sourceType: "MANUEL", dataStatus: subject.dataStatus });
  await recordAudit({ actorId: session.userId, entityType: "subject", entityId: subject.id, field: "status", oldValue: subject.status, newValue: data.status, reason: data.reason, relatedLotId: subject.lotId, relatedEventId: null });
  return updated;
}

export const subjectEventSchema = z.object({
  subjectId: z.string().min(1),
  eventType: z.enum(SUBJECT_EVENT_TYPE).refine((t) => t !== "STATUT", "Un changement de statut passe par la fiche du sujet."),
  value: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(16).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  attributionProof: z.string().trim().max(200).nullable().optional(),
  occurredAt: businessDate("Date"),
  deviceId: z.string().trim().max(80).nullable().optional(),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE).default("MANUEL"),
});

/**
 * An individual record. A weight or reading is individual only when we can say how it was tied to
 * this bird — "Un capteur d'ambiance ne transforme jamais une donnée de bâtiment en donnée
 * individuelle" — so a measured value without an attribution proof is refused.
 */
export async function recordSubjectEvent(input: unknown, session: Session): Promise<SubjectEvent> {
  const data = parseInput(subjectEventSchema, input);
  const subject = await repositories.subjects.findById(data.subjectId);
  if (!subject) throw new NotFoundError("Sujet", data.subjectId);
  await lotInScope(subject.lotId, session, "EDIT");
  if (subject.status === "MORT" || subject.status === "SORTI") throw new ConflictError("Ce sujet n'est plus présent.");
  if (["PESEE", "LECTURE"].includes(data.eventType)) {
    if (data.value === null || data.value === undefined) throw new ValidationError("Une pesée ou une lecture porte une valeur.");
    if (!data.attributionProof) throw new ValidationError("Dites comment la valeur a été rattachée à ce sujet (lecture de puce, bague vérifiée…) : sans preuve, elle reste une donnée de lot.");
  }
  if (data.eventType === "PESEE" && (data.value! <= 0 || data.value! > 15)) throw new ValidationError("Poids hors plage pour un poulet (0 à 15 kg).");
  const event = await repositories.subjectEvents.create({
    subjectId: subject.id,
    eventType: data.eventType,
    value: data.value ?? null,
    unit: data.unit ?? (data.eventType === "PESEE" ? "KG" : null),
    payload: { notes: data.notes ?? null },
    attributionProof: data.attributionProof ?? null,
    occurredAt: data.occurredAt,
    actorId: session.userId,
    deviceId: data.deviceId ?? null,
    sourceType: data.sourceType,
    dataStatus: subject.dataStatus,
  });
  await appendLedgerEvent({ eventType: `SUBJECT_${data.eventType}`, objectType: "SUBJECT", objectId: subject.id, actorKind: "USER", actorId: session.userId, source: "application", occurredAt: data.occurredAt, payload: { bvuId: subject.bvuId, value: event.value, unit: event.unit, attributionProof: event.attributionProof, notes: data.notes ?? null } });
  return event;
}

export const releaseRfidSchema = z.object({ subjectId: z.string().min(1), reason: z.string().trim().min(10, "Le retrait d'une puce se justifie (10 caractères au moins).").max(500) });

/**
 * The controlled procedure for a chip that leaves a bird (lost, faulty, bird dead): the UID is
 * kept as a retired alias of that bird, so it can never be read as someone else's history.
 */
export async function releaseSubjectRfid(input: unknown, session: Session): Promise<Subject> {
  const data = parseInput(releaseRfidSchema, input);
  if (!can(session, "VALIDATE", "TRACEABILITY") && !can(session, "EDIT", "HATCHERY")) throw new AuthorizationError("Le retrait d'une puce est réservé aux responsables.");
  const subject = await repositories.subjects.findById(data.subjectId);
  if (!subject) throw new NotFoundError("Sujet", data.subjectId);
  await lotInScope(subject.lotId, session, "VIEW");
  if (!subject.rfidUid) throw new ConflictError("Ce sujet ne porte pas de puce.");
  const now = new Date().toISOString();
  await repositories.identifierAliases.create({ bvuId: subject.bvuId, scheme: "RFID", issuer: "", value: subject.rfidUid, validFrom: subject.taggedAt, validTo: now, reason: data.reason, createdBy: session.userId });
  const updated = await repositories.subjects.update(subject.id, { rfidUid: null });
  await recordAudit({ actorId: session.userId, entityType: "subject", entityId: subject.id, field: "rfidUid", oldValue: subject.rfidUid, newValue: null, reason: data.reason, relatedLotId: subject.lotId, relatedEventId: null });
  return updated;
}

export async function listSubjects(lotId: string, session: Session): Promise<Subject[]> {
  await lotInScope(lotId, session, "VIEW");
  return repositories.subjects.listByLot(lotId);
}

export async function getSubject(subjectId: string, session: Session): Promise<{ subject: Subject; events: SubjectEvent[] }> {
  const subject = await repositories.subjects.findById(subjectId);
  if (!subject) throw new NotFoundError("Sujet", subjectId);
  await lotInScope(subject.lotId, session, "VIEW");
  return { subject, events: await repositories.subjectEvents.listBySubject(subject.id) };
}
