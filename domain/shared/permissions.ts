import type { Role, ScopeType } from "./enums";

export const MODULE = [
  "ORGANIZATIONS",
  "COOPERATIVES",
  "PRODUCERS",
  "FARMS",
  "BUILDINGS",
  "LOTS",
  "IOT",
  "ANOMALIES",
  "ALERTS",
  "ACTIONS",
  "EVENTS",
  "PRODUCTS",
  "SANITARY",
  "TRACEABILITY",
  "AUDIT",
  "INTEGRITY",
  "USERS",
  "SETTINGS",
  /** Inbound requests from the public BVU Tech site. */
  "LEADS",
  /** HOLD / RELEASE cases and recall exports. VALIDATE = the release decision. */
  "QUALITY",
  /** Upstream chain: parent flocks, egg lots, incubation cycles, chick lots. */
  "HATCHERY",
  /**
   * Equipment register per unit, the purchasing nomenclature and the commissioning screens. Recording a
   * commissioning test is validating an installation: it takes IOT VALIDATE (the technician), not EQUIPMENT EDIT.
   */
  "EQUIPMENT",
  /** Machine API clients (keys and scopes) for /api/v1. */
  "API_CLIENTS",
  /** Egg-marking lines and runs (document 3, lot 15). VALIDATE = the read-back threshold, a quality decision. */
  "MARKING",
  /** Laboratory samples and results (document 3, data sources). VALIDATE = interpreting a result, the veterinarian's call. */
  "LAB",
] as const;
export type Module = (typeof MODULE)[number];

export const ACTION = ["VIEW", "CREATE", "EDIT", "DELETE", "VALIDATE", "ACKNOWLEDGE", "EXPORT"] as const;
export type Action = (typeof ACTION)[number];

/** Minimal shape `can()` needs — satisfied by services/auth's Session, but kept decoupled from it. */
export interface PermissionSubject {
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
}

const ALL_ACTIONS = ACTION;
const READ_ONLY = ["VIEW"] as const;

/**
 * Central permission matrix. This is the ONLY place role -> allowed-action mappings live.
 * Never scatter `if (role === ...)` checks elsewhere — extend this table instead.
 */
const PERMISSIONS: Record<Role, Partial<Record<Module, readonly Action[]>>> = {
  SUPER_ADMIN: Object.fromEntries(MODULE.map((m) => [m, ALL_ACTIONS])) as unknown as Record<
    Module,
    readonly Action[]
  >,

  COOP_MANAGER: {
    ORGANIZATIONS: READ_ONLY,
    COOPERATIVES: ["VIEW", "EDIT"],
    PRODUCERS: ["VIEW", "CREATE", "EDIT"],
    FARMS: ["VIEW", "CREATE", "EDIT"],
    BUILDINGS: ["VIEW", "CREATE", "EDIT"],
    LOTS: ["VIEW", "CREATE", "EDIT"],
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    /** VALIDATE: arbitrate a disputed field day and correct past mortality (document 3, annex — default pending the owner's decision). */
    EVENTS: ["VIEW", "CREATE", "VALIDATE"],
    PRODUCTS: READ_ONLY,
    SANITARY: READ_ONLY,
    TRACEABILITY: ["VIEW", "CREATE", "EDIT"],
    QUALITY: ["VIEW", "CREATE", "EXPORT"],
    HATCHERY: ["VIEW", "CREATE", "EDIT"],
    EQUIPMENT: READ_ONLY,
    MARKING: ["VIEW", "CREATE", "EDIT"],
    LAB: ["VIEW", "CREATE"],
  },

  PRODUCER: {
    FARMS: ["VIEW", "EDIT"],
    BUILDINGS: ["VIEW", "EDIT"],
    LOTS: ["VIEW", "CREATE", "EDIT"],
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    EVENTS: ["VIEW", "CREATE"],
    PRODUCTS: READ_ONLY,
    /** The farmer records the vaccinations and treatments given on the farm (document 3, ch. 05). */
    SANITARY: ["VIEW", "CREATE"],
    TRACEABILITY: ["VIEW", "CREATE", "EDIT"],
    QUALITY: READ_ONLY,
    HATCHERY: READ_ONLY,
    /** The line usually stands on the farm: the farmer runs it and cleans the head when the guard stops it. */
    MARKING: ["VIEW", "CREATE", "EDIT"],
    /** The farmer sees the results of his own flocks' samples. */
    LAB: READ_ONLY,
  },

  FARM_MANAGER: {
    FARMS: READ_ONLY,
    BUILDINGS: ["VIEW", "EDIT"],
    LOTS: ["VIEW", "CREATE", "EDIT"],
    IOT: ["VIEW", "EDIT"],
    ANOMALIES: READ_ONLY,
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    /** VALIDATE: arbitrate a disputed field day and correct past mortality (document 3, annex — default pending the owner's decision). */
    EVENTS: ["VIEW", "CREATE", "VALIDATE"],
    SANITARY: ["VIEW", "CREATE"],
    TRACEABILITY: ["VIEW", "CREATE", "EDIT"],
    QUALITY: ["VIEW", "CREATE"],
    HATCHERY: ["VIEW", "CREATE", "EDIT"],
    EQUIPMENT: READ_ONLY,
    MARKING: ["VIEW", "CREATE", "EDIT"],
    LAB: ["VIEW", "CREATE"],
  },

  TECHNICIAN: {
    BUILDINGS: READ_ONLY,
    LOTS: ["VIEW", "EDIT"],
    /** VALIDATE: reference bands and rule settings — the poultry technician's call (document 3, ch. 4). */
    IOT: ["VIEW", "EDIT", "VALIDATE"],
    ANOMALIES: ["VIEW", "VALIDATE"],
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    EVENTS: ["VIEW", "CREATE"],
    SANITARY: ["VIEW", "CREATE", "VALIDATE"],
    TRACEABILITY: READ_ONLY,
    QUALITY: ["VIEW", "CREATE"],
    HATCHERY: ["VIEW", "CREATE"],
    EQUIPMENT: READ_ONLY,
    MARKING: ["VIEW", "CREATE", "EDIT"],
    /** The technician takes samples on the farm. */
    LAB: ["VIEW", "CREATE"],
  },

  AUDITOR: {
    ORGANIZATIONS: READ_ONLY,
    COOPERATIVES: READ_ONLY,
    PRODUCERS: READ_ONLY,
    FARMS: READ_ONLY,
    BUILDINGS: READ_ONLY,
    LOTS: READ_ONLY,
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: READ_ONLY,
    ACTIONS: READ_ONLY,
    EVENTS: READ_ONLY,
    PRODUCTS: READ_ONLY,
    SANITARY: READ_ONLY,
    TRACEABILITY: READ_ONLY,
    AUDIT: ["VIEW", "EXPORT"],
    INTEGRITY: ["VIEW", "EXPORT"],
    QUALITY: ["VIEW", "EXPORT"],
    HATCHERY: READ_ONLY,
    EQUIPMENT: READ_ONLY,
    MARKING: READ_ONLY,
    LAB: READ_ONLY,
  },

  /**
   * Responsable qualité — global read across the chain, and the only role besides SUPER_ADMIN
   * that may decide a RELEASE (QUALITY:VALIDATE). Opening a hold is open to field roles; lifting
   * one is not, by design (client spec R10, RELEASE_ROLES).
   */
  QUALITY_MANAGER: {
    ORGANIZATIONS: READ_ONLY,
    COOPERATIVES: READ_ONLY,
    PRODUCERS: READ_ONLY,
    FARMS: READ_ONLY,
    BUILDINGS: READ_ONLY,
    LOTS: READ_ONLY,
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: READ_ONLY,
    ACTIONS: READ_ONLY,
    EVENTS: READ_ONLY,
    PRODUCTS: READ_ONLY,
    SANITARY: READ_ONLY,
    TRACEABILITY: READ_ONLY,
    AUDIT: READ_ONLY,
    INTEGRITY: READ_ONLY,
    QUALITY: ["VIEW", "CREATE", "VALIDATE", "EXPORT"],
    HATCHERY: READ_ONLY,
    EQUIPMENT: READ_ONLY,
    /** VALIDATE: the read-back threshold below which a marking stops counting as proof. */
    MARKING: ["VIEW", "VALIDATE"],
    /** EDIT: records the results of product controls the laboratory sends back. */
    LAB: ["VIEW", "CREATE", "EDIT"],
  },

  /**
   * Direction (document 3, ch. 07): the consolidated view across every site. Reads everything,
   * exports, operates nothing — a decision taken at the top goes through the person responsible.
   */
  DIRECTION: {
    ORGANIZATIONS: READ_ONLY,
    COOPERATIVES: READ_ONLY,
    PRODUCERS: READ_ONLY,
    FARMS: READ_ONLY,
    BUILDINGS: READ_ONLY,
    LOTS: READ_ONLY,
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: READ_ONLY,
    ACTIONS: READ_ONLY,
    EVENTS: READ_ONLY,
    PRODUCTS: READ_ONLY,
    SANITARY: READ_ONLY,
    TRACEABILITY: READ_ONLY,
    AUDIT: ["VIEW", "EXPORT"],
    INTEGRITY: READ_ONLY,
    QUALITY: ["VIEW", "EXPORT"],
    HATCHERY: READ_ONLY,
    EQUIPMENT: READ_ONLY,
    MARKING: READ_ONLY,
    LAB: READ_ONLY,
  },

  /** Responsable couvoir: the hatchery site — parent flocks, egg room, incubation, hatching-egg marking. */
  HATCHERY_MANAGER: {
    FARMS: READ_ONLY,
    BUILDINGS: ["VIEW", "EDIT"],
    LOTS: ["VIEW", "CREATE", "EDIT"],
    IOT: ["VIEW", "EDIT"],
    ANOMALIES: READ_ONLY,
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    EVENTS: ["VIEW", "CREATE"],
    SANITARY: ["VIEW", "CREATE"],
    TRACEABILITY: ["VIEW", "CREATE", "EDIT"],
    QUALITY: ["VIEW", "CREATE"],
    HATCHERY: ["VIEW", "CREATE", "EDIT"],
    EQUIPMENT: READ_ONLY,
    MARKING: ["VIEW", "CREATE", "EDIT"],
    LAB: ["VIEW", "CREATE"],
  },

  /**
   * Vétérinaire: the health of every flock. Records treatments and vaccinations, reviews the
   * observations made by others, interprets laboratory results, and may place a hold on a
   * sanitary suspicion — lifting it stays with the quality manager.
   */
  VETERINARIAN: {
    FARMS: READ_ONLY,
    BUILDINGS: READ_ONLY,
    LOTS: READ_ONLY,
    IOT: READ_ONLY,
    ANOMALIES: READ_ONLY,
    ALERTS: ["VIEW", "ACKNOWLEDGE"],
    ACTIONS: ["VIEW", "CREATE"],
    EVENTS: READ_ONLY,
    SANITARY: ["VIEW", "CREATE", "EDIT", "VALIDATE"],
    TRACEABILITY: READ_ONLY,
    QUALITY: ["VIEW", "CREATE"],
    HATCHERY: READ_ONLY,
    LAB: ["VIEW", "CREATE", "EDIT", "VALIDATE"],
  },
};

/** Returns whether `subject` may perform `action` on `module`. This is the single choke point for authorization checks. */
export function can(subject: PermissionSubject | null | undefined, action: Action, module: Module): boolean {
  if (!subject) return false;
  const allowed = PERMISSIONS[subject.role]?.[module];
  return allowed?.includes(action) ?? false;
}

/** Convenience for nav/route visibility: does this role have any access at all to this module? */
export function canAccessModule(subject: PermissionSubject | null | undefined, module: Module): boolean {
  if (!subject) return false;
  const allowed = PERMISSIONS[subject.role]?.[module];
  return !!allowed && allowed.length > 0;
}

/** Modules visible in navigation for a role, in matrix declaration order. */
export function visibleModules(subject: PermissionSubject | null | undefined): Module[] {
  if (!subject) return [];
  return MODULE.filter((m) => canAccessModule(subject, m));
}
