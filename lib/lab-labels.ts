import type { ResultInterpretation, SampleStatus } from "@/domain/lab/lab";

export const INTERPRETATION_TONE: Record<ResultInterpretation, "success" | "critical" | "warning"> = {
  NEGATIF: "success",
  CONFORME: "success",
  POSITIF: "critical",
  NON_CONFORME: "critical",
  A_INTERPRETER: "warning",
};

export const SAMPLE_STATUS_TONE: Record<SampleStatus, "neutral" | "info" | "warning" | "success"> = {
  PRELEVE: "neutral",
  ENVOYE: "info",
  RESULTAT_PARTIEL: "warning",
  RESULTAT: "success",
};
