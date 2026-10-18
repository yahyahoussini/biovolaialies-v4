import { z } from "zod";
import { repositories } from "../../data/repositories";
import type { ApiPrincipal } from "../../domain/api/types";
import { DATA_STATUS, MEASUREMENT_SOURCE_TYPE } from "../../domain/shared/enums";
import { NotFoundError, ValidationError } from "../../domain/shared/errors";
import { ENTITY_TYPE, isEntityType, type EntityType } from "../../domain/traceability/entity-types";
import type { Session } from "../auth/session";
import { createChickLot, createEggLot } from "../hatchery/hatchery";
import { recordMeasurement } from "../iot/measurements";
import { appendLedgerEvent } from "../ledger/ledger";
import { createLot } from "../production/lot";
import { activeHoldsOn, openHold } from "../quality/holds";
import { buildRecallReportForCase } from "../quality/recall";
import { resolveNode } from "../traceability/entity-resolver";
import { collectAncestors, collectDescendants } from "../traceability/genealogy";
import { findEntityIdByCode } from "../traceability/lookup";
import { ApiError } from "./http";

/** Finds an object by id across every entity type, or by code when `type` is given. */
export async function locateObject(idOrCode: string, type?: string | null): Promise<{ type: EntityType; id: string }> {
  if (type) {
    if (!isEntityType(type)) throw new ApiError(400, "INVALID_TYPE", `Type inconnu : ${type}.`);
    if (await resolveNode(type, idOrCode)) return { type, id: idOrCode };
    const id = await findEntityIdByCode(type, idOrCode);
    if (id) return { type, id };
    throw new NotFoundError(type, idOrCode);
  }
  for (const t of ENTITY_TYPE) {
    if (await resolveNode(t, idOrCode)) return { type: t, id: idOrCode };
  }
  throw new NotFoundError("Objet", idOrCode);
}

// API-01 -----------------------------------------------------------------------------------
export const createLotBodySchema = z.discriminatedUnion("lotType", [
  z.object({ lotType: z.literal("EGG_LOT"), code: z.string(), parentFlockCode: z.string(), collectedAt: z.string(), quantity: z.number(), storageBuildingId: z.string().optional().nullable(), dataStatus: z.enum(DATA_STATUS).default("A_CONFIRMER") }),
  z.object({ lotType: z.literal("CHICK_LOT"), code: z.string(), hatchCycleCode: z.string(), quantity: z.number(), grade: z.enum(["A", "B"]).default("A"), dispatchedAt: z.string(), dataStatus: z.enum(DATA_STATUS).default("A_CONFIRMER") }),
  z.object({ lotType: z.literal("LOT"), code: z.string(), buildingId: z.string(), species: z.string(), breed: z.string(), initialPopulation: z.number(), plannedStartAt: z.string().optional().nullable(), dataStatus: z.enum(DATA_STATUS).default("A_CONFIRMER") }),
]);

export async function apiCreateLot(body: z.infer<typeof createLotBodySchema>, session: Session) {
  switch (body.lotType) {
    case "EGG_LOT": {
      const flock = await repositories.parentFlocks.findByCode(body.parentFlockCode);
      if (!flock) throw new ValidationError(`Troupeau « ${body.parentFlockCode} » introuvable.`);
      const egg = await createEggLot({ ...body, parentFlockId: flock.id, sourceType: "CAPTEUR" }, session);
      return { lotType: body.lotType, lotId: egg.id, code: egg.code };
    }
    case "CHICK_LOT": {
      const cycle = await repositories.hatchCycles.findByCode(body.hatchCycleCode);
      if (!cycle) throw new ValidationError(`Cycle « ${body.hatchCycleCode} » introuvable.`);
      const chicks = await createChickLot({ ...body, hatchCycleId: cycle.id, sourceType: "CAPTEUR" }, session);
      return { lotType: body.lotType, lotId: chicks.id, code: chicks.code };
    }
    case "LOT": {
      const lot = await createLot({ ...body, plannedStartAt: body.plannedStartAt ?? null }, session);
      return { lotType: body.lotType, lotId: lot.id, code: lot.code };
    }
  }
}

// API-02 / API-04 ---------------------------------------------------------------------------
export async function apiGetObject(idOrCode: string, type: string | null) {
  const target = await locateObject(idOrCode, type);
  const node = (await resolveNode(target.type, target.id))!;
  const [holds, up, down] = await Promise.all([activeHoldsOn(target.type, target.id), collectAncestors(target.type, target.id), collectDescendants(target.type, target.id)]);
  const caseCodes = [];
  for (const caseId of new Set(holds.map((h) => h.caseId))) caseCodes.push((await repositories.qualityCases.findById(caseId))?.code ?? caseId);
  return {
    type: node.type,
    id: node.id,
    code: node.code,
    label: node.label,
    dataStatus: node.dataStatus,
    occurredAt: node.occurredAt || null,
    qualityStatus: { onHold: holds.length > 0, cases: caseCodes },
    lineageSummary: { ancestors: up.nodes.length - 1, descendants: down.nodes.length - 1, destinations: down.destinations.length },
  };
}

export async function apiGetLineage(idOrCode: string, type: string | null, direction: "up" | "down" | "both") {
  const target = await locateObject(idOrCode, type);
  const describe = async (nodes: { type: EntityType; id: string; depth: number }[]) =>
    (await Promise.all(nodes.filter((n) => n.depth > 0).map(async (n) => {
      const node = await resolveNode(n.type, n.id);
      return node ? { type: n.type, id: n.id, code: node.code, depth: n.depth, occurredAt: node.occurredAt || null, dataStatus: node.dataStatus } : null;
    }))).filter(Boolean);
  const up = direction === "down" ? null : await collectAncestors(target.type, target.id);
  const down = direction === "up" ? null : await collectDescendants(target.type, target.id);
  return {
    root: target,
    ancestors: up ? await describe(up.nodes) : [],
    descendants: down ? await describe(down.nodes) : [],
    destinations: down ? await describe(down.destinations) : [],
    // Explicit omissions (API-04): the caller is told when the walk was capped.
    truncated: Boolean(up?.truncated || down?.truncated),
    computedAt: new Date().toISOString(),
  };
}

// API-03 / API-08 ---------------------------------------------------------------------------
export const eventBodySchema = z.object({
  eventType: z.string().trim().min(2).max(80).regex(/^[A-Z0-9_:.-]+$/, "eventType en MAJUSCULES_SOULIGNÉES."),
  objectType: z.string(),
  objectId: z.string().optional(),
  objectCode: z.string().optional(),
  occurredAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "occurredAt doit être une date ISO 8601."),
  payload: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  schemaVersion: z.number().int().positive().default(1),
  correctsEventId: z.string().optional(),
});
export type EventBody = z.infer<typeof eventBodySchema>;

export async function apiAppendEvent(body: EventBody, principal: ApiPrincipal, sourceSystem = "api") {
  if (!isEntityType(body.objectType)) throw new ValidationError(`objectType inconnu : ${body.objectType}.`);
  if (!body.objectId && !body.objectCode) throw new ValidationError("objectId ou objectCode est requis.");
  const target = await locateObject(body.objectId ?? body.objectCode!, body.objectType);
  if (body.correctsEventId && !(await repositories.ledger.findById(body.correctsEventId))) {
    throw new ValidationError("correctsEventId ne désigne aucun événement existant.");
  }
  if (Date.parse(body.occurredAt) > Date.now() + 5 * 60_000) {
    throw new ValidationError("occurredAt est dans le futur (dérive d'horloge du terminal ?).");
  }
  const result = await appendLedgerEvent({
    eventType: body.eventType,
    objectType: target.type,
    objectId: target.id,
    actorKind: "API_CLIENT",
    actorId: principal.clientId,
    source: `${sourceSystem}:${principal.name}`,
    occurredAt: new Date(body.occurredAt).toISOString(),
    payload: body.payload,
    schemaVersion: body.schemaVersion,
    idempotencyKey: body.idempotencyKey ? `${principal.clientId}:${body.idempotencyKey}` : null,
    correctsEventId: body.correctsEventId ?? null,
  });
  return { eventId: result.event.id, seq: result.event.seq, hash: result.event.hash, duplicate: result.duplicate };
}

export const ingestBodySchema = z.object({
  sourceSystem: z.string().trim().min(2).max(80),
  schemaVersion: z.number().int().positive(),
  batchId: z.string().trim().min(1).max(200),
  records: z.array(z.unknown()).min(1).max(500),
});

/** Batch ingest (API-08): each record succeeds or fails on its own; nothing is half-written. */
export async function apiIngest(body: z.infer<typeof ingestBodySchema>, principal: ApiPrincipal) {
  const results: { index: number; status: "accepted" | "duplicate" | "rejected"; eventId?: string; error?: string }[] = [];
  for (const [index, raw] of body.records.entries()) {
    const parsed = eventBodySchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ index, status: "rejected", error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    try {
      const r = await apiAppendEvent({ ...parsed.data, schemaVersion: parsed.data.schemaVersion ?? body.schemaVersion }, principal, body.sourceSystem);
      results.push({ index, status: r.duplicate ? "duplicate" : "accepted", eventId: r.eventId });
    } catch (error) {
      results.push({ index, status: "rejected", error: error instanceof Error ? error.message : "Erreur" });
    }
  }
  return {
    batchId: body.batchId,
    accepted: results.filter((r) => r.status === "accepted").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    results,
  };
}

// API-05 -------------------------------------------------------------------------------------
export const holdBodySchema = z.object({
  objectType: z.string(),
  objectId: z.string().optional(),
  objectCode: z.string().optional(),
  reason: z.string(),
  description: z.string(),
  scope: z.enum(["OBJET_SEUL", "DESCENDANTS"]).default("DESCENDANTS"),
  evidenceRefs: z.array(z.string()).default([]),
});

export async function apiOpenHold(body: z.infer<typeof holdBodySchema>, session: Session, principal: ApiPrincipal) {
  if (!body.objectId && !body.objectCode) throw new ValidationError("objectId ou objectCode est requis.");
  const target = await locateObject(body.objectId ?? body.objectCode!, body.objectType);
  const created = await openHold(
    { rootType: target.type, rootId: target.id, reason: body.reason, description: `${body.description} [via API : ${principal.name}]`, scope: body.scope, evidence: body.evidenceRefs.join("; ") },
    session
  );
  const items = await repositories.qualityCases.listItems(created.id);
  return { caseId: created.id, code: created.code, holdStatus: created.status, affectedObjects: items.length };
}

// API-07 -------------------------------------------------------------------------------------
export const measurementBodySchema = z.object({
  sensorId: z.string(),
  value: z.number(),
  capturedAt: z.string(),
  lotId: z.string().optional().nullable(),
  dataStatus: z.enum(DATA_STATUS).default("A_CONFIRMER"),
  sourceType: z.enum(MEASUREMENT_SOURCE_TYPE).default("CAPTEUR"),
  measurementMethod: z.string().optional().nullable(),
});

export async function apiRecordMeasurement(body: z.infer<typeof measurementBodySchema>, session: Session) {
  const { record, quality } = await recordMeasurement(body, session);
  return { measurementId: record.id, accepted: true, quality };
}

// API-10 -------------------------------------------------------------------------------------
export async function apiRecallExport(caseId: string, session: Session) {
  const qualityCase = await repositories.qualityCases.findById(caseId);
  if (!qualityCase) throw new NotFoundError("Dossier qualité", caseId);
  return { caseCode: qualityCase.code, status: qualityCase.status, report: await buildRecallReportForCase(caseId, session) };
}
