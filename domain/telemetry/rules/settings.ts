import type { DecisionRule } from "../catalog";
import type { RuleParams } from "./types";

/**
 * Default parameters of each rule. Every one can be changed from the rules screen, globally or
 * per building, without redeploying (document 3, ch. 1). Each carries where its value comes
 * from, because a threshold with no stated origin is exactly what document 3 warns against.
 */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  default: number | string;
  origin: "CLIENT" | "REGLEMENT_UE" | "HYPOTHESE";
}

const H = "HYPOTHESE" as const;

export const RULE_PARAMS: Record<DecisionRule, ParamSpec[]> = {
  BANDE_APPRISE: [
    { key: "smoothingMinutes", label: "Moyenne glissante jugée", unit: "min", default: 10, origin: H },
    { key: "criticalMarginPct", label: "Dépassement critique (part de la largeur de bande)", unit: "%", default: 50, origin: H },
    { key: "hysteresisPct", label: "Retour à la normale : marge à l'intérieur de la bande", unit: "%", default: 5, origin: H },
  ],
  DERIVE_ENTRE_ZONES: [
    { key: "maxSpreadC", label: "Écart maximal entre zones", unit: "°C", default: 2, origin: H },
    { key: "smoothingMinutes", label: "Moyenne glissante comparée", unit: "min", default: 10, origin: H },
  ],
  CO2_VENTILATION: [
    { key: "highPpm", label: "CO₂ élevé à partir de", unit: "ppm", default: 3000, origin: "REGLEMENT_UE" },
    { key: "fansStoppedPct", label: "Ventilation considérée à l'arrêt sous", unit: "%", default: 5, origin: H },
    { key: "fansFullPct", label: "Ventilation considérée à fond au-dessus de", unit: "%", default: 95, origin: H },
  ],
  NH3_EXPOSITION: [
    { key: "thresholdPpm", label: "Seuil d'ammoniac", unit: "ppm", default: 20, origin: "REGLEMENT_UE" },
    { key: "maxCumulativeMinutes", label: "Exposition cumulée tolérée sur 24 h", unit: "min", default: 120, origin: H },
  ],
  H2S_PRESENCE: [{ key: "presencePpm", label: "Valeur significative à partir de", unit: "ppm", default: 1, origin: H }],
  DEPRESSION_COMMANDE: [
    { key: "fansOnPct", label: "Ventilation en marche à partir de", unit: "%", default: 30, origin: H },
    { key: "minPa", label: "Dépression minimale attendue ventilation en marche", unit: "Pa", default: 5, origin: H },
    { key: "maxPa", label: "Dépression maximale admise", unit: "Pa", default: 50, origin: H },
  ],
  LUMIERE_PROGRAMME: [
    { key: "onTime", label: "Allumage programmé (heure locale)", unit: "hh:mm", default: "06:00", origin: H },
    { key: "offTime", label: "Extinction programmée (heure locale)", unit: "hh:mm", default: "20:00", origin: H },
    { key: "utcOffsetMinutes", label: "Décalage heure locale / UTC", unit: "min", default: 60, origin: H },
    { key: "targetLux", label: "Éclairement visé", unit: "lux", default: 20, origin: H },
    { key: "tolerancePct", label: "Écart d'intensité toléré", unit: "%", default: 30, origin: H },
    { key: "litLux", label: "Considéré allumé au-dessus de", unit: "lux", default: 5, origin: H },
    { key: "shiftToleranceMinutes", label: "Décalage horaire toléré", unit: "min", default: 15, origin: H },
  ],
  PARCOURS_DISPONIBLE: [
    { key: "wetSoilPct", label: "Sol détrempé au-dessus de", unit: "%", default: 40, origin: H },
    { key: "rain24hMm", label: "Pluie sur 24 h rendant le parcours indisponible", unit: "mm", default: 10, origin: H },
  ],
  EAU_PROFIL: [
    { key: "windowHours", label: "Fenêtre comparée", unit: "h", default: 6, origin: H },
    { key: "historyDays", label: "Historique de référence (mêmes heures, jours précédents)", unit: "j", default: 3, origin: H },
    { key: "dropPct", label: "Chute déclenchant l'investigation", unit: "%", default: 20, origin: H },
    { key: "risePct", label: "Hausse déclenchant l'investigation", unit: "%", default: 30, origin: H },
    { key: "pressureDropPct", label: "Baisse de pression significative", unit: "%", default: 15, origin: H },
  ],
  EAU_DESEQUILIBRE_LIGNES: [
    { key: "windowMinutes", label: "Fenêtre de comparaison", unit: "min", default: 60, origin: H },
    { key: "imbalancePct", label: "Écart entre lignes toléré", unit: "%", default: 25, origin: H },
    { key: "totalStabilityPct", label: "Variation de la consommation totale tolérée", unit: "%", default: 15, origin: H },
  ],
  CUVE_AUTONOMIE: [
    { key: "warnHours", label: "Alerte si autonomie inférieure à", unit: "h", default: 12, origin: H },
    { key: "criticalHours", label: "Critique si autonomie inférieure à", unit: "h", default: 4, origin: H },
  ],
  SILO_STOCK: [
    { key: "deliveryMinKg", label: "Saut de masse reconnu comme livraison", unit: "kg", default: 500, origin: H },
    { key: "warnDays", label: "Alerte si stock inférieur à", unit: "j", default: 2, origin: H },
    { key: "criticalDays", label: "Critique si stock inférieur à", unit: "j", default: 1, origin: H },
  ],
  VIS_SANS_ROTATION: [
    { key: "delayMinutes", label: "Délai sans rotation, moteur commandé", unit: "min", default: 3, origin: "CLIENT" },
    { key: "minRpm", label: "Rotation considérée nulle sous", unit: "tr/min", default: 1, origin: H },
  ],
  PESEE_HOMOGENEITE: [
    { key: "windowHours", label: "Passages pris en compte", unit: "h", default: 24, origin: H },
    { key: "minPassages", label: "Passages minimum pour juger", unit: "", default: 50, origin: H },
    { key: "minHomogeneityPct", label: "Homogénéité minimale (± 10 % du poids moyen)", unit: "%", default: 70, origin: H },
  ],
  COUVOIR_POSITIONS: [
    { key: "lowC", label: "Température basse admise", unit: "°C", default: 37.2, origin: H },
    { key: "highC", label: "Température haute admise", unit: "°C", default: 38, origin: H },
    { key: "maxSpreadC", label: "Écart maximal entre positions", unit: "°C", default: 0.5, origin: H },
    { key: "maxMachineGapC", label: "Écart maximal sonde indépendante / machine", unit: "°C", default: 0.5, origin: H },
    { key: "criticalOutMinutes", label: "Critique après ce temps cumulé hors plage", unit: "min", default: 30, origin: H },
  ],
  SALLE_OEUFS_ECART: [
    { key: "lowC", label: "Température basse admise", unit: "°C", default: 15, origin: H },
    { key: "highC", label: "Température haute admise", unit: "°C", default: 18, origin: H },
    { key: "maxGapC", label: "Écart maximal porte / point froid", unit: "°C", default: 2, origin: H },
  ],
  ACCES_HORS_PLAGE: [
    { key: "openFrom", label: "Accès autorisé à partir de (heure locale)", unit: "hh:mm", default: "06:00", origin: H },
    { key: "openTo", label: "Accès autorisé jusqu'à (heure locale)", unit: "hh:mm", default: "20:00", origin: H },
    { key: "utcOffsetMinutes", label: "Décalage heure locale / UTC", unit: "min", default: 60, origin: H },
    { key: "maxOpenMinutes", label: "Porte restée ouverte au-delà de", unit: "min", default: 10, origin: H },
  ],
  CAPTEUR_SILENCIEUX: [
    { key: "silentAfterReports", label: "Silencieux après ce nombre de remontées manquées", unit: "", default: 3, origin: H },
    { key: "minSilentMinutes", label: "Jamais avant", unit: "min", default: 10, origin: H },
    { key: "criticalMinutes", label: "Critique au-delà de", unit: "min", default: 60, origin: H },
  ],
};

export function defaultParams(rule: DecisionRule): RuleParams {
  return Object.fromEntries(RULE_PARAMS[rule].map((p) => [p.key, p.default]));
}

/** Overlays stored values on the defaults, ignoring keys the rule does not know and values of the wrong kind. */
export function mergeParams(rule: DecisionRule, ...layers: (RuleParams | null | undefined)[]): RuleParams {
  const specs = RULE_PARAMS[rule];
  const out = defaultParams(rule);
  for (const layer of layers) {
    if (!layer) continue;
    for (const spec of specs) {
      const v = layer[spec.key];
      if (v === undefined || v === null) continue;
      if (typeof spec.default === "number" && typeof v === "number" && Number.isFinite(v)) out[spec.key] = v;
      if (typeof spec.default === "string" && typeof v === "string" && /^\d{2}:\d{2}$/.test(v)) out[spec.key] = v;
    }
  }
  return out;
}

export const num = (p: RuleParams, key: string) => Number(p[key]);

/** "hh:mm" local → minutes after local midnight. */
export function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes after local midnight for an instant, given the local offset from UTC. */
export function localMinutesOfDay(at: number, utcOffsetMinutes: number): number {
  const d = new Date(at + utcOffsetMinutes * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Whether a local minute-of-day lies in [from, to), handling windows that cross midnight. */
export function inDailyWindow(minute: number, from: number, to: number): boolean {
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}
