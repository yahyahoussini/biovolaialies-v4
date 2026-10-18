import type { LeadActivity, LeadStatus } from "../domain/shared/enums";
import type { BadgeTone } from "./status-colors";

export const LEAD_ACTIVITY_LABEL: Record<LeadActivity, string> = {
  COUVOIR: "Couvoir",
  ELEVAGE: "Élevage avicole",
  ALIMENT: "Fabrication d'aliments",
  ABATTAGE: "Abattage",
  DECOUPE_TRANSFORMATION: "Découpe / transformation",
  OPERATEUR_INTEGRE: "Opérateur intégré",
  AUTRE: "Autre",
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NOUVEAU: "Nouveau",
  EN_QUALIFICATION: "En qualification",
  RDV_PLANIFIE: "Rendez-vous planifié",
  PROPOSITION: "Proposition envoyée",
  GAGNE: "Gagné",
  PERDU: "Perdu",
};

export const LEAD_STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  NOUVEAU: "info",
  EN_QUALIFICATION: "warning",
  RDV_PLANIFIE: "warning",
  PROPOSITION: "gold",
  GAGNE: "success",
  PERDU: "neutral",
};
