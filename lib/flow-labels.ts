import type { PhasePlanCheck, TransferStatus } from "@/domain/shared/enums";

export const TRANSFER_TONE: Record<TransferStatus, "info" | "success" | "warning" | "critical" | "neutral"> = {
  EN_TRANSIT: "info",
  RECU_CONFORME: "success",
  RECU_AVEC_ECART: "warning",
  LITIGE: "critical",
  ANNULE: "neutral",
};

export const PLAN_CHECK_TONE: Record<PhasePlanCheck, "info" | "success" | "warning" | "critical" | "neutral"> = {
  CONFORME: "success",
  AVANT_PLAN: "warning",
  APRES_PLAN: "warning",
  HORS_PLAN: "critical",
  SANS_PLAN: "neutral",
};

export const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Africa/Casablanca", dateStyle: "short", timeStyle: "short" }) : "—");
export const day = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca" }) : "—");

export const EGG_TYPE_LABEL: Record<string, string> = { BLANC: "Blanc", PISTACHE: "« Pistache »", AUTRE: "Autre" };
export const TABLE_EGG_STATUS_LABEL: Record<string, string> = { EN_STOCK: "En stock", CONDITIONNE: "Conditionné", EXPEDIE: "Expédié", DETRUIT: "Détruit" };
