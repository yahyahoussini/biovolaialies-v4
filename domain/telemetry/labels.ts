import type { RuleState, SensorType, SiteEventKind, ZoneKind } from "../shared/enums";

export const SENSOR_TYPE_LABEL: Record<SensorType, string> = {
  TEMPERATURE: "Température",
  HUMIDITE: "Humidité",
  CO2: "CO₂",
  EAU: "Eau consommée",
  ALIMENT: "Aliment",
  POIDS: "Poids",
  LUMIERE: "Luminosité",
  NH3: "Ammoniac",
  H2S: "Hydrogène sulfuré",
  PRESSION_DIFFERENTIELLE: "Dépression",
  PLUIE: "Pluie",
  VENT: "Vent",
  HUMIDITE_SOL: "Humidité du sol",
  TEMPERATURE_SOL: "Température du sol",
  DEBIT_EAU: "Débit de ligne",
  PRESSION_EAU: "Pression d'eau",
  NIVEAU_CUVE: "Niveau de cuve",
  TEMPERATURE_EAU: "Température de l'eau",
  MASSE_SILO: "Masse du silo",
  ROTATION_VIS: "Rotation de vis",
  VENTILATION: "Ventilation (automate)",
  VOLETS: "Volets (automate)",
  COMMANDE_VIS: "Commande vis (automate)",
  TEMPERATURE_MACHINE: "Température affichée machine",
};

export const UNIT_LABEL: Record<string, string> = {
  C: "°C",
  "%": "%",
  PPM: "ppm",
  PA: "Pa",
  LUX: "lux",
  MM: "mm",
  "M/S": "m/s",
  L: "L",
  "L/MIN": "L/min",
  BAR: "bar",
  KG: "kg",
  "TR/MIN": "tr/min",
  ETAT: "",
};

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "";
  return UNIT_LABEL[unit] ?? unit;
}

export const ZONE_KIND_LABEL: Record<ZoneKind, string> = {
  ELEVAGE: "Zone d'élevage",
  PARCOURS: "Parcours",
  INCUBATEUR: "Incubateur",
  SALLE_OEUFS: "Salle des œufs",
  ARMOIRE: "Armoire",
  SITE: "Site",
};

export const RULE_STATE_LABEL: Record<RuleState, string> = {
  NORMAL: "Normal",
  ALERTE: "Alerte",
  CRITIQUE: "Critique",
};

export const SITE_EVENT_LABEL: Record<SiteEventKind, string> = {
  ALARME_GSM_DECLENCHEE: "Alarme GSM déclenchée",
  ALARME_GSM_APPEL: "Alarme GSM : appel",
  ALARME_GSM_SMS: "Alarme GSM : SMS",
  ALARME_GSM_ACQUITTEE: "Alarme GSM acquittée sur place",
  THERMOSTAT_SECURITE_OUVERT: "Thermostat de sécurité déclenché",
  THERMOSTAT_SECURITE_FERME: "Thermostat de sécurité réarmé",
  ACCES_BADGE: "Badge présenté",
  PORTE_OUVERTE: "Porte ouverte",
  PORTE_FERMEE: "Porte fermée",
  COUPURE_SECTEUR: "Coupure secteur",
  RETOUR_SECTEUR: "Retour secteur",
  GROUPE_DEMARRE: "Groupe électrogène démarré",
  CAMERA_IMAGE: "Image fixe caméra",
  CAMERA_SEQUENCE: "Séquence vidéo courte",
  PASSERELLE_DEMARRAGE: "Passerelle redémarrée",
  PASSERELLE_SYNCHRO_HORLOGE: "Horloge passerelle synchronisée",
  LIVRAISON_ALIMENT_DETECTEE: "Livraison d'aliment détectée (saut de masse)",
};
