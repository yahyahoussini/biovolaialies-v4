import type {
  DeviceStatus,
  MeasurementSourceType,
  RelationType,
  Role,
  ScopeType,
  SensorType,
  ValidationStatus,
} from "@/domain/shared/enums";
import type { IntegrityCheckCode } from "@/domain/integrity/types";
import type { EntityType } from "@/domain/traceability/entity-types";

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Administrateur",
  COOP_MANAGER: "Responsable coopérative",
  PRODUCER: "Producteur",
  FARM_MANAGER: "Responsable ferme",
  TECHNICIAN: "Technicien",
  AUDITOR: "Auditeur",
  QUALITY_MANAGER: "Responsable qualité",
};

export const SCOPE_TYPE_LABEL: Record<ScopeType, string> = {
  GLOBAL: "Global",
  ORGANIZATION: "Organisation",
  COOPERATIVE: "Coopérative",
  PRODUCER: "Producteur",
  FARM: "Ferme",
};

/** Known audit_log.entityType values (a free-text column, not a domain enum) — for the /audit filter dropdown only. */
export const AUDIT_ENTITY_TYPE_LABEL: Record<string, string> = {
  lot: "Lot",
  building: "Bâtiment",
  user: "Utilisateur",
  relation: "Relation de traçabilité",
  collection: "Collecte",
  slaughter_batch: "Lot d'abattage",
  transformation_batch: "Lot de transformation",
  product: "Produit",
  measurement: "Mesure IoT",
  feed_usage_record: "Alimentation",
  water_usage_record: "Eau",
  weight_measurement_record: "Pesée",
  environment_measurement_record: "Environnement",
  alert: "Alerte",
  integrity_issue: "Anomalie d'intégrité",
};

export function auditEntityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABEL[entityType] ?? entityType;
}

export const INTEGRITY_CHECK_LABEL: Record<IntegrityCheckCode, string> = {
  T01_ORPHAN_LOT: "T01 — Lot orphelin",
  T02_ORPHAN_BUILDING: "T02 — Bâtiment orphelin",
  T04_INVALID_RELATIONSHIP: "T04 — Relation de parenté invalide",
  T05_MISSING_SOURCE: "T05 — Produit/lot sans source",
  T06_QUANTITY_MISMATCH: "T06 — Écart de quantité",
  T07_BLOCKED_SOURCE_DOWNSTREAM: "T07 — Lot bloqué avec produit libéré",
  T08_MISSING_PROVENANCE: "T08 — Provenance manquante",
  T09_REAL_SIMULATION_MISMATCH: "T09 — Incohérence réel/simulation",
  T10_MUTATION_WITHOUT_AUDIT: "T10 — Mutation sans audit",
  T13_INVALID_ACTOR: "T13 — Acteur invalide",
  T15_INVALID_CHRONOLOGY: "T15 — Chronologie impossible",
  T17_POPULATION_RECONCILIATION: "T17 — Réconciliation de population",
  T18_DATA_QUALITY: "T18 — Qualité des données",
  T19_ANOMALY_WITHOUT_ALERT: "T19 — Anomalie sans alerte",
  T21_DEVICE_STALE_OFFLINE: "T21 — Appareil hors ligne ou obsolète",
  T24_DUPLICATE_CODE: "T24 — Code métier dupliqué",
  T25_USER_SCOPE_INVALID: "T25 — Périmètre utilisateur invalide",
  T26_USER_ROLE_SCOPE_STRUCTURE: "T26 — Structure rôle/périmètre incohérente",
  T27_ALERT_LIFECYCLE_AUDIT: "T27 — Cycle de vie d'alerte non tracé",
};

export const SOURCE_TYPE_LABEL: Record<MeasurementSourceType, string> = {
  MANUEL: "Saisie manuelle",
  CAPTEUR: "Capteur",
  SIMULATEUR: "Simulateur",
};

export const VALIDATION_STATUS_LABEL: Record<ValidationStatus, string> = {
  EN_ATTENTE: "En attente",
  VALIDE: "Validé",
  REJETE: "Rejeté",
};

export const MEASUREMENT_TYPE_LABEL: Record<SensorType, string> = {
  TEMPERATURE: "Température",
  HUMIDITE: "Humidité",
  CO2: "CO₂",
  EAU: "Eau",
  ALIMENT: "Aliment",
  POIDS: "Poids",
  LUMIERE: "Luminosité",
};

/**
 * Traceability vocabulary in French. The graph and timeline previously printed the raw
 * TypeScript enum ("SLAUGHTER BATCH", "CONDITIONNE_DEPUIS") into an otherwise French UI —
 * these give every node and edge a real domain word (§22).
 */
export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  PARENT_FLOCK: "Troupeau reproducteur",
  EGG_LOT: "Lot d'œufs",
  HATCH_CYCLE: "Cycle d'incubation",
  CHICK_LOT: "Lot de poussins",
  SHIPMENT: "Expédition",
  LOT: "Lot d'élevage",
  COLLECTION: "Collecte",
  SLAUGHTER_BATCH: "Abattage",
  TRANSFORMATION_BATCH: "Transformation",
  PRODUCT: "Produit",
  DESTINATION: "Destination",
};

/** Read as "<downstream node> <label> <upstream node>", matching the edge direction. */
export const RELATION_TYPE_LABEL: Record<RelationType, string> = {
  PROVIENT_DE: "provient de",
  PRODUIT: "produit",
  ALIMENTE: "alimente",
  RECOIT: "reçoit",
  TRANSFERE_VERS: "transféré vers",
  COLLECTE_DE: "collecté depuis",
  ABATTU_DEPUIS: "abattu depuis",
  TRANSFORME_DEPUIS: "transformé depuis",
  DECOUPE_DEPUIS: "découpé depuis",
  CONDITIONNE_DEPUIS: "conditionné depuis",
  DESTINE_A: "destiné à",
  CONTIENT: "contient",
  ASSOCIE_A: "associé à",
  DOCUMENTE_PAR: "documenté par",
  CERTIFIE_PAR: "certifié par",
  EXPEDIE_DEPUIS: "expédié depuis",
};

/**
 * Was redefined inline in three separate pages (/iot, /iot/[deviceId], building detail), two
 * of which said "Défaut" while a third said "En défaut". One definition now.
 */
export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  ONLINE: "En ligne",
  OFFLINE: "Hors ligne",
  FAULT: "En défaut",
};

/** Building zone type. Was duplicated verbatim in the two /fermes/[farmId]/batiments pages. */
export const ZONE_TYPE_LABEL: Record<string, string> = {
  ELEVAGE: "Élevage",
  COUVOIR: "Couvoir",
  STOCKAGE: "Stockage",
  AUTRE: "Autre",
};

/** Demo health-check verdicts — the screen was rendering the raw "OK"/"WARN"/"FAIL" enum. */
export const HEALTH_STATUS_LABEL: Record<string, string> = {
  OK: "Conforme",
  WARN: "À surveiller",
  FAIL: "En échec",
};
