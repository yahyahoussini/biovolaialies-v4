import { z } from "../../lib/zod";

/**
 * The egg-marking line (document 2, ch. 08; document 3, lot 15): it prints a short code on each
 * shell, a camera reads it back, and the software ties every printed code to its lot and its tray.
 * Two routes (document 2, "deux voies, deux logiques"): hatching eggs marked at collection, to know
 * which egg was rejected at candling and how long it stayed in the egg room; table eggs marked
 * after grading, so the proof of origin travels on the egg to the consumer.
 *
 * Pure rules. The codes are sequential, so the database keeps ranges and the exceptions — never one
 * row per egg (30 000 eggs an hour would be ten million rows a year for nothing).
 */

export const MARKING_ROUTE = ["A_COUVER", "B_CONSOMMATION"] as const;
export type MarkingRoute = (typeof MARKING_ROUTE)[number];

export const MARKING_ROUTE_LABEL: Record<MarkingRoute, string> = {
  A_COUVER: "Voie A — œuf à couver, marqué au ramassage",
  B_CONSOMMATION: "Voie B — œuf de consommation, marqué après calibrage",
};

export const MARKING_RUN_STATUS = ["EN_COURS", "ARRET_LECTURE", "CLOS"] as const;
export type MarkingRunStatus = (typeof MARKING_RUN_STATUS)[number];

export const MARKING_RUN_STATUS_LABEL: Record<MarkingRunStatus, string> = {
  EN_COURS: "En cours",
  ARRET_LECTURE: "Arrêt : contrôle de lecture en défaut",
  CLOS: "Clos",
};

/** ILLISIBLE: the camera could not read the code back, the egg went to the reject exit. REBUT_MIRAGE: a hatching egg removed at candling. */
export const EGG_EXCEPTION = ["ILLISIBLE", "REBUT_MIRAGE"] as const;
export type EggExceptionKind = (typeof EGG_EXCEPTION)[number];

export const MARKING_SOURCE = ["TABLE_EGG_LOT", "EGG_LOT"] as const;
export type MarkingSourceType = (typeof MARKING_SOURCE)[number];

/** Route B marks table eggs (graded collections), route A hatching eggs (egg lots of a parent flock). */
export const SOURCE_OF_ROUTE: Record<MarkingRoute, MarkingSourceType> = { A_COUVER: "EGG_LOT", B_CONSOMMATION: "TABLE_EGG_LOT" };

/** Why the line controller gets no codes: each reason is a distinct answer the machine acts on. */
export const MARKING_REFUSAL = ["RUN_CLOSED", "READ_STOP", "SOURCE_BLOCKED", "SERIALS_EXHAUSTED"] as const;
export type MarkingRefusalCode = (typeof MARKING_REFUSAL)[number];

/** Largest block of codes one request may draw, largest batch of reads one report may carry. */
export const MAX_BLOCK = 5000;
export const MAX_BATCH = 5000;
/** A tray, a box or an alvéole: 6 to 30 eggs in practice; 360 is a full stack of twelve 30-egg trays. */
export const MAX_TRAY_CAPACITY = 360;
/** The camera's clock may run a little ahead of ours; past this, a read reported "in the future" is refused. */
export const READ_CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// The code on the shell
// ---------------------------------------------------------------------------

/**
 * Crockford base 32: no I, L, O or U — nothing a smudge or a tired eye turns into another
 * character. Document 2: "code court alphanumérique, 8 à 10 caractères, lisible à l'œil et à la
 * caméra". Ours: two characters for the line, six for the serial, one check character = 9.
 */
export const SHELL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHELL_PREFIX_LENGTH = 2;
export const SHELL_SERIAL_LENGTH = 6;
export const SHELL_CODE_LENGTH = SHELL_PREFIX_LENGTH + SHELL_SERIAL_LENGTH + 1;
export const MAX_SERIAL = 32 ** SHELL_SERIAL_LENGTH - 1;

const value = (c: string) => SHELL_ALPHABET.indexOf(c);

/** Luhn mod 32 over the alphabet: catches every single wrong character and almost every swap of neighbours. */
export function shellCheck(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * value(body[i]);
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
    factor = factor === 2 ? 1 : 2;
  }
  return SHELL_ALPHABET[(32 - (sum % 32)) % 32];
}

export function isValidPrefix(prefix: string): boolean {
  return prefix.length === SHELL_PREFIX_LENGTH && [...prefix].every((c) => value(c) >= 0);
}

export function encodeSerial(serial: number): string {
  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_SERIAL) throw new RangeError(`Numéro hors plage : ${serial}`);
  let out = "";
  let n = serial;
  for (let i = 0; i < SHELL_SERIAL_LENGTH; i++) {
    out = SHELL_ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

export function shellCode(prefix: string, serial: number): string {
  const body = prefix + encodeSerial(serial);
  return body + shellCheck(body);
}

/**
 * Reads a code as a person types it: case, spaces and dashes ignored, and the letters Crockford
 * maps to digits (O → 0, I and L → 1) accepted — the egg says the same thing either way.
 */
export function normalizeShellCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function parseShellCode(raw: string): { prefix: string; serial: number; valid: boolean; code: string } | null {
  const code = normalizeShellCode(raw);
  if (code.length !== SHELL_CODE_LENGTH || [...code].some((c) => value(c) < 0)) return null;
  const prefix = code.slice(0, SHELL_PREFIX_LENGTH);
  const serialPart = code.slice(SHELL_PREFIX_LENGTH, SHELL_PREFIX_LENGTH + SHELL_SERIAL_LENGTH);
  const serial = [...serialPart].reduce((n, c) => n * 32 + value(c), 0);
  return { prefix, serial, valid: shellCheck(code.slice(0, -1)) === code[code.length - 1], code };
}

// ---------------------------------------------------------------------------
// The read-back control (document 2, ch. 08, station 5)
// ---------------------------------------------------------------------------

/**
 * "Sans lui, une tête encrassée imprime des centaines de codes illisibles avant que quiconque s'en
 * aperçoive." Over the last `window` eggs read back, the share read correctly must stay at or above
 * the threshold; below it, the line stops receiving codes until someone cleans the head and says so.
 * Batches come oldest first, as the camera reported them; whole batches are counted, so the window
 * may run slightly past `window` eggs.
 */
export function readGuard(batches: { ok: number; ko: number }[], threshold: number, window: number): { ok: boolean; rate: number | null; considered: number } {
  let read = 0;
  let considered = 0;
  for (let i = batches.length - 1; i >= 0 && considered < window; i--) {
    read += batches[i].ok;
    considered += batches[i].ok + batches[i].ko;
  }
  const rate = considered ? read / considered : null;
  // Too few eggs to judge: a single smudge on the first ten must not stop a line.
  if (rate === null || considered < Math.min(window, 50)) return { ok: true, rate, considered };
  return { ok: rate >= threshold, rate, considered };
}

// ---------------------------------------------------------------------------
// Trays (plateau or alvéole): a run of consecutive codes, minus the eggs the camera rejected
// ---------------------------------------------------------------------------

export interface SerialRange {
  firstSerial: number;
  lastSerial: number;
}

/** Eggs in a tray: every serial of its range except those diverted at the reject exit. */
export function eggsInRange(range: SerialRange, rejected: number[]): number {
  const inside = new Set(rejected.filter((s) => s >= range.firstSerial && s <= range.lastSerial));
  return range.lastSerial - range.firstSerial + 1 - inside.size;
}

/** True when the reported read batches cover every serial of the range, with no gap. */
export function isCovered(range: SerialRange, batches: SerialRange[]): boolean {
  let cursor = range.firstSerial;
  for (const b of [...batches].sort((x, y) => x.firstSerial - y.firstSerial)) {
    if (b.firstSerial > cursor) break;
    if (b.lastSerial >= cursor) cursor = b.lastSerial + 1;
    if (cursor > range.lastSerial) return true;
  }
  return cursor > range.lastSerial;
}

/**
 * A tray holds consecutive codes that were printed and read back by this run (`printed`: the read
 * batches touching the range), none of them already in another tray, and no more eggs than it holds
 * once the eggs sent to the reject exit are taken out.
 */
export function trayError(tray: SerialRange & { capacity: number }, printed: SerialRange[], existing: SerialRange[], rejected: number[]): string | null {
  if (tray.lastSerial < tray.firstSerial) return "La fin de la plage précède son début.";
  if (!isCovered(tray, printed)) return "Ces codes n'ont pas été imprimés et relus par cette campagne.";
  if (existing.some((t) => tray.firstSerial <= t.lastSerial && t.firstSerial <= tray.lastSerial)) return "Une partie de ces codes est déjà dans un autre plateau.";
  const eggs = eggsInRange(tray, rejected);
  if (eggs === 0) return "Aucun œuf relu dans cette plage : rien à conditionner.";
  if (eggs > tray.capacity) return `${eggs} œufs relus pour un plateau de ${tray.capacity} : plage trop longue.`;
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Route A: days a hatching egg stayed between collection (when it was marked) and setting. */
export function storageDays(markedAt: string, setAt: string): number {
  return Math.max(0, Math.round((Date.parse(setAt) - Date.parse(markedAt)) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A marking machine with its read-back camera, where it stands, and the codes it prints. */
export interface MarkingLine {
  id: string;
  code: string;
  name: string;
  buildingId: string;
  /** The routes this machine serves — the owner's decision (document 3, annex): A, B, or both. */
  routes: MarkingRoute[];
  shellPrefix: string;
  /** Next serial to hand out; serials are never reused, whatever happens to a run. */
  nextSerial: number;
  readThreshold: number;
  readWindow: number;
  trayCapacity: number;
  /** How the printer and the camera talk to the line controller — unknown until the supplier documents it (document 2). */
  protocol: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** One sitting of the line on one source: a day's graded collection (route B) or an egg lot (route A). */
export interface MarkingRun {
  id: string;
  code: string;
  lineId: string;
  route: MarkingRoute;
  sourceType: MarkingSourceType;
  sourceId: string;
  status: MarkingRunStatus;
  startedAt: string;
  startedBy: string;
  endedAt: string | null;
  endedBy: string | null;
  /** Serial range handed out to this run, null until its first block. */
  firstSerial: number | null;
  lastSerial: number | null;
  allocated: number;
  printed: number;
  readOk: number;
  readKo: number;
  /** The guard judges only eggs read after this instant: a lifted stop starts a fresh window. */
  guardSince: string;
  notes: string | null;
  closeNote: string | null;
  createdAt: string;
}

/** Codes handed to the line controller in one request; its reference makes a retried request harmless. */
export interface CodeBlock extends SerialRange {
  id: string;
  lineId: string;
  runId: string;
  requestRef: string;
  allocatedAt: string;
  requestedBy: string;
}

/** Eggs printed and read back, as the camera reported them: a range, and the serials it could not read. */
export interface ReadBatch extends SerialRange {
  id: string;
  runId: string;
  batchRef: string;
  readAt: string;
  ok: number;
  ko: number;
  receivedAt: string;
  reportedBy: string;
}

export interface EggReadException {
  id: string;
  runId: string;
  serial: number;
  kind: EggExceptionKind;
  at: string;
  recordedBy: string | null;
  hatchCycleId: string | null;
  note: string | null;
}

export interface EggTray extends SerialRange {
  id: string;
  runId: string;
  trayRef: string | null;
  capacity: number;
  eggCount: number;
  packedAt: string;
  packedBy: string;
  createdAt: string;
}

/** The guard stopping the line, and the person who restarted it and what they did. */
export interface ReadStop {
  id: string;
  runId: string;
  stoppedAt: string;
  rate: number;
  considered: number;
  liftedAt: string | null;
  liftedBy: string | null;
  liftNote: string | null;
}

export type NewMarkingLine = Omit<MarkingLine, "id" | "createdAt" | "updatedAt" | "updatedBy" | "nextSerial">;
export type NewMarkingRun = Omit<MarkingRun, "id" | "createdAt" | "endedAt" | "endedBy" | "firstSerial" | "lastSerial" | "allocated" | "printed" | "readOk" | "readKo" | "closeNote">;

export interface MarkingRepository {
  listLines(): Promise<MarkingLine[]>;
  findLine(id: string): Promise<MarkingLine | null>;
  findLineByCode(code: string): Promise<MarkingLine | null>;
  findLineByPrefix(prefix: string): Promise<MarkingLine | null>;
  createLine(input: NewMarkingLine): Promise<MarkingLine>;
  updateLine(id: string, changes: Partial<Pick<MarkingLine, "name" | "routes" | "readThreshold" | "readWindow" | "trayCapacity" | "protocol" | "active" | "updatedAt" | "updatedBy">>): Promise<MarkingLine>;
  /** Compare-and-set on the line's next serial: null when another request moved it first. */
  advanceSerial(lineId: string, expectedNext: number, count: number): Promise<MarkingLine | null>;

  listRuns(): Promise<MarkingRun[]>;
  listRunsByLine(lineId: string): Promise<MarkingRun[]>;
  listRunsBySource(sourceType: MarkingSourceType, sourceIds: string[]): Promise<MarkingRun[]>;
  findRun(id: string): Promise<MarkingRun | null>;
  findOpenRun(lineId: string): Promise<MarkingRun | null>;
  findRunBySerial(lineId: string, serial: number): Promise<MarkingRun | null>;
  countRunsOn(lineId: string, dayPrefix: string): Promise<number>;
  createRun(input: NewMarkingRun): Promise<MarkingRun>;
  /** Moves a run from one status to another; null when it was no longer in `from`. */
  setRunStatus(id: string, from: MarkingRunStatus, changes: Partial<Pick<MarkingRun, "status" | "endedAt" | "endedBy" | "guardSince" | "closeNote">>): Promise<MarkingRun | null>;
  addAllocation(id: string, block: SerialRange): Promise<void>;
  addReads(id: string, ok: number, ko: number): Promise<void>;

  findBlockByRef(runId: string, requestRef: string): Promise<CodeBlock | null>;
  createBlock(input: Omit<CodeBlock, "id">): Promise<CodeBlock>;

  findBatchByRef(runId: string, batchRef: string): Promise<ReadBatch | null>;
  listBatchesOverlapping(runId: string, range: SerialRange): Promise<ReadBatch[]>;
  /** The most recent batches read since `since`, newest first. */
  listRecentBatches(runId: string, since: string, limit: number): Promise<ReadBatch[]>;
  listBatchesByRuns(runIds: string[]): Promise<ReadBatch[]>;
  sumReadsSince(since: string): Promise<{ ok: number; ko: number }>;
  createBatch(input: Omit<ReadBatch, "id">): Promise<ReadBatch>;

  /** Inserts the exceptions not already recorded; returns how many were new. */
  addExceptions(rows: Omit<EggReadException, "id">[]): Promise<number>;
  listExceptions(runId: string, kind: EggExceptionKind | null, limit: number): Promise<EggReadException[]>;
  listExceptionsInRange(runId: string, range: SerialRange, kind: EggExceptionKind): Promise<EggReadException[]>;
  listExceptionsForSerial(runId: string, serial: number): Promise<EggReadException[]>;
  listExceptionsByCycle(hatchCycleId: string): Promise<EggReadException[]>;

  findTrayByRef(runId: string, trayRef: string): Promise<EggTray | null>;
  findTray(id: string): Promise<EggTray | null>;
  listTraysOverlapping(runId: string, range: SerialRange): Promise<EggTray[]>;
  listTrays(runId: string, limit: number): Promise<EggTray[]>;
  countTrays(runId: string): Promise<{ trays: number; eggs: number }>;
  createTray(input: Omit<EggTray, "id" | "createdAt">): Promise<EggTray>;

  findOpenStop(runId: string): Promise<ReadStop | null>;
  listStops(runId: string): Promise<ReadStop[]>;
  createStop(input: Omit<ReadStop, "id" | "liftedAt" | "liftedBy" | "liftNote">): Promise<ReadStop>;
  liftStop(id: string, input: { liftedAt: string; liftedBy: string; liftNote: string }): Promise<ReadStop | null>;
}

// ---------------------------------------------------------------------------
// What people and machines send
// ---------------------------------------------------------------------------

const ref = (label: string) => z.string().trim().min(8, `${label} : 8 caractères au moins.`).max(100);
const serial = z.number().int().min(0).max(MAX_SERIAL);

export const createLineSchema = z.object({
  code: z.string().trim().min(3).max(40),
  name: z.string().trim().min(3).max(120),
  buildingId: z.string().min(1),
  routes: z.array(z.enum(MARKING_ROUTE)).min(1, "Choisissez au moins une voie.").max(2),
  shellPrefix: z
    .string()
    .trim()
    .transform((v) => normalizeShellCode(v))
    .refine(isValidPrefix, "Préfixe : deux caractères parmi 0-9 et A-Z sans I, L, O ni U."),
  readThreshold: z.number().min(0.5).max(1),
  readWindow: z.number().int().min(50).max(MAX_BATCH),
  trayCapacity: z.number().int().min(1).max(MAX_TRAY_CAPACITY),
  protocol: z.string().trim().max(200).optional().nullable(),
});

/** Changing what counts as a good read changes what the marking proves: the change is justified. */
export const updateLineSchema = z.object({
  lineId: z.string().min(1),
  readThreshold: z.number().min(0.5).max(1),
  readWindow: z.number().int().min(50).max(MAX_BATCH),
  trayCapacity: z.number().int().min(1).max(MAX_TRAY_CAPACITY),
  protocol: z.string().trim().max(200).optional().nullable(),
  active: z.boolean(),
  reason: z.string().trim().min(10, "Justifiez le changement (10 caractères au moins)."),
});

export const startRunSchema = z.object({
  lineId: z.string().min(1),
  route: z.enum(MARKING_ROUTE),
  sourceId: z.string().min(1, "Choisissez ce que la ligne va marquer."),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const allocateSchema = z.object({
  count: z.number().int().min(1).max(MAX_BLOCK),
  requestRef: ref("Référence de la demande"),
});

export const readBatchSchema = z
  .object({
    batchRef: ref("Référence du lot de lectures"),
    firstSerial: serial,
    lastSerial: serial,
    readAt: z.iso.datetime({ offset: true }),
    failed: z.array(serial).max(MAX_BATCH).default([]),
  })
  .refine((b) => b.lastSerial >= b.firstSerial, "La fin de la plage précède son début.")
  .refine((b) => b.lastSerial - b.firstSerial + 1 <= MAX_BATCH, `${MAX_BATCH} œufs au plus par envoi.`)
  .refine((b) => b.failed.every((s) => s >= b.firstSerial && s <= b.lastSerial), "Un numéro rejeté est hors de la plage envoyée.")
  .refine((b) => new Set(b.failed).size === b.failed.length, "Un numéro rejeté figure deux fois.");

export const traySchema = z.object({
  trayRef: ref("Référence du plateau").optional().nullable(),
  firstSerial: serial,
  lastSerial: serial,
  capacity: z.number().int().min(1).max(MAX_TRAY_CAPACITY).optional().nullable(),
  packedAt: z.iso.datetime({ offset: true }).optional().nullable(),
});

export const liftStopSchema = z.object({
  runId: z.string().min(1),
  note: z.string().trim().min(10, "Dites ce qui a été fait sur la tête et la caméra (10 caractères au moins).").max(500),
});

export const closeRunSchema = z.object({
  runId: z.string().min(1),
  note: z.string().trim().max(500).optional().nullable(),
});

export const candlingRejectsSchema = z.object({
  cycleId: z.string().min(1),
  /** As scanned or typed: one code per line, or separated by spaces or commas. */
  codes: z.string().max(40_000),
});

export function splitCodes(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean))];
}
