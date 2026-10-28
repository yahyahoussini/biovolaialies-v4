import { z } from "../../lib/zod";
import { businessDate } from "../shared/dates";
import { SANITARY_STATUS, type SanitaryStatus } from "../shared/enums";

/**
 * The health domain of document 3 (ch. 02, "Santé : traitements, vaccinations, observations"):
 * what was given to a lot, how, and until when its meat and eggs stay out of the food chain.
 * Pure rules; services/sanitary owns reads and writes.
 */

export const ADMIN_ROUTE = ["EAU_DE_BOISSON", "ALIMENT", "NEBULISATION", "INJECTION", "OCULAIRE_NASALE", "TREMPAGE_BEC", "AUTRE"] as const;
export type AdminRoute = (typeof ADMIN_ROUTE)[number];

export const ADMIN_ROUTE_LABEL: Record<AdminRoute, string> = {
  EAU_DE_BOISSON: "Eau de boisson",
  ALIMENT: "Aliment",
  NEBULISATION: "Nébulisation",
  INJECTION: "Injection",
  OCULAIRE_NASALE: "Goutte oculaire ou nasale",
  TREMPAGE_BEC: "Trempage du bec",
  AUTRE: "Autre",
};

export const SANITARY_STATUS_LABEL: Record<SanitaryStatus, string> = {
  NORMAL: "Normal",
  SURVEILLANCE: "Sous surveillance",
  ALERTE: "Alerte sanitaire",
};

const text = (label: string, min: number, max: number) =>
  z.string().trim().min(min, `${label} : ${min} caractères au moins.`).max(max, `${label} : ${max} caractères au plus.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optionalCount = z.number().int().positive().optional().nullable().transform((v) => v ?? null);

export const vaccinationSchema = z.object({
  vaccine: text("Vaccin", 2, 120),
  disease: text("Maladie visée", 2, 120),
  batchNumber: optionalText(60),
  route: z.enum(ADMIN_ROUTE),
  dose: optionalText(60),
  headcount: optionalCount,
  administeredAt: businessDate("Vaccination"),
  operator: optionalText(120),
  notes: optionalText(500),
});
export type Vaccination = z.output<typeof vaccinationSchema>;

export const treatmentSchema = z.object({
  product: text("Médicament", 2, 120),
  activeSubstance: optionalText(120),
  indication: text("Motif du traitement", 2, 200),
  prescriptionRef: optionalText(80),
  prescriber: optionalText(120),
  route: z.enum(ADMIN_ROUTE),
  dose: optionalText(80),
  startedAt: businessDate("Début du traitement"),
  durationDays: z.number().int().min(1, "La durée du traitement est d'au moins un jour.").max(60, "Durée de traitement au-delà de 60 jours : vérifiez la saisie."),
  /** Délai d'attente viande, in days after the last administration. 0 is a real answer, not a default. */
  withdrawalMeatDays: z.number().int().min(0).max(365),
  /** Délai d'attente œufs. Null on a meat lot; required on layers and breeders (see treatmentError). */
  withdrawalEggDays: z.number().int().min(0).max(365).optional().nullable().transform((v) => v ?? null),
  headcount: optionalCount,
  notes: optionalText(500),
});
export type Treatment = z.output<typeof treatmentSchema>;

export const observationSchema = z.object({
  status: z.enum(SANITARY_STATUS),
  signs: text("Signes observés", 2, 500),
  affectedCount: z.number().int().nonnegative().optional().nullable().transform((v) => v ?? null),
  observedAt: businessDate("Observation"),
});
export type Observation = z.output<typeof observationSchema>;

/** Rules that depend on the lot, not on the form alone. */
export function treatmentError(treatment: Treatment, lot: { purpose?: string | null }): string | null {
  const laying = lot.purpose === "PONTE" || lot.purpose === "REPRODUCTION";
  if (laying && treatment.withdrawalEggDays === null) {
    return "Lot de pondeuses ou de reproducteurs : indiquez le délai d'attente œufs (0 s'il n'y en a pas).";
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Last day of administration, then the withdrawal period counted from the end of the treatment. */
export function treatmentEndsAt(treatment: Pick<Treatment, "startedAt" | "durationDays">): string {
  return new Date(Date.parse(treatment.startedAt) + treatment.durationDays * DAY_MS).toISOString();
}

export function meatClearAt(treatment: Pick<Treatment, "startedAt" | "durationDays" | "withdrawalMeatDays">): string {
  return new Date(Date.parse(treatmentEndsAt(treatment)) + treatment.withdrawalMeatDays * DAY_MS).toISOString();
}

export function eggClearAt(treatment: Pick<Treatment, "startedAt" | "durationDays" | "withdrawalEggDays">): string | null {
  if (treatment.withdrawalEggDays === null) return null;
  return new Date(Date.parse(treatmentEndsAt(treatment)) + treatment.withdrawalEggDays * DAY_MS).toISOString();
}

export interface RecordedTreatment {
  eventId: string;
  treatment: Treatment;
}

export interface Withdrawal {
  eventId: string;
  product: string;
  from: string;
  until: string;
}

/**
 * Treatments whose withdrawal window covers `at` — the treatment started on or before `at` and
 * the product is not cleared yet. A treatment recorded after the fact still counts for the dates
 * it covers: a slaughter or a collection inside its window is caught whenever it is entered.
 */
export function activeWithdrawals(treatments: RecordedTreatment[], at: string, kind: "meat" | "eggs"): Withdrawal[] {
  const t = Date.parse(at);
  const out: Withdrawal[] = [];
  for (const { eventId, treatment } of treatments) {
    const until = kind === "meat" ? meatClearAt(treatment) : eggClearAt(treatment);
    if (until === null) continue;
    if (Date.parse(treatment.startedAt) <= t && t < Date.parse(until)) {
      out.push({ eventId, product: treatment.product, from: treatment.startedAt, until });
    }
  }
  return out.sort((a, b) => b.until.localeCompare(a.until));
}

/** The calendar day of an instant on the farm (Morocco), as YYYY-MM-DD. */
export function farmDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Casablanca" });
}

/**
 * Egg withdrawals covering a collection day. Collections carry a day, not an hour, so the
 * check is by day and errs on the safe side: the first and the last day of the window count.
 */
export function eggWithdrawalsOnDay(treatments: RecordedTreatment[], day: string): Withdrawal[] {
  const out: Withdrawal[] = [];
  for (const { eventId, treatment } of treatments) {
    const until = eggClearAt(treatment);
    if (until === null) continue;
    if (farmDay(treatment.startedAt) <= day && day <= farmDay(until)) {
      out.push({ eventId, product: treatment.product, from: treatment.startedAt, until });
    }
  }
  return out.sort((a, b) => b.until.localeCompare(a.until));
}

export function withdrawalMessage(withdrawals: Withdrawal[], kind: "meat" | "eggs"): string | null {
  const longest = withdrawals[0];
  if (!longest) return null;
  const what = kind === "meat" ? "viande" : "œufs";
  const until = new Date(longest.until).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca" });
  return `Délai d'attente ${what} en cours jusqu'au ${until} (traitement : ${longest.product}).`;
}
