import { createHash } from "node:crypto";
import { parseInput, z } from "../../lib/zod";
import { withLock } from "../../lib/keyed-lock";
import { repositories } from "../../data/repositories";
import { recordLotEventWithPopulationUpdate } from "../../data/repositories/transactions";
import { canonicalJson } from "../../domain/ledger/hash-chain";
import { allowedPhases, PHASE_LABEL } from "../../domain/production/lines";
import { receptionOutcome, signatureMatches, TRANSFER_STATUS_LABEL, type Transfer } from "../../domain/production/flow";
import { validateTransition } from "../../domain/production/lot-lifecycle";
import type { Lot } from "../../domain/production/types";
import { LOT_PHASE, TRANSFER_OBJECT, type TransferObject } from "../../domain/shared/enums";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { businessDate, orderError } from "../../domain/shared/dates";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { HATCHERY_STOCK_LOCK, chicksCommitted, eggLotInTransit, eggsAllocated, eggsLostInTransfers } from "../hatchery/hatchery";
import { assignBvuId } from "../identity/bvu-ids";
import { assertInScope, buildHierarchyIndex, isWithinScope, resolveBuildingHierarchy } from "../identity/scope-check";
import { appendLedgerEvent } from "../ledger/ledger";
import { assertNotOnHold } from "../quality/holds";
import { createRelation } from "../traceability/relations";
import { getProductionLine } from "./lines";
import { lotFlowLock, moveLotOccupancy, startLotPhaseUnlocked } from "./phases";

/**
 * Movements of birds and eggs between sites (document 3, chapter 6). "Le maillon faible n'est ni
 * le capteur ni la base : c'est le transfert vers la coopérative." A transfer is therefore two
 * acts by two people: the sender counts and signs at departure, the receiver counts and signs at
 * arrival. Both counts are kept, and any gap between them stays on record with its explanation.
 */

const CLOSED: Lot["status"][] = ["ABATTU", "TRANSFORME", "CLOTURE", "ARCHIVE"];

function signature(fields: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(fields), "utf8").digest("hex");
}

async function requireSignature(session: Session, signerName: string): Promise<string> {
  const user = await repositories.users.findById(session.userId);
  if (!user) throw new AuthorizationError();
  if (!signatureMatches(signerName, user.fullName)) {
    throw new ValidationError(`La signature est votre nom complet, tel qu'il figure sur votre compte : « ${user.fullName} ».`);
  }
  return user.fullName;
}

function transferCode(at: string): string {
  const d = new Date(at);
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `MOV-${ymd}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Departure
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const dispatchTransferSchema = z.object({
  objectType: z.enum(TRANSFER_OBJECT),
  objectId: z.string().min(1),
  destinationBuildingId: z.string().min(1, "La destination est requise."),
  destinationLotId: z.string().min(1).nullable().optional(),
  destinationLotCode: z.string().trim().min(3).max(50).nullable().optional(),
  destinationLineCode: z.string().trim().max(40).nullable().optional(),
  phaseOnArrival: z.enum(LOT_PHASE).nullable().optional(),
  quantity: z.number().int().positive("La quantité expédiée doit être positive."),
  sentAt: businessDate("Départ"),
  documentRef: optionalText(80),
  transporter: optionalText(120),
  vehicle: optionalText(40),
  crates: z.number().int().nonnegative().nullable().optional(),
  notes: optionalText(500),
  signerName: z.string().trim().min(2, "Signez en tapant votre nom complet."),
});

interface SourceInfo {
  buildingId: string;
  available: number;
  label: string;
  lot: Lot | null;
}

async function resolveSource(objectType: TransferObject, objectId: string, session: Session): Promise<SourceInfo> {
  if (objectType === "LOT") {
    if (!can(session, "EDIT", "LOTS")) throw new AuthorizationError("Vous n'avez pas les droits pour expédier ce lot.");
    const lot = await repositories.lots.findById(objectId);
    if (!lot) throw new NotFoundError("Lot", objectId);
    assertInScope(session, await resolveBuildingHierarchy(lot.buildingId));
    if (CLOSED.includes(lot.status) || lot.status === "PLANIFIE" || lot.status === "CREE") throw new ConflictError("Seul un lot en cours peut être expédié.");
    await assertNotOnHold("LOT", lot.id);
    return { buildingId: lot.buildingId, available: lot.currentPopulation, label: `lot ${lot.code}`, lot };
  }
  if (!can(session, "CREATE", "HATCHERY")) throw new AuthorizationError("Vous n'avez pas les droits sur les expéditions du couvoir.");
  if (objectType === "CHICK_LOT") {
    const chicks = await repositories.chickLots.findById(objectId);
    if (!chicks) throw new NotFoundError("Lot de poussins", objectId);
    const cycle = await repositories.hatchCycles.findById(chicks.hatchCycleId);
    if (!cycle) throw new NotFoundError("Cycle d'incubation", chicks.hatchCycleId);
    assertInScope(session, await resolveBuildingHierarchy(cycle.buildingId));
    await assertNotOnHold("CHICK_LOT", chicks.id);
    return { buildingId: cycle.buildingId, available: chicks.quantity - (await chicksCommitted(chicks.id)), label: `poussins ${chicks.code}`, lot: null };
  }
  const egg = await repositories.eggLots.findById(objectId);
  if (!egg) throw new NotFoundError("Lot d'œufs", objectId);
  const flock = await repositories.parentFlocks.findById(egg.parentFlockId);
  const buildingId = egg.storageBuildingId ?? flock?.buildingId;
  if (!buildingId) throw new ValidationError("Le lieu de stockage de ce lot d'œufs est inconnu.");
  assertInScope(session, await resolveBuildingHierarchy(buildingId));
  await assertNotOnHold("EGG_LOT", egg.id);
  if (await eggLotInTransit(egg.id)) throw new ConflictError("Ce lot d'œufs est déjà en transit.");
  return { buildingId, available: egg.quantity - (await eggsAllocated(egg.id)) - (await eggsLostInTransfers(egg.id)), label: `œufs ${egg.code}`, lot: null };
}

async function dispatchUnlocked(data: z.infer<typeof dispatchTransferSchema>, session: Session): Promise<Transfer> {
  const source = await resolveSource(data.objectType, data.objectId, session);
  if (data.quantity > source.available) throw new ValidationError(`Seulement ${source.available} disponible(s) dans ${source.label}.`);
  const senderName = await requireSignature(session, data.signerName);

  const destination = await repositories.buildings.findById(data.destinationBuildingId);
  if (!destination) throw new NotFoundError("Bâtiment de destination", data.destinationBuildingId);
  if (destination.id === source.buildingId) throw new ValidationError("La destination est le bâtiment de départ : un changement de phase sur place n'est pas un transfert.");
  if (data.objectType === "EGG_LOT") {
    if (destination.zoneType !== "COUVOIR" && destination.zoneType !== "STOCKAGE") throw new ValidationError("Des œufs à couver vont vers un couvoir ou un lieu de stockage.");
  } else if (destination.zoneType !== "ELEVAGE") {
    throw new ValidationError("Des animaux vont vers un bâtiment d'élevage.");
  }

  let destinationLotId: string | null = null;
  let destinationLotCode: string | null = null;
  let destinationLineCode: string | null = null;
  let phaseOnArrival = data.phaseOnArrival ?? null;
  if (data.objectType !== "EGG_LOT") {
    if (data.destinationLotId) {
      const target = await repositories.lots.findById(data.destinationLotId);
      if (!target) throw new NotFoundError("Lot de destination", data.destinationLotId);
      if (target.buildingId !== destination.id) throw new ValidationError("Le lot de destination n'est pas dans le bâtiment de destination.");
      if (CLOSED.includes(target.status)) throw new ConflictError("Le lot de destination est terminé.");
      destinationLotId = target.id;
      destinationLineCode = target.productionLine ?? null;
    } else {
      if (!data.destinationLotCode) throw new ValidationError("Indiquez le lot qui recevra les animaux, ou le code du lot à créer à l'arrivée.");
      if (await repositories.lots.findByCode(data.destinationLotCode)) throw new ConflictError(`Le code de lot ${data.destinationLotCode} est déjà utilisé.`);
      const pending = (await repositories.transfers.list()).some((t) => t.status === "EN_TRANSIT" && t.destinationLotCode === data.destinationLotCode);
      if (pending) throw new ConflictError(`Le code de lot ${data.destinationLotCode} est déjà réservé par un transfert en cours.`);
      destinationLotCode = data.destinationLotCode;
      destinationLineCode = source.lot?.productionLine ?? data.destinationLineCode ?? null;
      if (data.objectType === "CHICK_LOT" && !destinationLineCode) throw new ValidationError("Indiquez la ligne des poussins : le couvoir ne peut pas la deviner.");
    }
    const line = await getProductionLine(destinationLineCode);
    if (destinationLineCode && !line) throw new NotFoundError("Ligne de production", destinationLineCode);
    if (line && phaseOnArrival && !allowedPhases(line).includes(phaseOnArrival)) throw new ValidationError(`La ligne ${line.label} ne prévoit pas la phase « ${PHASE_LABEL[phaseOnArrival]} ».`);
    if (line && !destinationLotId && !phaseOnArrival) throw new ValidationError("Indiquez la phase dans laquelle les animaux arrivent.");
    if (!line) phaseOnArrival = null;
  }

  const code = transferCode(data.sentAt);
  const sentAt = data.sentAt;
  const transfer = await repositories.transfers.create({
    code,
    objectType: data.objectType,
    objectId: data.objectId,
    sourceBuildingId: source.buildingId,
    destinationBuildingId: destination.id,
    destinationLotId,
    destinationLotCode,
    destinationLineCode,
    phaseOnArrival,
    quantitySent: data.quantity,
    sentAt,
    sentBy: session.userId,
    senderName,
    senderSignature: signature({ transfer: code, leg: "DEPART", quantity: data.quantity, sentAt, userId: session.userId, signerName: senderName }),
    documentRef: data.documentRef || null,
    transporter: data.transporter || null,
    vehicle: data.vehicle || null,
    crates: data.crates ?? null,
    notes: data.notes || null,
    quantityReceived: null,
    deadOnArrival: null,
    receivedAt: null,
    receivedBy: null,
    receiverName: null,
    receiverSignature: null,
    discrepancy: null,
    discrepancyReason: null,
    status: "EN_TRANSIT",
    statusReason: null,
  });
  const bvuId = await assignBvuId("TRANSFER", transfer.id);

  if (source.lot) {
    const lot = source.lot;
    await recordLotEventWithPopulationUpdate(
      {
        lotId: lot.id,
        eventType: "TRANSFERT",
        payload: { quantity: data.quantity, destination: destination.code, transferCode: code },
        occurredAt: sentAt,
        actorId: session.userId,
        dataStatus: lot.dataStatus,
        sourceType: "MANUEL",
        sourceId: transfer.id,
        deviceId: null,
        measurementMethod: null,
        validationStatus: null,
      },
      { lotId: lot.id, currentPopulation: lot.currentPopulation - data.quantity }
    );
    if (data.quantity === lot.currentPopulation && validateTransition(lot.status, "EN_TRANSFERT").ok) {
      await repositories.lots.updateStatus(lot.id, "EN_TRANSFERT");
    }
  }

  await appendLedgerEvent({
    eventType: "TRANSFER_DISPATCHED",
    objectType: "TRANSFER",
    objectId: transfer.id,
    actorKind: "USER",
    actorId: session.userId,
    source: "application",
    occurredAt: sentAt,
    payload: { code, bvuId, objectType: data.objectType, objectId: data.objectId, quantitySent: data.quantity, from: source.buildingId, to: destination.id, documentRef: transfer.documentRef, signerName: senderName, signature: transfer.senderSignature },
  });
  await recordAudit({ actorId: session.userId, entityType: "transfer", entityId: transfer.id, field: "status", oldValue: null, newValue: `EN_TRANSIT — ${data.quantity} ${source.label} vers ${destination.code}`, reason: "Départ compté et signé", relatedLotId: source.lot?.id ?? null, relatedEventId: null });
  return transfer;
}

export function dispatchTransfer(input: unknown, session: Session): Promise<Transfer> {
  const data = parseInput(dispatchTransferSchema, input);
  const key = data.objectType === "LOT" ? lotFlowLock(data.objectId) : HATCHERY_STOCK_LOCK;
  return withLock(key, () => dispatchUnlocked(data, session));
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

export const receiveTransferSchema = z.object({
  transferId: z.string().min(1),
  quantityReceived: z.number().int().nonnegative("Le nombre reçu vivant ne peut pas être négatif."),
  deadOnArrival: z.number().int().nonnegative("Le nombre de morts à l'arrivée ne peut pas être négatif."),
  receivedAt: businessDate("Arrivée"),
  discrepancyReason: optionalText(500),
  signerName: z.string().trim().min(2, "Signez en tapant votre nom complet."),
});

async function receiveUnlocked(data: z.infer<typeof receiveTransferSchema>, session: Session): Promise<Transfer> {
  const transfer = await repositories.transfers.findById(data.transferId);
  if (!transfer) throw new NotFoundError("Transfert", data.transferId);
  if (transfer.status !== "EN_TRANSIT") throw new ConflictError(`Ce transfert n'est plus à réceptionner : ${TRANSFER_STATUS_LABEL[transfer.status].toLowerCase()}.`);
  const needed = transfer.objectType === "EGG_LOT" ? can(session, "CREATE", "HATCHERY") : can(session, "EDIT", "LOTS");
  if (!needed) throw new AuthorizationError("Vous n'avez pas les droits pour réceptionner ce transfert.");
  assertInScope(session, await resolveBuildingHierarchy(transfer.destinationBuildingId));
  if (session.userId === transfer.sentBy) {
    throw new ValidationError("La réception est comptée et signée par une autre personne que l'expéditeur : c'est ce qui la rend contradictoire.");
  }
  const receiverName = await requireSignature(session, data.signerName);
  const order = orderError("Le départ", transfer.sentAt, "L'arrivée", data.receivedAt);
  if (order) throw new ValidationError(order);
  const outcome = receptionOutcome(transfer.quantitySent, data.quantityReceived, data.deadOnArrival);
  if (outcome.discrepancy !== 0 && (data.discrepancyReason ?? "").length < 10) {
    throw new ValidationError(
      `Les comptages ne concordent pas : ${transfer.quantitySent} expédiés, ${data.quantityReceived + data.deadOnArrival} comptés à l'arrivée (écart ${outcome.discrepancy > 0 ? "+" : ""}${outcome.discrepancy}). Expliquez l'écart (10 caractères au moins).`
    );
  }
  if (transfer.objectType !== "EGG_LOT" && data.quantityReceived === 0 && !transfer.destinationLotId) {
    throw new ValidationError("Aucun animal reçu vivant : aucun lot ne peut être créé. Enregistrez le litige avec l'expéditeur.");
  }

  const receiverSignature = signature({ transfer: transfer.code, leg: "ARRIVEE", quantityReceived: data.quantityReceived, deadOnArrival: data.deadOnArrival, receivedAt: data.receivedAt, userId: session.userId, signerName: receiverName });
  const updated = await repositories.transfers.updateIfStatus(transfer.id, "EN_TRANSIT", {
    quantityReceived: data.quantityReceived,
    deadOnArrival: data.deadOnArrival,
    receivedAt: data.receivedAt,
    receivedBy: session.userId,
    receiverName,
    receiverSignature,
    discrepancy: outcome.discrepancy,
    discrepancyReason: outcome.discrepancy !== 0 ? data.discrepancyReason ?? null : null,
    status: outcome.status,
  });
  if (!updated) throw new ConflictError("Ce transfert vient d'être réceptionné ou annulé par quelqu'un d'autre.");

  let destinationLotId = updated.destinationLotId;
  if (transfer.objectType === "EGG_LOT") {
    await repositories.eggLots.updateStorage(transfer.objectId, transfer.destinationBuildingId);
  } else {
    destinationLotId = await placeIntoDestinationLot(updated, data.quantityReceived, session);
    if (transfer.objectType === "LOT") await closeEmptiedSource(transfer.objectId, data.receivedAt, session);
  }

  await appendLedgerEvent({
    eventType: "TRANSFER_RECEIVED",
    objectType: "TRANSFER",
    objectId: transfer.id,
    actorKind: "USER",
    actorId: session.userId,
    source: "application",
    occurredAt: data.receivedAt,
    payload: {
      code: transfer.code,
      quantitySent: transfer.quantitySent,
      quantityReceived: data.quantityReceived,
      deadOnArrival: data.deadOnArrival,
      discrepancy: outcome.discrepancy,
      discrepancyReason: updated.discrepancyReason,
      destinationLotId,
      senderSignature: transfer.senderSignature,
      signerName: receiverName,
      signature: receiverSignature,
    },
  });
  await recordAudit({
    actorId: session.userId,
    entityType: "transfer",
    entityId: transfer.id,
    field: "status",
    oldValue: "EN_TRANSIT",
    newValue: `${outcome.status} — ${data.quantityReceived} vivants, ${data.deadOnArrival} morts à l'arrivée, écart ${outcome.discrepancy}`,
    reason: updated.discrepancyReason ?? "Arrivée comptée et signée",
    relatedLotId: destinationLotId,
    relatedEventId: null,
  });
  return (await repositories.transfers.findById(transfer.id)) ?? updated;
}

/** The lot the birds join: the one named at departure, or a new lot created now with the received count. */
async function placeIntoDestinationLot(transfer: Transfer, received: number, session: Session): Promise<string> {
  const line = await getProductionLine(transfer.destinationLineCode);
  const sourceLot = transfer.objectType === "LOT" ? await repositories.lots.findById(transfer.objectId) : null;
  let hatchedAt = sourceLot?.hatchedAt ?? null;
  let breed = sourceLot?.breed ?? "—";
  let dataStatus = sourceLot?.dataStatus ?? "REEL";
  if (transfer.objectType === "CHICK_LOT") {
    const chicks = await repositories.chickLots.findById(transfer.objectId);
    const cycle = chicks ? await repositories.hatchCycles.findById(chicks.hatchCycleId) : null;
    hatchedAt = cycle?.hatchedAt ?? chicks?.dispatchedAt ?? null;
    dataStatus = chicks?.dataStatus ?? dataStatus;
    const strains = new Set<string>();
    for (const edge of cycle ? (await repositories.relations.listFrom("HATCH_CYCLE", cycle.id)).filter((e) => e.toType === "EGG_LOT") : []) {
      const egg = await repositories.eggLots.findById(edge.toId);
      const flock = egg ? await repositories.parentFlocks.findById(egg.parentFlockId) : null;
      if (flock) strains.add(flock.strain);
    }
    if (strains.size) breed = [...strains].join(" + ");
  }

  return withLock(lotFlowLock(transfer.destinationLotId ?? `new:${transfer.destinationLotCode}`), async () => {
    let lot: Lot;
    if (transfer.destinationLotId) {
      const existing = await repositories.lots.findById(transfer.destinationLotId);
      if (!existing) throw new NotFoundError("Lot de destination", transfer.destinationLotId);
      const firstPlacement = (await repositories.transfers.listByDestinationLot(existing.id)).filter((t) => t.id !== transfer.id && t.status !== "EN_TRANSIT" && t.status !== "ANNULE").length === 0;
      const replacePlanned = firstPlacement && (existing.status === "PLANIFIE" || existing.status === "CREE");
      const initial = replacePlanned ? received : existing.initialPopulation + received;
      const current = replacePlanned ? received : existing.currentPopulation + received;
      await repositories.lots.updateFlow(existing.id, { initialPopulation: initial, currentPopulation: current, hatchedAt: existing.hatchedAt ?? hatchedAt });
      if (existing.status === "PLANIFIE" || existing.status === "CREE") await repositories.lots.updateStatus(existing.id, "ACTIF", { startedAt: transfer.receivedAt! });
      lot = (await repositories.lots.findById(existing.id))!;
    } else {
      lot = await repositories.lots.create({
        buildingId: transfer.destinationBuildingId,
        code: transfer.destinationLotCode!,
        species: sourceLot?.species ?? "Poulet",
        breed,
        status: "ACTIF",
        initialPopulation: received,
        currentPopulation: received,
        plannedStartAt: null,
        startedAt: transfer.receivedAt,
        endedAt: null,
        dataStatus,
        productionLine: line?.code ?? null,
        purpose: line?.purpose ?? sourceLot?.purpose ?? null,
        hatchedAt,
      });
      await repositories.lotEvents.create({ lotId: lot.id, eventType: "CREATION_LOT", payload: { initialPopulation: received }, occurredAt: transfer.receivedAt!, actorId: session.userId, dataStatus, sourceType: "MANUEL", sourceId: transfer.id, deviceId: null, measurementMethod: null, validationStatus: null });
      await assignBvuId("LOT", lot.id);
    }
    await repositories.lotEvents.create({
      lotId: lot.id,
      eventType: "RECEPTION",
      payload: { transferCode: transfer.code, sent: transfer.quantitySent, received, deadOnArrival: transfer.deadOnArrival, discrepancy: transfer.discrepancy },
      occurredAt: transfer.receivedAt!,
      actorId: session.userId,
      dataStatus,
      sourceType: "MANUEL",
      sourceId: transfer.id,
      deviceId: null,
      measurementMethod: null,
      validationStatus: null,
    });
    await repositories.transfers.updateIfStatus(transfer.id, transfer.status, { destinationLotId: lot.id });
    await createRelation({
      fromType: "LOT",
      fromId: lot.id,
      relationType: "PROVIENT_DE",
      toType: transfer.objectType,
      toId: transfer.objectId,
      metadata: { quantity: received, transferId: transfer.id, transferCode: transfer.code },
      actorId: session.userId,
    });
    if (transfer.phaseOnArrival && (await repositories.lotPhases.current(lot.id))?.phase !== transfer.phaseOnArrival) {
      await startLotPhaseUnlocked({ lotId: lot.id, phase: transfer.phaseOnArrival, startedAt: transfer.receivedAt!, buildingId: null, notes: `Arrivée par ${transfer.code}` }, session, true);
    }
    await moveLotOccupancy(lot.id, transfer.destinationBuildingId, transfer.receivedAt!, session.userId, lot.currentPopulation);
    return lot.id;
  });
}

/** A lot all of whose birds left by transfer ends when the last of them is received. */
async function closeEmptiedSource(lotId: string, at: string, session: Session): Promise<void> {
  const lot = await repositories.lots.findById(lotId);
  if (!lot || lot.currentPopulation > 0 || lot.status !== "EN_TRANSFERT") return;
  const pending = (await repositories.transfers.listByObject("LOT", lot.id)).some((t) => t.status === "EN_TRANSIT");
  if (pending) return;
  await repositories.lots.updateStatus(lot.id, "CLOTURE", { endedAt: at });
  const open = await repositories.lotPhases.current(lot.id);
  if (open) await repositories.lotPhases.close(open.id, at);
  for (const occupation of await repositories.zoneOccupations.listByLot(lot.id)) {
    if (occupation.endedAt === null && occupation.startedAt < at) await repositories.zoneOccupations.close(occupation.id, at);
  }
  await recordAudit({ actorId: session.userId, entityType: "lot", entityId: lot.id, field: "status", oldValue: "EN_TRANSFERT", newValue: "CLOTURE", reason: "Tous les animaux du lot ont été transférés et réceptionnés", relatedLotId: lot.id, relatedEventId: null });
}

export function receiveTransfer(input: unknown, session: Session): Promise<Transfer> {
  const data = parseInput(receiveTransferSchema, input);
  return withLock(`transfer:${data.transferId}`, () => receiveUnlocked(data, session));
}

// ---------------------------------------------------------------------------
// Cancel before arrival, dispute after
// ---------------------------------------------------------------------------

const reasonSchema = z.object({ transferId: z.string().min(1), reason: z.string().trim().min(10, "Justifiez (10 caractères au moins).").max(500) });

export function cancelTransfer(input: unknown, session: Session): Promise<Transfer> {
  const data = parseInput(reasonSchema, input);
  return withLock(`transfer:${data.transferId}`, async () => {
    const transfer = await repositories.transfers.findById(data.transferId);
    if (!transfer) throw new NotFoundError("Transfert", data.transferId);
    if (transfer.status !== "EN_TRANSIT") throw new ConflictError("Seul un transfert encore en transit peut être annulé.");
    if (!can(session, transfer.objectType === "LOT" ? "EDIT" : "CREATE", transfer.objectType === "LOT" ? "LOTS" : "HATCHERY")) throw new AuthorizationError();
    assertInScope(session, await resolveBuildingHierarchy(transfer.sourceBuildingId));
    const cancelled = await repositories.transfers.updateIfStatus(transfer.id, "EN_TRANSIT", { status: "ANNULE", statusReason: data.reason });
    if (!cancelled) throw new ConflictError("Ce transfert vient d'être réceptionné.");
    if (transfer.objectType === "LOT") {
      await withLock(lotFlowLock(transfer.objectId), async () => {
        const lot = await repositories.lots.findById(transfer.objectId);
        if (!lot) return;
        await recordLotEventWithPopulationUpdate(
          { lotId: lot.id, eventType: "AUTRE", payload: { description: `Annulation du transfert ${transfer.code} : ${transfer.quantitySent} animaux réintégrés. ${data.reason}` }, occurredAt: new Date().toISOString(), actorId: session.userId, dataStatus: lot.dataStatus, sourceType: "MANUEL", sourceId: transfer.id, deviceId: null, measurementMethod: null, validationStatus: null },
          { lotId: lot.id, currentPopulation: lot.currentPopulation + transfer.quantitySent }
        );
        if (lot.status === "EN_TRANSFERT") await repositories.lots.updateStatus(lot.id, "ACTIF");
      });
    }
    await appendLedgerEvent({ eventType: "TRANSFER_CANCELLED", objectType: "TRANSFER", objectId: transfer.id, actorKind: "USER", actorId: session.userId, source: "application", occurredAt: new Date().toISOString(), payload: { code: transfer.code, reason: data.reason } });
    await recordAudit({ actorId: session.userId, entityType: "transfer", entityId: transfer.id, field: "status", oldValue: "EN_TRANSIT", newValue: "ANNULE", reason: data.reason, relatedLotId: transfer.objectType === "LOT" ? transfer.objectId : null, relatedEventId: null });
    return cancelled;
  });
}

/** Either side can contest a received transfer. The counts stay as signed; the dispute is added on top. */
export function disputeTransfer(input: unknown, session: Session): Promise<Transfer> {
  const data = parseInput(reasonSchema, input);
  return withLock(`transfer:${data.transferId}`, async () => {
    const transfer = await repositories.transfers.findById(data.transferId);
    if (!transfer) throw new NotFoundError("Transfert", data.transferId);
    if (transfer.status !== "RECU_CONFORME" && transfer.status !== "RECU_AVEC_ECART") throw new ConflictError("Seul un transfert réceptionné peut être contesté.");
    if (!can(session, "EDIT", "LOTS") && !can(session, "CREATE", "HATCHERY")) throw new AuthorizationError();
    const index = await buildHierarchyIndex();
    const side = (id: string) => isGlobalScope(session) || isWithinScope(session, index.building.get(id) ?? {});
    if (!side(transfer.sourceBuildingId) && !side(transfer.destinationBuildingId)) throw new AuthorizationError("Seuls l'expéditeur et le destinataire peuvent contester ce transfert.");
    const disputed = await repositories.transfers.updateIfStatus(transfer.id, transfer.status, { status: "LITIGE", statusReason: data.reason });
    if (!disputed) throw new ConflictError("Ce transfert vient de changer d'état.");
    await appendLedgerEvent({ eventType: "TRANSFER_DISPUTED", objectType: "TRANSFER", objectId: transfer.id, actorKind: "USER", actorId: session.userId, source: "application", occurredAt: new Date().toISOString(), payload: { code: transfer.code, previousStatus: transfer.status, reason: data.reason } });
    await recordAudit({ actorId: session.userId, entityType: "transfer", entityId: transfer.id, field: "status", oldValue: transfer.status, newValue: "LITIGE", reason: data.reason, relatedLotId: transfer.destinationLotId, relatedEventId: null });
    return disputed;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TransferRow extends Transfer {
  objectLabel: string;
  sourceLabel: string;
  destinationLabel: string;
  destinationLotLabel: string | null;
  /** Which side the viewer is on: what they may do with it. */
  canReceive: boolean;
  canCancel: boolean;
}

export async function listTransfers(session: Session): Promise<TransferRow[]> {
  if (!can(session, "VIEW", "LOTS") && !can(session, "VIEW", "HATCHERY")) throw new AuthorizationError();
  const [transfers, index, buildings, farms, lots, chickLots, eggLots] = await Promise.all([
    repositories.transfers.list(),
    buildHierarchyIndex(),
    repositories.buildings.list(),
    repositories.farms.list(),
    repositories.lots.list(),
    repositories.chickLots.list(),
    repositories.eggLots.list(),
  ]);
  const inScope = (buildingId: string) => isGlobalScope(session) || isWithinScope(session, index.building.get(buildingId) ?? {});
  const farmName = new Map(farms.map((f) => [f.id, f.name]));
  const buildingLabel = new Map(buildings.map((b) => [b.id, `${farmName.get(b.farmId) ?? "—"} — ${b.code}`]));
  const lotCode = new Map(lots.map((l) => [l.id, l.code]));
  const objectCode = (t: Transfer) =>
    t.objectType === "LOT" ? lotCode.get(t.objectId) : t.objectType === "CHICK_LOT" ? chickLots.find((c) => c.id === t.objectId)?.code : eggLots.find((e) => e.id === t.objectId)?.code;
  const receiveRight = (t: Transfer) => (t.objectType === "EGG_LOT" ? can(session, "CREATE", "HATCHERY") : can(session, "EDIT", "LOTS"));
  return transfers
    .filter((t) => inScope(t.sourceBuildingId) || inScope(t.destinationBuildingId))
    .map((t) => ({
      ...t,
      objectLabel: `${objectCode(t) ?? "—"}`,
      sourceLabel: buildingLabel.get(t.sourceBuildingId) ?? "—",
      destinationLabel: buildingLabel.get(t.destinationBuildingId) ?? "—",
      destinationLotLabel: t.destinationLotId ? lotCode.get(t.destinationLotId) ?? null : t.destinationLotCode,
      canReceive: t.status === "EN_TRANSIT" && inScope(t.destinationBuildingId) && receiveRight(t) && t.sentBy !== session.userId,
      canCancel: t.status === "EN_TRANSIT" && inScope(t.sourceBuildingId) && receiveRight(t),
    }));
}

export async function getTransfer(transferId: string, session: Session): Promise<TransferRow> {
  const row = (await listTransfers(session)).find((t) => t.id === transferId);
  if (!row) throw new NotFoundError("Transfert", transferId);
  return row;
}
