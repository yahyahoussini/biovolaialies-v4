import { z } from "../../lib/zod";

/**
 * The field app (document 3, ch. 05): entries made on a phone without network, queued, sent back
 * in order, applied once. Pure rules and shapes; services/field owns the writes, app/terrain the
 * phone. "On ne détruit jamais une saisie humaine": every entry that reaches the server is kept,
 * applied, flagged or refused with its reason — none is overwritten or dropped.
 */

export const FIELD_KIND = ["MORTALITE", "PESEE", "ALIMENT", "EAU", "VACCINATION", "TRAITEMENT", "OBSERVATION", "RECEPTION"] as const;
export type FieldKind = (typeof FIELD_KIND)[number];

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  MORTALITE: "Mortalité du jour",
  PESEE: "Pesée",
  ALIMENT: "Aliment distribué",
  EAU: "Eau consommée",
  VACCINATION: "Vaccination",
  TRAITEMENT: "Traitement",
  OBSERVATION: "Observation sanitaire",
  RECEPTION: "Réception d'un transfert",
};

/**
 * APPLIQUEE: written to the lot's records. CONFIRMEE: repeats the value already recorded for that
 * day, nothing to add. EN_ECART: kept, shown, not applied — a manager decides. REFUSEE: kept with
 * the reason the server gave; the phone shows it to its author.
 */
export const FIELD_STATUS = ["APPLIQUEE", "CONFIRMEE", "EN_ECART", "REFUSEE"] as const;
export type FieldStatus = (typeof FIELD_STATUS)[number];

export const FIELD_STATUS_LABEL: Record<FieldStatus, string> = {
  APPLIQUEE: "Enregistrée",
  CONFIRMEE: "Confirme le chiffre du jour",
  EN_ECART: "Écart signalé",
  REFUSEE: "Refusée",
};

export const DISCREPANCY_STATUS = ["OUVERT", "RESOLU"] as const;
export type DiscrepancyStatus = (typeof DISCREPANCY_STATUS)[number];

/** A sync request carries at most this many entries; the phone sends the rest in the next one. */
export const FIELD_BATCH_MAX = 100;
/** A phone clock this far ahead of the server is wrong, not early: the entry is refused, not re-dated. */
export const CLOCK_AHEAD_TOLERANCE_MS = 10 * 60 * 1000;
/** How long after the day a manager may still arbitrate its mortality (annex: "jusqu'à quand"). Client decision pending. */
export const CORRECTION_WINDOW_DAYS = 30;

export const fieldOpSchema = z.object({
  opId: z.uuid(),
  deviceId: z.string().trim().min(8).max(64),
  seq: z.number().int().positive(),
  authorId: z.string().min(1),
  kind: z.enum(FIELD_KIND),
  lotId: z.string().min(1).nullable().optional(),
  transferId: z.string().min(1).nullable().optional(),
  capturedAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});
export type FieldOp = z.infer<typeof fieldOpSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const mortalityPayload = z.object({ count: z.number().int().positive("Le nombre de morts est positif."), cause: optionalText(200) });
export const weighingPayload = z.object({
  averageWeightKg: z.number().positive().max(15, "Poids moyen au-delà de 15 kg : vérifiez l'unité."),
  sampleCount: z.number().int().positive().optional().nullable().transform((v) => v ?? null),
});
export const feedPayload = z.object({ quantityKg: z.number().positive(), feedType: z.string().trim().min(1).max(100) });
export const waterPayload = z.object({ quantityL: z.number().positive() });
export const receptionPayload = z.object({
  quantityReceived: z.number().int().nonnegative(),
  deadOnArrival: z.number().int().nonnegative(),
  discrepancyReason: optionalText(500),
  signerName: z.string().trim().min(2),
});

// ---------------------------------------------------------------------------
// Daily mortality: the conflict rule of document 3, ch. 05
// ---------------------------------------------------------------------------

/** One person's count of the day's dead birds on one lot. */
export interface Declaration {
  authorId: string;
  count: number;
  capturedAt: string;
}

export interface MortalityDecision {
  status: Extract<FieldStatus, "APPLIQUEE" | "CONFIRMEE" | "EN_ECART">;
  /** Birds to add to the lot's mortality now (0 when nothing changes until a manager decides). */
  apply: number;
  reason: string | null;
}

/**
 * Document 3, ch. 05: "Qui gagne quand deux personnes déclarent une mortalité différente sur le
 * même lot, le même jour ? … les deux saisies sont conservées, la plus récente s'affiche, et
 * l'écart est signalé." Applied here, with the population as the stake:
 *
 * - the first declaration of the day is applied;
 * - a later declaration by the same person, higher than what is recorded, updates the day's total
 *   (only the difference is added);
 * - the same number again confirms it;
 * - anything else — another person's different number, a lower number, a late-arriving older
 *   declaration that disagrees — is kept and flagged, and the population waits for a manager.
 *   The system never gives birds back on its own.
 */
export function decideDailyMortality(prior: Declaration[], incoming: Declaration, applied: number): MortalityDecision {
  if (prior.length === 0) return { status: "APPLIQUEE", apply: incoming.count, reason: null };
  const latest = prior.reduce((a, b) => (b.capturedAt >= a.capturedAt ? b : a));
  const isMostRecent = incoming.capturedAt > latest.capturedAt;

  if (!isMostRecent) {
    if (incoming.count === latest.count) return { status: "CONFIRMEE", apply: 0, reason: null };
    return {
      status: "EN_ECART",
      apply: 0,
      reason: `Déclaration de ${incoming.count} saisie avant la dernière (${latest.count}) mais arrivée après : écart à arbitrer.`,
    };
  }
  if (incoming.count === applied) return { status: "CONFIRMEE", apply: 0, reason: null };
  const sameAuthorOnly = prior.every((d) => d.authorId === incoming.authorId);
  if (incoming.count > applied && sameAuthorOnly) return { status: "APPLIQUEE", apply: incoming.count - applied, reason: null };
  if (incoming.count < applied) {
    return {
      status: "EN_ECART",
      apply: 0,
      reason: `La dernière déclaration (${incoming.count}) est inférieure à la mortalité déjà enregistrée ce jour (${applied}) : correction à arbitrer.`,
    };
  }
  return {
    status: "EN_ECART",
    apply: 0,
    reason: `Deux personnes déclarent une mortalité différente ce jour (${applied} enregistrés, ${incoming.count} déclarés) : écart à arbitrer.`,
  };
}

/** The value shown for the day: the most recent declaration, whatever was applied. */
export function displayedDeclaration(declarations: Declaration[]): Declaration | null {
  if (declarations.length === 0) return null;
  return declarations.reduce((a, b) => (b.capturedAt >= a.capturedAt ? b : a));
}

export function mortalityDayKey(lotId: string, day: string): string {
  return `${lotId}:${day}`;
}

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

export interface FieldEntry {
  id: string;
  opId: string;
  deviceId: string;
  deviceSeq: number;
  authorId: string;
  kind: FieldKind;
  lotId: string | null;
  transferId: string | null;
  payload: Record<string, unknown>;
  capturedAt: string;
  receivedAt: string;
  status: FieldStatus;
  message: string | null;
  resultType: string | null;
  resultId: string | null;
  dayKey: string | null;
  appliedCount: number;
  createdAt: string;
}
export type NewFieldEntry = Omit<FieldEntry, "id" | "createdAt">;

export interface FieldDiscrepancy {
  id: string;
  dayKey: string;
  lotId: string;
  day: string;
  status: DiscrepancyStatus;
  reason: string;
  openedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolvedCount: number | null;
  resolutionNote: string | null;
}

export interface FieldEntryRepository {
  findByOpId(opId: string): Promise<FieldEntry | null>;
  findByDeviceSeq(deviceId: string, seq: number): Promise<FieldEntry | null>;
  create(input: NewFieldEntry): Promise<FieldEntry>;
  listByDayKey(dayKey: string): Promise<FieldEntry[]>;
  listRecent(limit: number): Promise<FieldEntry[]>;
  listByAuthor(authorId: string, limit: number): Promise<FieldEntry[]>;
}

export interface FieldDiscrepancyRepository {
  findById(id: string): Promise<FieldDiscrepancy | null>;
  findByDayKey(dayKey: string): Promise<FieldDiscrepancy | null>;
  /** Opens the day's discrepancy, or reopens it with the new reason if it had been resolved. */
  open(input: { dayKey: string; lotId: string; day: string; reason: string; openedAt: string }): Promise<FieldDiscrepancy>;
  /** Compare-and-set on OUVERT. */
  resolve(id: string, input: { resolvedBy: string; resolvedAt: string; resolvedCount: number; resolutionNote: string }): Promise<FieldDiscrepancy | null>;
  list(): Promise<FieldDiscrepancy[]>;
}
