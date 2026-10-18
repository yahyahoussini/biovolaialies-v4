/**
 * Shared enums used across every bounded context.
 * Pure TypeScript — no React/Next.js imports allowed in this file or anywhere in domain/.
 */

/** Distinguishes simulated/demo data from validated real data. Never omit this on a record. */
export const DATA_STATUS = [
  "REEL",
  "TEST",
  "SIMULATION",
  "CALCULE",
  "ESTIME",
  "A_CONFIRMER",
  "VALIDE",
  "MANQUANT",
] as const;
export type DataStatus = (typeof DATA_STATUS)[number];

export const LOT_STATUS = [
  "PLANIFIE",
  "CREE",
  "ACTIF",
  "EN_TRANSFERT",
  "SUSPENDU",
  "BLOQUE",
  "LIBERE",
  "ABATTU",
  "TRANSFORME",
  "CLOTURE",
  "ARCHIVE",
] as const;
export type LotStatus = (typeof LOT_STATUS)[number];

/** Edges of the traceability graph (the `relations` table). */
export const RELATION_TYPE = [
  "PROVIENT_DE",
  "PRODUIT",
  "ALIMENTE",
  "RECOIT",
  "TRANSFERE_VERS",
  "COLLECTE_DE",
  "ABATTU_DEPUIS",
  "TRANSFORME_DEPUIS",
  "DECOUPE_DEPUIS",
  "CONDITIONNE_DEPUIS",
  "DESTINE_A",
  "CONTIENT",
  "ASSOCIE_A",
  "DOCUMENTE_PAR",
  "CERTIFIE_PAR",
  /** Commercial shipment of a packaged product (SHIPMENT -EXPEDIE_DEPUIS-> PRODUCT). */
  "EXPEDIE_DEPUIS",
] as const;
export type RelationType = (typeof RELATION_TYPE)[number];

export const SANITARY_STATUS = ["NORMAL", "SURVEILLANCE", "ALERTE"] as const;
export type SanitaryStatus = (typeof SANITARY_STATUS)[number];

/** Authenticated roles only. PUBLIC is the absence of a session, not a role value. */
export const ROLE = [
  "SUPER_ADMIN",
  "COOP_MANAGER",
  "PRODUCER",
  "FARM_MANAGER",
  "TECHNICIAN",
  "AUDITOR",
  /** Holds the RELEASE decision on quality holds (client spec R10 / RELEASE_ROLES). */
  "QUALITY_MANAGER",
] as const;
export type Role = (typeof ROLE)[number];

export const EVENT_TYPE = [
  "CREATION_LOT",
  "MISE_EN_PLACE",
  "MORTALITE",
  "PESEE",
  "ALIMENTATION",
  "TRANSFERT",
  "VACCINATION",
  "TRAITEMENT",
  "OBSERVATION_SANITAIRE",
  "ABATTAGE",
  "DEVICE_CONNECTED",
  "DEVICE_OFFLINE",
  "SENSOR_FAULT",
  "ALERT_ACTION",
  "AUTRE",
] as const;
export type EventType = (typeof EVENT_TYPE)[number];

export const ALERT_SEVERITY = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITY)[number];

export const ALERT_STATUS = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;
export type AlertStatus = (typeof ALERT_STATUS)[number];

export const ANOMALY_STATUS = ["OPEN", "REVIEWED", "DISMISSED"] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUS)[number];

export const DEVICE_STATUS = ["ONLINE", "OFFLINE", "FAULT"] as const;
export type DeviceStatus = (typeof DEVICE_STATUS)[number];

export const SENSOR_TYPE = [
  "TEMPERATURE",
  "HUMIDITE",
  "CO2",
  "EAU",
  "ALIMENT",
  "POIDS",
  "LUMIERE",
] as const;
export type SensorType = (typeof SENSOR_TYPE)[number];

export const MEASUREMENT_SOURCE_TYPE = ["SIMULATEUR", "MANUEL", "CAPTEUR"] as const;
export type MeasurementSourceType = (typeof MEASUREMENT_SOURCE_TYPE)[number];

export const BUILDING_ZONE_TYPE = ["ELEVAGE", "COUVOIR", "STOCKAGE", "AUTRE"] as const;
export type BuildingZoneType = (typeof BUILDING_ZONE_TYPE)[number];

export const ORGANIZATION_TYPE = ["COOPERATIVE", "PRODUCER_GROUP", "INTERNAL"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPE)[number];

/** A user's data-visibility boundary. GLOBAL sees everything; the rest are scoped to one row + its descendants. */
export const SCOPE_TYPE = ["GLOBAL", "ORGANIZATION", "COOPERATIVE", "PRODUCER", "FARM"] as const;
export type ScopeType = (typeof SCOPE_TYPE)[number];

export const DESTINATION_TYPE = ["MARCHE", "GROSSISTE", "EXPORT", "POINT_VENTE", "AUTRE"] as const;
export type DestinationType = (typeof DESTINATION_TYPE)[number];

export const VALIDATION_STATUS = ["EN_ATTENTE", "VALIDE", "REJETE"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUS)[number];

// ---------------------------------------------------------------------------
// BVU Tech extensions — public site leads, quality holds, hatchery chain, ledger, API.
// ---------------------------------------------------------------------------

/** Activity choices on the public contact form — same list as the client's original site. */
export const LEAD_ACTIVITY = [
  "COUVOIR",
  "ELEVAGE",
  "ALIMENT",
  "ABATTAGE",
  "DECOUPE_TRANSFORMATION",
  "OPERATEUR_INTEGRE",
  "AUTRE",
] as const;
export type LeadActivity = (typeof LEAD_ACTIVITY)[number];

/** B2B qualification pipeline for an inbound request. */
export const LEAD_STATUS = ["NOUVEAU", "EN_QUALIFICATION", "RDV_PLANIFIE", "PROPOSITION", "GAGNE", "PERDU"] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/** Quality case lifecycle: a HOLD is opened, then either released or confirmed non-conforming. */
export const QUALITY_CASE_STATUS = ["EN_BLOCAGE", "LIBERE", "NON_CONFORME"] as const;
export type QualityCaseStatus = (typeof QUALITY_CASE_STATUS)[number];

/** Whether a hold blocks only the named object, or also everything made from it (rule R09). */
export const QUALITY_HOLD_SCOPE = ["OBJET_SEUL", "DESCENDANTS"] as const;
export type QualityHoldScope = (typeof QUALITY_HOLD_SCOPE)[number];

export const QUALITY_REASON = [
  "SUSPICION_SANITAIRE",
  "RESULTAT_LABORATOIRE",
  "TEMPERATURE_HORS_LIMITE",
  "ECART_TRACABILITE",
  "ECART_QUANTITE",
  "RECLAMATION_CLIENT",
  "INSTRUMENT_HORS_VALIDITE",
  "AUTRE",
] as const;
export type QualityReason = (typeof QUALITY_REASON)[number];

export const HATCH_CYCLE_STATUS = ["EN_INCUBATION", "MIRE", "ECLOS"] as const;
export type HatchCycleStatus = (typeof HATCH_CYCLE_STATUS)[number];

export const CHICK_GRADE = ["A", "B"] as const;
export type ChickGrade = (typeof CHICK_GRADE)[number];

/** Who wrote a ledger event — a signed-in person, a machine API client, or the platform itself. */
export const LEDGER_ACTOR_KIND = ["USER", "API_CLIENT", "SYSTEM"] as const;
export type LedgerActorKind = (typeof LEDGER_ACTOR_KIND)[number];

/** Scopes an API client can be granted (client spec API-01..API-10). Release is deliberately absent: a human decides. */
export const API_SCOPE = [
  "lots:read",
  "lots:write",
  "events:write",
  "lineage:read",
  "quality:hold",
  "measurements:write",
  "ingest:write",
  "recall:export",
] as const;
export type ApiScope = (typeof API_SCOPE)[number];

export const COMMISSIONING_RESULT = ["A_FAIRE", "CONFORME", "NON_CONFORME"] as const;
export type CommissioningResult = (typeof COMMISSIONING_RESULT)[number];
