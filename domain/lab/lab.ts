import { z } from "../../lib/zod";
import { businessDate } from "../shared/dates";
import { DATA_STATUS, type DataStatus } from "../shared/enums";

/**
 * The laboratory (document 3, data sources: "Laboratoire — analyses, résultats, dates de
 * prélèvement"; health and water are "humain + laboratoire"). A sample is taken on something —
 * a flock, eggs, a hatch cycle, a building's water — for a reason, sent to a laboratory, and comes
 * back with one result per analysis. A result is stored as the laboratory wrote it, with its
 * interpretation; an adverse one is put in front of the veterinarian, who says what follows.
 */

export const SAMPLE_OBJECT = ["LOT", "PARENT_FLOCK", "EGG_LOT", "TABLE_EGG_LOT", "HATCH_CYCLE", "BUILDING"] as const;
export type SampleObjectType = (typeof SAMPLE_OBJECT)[number];

export const SAMPLE_OBJECT_LABEL: Record<SampleObjectType, string> = {
  LOT: "Lot",
  PARENT_FLOCK: "Troupeau reproducteur",
  EGG_LOT: "Lot d'œufs à couver",
  TABLE_EGG_LOT: "Collecte d'œufs de consommation",
  HATCH_CYCLE: "Cycle d'incubation",
  BUILDING: "Bâtiment (eau, ambiance)",
};

export const SAMPLE_MATRIX = ["FIENTES", "CHIFFONNETTES", "ECOUVILLON", "SANG", "ORGANES", "EAU", "ALIMENT", "OEUFS", "POUSSIERE", "AUTRE"] as const;
export type SampleMatrix = (typeof SAMPLE_MATRIX)[number];

export const SAMPLE_MATRIX_LABEL: Record<SampleMatrix, string> = {
  FIENTES: "Fientes",
  CHIFFONNETTES: "Chiffonnettes",
  ECOUVILLON: "Écouvillons",
  SANG: "Sang",
  ORGANES: "Organes, cadavres",
  EAU: "Eau",
  ALIMENT: "Aliment",
  OEUFS: "Œufs",
  POUSSIERE: "Poussières, duvets",
  AUTRE: "Autre",
};

export const SAMPLE_REASON = ["SURVEILLANCE", "SUSPICION", "CONTROLE_OFFICIEL", "AUTOCONTROLE"] as const;
export type SampleReason = (typeof SAMPLE_REASON)[number];

export const SAMPLE_REASON_LABEL: Record<SampleReason, string> = {
  SURVEILLANCE: "Surveillance programmée",
  SUSPICION: "Suspicion (signes observés)",
  CONTROLE_OFFICIEL: "Contrôle officiel",
  AUTOCONTROLE: "Autocontrôle",
};

export const SAMPLE_STATUS = ["PRELEVE", "ENVOYE", "RESULTAT_PARTIEL", "RESULTAT"] as const;
export type SampleStatus = (typeof SAMPLE_STATUS)[number];

export const SAMPLE_STATUS_LABEL: Record<SampleStatus, string> = {
  PRELEVE: "Prélevé",
  ENVOYE: "Au laboratoire",
  RESULTAT_PARTIEL: "Résultats partiels",
  RESULTAT: "Résultats reçus",
};

export const RESULT_INTERPRETATION = ["NEGATIF", "POSITIF", "CONFORME", "NON_CONFORME", "A_INTERPRETER"] as const;
export type ResultInterpretation = (typeof RESULT_INTERPRETATION)[number];

export const RESULT_INTERPRETATION_LABEL: Record<ResultInterpretation, string> = {
  NEGATIF: "Négatif",
  POSITIF: "Positif",
  CONFORME: "Conforme",
  NON_CONFORME: "Non conforme",
  A_INTERPRETER: "À interpréter",
};

/** A result that calls for a decision: a pathogen found, a value outside the norm, or one the laboratory left open. */
export function needsDecision(interpretation: ResultInterpretation): boolean {
  return interpretation === "POSITIF" || interpretation === "NON_CONFORME" || interpretation === "A_INTERPRETER";
}

export function isAdverse(interpretation: ResultInterpretation): boolean {
  return interpretation === "POSITIF" || interpretation === "NON_CONFORME";
}

export interface LabSample {
  id: string;
  code: string;
  objectType: SampleObjectType;
  objectId: string;
  matrix: SampleMatrix;
  reason: SampleReason;
  /** The observation that led to the sample, when it follows one. */
  observationId: string | null;
  sampledAt: string;
  sampledBy: string;
  /** Number of samples or pools sent together. */
  sampleCount: number | null;
  laboratory: string;
  sentAt: string | null;
  status: SampleStatus;
  notes: string | null;
  dataStatus: DataStatus;
  createdAt: string;
}

export interface LabResult {
  id: string;
  sampleId: string;
  analyte: string;
  method: string | null;
  /** As the laboratory wrote it: "Non détecté", "0 UFC/100 mL", "Absence dans 25 g". */
  value: string;
  numericValue: number | null;
  unit: string | null;
  interpretation: ResultInterpretation;
  resultAt: string;
  reportRef: string | null;
  recordedBy: string;
  recordedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export type NewLabSample = Omit<LabSample, "id" | "createdAt">;
export type NewLabResult = Omit<LabResult, "id" | "recordedAt" | "reviewedBy" | "reviewedAt" | "reviewNote">;

export interface LabRepository {
  findSample(id: string): Promise<LabSample | null>;
  listSamples(): Promise<LabSample[]>;
  listSamplesFor(objectType: SampleObjectType, objectIds: string[]): Promise<LabSample[]>;
  countSamplesInYear(year: number): Promise<number>;
  createSample(input: NewLabSample): Promise<LabSample>;
  /** Moves a sample from one status to another; null when it was no longer in `from`. */
  setSampleStatus(id: string, from: SampleStatus, changes: Partial<Pick<LabSample, "status" | "sentAt" | "laboratory">>): Promise<LabSample | null>;
  listResults(sampleIds: string[]): Promise<LabResult[]>;
  findResult(id: string): Promise<LabResult | null>;
  createResult(input: NewLabResult & { recordedAt: string }): Promise<LabResult>;
  /** Compare-and-set: only a result not yet reviewed can be reviewed. */
  reviewResult(id: string, input: { reviewedBy: string; reviewedAt: string; reviewNote: string }): Promise<LabResult | null>;
}

// ---------------------------------------------------------------------------
// What people enter
// ---------------------------------------------------------------------------

export const createSampleSchema = z.object({
  objectType: z.enum(SAMPLE_OBJECT),
  objectId: z.string().min(1, "Choisissez ce qui a été prélevé."),
  matrix: z.enum(SAMPLE_MATRIX),
  reason: z.enum(SAMPLE_REASON),
  observationId: z.string().min(1).optional().nullable(),
  sampledAt: businessDate("Prélèvement"),
  sampleCount: z.number().int().min(1).max(500).optional().nullable(),
  laboratory: z.string().trim().min(3, "Laboratoire destinataire requis.").max(160),
  notes: z.string().trim().max(1000).optional().nullable(),
  dataStatus: z.enum(DATA_STATUS).default("REEL"),
});

export const markSentSchema = z.object({
  sampleId: z.string().min(1),
  sentAt: businessDate("Envoi"),
});

export const resultSchema = z.object({
  analyte: z.string().trim().min(2, "Analyse requise (ex. Salmonella spp.).").max(160),
  method: z.string().trim().max(160).optional().nullable(),
  value: z.string().trim().min(1, "Résultat requis, tel que le laboratoire l'a écrit.").max(200),
  numericValue: z.number().finite().optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  interpretation: z.enum(RESULT_INTERPRETATION),
  resultAt: businessDate("Résultat"),
  reportRef: z.string().trim().max(120).optional().nullable(),
});

export const recordResultsSchema = z.object({
  sampleId: z.string().min(1),
  results: z.array(resultSchema).min(1, "Au moins un résultat.").max(50),
  /** True when the laboratory's report is complete: the sample then reads "Résultats reçus". */
  complete: z.boolean(),
});

/** An adverse or open result is reviewed with what follows from it; a favourable one may be acknowledged without a note. */
export const reviewResultSchema = z.object({
  resultId: z.string().min(1),
  note: z.string().trim().max(1000).optional().nullable(),
});
