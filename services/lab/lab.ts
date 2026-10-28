import { parseInput } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import {
  createSampleSchema,
  isAdverse,
  markSentSchema,
  needsDecision,
  RESULT_INTERPRETATION_LABEL,
  recordResultsSchema,
  reviewResultSchema,
  SAMPLE_MATRIX_LABEL,
  SAMPLE_OBJECT_LABEL,
  SAMPLE_REASON_LABEL,
  type LabResult,
  type LabSample,
  type SampleObjectType,
} from "../../domain/lab/lab";
import { orderError } from "../../domain/shared/dates";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assignBvuId } from "../identity/bvu-ids";
import { buildHierarchyIndex, isWithinScope, type HierarchyIndex } from "../identity/scope-check";

/**
 * Samples and laboratory results (document 3, data sources). A sample belongs to whatever it was
 * taken on, and through it to a site: only the people of that site — and the global roles — see it.
 * Results are kept as the laboratory reported them; a rectified report adds rows, it never edits
 * one. An adverse or open result waits for the veterinarian, who records what follows from it.
 */

/** What a sample was taken on: its code, the building it stands in, and the farm lot it belongs to. */
export interface SampledObject {
  type: SampleObjectType;
  id: string;
  code: string;
  buildingId: string | null;
  lotId: string | null;
  href: string | null;
}

/** Every object a sample can name, loaded once: list pages describe each sample without a query per row. */
async function objectIndex() {
  const [lots, flocks, eggLots, tableEggs, cycles, buildings, farms] = await Promise.all([
    repositories.lots.list(),
    repositories.parentFlocks.list(),
    repositories.eggLots.list(),
    repositories.tableEggLots.list(),
    repositories.hatchCycles.list(),
    repositories.buildings.list(),
    repositories.farms.list(),
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const lot = byId(lots);
  const flock = byId(flocks);
  const egg = byId(eggLots);
  const table = byId(tableEggs);
  const cycle = byId(cycles);
  const building = byId(buildings);
  const farm = byId(farms);
  return (type: SampleObjectType, id: string): SampledObject | null => {
    switch (type) {
      case "LOT": {
        const l = lot.get(id);
        return l ? { type, id, code: l.code, buildingId: l.buildingId, lotId: l.id, href: `/lots/${l.id}` } : null;
      }
      case "PARENT_FLOCK": {
        const f = flock.get(id);
        return f ? { type, id, code: f.code, buildingId: f.buildingId, lotId: f.lotId ?? null, href: `/couvoir/reproducteurs/${f.id}` } : null;
      }
      case "EGG_LOT": {
        const e = egg.get(id);
        return e ? { type, id, code: e.code, buildingId: e.storageBuildingId ?? flock.get(e.parentFlockId)?.buildingId ?? null, lotId: null, href: `/couvoir/reproducteurs/${e.parentFlockId}` } : null;
      }
      case "TABLE_EGG_LOT": {
        const t = table.get(id);
        return t ? { type, id, code: t.code, buildingId: lot.get(t.lotId)?.buildingId ?? null, lotId: t.lotId, href: `/oeufs-consommation/${t.id}` } : null;
      }
      case "HATCH_CYCLE": {
        const c = cycle.get(id);
        return c ? { type, id, code: c.code, buildingId: c.buildingId, lotId: null, href: `/couvoir/cycles/${c.id}` } : null;
      }
      case "BUILDING": {
        const b = building.get(id);
        return b ? { type, id, code: `${farm.get(b.farmId)?.name ?? "—"} — ${b.code}`, buildingId: b.id, lotId: null, href: null } : null;
      }
    }
  };
}

function inScope(session: Session, index: HierarchyIndex, object: SampledObject | null): boolean {
  if (isGlobalScope(session)) return true;
  return !!object?.buildingId && isWithinScope(session, index.building.get(object.buildingId) ?? {});
}

async function sampleInScope(sampleId: string, session: Session): Promise<{ sample: LabSample; object: SampledObject | null }> {
  const sample = await repositories.lab.findSample(sampleId);
  if (!sample) throw new NotFoundError("Prélèvement", sampleId);
  const [describe, index] = await Promise.all([objectIndex(), buildHierarchyIndex()]);
  const object = describe(sample.objectType, sample.objectId);
  if (!inScope(session, index, object)) throw new AuthorizationError("Cette ressource n'appartient pas à votre périmètre.");
  return { sample, object };
}

function isUniqueViolation(error: unknown): boolean {
  const text = `${(error as { message?: string })?.message ?? ""} ${String((error as { cause?: unknown })?.cause ?? "")}`;
  return /UNIQUE constraint failed/i.test(text);
}

export async function createSample(input: unknown, session: Session): Promise<LabSample> {
  if (!can(session, "CREATE", "LAB")) throw new AuthorizationError("Vous n'avez pas les droits pour enregistrer un prélèvement.");
  const data = parseInput(createSampleSchema, input);
  const [describe, index] = await Promise.all([objectIndex(), buildHierarchyIndex()]);
  const object = describe(data.objectType, data.objectId);
  if (!object) throw new NotFoundError(SAMPLE_OBJECT_LABEL[data.objectType], data.objectId);
  if (!inScope(session, index, object)) throw new AuthorizationError("Cette ressource n'appartient pas à votre périmètre.");
  if (data.observationId) {
    const observation = await repositories.sanitaryObservations.findById(data.observationId);
    if (!observation) throw new NotFoundError("Observation", data.observationId);
    if (observation.lotId !== object.lotId) throw new ValidationError("Cette observation concerne un autre lot que celui prélevé.");
  }

  const year = new Date(data.sampledAt).getUTCFullYear();
  let sample: LabSample | null = null;
  for (let attempt = 0; attempt < 3 && !sample; attempt++) {
    const code = `LAB-${year}-${String((await repositories.lab.countSamplesInYear(year)) + 1 + attempt).padStart(4, "0")}`;
    try {
      sample = await repositories.lab.createSample({
        code,
        objectType: data.objectType,
        objectId: data.objectId,
        matrix: data.matrix,
        reason: data.reason,
        observationId: data.observationId ?? null,
        sampledAt: data.sampledAt,
        sampledBy: session.userId,
        sampleCount: data.sampleCount ?? null,
        laboratory: data.laboratory,
        sentAt: null,
        status: "PRELEVE",
        notes: data.notes ?? null,
        dataStatus: data.dataStatus,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (!sample) throw new ConflictError("Numérotation concurrente des prélèvements : réessayez.");
  await assignBvuId("SAMPLE", sample.id);
  await recordAudit({
    actorId: session.userId,
    entityType: "lab_sample",
    entityId: sample.id,
    field: null,
    oldValue: null,
    newValue: `${sample.code} — ${SAMPLE_MATRIX_LABEL[sample.matrix]} sur ${object.code} (${SAMPLE_REASON_LABEL[sample.reason].toLowerCase()}), pour ${sample.laboratory}`,
    reason: "Prélèvement pour le laboratoire",
    relatedLotId: object.lotId,
    relatedEventId: null,
  });
  return sample;
}

export async function markSampleSent(input: unknown, session: Session): Promise<LabSample> {
  if (!can(session, "CREATE", "LAB")) throw new AuthorizationError();
  const data = parseInput(markSentSchema, input);
  const { sample, object } = await sampleInScope(data.sampleId, session);
  if (sample.status !== "PRELEVE") throw new ConflictError("Ce prélèvement est déjà parti au laboratoire.");
  const order = orderError("Le prélèvement", sample.sampledAt, "L'envoi", data.sentAt);
  if (order) throw new ValidationError(order);
  const sent = await repositories.lab.setSampleStatus(sample.id, "PRELEVE", { status: "ENVOYE", sentAt: data.sentAt });
  if (!sent) throw new ConflictError("Ce prélèvement vient de changer d'état.");
  await recordAudit({ actorId: session.userId, entityType: "lab_sample", entityId: sample.id, field: "status", oldValue: "PRELEVE", newValue: "ENVOYE", reason: `Envoyé à ${sample.laboratory}`, relatedLotId: object?.lotId ?? null, relatedEventId: null });
  return sent;
}

/**
 * Records what the laboratory sent back, one row per analysis. A report may come in several
 * parts; `complete` says the last part has arrived. Rows are never edited: a rectified report is
 * recorded as new rows with its own reference.
 */
export async function recordResults(input: unknown, session: Session, now = new Date()): Promise<{ sample: LabSample; results: LabResult[]; toReview: number }> {
  if (!can(session, "EDIT", "LAB")) throw new AuthorizationError("L'enregistrement des résultats revient au vétérinaire ou au responsable qualité.");
  const data = parseInput(recordResultsSchema, input);
  const { sample, object } = await sampleInScope(data.sampleId, session);
  for (const r of data.results) {
    const order = orderError("Le prélèvement", sample.sampledAt, "Le résultat", r.resultAt);
    if (order) throw new ValidationError(order);
  }
  const results: LabResult[] = [];
  for (const r of data.results) {
    results.push(
      await repositories.lab.createResult({
        sampleId: sample.id,
        analyte: r.analyte,
        method: r.method ?? null,
        value: r.value,
        numericValue: r.numericValue ?? null,
        unit: r.unit ?? null,
        interpretation: r.interpretation,
        resultAt: r.resultAt,
        reportRef: r.reportRef ?? null,
        recordedBy: session.userId,
        recordedAt: now.toISOString(),
      })
    );
  }
  const target = data.complete ? "RESULTAT" : "RESULTAT_PARTIEL";
  let updated = sample;
  if (sample.status !== target && !(sample.status === "RESULTAT" && target === "RESULTAT_PARTIEL")) {
    updated = (await repositories.lab.setSampleStatus(sample.id, sample.status, { status: target })) ?? (await repositories.lab.findSample(sample.id)) ?? sample;
  }
  const adverse = results.filter((r) => isAdverse(r.interpretation));
  await recordAudit({
    actorId: session.userId,
    entityType: "lab_sample",
    entityId: sample.id,
    field: "results",
    oldValue: sample.status,
    newValue: results.map((r) => `${r.analyte} : ${r.value} (${RESULT_INTERPRETATION_LABEL[r.interpretation].toLowerCase()})`).join(" ; "),
    reason: adverse.length ? `Résultat défavorable : ${adverse.map((r) => r.analyte).join(", ")}` : "Résultats du laboratoire",
    relatedLotId: object?.lotId ?? null,
    relatedEventId: null,
  });
  return { sample: updated, results, toReview: results.filter((r) => needsDecision(r.interpretation)).length };
}

/** The veterinarian's reading of a result. An adverse or open one is read with what follows from it. */
export async function reviewResult(input: unknown, session: Session, now = new Date()): Promise<LabResult> {
  if (!can(session, "VALIDATE", "LAB")) throw new AuthorizationError("L'interprétation d'un résultat revient au vétérinaire.");
  const data = parseInput(reviewResultSchema, input);
  const result = await repositories.lab.findResult(data.resultId);
  if (!result) throw new NotFoundError("Résultat", data.resultId);
  const { object } = await sampleInScope(result.sampleId, session);
  const note = data.note?.trim() ?? "";
  if (needsDecision(result.interpretation) && note.length < 10) {
    throw new ValidationError("Dites ce qui découle de ce résultat — traitement, blocage, nouveau prélèvement… (10 caractères au moins).");
  }
  const reviewed = await repositories.lab.reviewResult(result.id, { reviewedBy: session.userId, reviewedAt: now.toISOString(), reviewNote: note || "Pris connaissance." });
  if (!reviewed) throw new ConflictError("Ce résultat a déjà été examiné.");
  await recordAudit({ actorId: session.userId, entityType: "lab_result", entityId: result.id, field: "review", oldValue: null, newValue: `${result.analyte} : ${RESULT_INTERPRETATION_LABEL[result.interpretation].toLowerCase()}`, reason: reviewed.reviewNote, relatedLotId: object?.lotId ?? null, relatedEventId: null });
  return reviewed;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface LabSampleRow extends LabSample {
  object: SampledObject | null;
  results: LabResult[];
  /** Results that call for a decision and have not been read by the veterinarian yet. */
  toReview: number;
  adverse: number;
}

async function rows(samples: LabSample[]): Promise<LabSampleRow[]> {
  const describe = await objectIndex();
  const results = await repositories.lab.listResults(samples.map((s) => s.id));
  return samples.map((s) => {
    const own = results.filter((r) => r.sampleId === s.id);
    return {
      ...s,
      object: describe(s.objectType, s.objectId),
      results: own,
      toReview: own.filter((r) => needsDecision(r.interpretation) && !r.reviewedAt).length,
      adverse: own.filter((r) => isAdverse(r.interpretation)).length,
    };
  });
}

export async function listLabSamples(session: Session): Promise<LabSampleRow[]> {
  if (!can(session, "VIEW", "LAB")) throw new AuthorizationError();
  const [all, index] = await Promise.all([rows(await repositories.lab.listSamples()), buildHierarchyIndex()]);
  return all.filter((s) => inScope(session, index, s.object));
}

/** Samples taken on a farm lot, on its eggs, or on the parent flock it carries — the lot's laboratory record. */
export async function labRecordForLot(lotId: string, session: Session): Promise<LabSampleRow[]> {
  if (!can(session, "VIEW", "LAB")) return [];
  return (await listLabSamples(session)).filter((s) => s.object?.lotId === lotId);
}

export interface LabSampleDetail extends LabSampleRow {
  bvuId: string | null;
  sampledByName: string;
  reviewers: Record<string, string>;
  observation: { signs: string; observedAt: string } | null;
  can: { send: boolean; record: boolean; review: boolean; hold: boolean };
}

export async function getLabSample(sampleId: string, session: Session): Promise<LabSampleDetail> {
  if (!can(session, "VIEW", "LAB")) throw new AuthorizationError();
  const { sample } = await sampleInScope(sampleId, session);
  const [row] = await rows([sample]);
  const users = await repositories.users.list();
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const observation = sample.observationId ? await repositories.sanitaryObservations.findById(sample.observationId) : null;
  return {
    ...row,
    bvuId: (await repositories.bvuIds.findByObject("SAMPLE", sample.id))?.bvuId ?? null,
    sampledByName: nameOf.get(sample.sampledBy) ?? "—",
    reviewers: Object.fromEntries(row.results.flatMap((r) => [r.recordedBy, r.reviewedBy]).filter((id): id is string => !!id).map((id) => [id, nameOf.get(id) ?? "—"])),
    observation: observation ? { signs: observation.notes, observedAt: observation.observedAt } : null,
    can: {
      send: sample.status === "PRELEVE" && can(session, "CREATE", "LAB"),
      record: can(session, "EDIT", "LAB"),
      review: can(session, "VALIDATE", "LAB"),
      hold: row.adverse > 0 && sample.objectType !== "BUILDING" && can(session, "CREATE", "QUALITY"),
    },
  };
}

/** What the veterinarian's and the direction's screens need: what is still at the laboratory, and what awaits a reading. */
export async function labWatch(session: Session): Promise<{ pending: LabSampleRow[]; toReview: LabSampleRow[]; recentAdverse: LabSampleRow[] }> {
  if (!can(session, "VIEW", "LAB")) return { pending: [], toReview: [], recentAdverse: [] };
  const all = await listLabSamples(session);
  return {
    pending: all.filter((s) => s.status === "PRELEVE" || s.status === "ENVOYE" || s.status === "RESULTAT_PARTIEL"),
    toReview: all.filter((s) => s.toReview > 0),
    recentAdverse: all.filter((s) => s.adverse > 0).slice(0, 5),
  };
}

/** What a new sample may be taken on, in the person's scope: live lots, flocks, recent eggs and cycles, buildings. */
export async function sampleTargets(session: Session, now = new Date()): Promise<{ value: string; label: string }[]> {
  if (!can(session, "CREATE", "LAB")) return [];
  const [describe, index, lots, flocks, eggLots, tableEggs, cycles, buildings] = await Promise.all([
    objectIndex(),
    buildHierarchyIndex(),
    repositories.lots.list(),
    repositories.parentFlocks.list(),
    repositories.eggLots.list(),
    repositories.tableEggLots.list(),
    repositories.hatchCycles.list(),
    repositories.buildings.list(),
  ]);
  const recent = (iso: string) => Date.parse(iso) >= now.getTime() - 60 * 86_400_000;
  const candidates: [SampleObjectType, string][] = [
    ...lots.filter((l) => !["PLANIFIE", "ABATTU", "TRANSFORME", "CLOTURE", "ARCHIVE"].includes(l.status)).map((l) => ["LOT", l.id] as [SampleObjectType, string]),
    ...flocks.map((f) => ["PARENT_FLOCK", f.id] as [SampleObjectType, string]),
    ...eggLots.filter((e) => recent(e.collectedAt)).map((e) => ["EGG_LOT", e.id] as [SampleObjectType, string]),
    ...tableEggs.filter((e) => recent(e.collectedOn)).map((e) => ["TABLE_EGG_LOT", e.id] as [SampleObjectType, string]),
    ...cycles.filter((c) => recent(c.setAt)).map((c) => ["HATCH_CYCLE", c.id] as [SampleObjectType, string]),
    ...buildings.map((b) => ["BUILDING", b.id] as [SampleObjectType, string]),
  ];
  return candidates
    .map(([type, id]) => describe(type, id))
    .filter((o): o is SampledObject => !!o && inScope(session, index, o))
    .map((o) => ({ value: `${o.type}:${o.id}`, label: `${SAMPLE_OBJECT_LABEL[o.type]} — ${o.code}` }));
}

/** The laboratory page in one call: samples in scope, what a new one may target, and the counts on top. */
export async function getLaboratoryPage(session: Session, now = new Date()) {
  const [samples, targets] = await Promise.all([listLabSamples(session), sampleTargets(session, now)]);
  return {
    samples,
    targets,
    pending: samples.filter((s) => s.status !== "RESULTAT").length,
    toReview: samples.filter((s) => s.toReview > 0).length,
    last30: samples.filter((s) => Date.parse(s.sampledAt) >= now.getTime() - 30 * 86_400_000).length,
  };
}
