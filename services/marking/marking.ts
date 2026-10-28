import { parseInput, z } from "../../lib/zod";
import { repositories } from "../../data/repositories";
import {
  allocateSchema,
  candlingRejectsSchema,
  closeRunSchema,
  createLineSchema,
  eggsInRange,
  liftStopSchema,
  MAX_SERIAL,
  parseShellCode,
  READ_CLOCK_TOLERANCE_MS,
  readBatchSchema,
  readGuard,
  shellCode,
  SOURCE_OF_ROUTE,
  splitCodes,
  startRunSchema,
  storageDays,
  trayError,
  traySchema,
  updateLineSchema,
  type CodeBlock,
  type EggReadException,
  type EggTray,
  type MarkingLine,
  type MarkingRefusalCode,
  type MarkingRoute,
  type MarkingRun,
  type MarkingRunStatus,
  type MarkingSourceType,
  type ReadBatch,
  type ReadStop,
  type SerialRange,
} from "../../domain/marking/marking";
import { farmDay } from "../../domain/sanitary/health";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { withLock } from "../../lib/keyed-lock";
import { publicEggUrl } from "../../lib/public-url";
import { recordAudit } from "../audit/record";
import type { Session } from "../auth/session";
import { assignBvuId, bvuIdsFor } from "../identity/bvu-ids";
import { assertInScope, buildHierarchyIndex, isWithinScope, resolveBuildingHierarchy } from "../identity/scope-check";
import { activeHoldsOn } from "../quality/holds";

/**
 * The egg-marking line (document 3, lot 15): "pilote la tête d'impression, lit le retour de la
 * caméra de contrôle, et rattache chaque code imprimé à son lot et à son plateau". The line
 * controller next to the machine draws blocks of codes, reports what the camera read back, and
 * declares the trays; a person starts and closes the run, and restarts the line when the read-back
 * guard has stopped it. "Un marquage non relu n'est pas une preuve : c'est une intention."
 */

/** A refusal the line controller acts on: the code says whether to stop, wait for a person, or give up the run. */
export class MarkingRefusal extends ConflictError {
  constructor(
    readonly code: MarkingRefusalCode,
    message: string
  ) {
    super(message);
    this.name = "MarkingRefusal";
  }
}

/** Who is speaking: a person in the application, or a line controller through the API. */
export type MarkingOrigin = { kind: "USER" } | { kind: "API"; clientId: string; name: string };
const USER: MarkingOrigin = { kind: "USER" };
const originRef = (session: Session, origin: MarkingOrigin) => (origin.kind === "API" ? `api:${origin.clientId}` : `user:${session.userId}`);
const viaApi = (origin: MarkingOrigin) => (origin.kind === "API" ? ` [via API : ${origin.name}]` : "");
const pct = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);
const ROUTE_SHORT: Record<MarkingRoute, string> = { A_COUVER: "voie A (œufs à couver)", B_CONSOMMATION: "voie B (œufs de consommation)" };

async function lineInScope(lineId: string, session: Session): Promise<MarkingLine> {
  const line = await repositories.marking.findLine(lineId);
  if (!line) throw new NotFoundError("Ligne de marquage", lineId);
  assertInScope(session, await resolveBuildingHierarchy(line.buildingId));
  return line;
}

async function runInScope(runId: string, session: Session): Promise<{ run: MarkingRun; line: MarkingLine }> {
  const run = await repositories.marking.findRun(runId);
  if (!run) throw new NotFoundError("Campagne de marquage", runId);
  return { run, line: await lineInScope(run.lineId, session) };
}

// ---------------------------------------------------------------------------
// What a run marks
// ---------------------------------------------------------------------------

interface MarkingSource {
  type: MarkingSourceType;
  id: string;
  code: string;
  /** Table eggs only: their status, and the layer lot they come from. */
  status: string | null;
  lotId: string | null;
  /** Hatching eggs only: the parent flock. */
  flockId: string | null;
  collectedAt: string;
  /** Eggs the source declares: saleable eggs of a graded collection, eggs of a hatching-egg lot. */
  expected: number;
  eggType: string | null;
  buildingId: string | null;
}

async function loadSource(type: MarkingSourceType, id: string): Promise<MarkingSource | null> {
  if (type === "TABLE_EGG_LOT") {
    const eggs = await repositories.tableEggLots.findById(id);
    if (!eggs) return null;
    const lot = await repositories.lots.findById(eggs.lotId);
    return { type, id, code: eggs.code, status: eggs.status, lotId: eggs.lotId, flockId: null, collectedAt: eggs.collectedOn, expected: eggs.saleable, eggType: eggs.eggType, buildingId: lot?.buildingId ?? null };
  }
  const egg = await repositories.eggLots.findById(id);
  if (!egg) return null;
  const flock = await repositories.parentFlocks.findById(egg.parentFlockId);
  return { type, id, code: egg.code, status: null, lotId: null, flockId: egg.parentFlockId, collectedAt: egg.collectedAt, expected: egg.quantity, eggType: null, buildingId: egg.storageBuildingId ?? flock?.buildingId ?? null };
}

/**
 * Why a source may not receive codes now, or null. Checked when the run starts and again before
 * every block: a treatment recorded at noon takes the day's eggs off sale, and the line must stop
 * printing proof of origin on eggs that may no longer be sold.
 */
async function sourceBlock(source: MarkingSource): Promise<string | null> {
  if (source.status === "RETIRE") return `Les œufs ${source.code} sont retirés de la vente (délai d'attente d'un traitement) : ils ne se marquent pas pour la consommation.`;
  if (source.status === "DETRUIT") return `Les œufs ${source.code} sont détruits.`;
  if (source.status === "EXPEDIE") return `Les œufs ${source.code} sont déjà expédiés.`;
  const holds = [
    ...(await activeHoldsOn(source.type, source.id)),
    ...(source.lotId ? await activeHoldsOn("LOT", source.lotId) : []),
    ...(source.flockId ? await activeHoldsOn("PARENT_FLOCK", source.flockId) : []),
  ];
  if (holds.length === 0) return null;
  const qualityCase = await repositories.qualityCases.findById(holds[0].caseId);
  return `${source.code} est sous blocage qualité (${qualityCase?.code ?? "dossier ouvert"}) : aucun code ne s'imprime avant sa levée.`;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export async function createMarkingLine(input: unknown, session: Session): Promise<MarkingLine> {
  if (!can(session, "VALIDATE", "MARKING")) throw new AuthorizationError("La configuration des lignes de marquage revient au responsable qualité.");
  const data = parseInput(createLineSchema, input);
  assertInScope(session, await resolveBuildingHierarchy(data.buildingId));
  if (await repositories.marking.findLineByCode(data.code)) throw new ConflictError(`Le code ${data.code} est déjà utilisé.`);
  if (await repositories.marking.findLineByPrefix(data.shellPrefix)) throw new ConflictError(`Le préfixe ${data.shellPrefix} est déjà imprimé par une autre ligne : deux lignes ne partagent jamais un préfixe.`);
  const line = await repositories.marking.createLine({ ...data, protocol: data.protocol ?? null, active: true });
  await recordAudit({
    actorId: session.userId,
    entityType: "egg_marking_line",
    entityId: line.id,
    field: null,
    oldValue: null,
    newValue: `${line.code} — préfixe ${line.shellPrefix}, contrôle de lecture à ${pct(line.readThreshold)} sur ${line.readWindow} œufs`,
    reason: "Mise en service d'une ligne de marquage",
    relatedLotId: null,
    relatedEventId: null,
  });
  return line;
}

export async function updateMarkingLine(input: unknown, session: Session): Promise<MarkingLine> {
  if (!can(session, "VALIDATE", "MARKING")) throw new AuthorizationError("Le seuil de lecture est une décision du responsable qualité.");
  const data = parseInput(updateLineSchema, input);
  const line = await lineInScope(data.lineId, session);
  const updated = await repositories.marking.updateLine(line.id, {
    readThreshold: data.readThreshold,
    readWindow: data.readWindow,
    trayCapacity: data.trayCapacity,
    protocol: data.protocol ?? null,
    active: data.active,
    updatedAt: new Date().toISOString(),
    updatedBy: session.userId,
  });
  const describe = (l: MarkingLine) => `seuil ${pct(l.readThreshold)} sur ${l.readWindow} œufs, plateau de ${l.trayCapacity}${l.active ? "" : ", hors service"}`;
  await recordAudit({ actorId: session.userId, entityType: "egg_marking_line", entityId: line.id, field: "settings", oldValue: describe(line), newValue: describe(updated), reason: data.reason, relatedLotId: null, relatedEventId: null });
  return updated;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function startMarkingRun(input: unknown, session: Session, now = new Date()): Promise<MarkingRun> {
  if (!can(session, "CREATE", "MARKING")) throw new AuthorizationError();
  const data = parseInput(startRunSchema, input);
  return withLock(`marking-line:${data.lineId}`, async () => {
    const line = await lineInScope(data.lineId, session);
    if (!line.active) throw new ValidationError(`La ligne ${line.code} est hors service.`);
    if (!line.routes.includes(data.route)) throw new ValidationError(`La ligne ${line.code} n'est pas réglée pour la ${ROUTE_SHORT[data.route]}.`);
    const open = await repositories.marking.findOpenRun(line.id);
    if (open) throw new ConflictError(`La campagne ${open.code} est encore ouverte sur cette ligne : clôturez-la avant d'en commencer une autre.`);
    const sourceType = SOURCE_OF_ROUTE[data.route];
    const source = await loadSource(sourceType, data.sourceId);
    if (!source) throw new NotFoundError(sourceType === "TABLE_EGG_LOT" ? "Collecte d'œufs de consommation" : "Lot d'œufs à couver", data.sourceId);
    if (source.buildingId) assertInScope(session, await resolveBuildingHierarchy(source.buildingId));
    const blocked = await sourceBlock(source);
    if (blocked) throw new ConflictError(blocked);

    const stamp = farmDay(now.toISOString()).replaceAll("-", "");
    const prefix = `MQ-${line.shellPrefix}-${stamp}-`;
    const run = await repositories.marking.createRun({
      code: `${prefix}${(await repositories.marking.countRunsOn(line.id, prefix)) + 1}`,
      lineId: line.id,
      route: data.route,
      sourceType,
      sourceId: source.id,
      status: "EN_COURS",
      startedAt: now.toISOString(),
      startedBy: session.userId,
      guardSince: now.toISOString(),
      notes: data.notes ?? null,
    });
    await recordAudit({
      actorId: session.userId,
      entityType: "egg_marking_run",
      entityId: run.id,
      field: null,
      oldValue: null,
      newValue: `${run.code} — ${source.code} sur ${line.code}, ${ROUTE_SHORT[run.route]}`,
      reason: "Début d'une campagne de marquage",
      relatedLotId: source.lotId,
      relatedEventId: null,
    });
    return run;
  });
}

export interface AllocatedBlock {
  runId: string;
  runCode: string;
  prefix: string;
  firstSerial: number;
  lastSerial: number;
  codes: string[];
  replayed: boolean;
}

const blockOut = (run: MarkingRun, line: MarkingLine, block: CodeBlock, replayed: boolean): AllocatedBlock => ({
  runId: run.id,
  runCode: run.code,
  prefix: line.shellPrefix,
  firstSerial: block.firstSerial,
  lastSerial: block.lastSerial,
  codes: Array.from({ length: block.lastSerial - block.firstSerial + 1 }, (_, i) => shellCode(line.shellPrefix, block.firstSerial + i)),
  replayed,
});

/**
 * Hands the line controller its next block of codes. Serials only move forward, by compare-and-set
 * on the line, so two blocks never share a code; a request repeated with the same reference (a
 * timeout, a restart) gets the same block back instead of burning a second one.
 */
export async function allocateCodes(runId: string, input: unknown, session: Session, origin: MarkingOrigin = USER, now = new Date()): Promise<AllocatedBlock> {
  if (!can(session, "CREATE", "MARKING")) throw new AuthorizationError();
  const data = parseInput(allocateSchema, input);
  return withLock(`marking-run:${runId}`, async () => {
    const { run, line } = await runInScope(runId, session);
    const replay = await repositories.marking.findBlockByRef(run.id, data.requestRef);
    if (replay) {
      if (replay.lastSerial - replay.firstSerial + 1 !== data.count) throw new ConflictError("Cette référence de demande a déjà servi pour un autre nombre de codes.");
      return blockOut(run, line, replay, true);
    }
    if (run.status === "CLOS") throw new MarkingRefusal("RUN_CLOSED", `La campagne ${run.code} est close : démarrez-en une autre.`);
    if (run.status === "ARRET_LECTURE") throw new MarkingRefusal("READ_STOP", "Ligne arrêtée par le contrôle de lecture : nettoyez la tête, vérifiez la caméra, puis faites lever l'arrêt.");
    const source = await loadSource(run.sourceType, run.sourceId);
    const blocked = source ? await sourceBlock(source) : "La source de cette campagne n'existe plus.";
    if (blocked) throw new MarkingRefusal("SOURCE_BLOCKED", blocked);

    return withLock(`marking-line:${line.id}`, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await repositories.marking.findLine(line.id);
        if (!current) throw new NotFoundError("Ligne de marquage", line.id);
        const firstSerial = current.nextSerial;
        const lastSerial = firstSerial + data.count - 1;
        if (lastSerial > MAX_SERIAL) throw new MarkingRefusal("SERIALS_EXHAUSTED", `La ligne ${line.code} a épuisé ses numéros : donnez-lui un nouveau préfixe.`);
        if (!(await repositories.marking.advanceSerial(line.id, firstSerial, data.count))) continue;
        const block = await repositories.marking.createBlock({
          lineId: line.id,
          runId: run.id,
          requestRef: data.requestRef,
          firstSerial,
          lastSerial,
          allocatedAt: now.toISOString(),
          requestedBy: originRef(session, origin),
        });
        await repositories.marking.addAllocation(run.id, block);
        return blockOut(run, line, block, false);
      }
      throw new ConflictError("Attribution de codes concurrente sur cette ligne : réessayez.");
    });
  });
}

export interface ReadOutcome {
  runId: string;
  status: MarkingRunStatus;
  /** Share read correctly over the guard's window, and how many eggs that window holds. */
  rate: number | null;
  considered: number;
  stopped: boolean;
  replayed: boolean;
  ok: number;
  ko: number;
}

async function guardOf(run: MarkingRun, line: MarkingLine) {
  const recent = await repositories.marking.listRecentBatches(run.id, run.guardSince, 1000);
  return readGuard(recent.reverse(), line.readThreshold, line.readWindow);
}

/**
 * What the camera read back: a range of printed serials and those it could not read (sent to the
 * reject exit). Below the line's threshold over its window, the run stops: no more codes until a
 * person has cleaned the head and said so. Reads of eggs already printed are still accepted while
 * stopped — they are the eggs in flight, and their fate must be known.
 */
export async function recordReadBatch(runId: string, input: unknown, session: Session, origin: MarkingOrigin = USER, now = new Date()): Promise<ReadOutcome> {
  if (!can(session, "CREATE", "MARKING")) throw new AuthorizationError();
  const data = parseInput(readBatchSchema, input);
  return withLock(`marking-run:${runId}`, async () => {
    const { run, line } = await runInScope(runId, session);
    const replay = await repositories.marking.findBatchByRef(run.id, data.batchRef);
    if (replay) {
      if (replay.firstSerial !== data.firstSerial || replay.lastSerial !== data.lastSerial || replay.ko !== data.failed.length) {
        throw new ConflictError("Cette référence de lecture a déjà servi pour une autre plage.");
      }
      const current = (await repositories.marking.findRun(run.id)) ?? run;
      const guard = await guardOf(current, line);
      return { runId: run.id, status: current.status, rate: guard.rate, considered: guard.considered, stopped: current.status === "ARRET_LECTURE", replayed: true, ok: replay.ok, ko: replay.ko };
    }
    if (run.status === "CLOS") throw new MarkingRefusal("RUN_CLOSED", `La campagne ${run.code} est close.`);
    if (run.firstSerial === null || run.lastSerial === null || data.firstSerial < run.firstSerial || data.lastSerial > run.lastSerial) {
      throw new ValidationError("Ces numéros n'ont pas été attribués à cette campagne.");
    }
    const readAt = new Date(data.readAt).toISOString();
    if (Date.parse(readAt) > now.getTime() + READ_CLOCK_TOLERANCE_MS) throw new ValidationError("Heure de lecture dans le futur : l'horloge du contrôleur de ligne est à régler.");
    if (Date.parse(readAt) < Date.parse(run.startedAt) - READ_CLOCK_TOLERANCE_MS) throw new ValidationError("Heure de lecture antérieure au début de la campagne.");
    const overlap = await repositories.marking.listBatchesOverlapping(run.id, data);
    if (overlap.length) throw new ConflictError(`Une partie de ces numéros a déjà été déclarée lue (envoi ${overlap[0].batchRef}).`);

    const ko = data.failed.length;
    const ok = data.lastSerial - data.firstSerial + 1 - ko;
    await repositories.marking.createBatch({ runId: run.id, batchRef: data.batchRef, firstSerial: data.firstSerial, lastSerial: data.lastSerial, readAt, ok, ko, receivedAt: now.toISOString(), reportedBy: originRef(session, origin) });
    if (ko) await repositories.marking.addExceptions(data.failed.map((serial) => ({ runId: run.id, serial, kind: "ILLISIBLE", at: readAt, recordedBy: null, hatchCycleId: null, note: null })));
    await repositories.marking.addReads(run.id, ok, ko);

    const guard = await guardOf(run, line);
    let status = run.status;
    if (!guard.ok && run.status === "EN_COURS" && (await repositories.marking.setRunStatus(run.id, "EN_COURS", { status: "ARRET_LECTURE" }))) {
      status = "ARRET_LECTURE";
      await repositories.marking.createStop({ runId: run.id, stoppedAt: now.toISOString(), rate: guard.rate ?? 0, considered: guard.considered });
      await recordAudit({
        actorId: null,
        entityType: "egg_marking_run",
        entityId: run.id,
        field: "status",
        oldValue: "EN_COURS",
        newValue: "ARRET_LECTURE",
        reason: `Arrêt automatique : ${pct(guard.rate)} des ${guard.considered} derniers œufs relus, pour un seuil de ${pct(line.readThreshold)}${viaApi(origin)}`,
        relatedLotId: null,
        relatedEventId: null,
      });
    }
    return { runId: run.id, status, rate: guard.rate, considered: guard.considered, stopped: status === "ARRET_LECTURE", replayed: false, ok, ko };
  });
}

/** Restarts a line the guard stopped. Says what was done; the guard then judges only the eggs read from now on. */
export async function liftReadStop(input: unknown, session: Session, now = new Date()): Promise<MarkingRun> {
  if (!can(session, "EDIT", "MARKING")) throw new AuthorizationError("Seul le responsable de la ligne relance après un arrêt de lecture.");
  const data = parseInput(liftStopSchema, input);
  return withLock(`marking-run:${data.runId}`, async () => {
    const { run } = await runInScope(data.runId, session);
    if (run.status !== "ARRET_LECTURE") throw new ConflictError("Cette campagne n'est pas arrêtée.");
    const lifted = await repositories.marking.setRunStatus(run.id, "ARRET_LECTURE", { status: "EN_COURS", guardSince: now.toISOString() });
    if (!lifted) throw new ConflictError("Cette campagne vient de changer d'état.");
    const stop = await repositories.marking.findOpenStop(run.id);
    if (stop) await repositories.marking.liftStop(stop.id, { liftedAt: now.toISOString(), liftedBy: session.userId, liftNote: data.note });
    await recordAudit({ actorId: session.userId, entityType: "egg_marking_run", entityId: run.id, field: "status", oldValue: "ARRET_LECTURE", newValue: "EN_COURS", reason: data.note, relatedLotId: null, relatedEventId: null });
    return lifted;
  });
}

export interface PackedTray {
  tray: EggTray;
  bvuId: string;
  url: string;
  replayed: boolean;
}

/**
 * A tray (plateau, boîte, alvéole) of table eggs: consecutive codes printed and read back by this
 * run, minus those sent to the reject exit. It gets its own BIOVOLAILLES identifier, and the QR on
 * its label opens the public egg page — "même logique que le QR sur le poulet" (document 3).
 */
export async function packTray(runId: string, input: unknown, session: Session, origin: MarkingOrigin = USER, now = new Date()): Promise<PackedTray> {
  if (!can(session, "CREATE", "MARKING")) throw new AuthorizationError();
  const data = parseInput(traySchema, input);
  return withLock(`marking-run:${runId}`, async () => {
    const { run, line } = await runInScope(runId, session);
    if (run.route !== "B_CONSOMMATION") throw new ValidationError("Les plateaux tracés concernent les œufs de consommation (voie B).");
    const range: SerialRange = { firstSerial: data.firstSerial, lastSerial: data.lastSerial };
    if (data.trayRef) {
      const replay = await repositories.marking.findTrayByRef(run.id, data.trayRef);
      if (replay) {
        if (replay.firstSerial !== range.firstSerial || replay.lastSerial !== range.lastSerial) throw new ConflictError("Cette référence de plateau a déjà servi pour une autre plage.");
        const bvuId = await assignBvuId("PACKAGE", replay.id);
        return { tray: replay, bvuId, url: publicEggUrl(bvuId), replayed: true };
      }
    }
    if (run.status === "CLOS") throw new MarkingRefusal("RUN_CLOSED", `La campagne ${run.code} est close.`);
    const source = await loadSource(run.sourceType, run.sourceId);
    const blocked = source ? await sourceBlock(source) : "La source de cette campagne n'existe plus.";
    if (blocked) throw new MarkingRefusal("SOURCE_BLOCKED", blocked);
    const capacity = data.capacity ?? line.trayCapacity;
    const [printed, existing, rejected] = await Promise.all([
      repositories.marking.listBatchesOverlapping(run.id, range),
      repositories.marking.listTraysOverlapping(run.id, range),
      repositories.marking.listExceptionsInRange(run.id, range, "ILLISIBLE"),
    ]);
    const rejectedSerials = rejected.map((e) => e.serial);
    const error = trayError({ ...range, capacity }, printed, existing, rejectedSerials);
    if (error) throw new ValidationError(error);
    const tray = await repositories.marking.createTray({
      runId: run.id,
      trayRef: data.trayRef ?? null,
      ...range,
      capacity,
      eggCount: eggsInRange(range, rejectedSerials),
      packedAt: data.packedAt ? new Date(data.packedAt).toISOString() : now.toISOString(),
      packedBy: originRef(session, origin),
    });
    const bvuId = await assignBvuId("PACKAGE", tray.id);
    return { tray, bvuId, url: publicEggUrl(bvuId), replayed: false };
  });
}

/**
 * Closes a run. Codes handed out and never printed stay unused for good — serials are never
 * reused. More eggs read back than the source declares means eggs from elsewhere went through the
 * line: the run then closes only with an explanation.
 */
export async function closeMarkingRun(input: unknown, session: Session, now = new Date()): Promise<MarkingRun> {
  if (!can(session, "EDIT", "MARKING")) throw new AuthorizationError();
  const data = parseInput(closeRunSchema, input);
  return withLock(`marking-run:${data.runId}`, async () => {
    const { run } = await runInScope(data.runId, session);
    if (run.status === "CLOS") throw new ConflictError("Cette campagne est déjà close.");
    const source = await loadSource(run.sourceType, run.sourceId);
    const note = data.note?.trim() || null;
    if (source && run.readOk > source.expected && (note ?? "").length < 10) {
      throw new ValidationError(
        `${run.readOk.toLocaleString("fr-FR")} œufs relus pour ${source.expected.toLocaleString("fr-FR")} ${run.sourceType === "TABLE_EGG_LOT" ? "œufs vendables déclarés" : "œufs dans le lot"} : expliquez l'écart avant de clore (10 caractères au moins).`
      );
    }
    const closed = await repositories.marking.setRunStatus(run.id, run.status, { status: "CLOS", endedAt: now.toISOString(), endedBy: session.userId, closeNote: note });
    if (!closed) throw new ConflictError("Cette campagne vient de changer d'état.");
    const stop = await repositories.marking.findOpenStop(run.id);
    if (stop) await repositories.marking.liftStop(stop.id, { liftedAt: now.toISOString(), liftedBy: session.userId, liftNote: "Campagne close pendant l'arrêt de lecture." });
    const trays = await repositories.marking.countTrays(run.id);
    await recordAudit({
      actorId: session.userId,
      entityType: "egg_marking_run",
      entityId: run.id,
      field: "status",
      oldValue: run.status,
      newValue: `CLOS — ${run.printed} imprimés, ${run.readOk} relus (${pct(run.printed ? run.readOk / run.printed : null)}), ${run.readKo} rejetés, ${run.allocated - run.printed} codes non utilisés${run.route === "B_CONSOMMATION" ? `, ${trays.trays} plateaux (${trays.eggs} œufs)` : ""}`,
      reason: note ?? "Fin de campagne",
      relatedLotId: source?.lotId ?? null,
      relatedEventId: null,
    });
    return closed;
  });
}

// ---------------------------------------------------------------------------
// Route A: candling rejects named by their code, storage time egg by egg
// ---------------------------------------------------------------------------

/**
 * "Rebut au mirage rattaché à un troupeau parent" (document 3): the eggs removed at candling are
 * scanned or typed; each is traced to its egg lot and parent flock. All-or-nothing: one code that
 * is unknown, misread or from another cycle refuses the whole entry with the list to correct, so a
 * typing error never leaves half an entry behind. A code entered twice counts once.
 */
export async function recordCandlingRejects(input: unknown, session: Session, now = new Date()): Promise<{ recorded: number; alreadyKnown: number }> {
  if (!can(session, "EDIT", "HATCHERY")) throw new AuthorizationError("Le mirage relève du couvoir.");
  const data = parseInput(candlingRejectsSchema, input);
  const codes = splitCodes(data.codes);
  if (codes.length === 0) throw new ValidationError("Aucun code saisi.");
  if (codes.length > 2000) throw new ValidationError("2 000 codes au plus par saisie.");
  const cycle = await repositories.hatchCycles.findById(data.cycleId);
  if (!cycle) throw new NotFoundError("Cycle d'incubation", data.cycleId);
  assertInScope(session, await resolveBuildingHierarchy(cycle.buildingId));
  const loaded = new Set((await repositories.relations.listFrom("HATCH_CYCLE", cycle.id)).filter((e) => e.toType === "EGG_LOT").map((e) => e.toId));

  const lines = new Map<string, { line: MarkingLine; runs: MarkingRun[] } | null>();
  const batches = new Map<string, ReadBatch[]>();
  const problems: string[] = [];
  const rows: Omit<EggReadException, "id">[] = [];
  for (const raw of codes) {
    const parsed = parseShellCode(raw);
    if (!parsed) {
      problems.push(`« ${raw} » n'est pas un code de coquille`);
      continue;
    }
    if (!parsed.valid) {
      problems.push(`${parsed.code} : caractère de contrôle faux, relisez le code`);
      continue;
    }
    if (!lines.has(parsed.prefix)) {
      const line = await repositories.marking.findLineByPrefix(parsed.prefix);
      lines.set(parsed.prefix, line ? { line, runs: await repositories.marking.listRunsByLine(line.id) } : null);
    }
    const known = lines.get(parsed.prefix);
    const run = known?.runs.find((r) => r.firstSerial !== null && r.lastSerial !== null && r.firstSerial <= parsed.serial && parsed.serial <= r.lastSerial);
    if (!known || !run) {
      problems.push(`${parsed.code} : code jamais attribué`);
      continue;
    }
    if (run.route !== "A_COUVER") {
      problems.push(`${parsed.code} : œuf de consommation, pas un œuf à couver`);
      continue;
    }
    if (!loaded.has(run.sourceId)) {
      const egg = await repositories.eggLots.findById(run.sourceId);
      problems.push(`${parsed.code} : œuf du lot ${egg?.code ?? "inconnu"}, qui n'est pas chargé dans ce cycle`);
      continue;
    }
    if (!batches.has(run.id)) batches.set(run.id, await repositories.marking.listBatchesByRuns([run.id]));
    if (!batches.get(run.id)!.some((b) => b.firstSerial <= parsed.serial && parsed.serial <= b.lastSerial)) {
      problems.push(`${parsed.code} : jamais relu au marquage`);
      continue;
    }
    rows.push({ runId: run.id, serial: parsed.serial, kind: "REBUT_MIRAGE", at: now.toISOString(), recordedBy: session.userId, hatchCycleId: cycle.id, note: null });
  }
  if (problems.length) {
    throw new ValidationError(`${problems.length} code${problems.length > 1 ? "s" : ""} refusé${problems.length > 1 ? "s" : ""}, rien n'a été enregistré : ${problems.slice(0, 8).join(" ; ")}${problems.length > 8 ? " ; …" : ""}`);
  }
  const recorded = await repositories.marking.addExceptions(rows);
  if (recorded > 0) {
    await recordAudit({ actorId: session.userId, entityType: "hatch_cycle", entityId: cycle.id, field: "candlingRejects", oldValue: null, newValue: `${recorded} rebut${recorded > 1 ? "s" : ""} au mirage identifié${recorded > 1 ? "s" : ""} par leur code`, reason: "Mirage", relatedLotId: null, relatedEventId: null });
  }
  return { recorded, alreadyKnown: rows.length - recorded };
}

export interface CycleMarking {
  /** Egg lots of the cycle that were marked at collection, with the eggs read back. */
  markedLots: { code: string; flockCode: string; loaded: number; marked: number }[];
  /** Days between marking (= collection) and setting, egg by egg, over the marked eggs of the lots loaded. */
  storage: { days: number; eggs: number }[];
  storageRange: { min: number; max: number; mean: number } | null;
  rejectsByFlock: { flockCode: string; eggLotCode: string; identified: number; loaded: number }[];
  identified: number;
  clearsRemoved: number | null;
  canRecord: boolean;
}

export async function getCycleMarking(cycleId: string, session: Session): Promise<CycleMarking | null> {
  if (!can(session, "VIEW", "HATCHERY")) throw new AuthorizationError();
  const cycle = await repositories.hatchCycles.findById(cycleId);
  if (!cycle) throw new NotFoundError("Cycle d'incubation", cycleId);
  assertInScope(session, await resolveBuildingHierarchy(cycle.buildingId));
  const edges = (await repositories.relations.listFrom("HATCH_CYCLE", cycle.id)).filter((e) => e.toType === "EGG_LOT");
  const runs = (await repositories.marking.listRunsBySource("EGG_LOT", edges.map((e) => e.toId))).filter((r) => r.route === "A_COUVER");
  if (runs.length === 0) return null;
  const batches = await repositories.marking.listBatchesByRuns(runs.map((r) => r.id));
  const rejects = await repositories.marking.listExceptionsByCycle(cycle.id);

  const histogram = new Map<number, number>();
  for (const b of batches) {
    const days = storageDays(b.readAt, cycle.setAt);
    histogram.set(days, (histogram.get(days) ?? 0) + b.ok);
  }
  const storage = [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([days, eggs]) => ({ days, eggs }));
  const total = storage.reduce((s, d) => s + d.eggs, 0);

  const markedLots: CycleMarking["markedLots"] = [];
  const rejectsByFlock: CycleMarking["rejectsByFlock"] = [];
  for (const edge of edges) {
    const egg = await repositories.eggLots.findById(edge.toId);
    if (!egg) continue;
    const flock = await repositories.parentFlocks.findById(egg.parentFlockId);
    const lotRuns = runs.filter((r) => r.sourceId === egg.id);
    const loaded = Number((edge.metadata as { quantity?: number }).quantity ?? 0);
    if (lotRuns.length) markedLots.push({ code: egg.code, flockCode: flock?.code ?? "—", loaded, marked: lotRuns.reduce((s, r) => s + r.readOk, 0) });
    const identified = rejects.filter((x) => lotRuns.some((r) => r.id === x.runId)).length;
    if (lotRuns.length) rejectsByFlock.push({ flockCode: flock?.code ?? "—", eggLotCode: egg.code, identified, loaded });
  }
  return {
    markedLots,
    storage,
    storageRange: total ? { min: storage[0].days, max: storage[storage.length - 1].days, mean: storage.reduce((s, d) => s + d.days * d.eggs, 0) / total } : null,
    rejectsByFlock,
    identified: rejects.length,
    clearsRemoved: cycle.clearsRemoved,
    canRecord: can(session, "EDIT", "HATCHERY"),
  };
}

// ---------------------------------------------------------------------------
// Reading a code back
// ---------------------------------------------------------------------------

export type ShellCodeFate = "RELU" | "ILLISIBLE" | "NON_RELU" | "REBUT_MIRAGE";

export interface ResolvedShellCode {
  code: string;
  serial: number;
  line: MarkingLine;
  run: MarkingRun;
  fate: ShellCodeFate;
  readAt: string | null;
  tray: EggTray | null;
}

/**
 * Where a shell code leads: the line that printed it, the run, and what became of the egg — read
 * back, rejected at the camera, never read, or removed at candling. A code with a wrong check
 * character returns "misread", never a guess at the code it was meant to be.
 */
export async function resolveShellCode(raw: string): Promise<ResolvedShellCode | "MISREAD" | null> {
  const parsed = parseShellCode(raw);
  if (!parsed) return null;
  if (!parsed.valid) return "MISREAD";
  const line = await repositories.marking.findLineByPrefix(parsed.prefix);
  if (!line) return null;
  const run = await repositories.marking.findRunBySerial(line.id, parsed.serial);
  if (!run) return null;
  const point = { firstSerial: parsed.serial, lastSerial: parsed.serial };
  const [batch] = await repositories.marking.listBatchesOverlapping(run.id, point);
  const exceptions = await repositories.marking.listExceptionsForSerial(run.id, parsed.serial);
  const [tray] = await repositories.marking.listTraysOverlapping(run.id, point);
  const fate: ShellCodeFate = !batch
    ? "NON_RELU"
    : exceptions.some((e) => e.kind === "ILLISIBLE")
      ? "ILLISIBLE"
      : exceptions.some((e) => e.kind === "REBUT_MIRAGE")
        ? "REBUT_MIRAGE"
        : "RELU";
  return { code: parsed.code, serial: parsed.serial, line, run, fate, readAt: batch?.readAt ?? null, tray: tray ?? null };
}

// ---------------------------------------------------------------------------
// The line controller's view (API)
// ---------------------------------------------------------------------------

export interface ControllerRunStatus {
  id: string;
  code: string;
  status: MarkingRunStatus;
  route: MarkingRoute;
  allocated: number;
  printed: number;
  readOk: number;
  readKo: number;
  rate: number | null;
  guard: { rate: number | null; considered: number; threshold: number; window: number };
}

async function controllerStatus(run: MarkingRun, line: MarkingLine): Promise<ControllerRunStatus> {
  const guard = await guardOf(run, line);
  return {
    id: run.id,
    code: run.code,
    status: run.status,
    route: run.route,
    allocated: run.allocated,
    printed: run.printed,
    readOk: run.readOk,
    readKo: run.readKo,
    rate: run.printed ? run.readOk / run.printed : null,
    guard: { rate: guard.rate, considered: guard.considered, threshold: line.readThreshold, window: line.readWindow },
  };
}

/** What a controller needs when it starts: its line's settings, and the run it should be printing for. */
export async function getLineForController(code: string, session: Session) {
  if (!can(session, "VIEW", "MARKING")) throw new AuthorizationError();
  const found = await repositories.marking.findLineByCode(code);
  if (!found) throw new NotFoundError("Ligne de marquage", code);
  const line = await lineInScope(found.id, session);
  const run = await repositories.marking.findOpenRun(line.id);
  return {
    line: { code: line.code, name: line.name, prefix: line.shellPrefix, routes: line.routes, readThreshold: line.readThreshold, readWindow: line.readWindow, trayCapacity: line.trayCapacity, active: line.active },
    openRun: run ? await controllerStatus(run, line) : null,
  };
}

export async function getRunForController(runId: string, session: Session): Promise<ControllerRunStatus> {
  if (!can(session, "VIEW", "MARKING")) throw new AuthorizationError();
  const { run, line } = await runInScope(runId, session);
  return controllerStatus(run, line);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface MarkingRunRow extends MarkingRun {
  lineCode: string;
  lineName: string;
  sourceCode: string;
  farmName: string;
  rate: number | null;
}

export interface MarkingOverview {
  lines: (MarkingLine & { place: string; openRun: MarkingRun | null; lastRunAt: string | null })[];
  runs: MarkingRunRow[];
  printedToday: number;
  rateToday: number | null;
  stopped: number;
  /** What a new run may mark, per route: today's graded collections and recent hatching-egg lots, in scope and not blocked. */
  sources: Record<MarkingRoute, { value: string; label: string }[]>;
  /** Where a new line may stand: every building in scope, for the people who configure lines. */
  buildings: { value: string; label: string }[];
  can: { start: boolean; configure: boolean };
}

export async function getMarkingOverview(session: Session, now = new Date()): Promise<MarkingOverview> {
  if (!can(session, "VIEW", "MARKING")) throw new AuthorizationError();
  const [lines, runs, buildings, farms, index, tableEggs, eggLots, flocks, lots] = await Promise.all([
    repositories.marking.listLines(),
    repositories.marking.listRuns(),
    repositories.buildings.list(),
    repositories.farms.list(),
    buildHierarchyIndex(),
    repositories.tableEggLots.list(),
    repositories.eggLots.list(),
    repositories.parentFlocks.list(),
    repositories.lots.list(),
  ]);
  const inScope = (buildingId: string | null | undefined) => isGlobalScope(session) || (!!buildingId && isWithinScope(session, index.building.get(buildingId) ?? {}));
  const visibleLines = lines.filter((l) => inScope(l.buildingId));
  const lineById = new Map(visibleLines.map((l) => [l.id, l]));
  const farmOf = (buildingId: string) => {
    const b = buildings.find((x) => x.id === buildingId);
    return { farm: farms.find((f) => f.id === b?.farmId)?.name ?? "—", building: b?.name ?? "—" };
  };
  const tableById = new Map(tableEggs.map((e) => [e.id, e]));
  const eggById = new Map(eggLots.map((e) => [e.id, e]));
  const visibleRuns = runs.filter((r) => lineById.has(r.lineId));

  const rows: MarkingRunRow[] = visibleRuns.slice(0, 100).map((r) => {
    const line = lineById.get(r.lineId)!;
    return {
      ...r,
      lineCode: line.code,
      lineName: line.name,
      sourceCode: (r.sourceType === "TABLE_EGG_LOT" ? tableById.get(r.sourceId)?.code : eggById.get(r.sourceId)?.code) ?? "—",
      farmName: farmOf(line.buildingId).farm,
      rate: r.printed ? r.readOk / r.printed : null,
    };
  });

  const since = new Date(`${farmDay(now.toISOString())}T00:00:00+01:00`).toISOString();
  const today = await repositories.marking.sumReadsSince(since);
  const horizon = now.getTime() - 30 * 86_400_000;
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const flockById = new Map(flocks.map((f) => [f.id, f]));
  const sources: MarkingOverview["sources"] = { B_CONSOMMATION: [], A_COUVER: [] };
  for (const e of tableEggs.filter((x) => (x.status === "EN_STOCK" || x.status === "CONDITIONNE") && Date.parse(x.collectedOn) >= horizon).sort((a, b) => b.collectedOn.localeCompare(a.collectedOn))) {
    const lot = lotById.get(e.lotId);
    if (!lot || !inScope(lot.buildingId) || (await activeHoldsOn("TABLE_EGG_LOT", e.id)).length || (await activeHoldsOn("LOT", lot.id)).length) continue;
    sources.B_CONSOMMATION.push({ value: e.id, label: `${e.code} — ${lot.code}, ${e.saleable.toLocaleString("fr-FR")} vendables` });
  }
  for (const e of eggLots.filter((x) => Date.parse(x.collectedAt) >= horizon).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))) {
    const flock = flockById.get(e.parentFlockId);
    if (!inScope(e.storageBuildingId ?? flock?.buildingId) || (await activeHoldsOn("EGG_LOT", e.id)).length) continue;
    sources.A_COUVER.push({ value: e.id, label: `${e.code} — ${flock?.code ?? "—"}, ${e.quantity.toLocaleString("fr-FR")} œufs` });
  }

  return {
    lines: visibleLines.map((l) => {
      const place = farmOf(l.buildingId);
      const lineRuns = visibleRuns.filter((r) => r.lineId === l.id);
      return { ...l, place: `${place.farm} — ${place.building}`, openRun: lineRuns.find((r) => r.status !== "CLOS") ?? null, lastRunAt: lineRuns[0]?.startedAt ?? null };
    }),
    runs: rows,
    printedToday: today.ok + today.ko,
    rateToday: today.ok + today.ko ? today.ok / (today.ok + today.ko) : null,
    stopped: visibleRuns.filter((r) => r.status === "ARRET_LECTURE").length,
    sources,
    buildings: can(session, "VALIDATE", "MARKING")
      ? buildings
          .filter((b) => inScope(b.id))
          .map((b) => ({ value: b.id, label: `${farms.find((f) => f.id === b.farmId)?.name ?? "—"} — ${b.name} (${b.code})` }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr"))
      : [],
    can: { start: can(session, "CREATE", "MARKING"), configure: can(session, "VALIDATE", "MARKING") },
  };
}

export interface MarkingRunDetail {
  run: MarkingRun;
  line: MarkingLine;
  place: string;
  source: { code: string; href: string; detail: string; expected: number; blocked: string | null };
  rate: number | null;
  guard: { rate: number | null; considered: number };
  firstCode: string | null;
  lastCode: string | null;
  unused: number;
  batches: ReadBatch[];
  stops: (ReadStop & { liftedByName: string | null })[];
  rejected: { code: string; at: string; kind: EggReadException["kind"] }[];
  rejectedCount: number;
  trays: (EggTray & { bvuId: string; firstCode: string; lastCode: string })[];
  trayTotals: { trays: number; eggs: number };
  startedByName: string;
  endedByName: string | null;
  can: { lift: boolean; close: boolean; pack: boolean; simulate: boolean };
}

export async function getMarkingRun(runId: string, session: Session): Promise<MarkingRunDetail> {
  if (!can(session, "VIEW", "MARKING")) throw new AuthorizationError();
  const { run, line } = await runInScope(runId, session);
  const building = await repositories.buildings.findById(line.buildingId);
  const farm = building ? await repositories.farms.findById(building.farmId) : null;
  const source = await loadSource(run.sourceType, run.sourceId);
  const [batches, stops, rejected, trays, trayTotals, guard, users] = await Promise.all([
    repositories.marking.listRecentBatches(run.id, "", 30),
    repositories.marking.listStops(run.id),
    repositories.marking.listExceptions(run.id, null, 200),
    repositories.marking.listTrays(run.id, 30),
    repositories.marking.countTrays(run.id),
    guardOf(run, line),
    repositories.users.list(),
  ]);
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.fullName ?? "—") : null);
  const trayIds = await bvuIdsFor("PACKAGE", trays.map((t) => t.id));
  const tableEggs = run.sourceType === "TABLE_EGG_LOT" ? await repositories.tableEggLots.findById(run.sourceId) : null;
  const open = run.status !== "CLOS";
  return {
    run,
    line,
    place: `${farm?.name ?? "—"} — ${building?.name ?? "—"}`,
    source: source
      ? {
          code: source.code,
          href: run.sourceType === "TABLE_EGG_LOT" ? `/oeufs-consommation/${source.id}` : `/couvoir`,
          detail: run.sourceType === "TABLE_EGG_LOT" ? `${tableEggs?.saleable.toLocaleString("fr-FR") ?? "—"} œufs vendables déclarés` : `${source.expected.toLocaleString("fr-FR")} œufs à couver`,
          expected: source.expected,
          blocked: open ? await sourceBlock(source) : null,
        }
      : { code: "—", href: "/marquage", detail: "Source introuvable", expected: 0, blocked: null },
    rate: run.printed ? run.readOk / run.printed : null,
    guard: { rate: guard.rate, considered: guard.considered },
    firstCode: run.firstSerial !== null ? shellCode(line.shellPrefix, run.firstSerial) : null,
    lastCode: run.lastSerial !== null ? shellCode(line.shellPrefix, run.lastSerial) : null,
    unused: run.allocated - run.printed,
    batches,
    stops: stops.map((s) => ({ ...s, liftedByName: nameOf(s.liftedBy) })),
    rejected: rejected.map((e) => ({ code: shellCode(line.shellPrefix, e.serial), at: e.at, kind: e.kind })),
    rejectedCount: run.readKo,
    trays: trays.map((t) => ({ ...t, bvuId: trayIds.get(t.id) ?? "—", firstCode: shellCode(line.shellPrefix, t.firstSerial), lastCode: shellCode(line.shellPrefix, t.lastSerial) })),
    trayTotals,
    startedByName: nameOf(run.startedBy) ?? "—",
    endedByName: nameOf(run.endedBy),
    can: {
      lift: run.status === "ARRET_LECTURE" && can(session, "EDIT", "MARKING"),
      close: open && can(session, "EDIT", "MARKING"),
      pack: run.status !== "CLOS" && run.route === "B_CONSOMMATION" && can(session, "CREATE", "MARKING"),
      simulate: run.status === "EN_COURS" && can(session, "CREATE", "MARKING"),
    },
  };
}

// ---------------------------------------------------------------------------
// The line, simulated: the demonstration and the seed drive the real paths above
// ---------------------------------------------------------------------------

export const simulateSchema = z.object({
  eggs: z.number().int().min(1).max(20_000),
  /** Share of eggs the camera fails to read, before and after the head clogs. */
  failRate: z.number().min(0).max(1).default(0.004),
  clogAfter: z.number().int().min(0).optional().nullable(),
  clogRate: z.number().min(0).max(1).default(0.09),
  batchSize: z.number().int().min(10).max(1000).default(100),
  /** When the first egg passes, and the line's pace; by default the eggs pass just now. */
  startAt: z.iso.datetime({ offset: true }).optional().nullable(),
  eggsPerHour: z.number().int().min(100).max(250_000).default(3000),
});

/**
 * Same answer for the same egg every time: the seed and a replayed demonstration stay reproducible.
 * FNV-1a alone gives neighbouring serials neighbouring values, so unreadable eggs would come in
 * clusters and stop a clean line; the murmur3 finaliser spreads them evenly.
 */
export function unreadable(runId: string, serial: number, rate: number): boolean {
  let h = 2166136261;
  for (const c of `${runId}:${serial}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < rate;
}

/**
 * Plays a line controller: draws codes block by block, reports the camera's reads, packs full trays
 * (route B). Stops when the guard stops the line, as a real controller must. Every step goes
 * through the same service functions as the machine API, so what the demonstration shows is what
 * the line will do.
 */
export async function simulateMarking(runId: string, input: unknown, session: Session, now = new Date()): Promise<{ printed: number; trays: number; status: MarkingRunStatus }> {
  const data = parseInput(simulateSchema, input);
  const { run, line } = await runInScope(runId, session);
  let msPerEgg = 3_600_000 / data.eggsPerHour;
  let start = data.startAt ? Date.parse(data.startAt) : 0;
  if (!data.startAt) {
    // The eggs pass "just now": after the last read and the last restart, and never later than now —
    // the server refuses reads stamped in the future. A short gap means a fast line, not a refusal.
    const [last] = await repositories.marking.listRecentBatches(run.id, "", 1);
    const earliest = Math.max(Date.parse(run.guardSince), last ? Date.parse(last.readAt) : 0);
    start = Math.max(earliest, now.getTime() - data.eggs * msPerEgg);
    msPerEgg = Math.max(0, now.getTime() - start) / data.eggs;
  }
  let printed = 0;
  let trays = 0;
  let status: MarkingRunStatus = run.status;
  let trayStart: number | null = null;
  let filled = 0;
  for (let done = 0; done < data.eggs && status === "EN_COURS"; ) {
    const count = Math.min(data.batchSize, data.eggs - done);
    const at = new Date(start + (done + count) * msPerEgg);
    const clock = data.startAt ? at : now;
    const ref = `${run.id.slice(0, 8)}-${at.getTime()}-${done}`;
    const block = await allocateCodes(run.id, { count, requestRef: `sim-c-${ref}` }, session, USER, clock);
    const failed: number[] = [];
    for (let s = block.firstSerial; s <= block.lastSerial; s++) {
      const rate = data.clogAfter != null && done + (s - block.firstSerial) >= data.clogAfter ? data.clogRate : data.failRate;
      if (unreadable(run.id, s, rate)) failed.push(s);
    }
    const outcome = await recordReadBatch(run.id, { batchRef: `sim-r-${ref}`, firstSerial: block.firstSerial, lastSerial: block.lastSerial, readAt: at.toISOString(), failed }, session, USER, clock);
    printed += count;
    done += count;
    status = outcome.status;
    if (run.route !== "B_CONSOMMATION") continue;
    // Full trays only: the eggs left over wait for the next batch.
    const rejected = new Set(failed);
    for (let s = block.firstSerial; s <= block.lastSerial; s++) {
      trayStart ??= s;
      if (!rejected.has(s)) filled++;
      if (filled === line.trayCapacity) {
        await packTray(run.id, { firstSerial: trayStart, lastSerial: s, packedAt: at.toISOString() }, session, USER, clock);
        trays++;
        trayStart = null;
        filled = 0;
      }
    }
  }
  return { printed, trays, status };
}

