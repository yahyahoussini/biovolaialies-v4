import type { QualityCaseStatus, QualityHoldScope, QualityReason } from "../domain/shared/enums";
import type { BadgeTone } from "./status-colors";

export const QUALITY_REASON_LABEL: Record<QualityReason, string> = {
  SUSPICION_SANITAIRE: "Suspicion sanitaire",
  RESULTAT_LABORATOIRE: "Résultat de laboratoire",
  TEMPERATURE_HORS_LIMITE: "Température hors limite",
  ECART_TRACABILITE: "Écart de traçabilité",
  ECART_QUANTITE: "Écart de quantité",
  RECLAMATION_CLIENT: "Réclamation client",
  INSTRUMENT_HORS_VALIDITE: "Instrument hors validité",
  AUTRE: "Autre",
};

export const QUALITY_STATUS_LABEL: Record<QualityCaseStatus, string> = {
  EN_BLOCAGE: "En blocage",
  LIBERE: "Libéré",
  NON_CONFORME: "Non-conformité confirmée",
};

export const QUALITY_STATUS_TONE: Record<QualityCaseStatus, BadgeTone> = {
  EN_BLOCAGE: "critical",
  LIBERE: "success",
  NON_CONFORME: "warning",
};

export const QUALITY_SCOPE_LABEL: Record<QualityHoldScope, string> = {
  OBJET_SEUL: "Objet seul",
  DESCENDANTS: "Objet et tous ses dérivés",
};
