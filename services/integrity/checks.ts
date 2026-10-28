import { repositories } from "../../data/repositories";
import type { EntityType } from "../../domain/traceability/entity-types";
import type { IntegrityCheckCode, IntegrityIssue, IntegrityReport } from "../../domain/integrity/types";
import { integrityIssueKey } from "../../domain/integrity/types";
import { checkDeviceOnline, checkStaleReading } from "../../domain/quality/iot-data-quality";
import type { Building, User } from "../../domain/identity/types";
import type { Lot } from "../../domain/production/types";
import type { AlertSeverity, DataStatus, MeasurementSourceType, Role, ScopeType } from "../../domain/shared/enums";
import { AuthorizationError } from "../../domain/shared/errors";
import { can } from "../../domain/shared/permissions";
import { isGlobalScope } from "../../domain/shared/scope";
import { ALERT_STATUS_LABEL, DATA_STATUS_LABEL } from "../../lib/status-colors";
import { ROLE_LABEL } from "../../lib/labels";
import type { AuditLogEntry } from "../../domain/audit/types";
import type { Session } from "../auth/session";
import { listBuildingsInScope, listFarmsInScope } from "../identity/queries";
import { assertScopeTargetExists } from "../identity/user-management";
import { listDevicesInScope } from "../iot/queries";
import { listAnomaliesInScope, listAlertsInScope, type AlertWithContext } from "../intelligence/queries";
import { listLotsWithContext, type LotWithContext } from "../production/lot-queries";
import { computeLotDataQuality } from "../quality/lot-quality";
import { buildLotTraceabilityChain } from "../traceability/chain";
import { checkTraceabilityIntegrity, type TraceabilityIssue } from "../traceability/integrity";

interface Accumulator {
  issues: IntegrityIssue[];
  checksRun: number;
}

function makeIssue(
  code: IntegrityCheckCode,
  severity: AlertSeverity,
  entityType: string,
  entityId: string,
  description: string,
  reason: string,
  now: string
): IntegrityIssue {
  return { code, severity, entityType, entityId, description, reason, status: "OPEN", detectedAt: now };
}

// ---------------------------------------------------------------------------
// T01 / T02 — structural hierarchy resolution
// ---------------------------------------------------------------------------

function checkOrphanLots(lots: LotWithContext[], buildingIds: Set<string>, now: string): Accumulator {
  const issues: IntegrityIssue[] = [];
  for (const lot of lots) {
    if (!buildingIds.has(lot.buildingId)) {
      issues.push(
        makeIssue(
          "T01_ORPHAN_LOT",
          "CRITICAL",
          "LOT",
          lot.id,
          `Le lot ${lot.code} référence un bâtiment introuvable.`,
          "Un lot doit toujours appartenir à un bâtiment existant.",
          now
        )
      );
    }
  }
  return { issues, checksRun: lots.length };
}

function checkOrphanBuildings(buildings: Building[], farmIds: Set<string>, now: string): Accumulator {
  const issues: IntegrityIssue[] = [];
  for (const building of buildings) {
    if (!farmIds.has(building.farmId)) {
      issues.push(
        makeIssue(
          "T02_ORPHAN_BUILDING",
          "CRITICAL",
          "BUILDING",
          building.id,
          `Le bâtiment ${building.code} référence une ferme introuvable.`,
          "Un bâtiment doit toujours appartenir à une ferme existante.",
          now
        )
      );
    }
  }
  return { issues, checksRun: buildings.length };
}

// ---------------------------------------------------------------------------
// T04 / T05 / T06 / T07 / T08 / T15 — reuse of the phase-7 per-lot traceability sweep,
// run over every lot in scope instead of a single one (brief: "scope-wide sweep").
// ---------------------------------------------------------------------------

const TRACE_CODE_MAP: Record<TraceabilityIssue["code"], IntegrityCheckCode> = {
  INVALID_RELATIONSHIP: "T04_INVALID_RELATIONSHIP",
  MISSING_SOURCE: "T05_MISSING_SOURCE",
  QUANTITY_MISMATCH: "T06_QUANTITY_MISMATCH",
  BLOCKED_SOURCE_DOWNSTREAM: "T07_BLOCKED_SOURCE_DOWNSTREAM",
  MISSING_PROVENANCE: "T08_MISSING_PROVENANCE",
  INVALID_CHRONOLOGY: "T15_INVALID_CHRONOLOGY",
};

const TRACE_REASON_MAP: Record<TraceabilityIssue["code"], string> = {
  INVALID_RELATIONSHIP: "Une relation du graphe de traçabilité viole les règles autorisées entre types d'entités.",
  MISSING_SOURCE: "Une étape de la chaîne référence une source structurelle introuvable.",
  QUANTITY_MISMATCH: "La quantité déclarée ne correspond pas à ce que la chaîne en amont permet.",
  BLOCKED_SOURCE_DOWNSTREAM: "Un lot bloqué ou suspendu a néanmoins des produits en aval.",
  MISSING_PROVENANCE: "Une donnée réelle ou validée doit être rattachée à une source.",
  INVALID_CHRONOLOGY: "Une étape est datée avant l'étape dont elle dépend.",
};

async function findProvenanceRecord(type: EntityType, id: string) {
  switch (type) {
    case "COLLECTION":
      return repositories.collections.findById(id);
    case "SLAUGHTER_BATCH":
      return repositories.slaughterBatches.findById(id);
    case "TRANSFORMATION_BATCH":
      return repositories.transformationBatches.findById(id);
    case "PRODUCT":
      return repositories.products.findById(id);
    default:
      return null;
  }
}

const NODE_TYPE_LABEL: Partial<Record<EntityType, string>> = {
  COLLECTION: "collection",
  SLAUGHTER_BATCH: "slaughter_batch",
  TRANSFORMATION_BATCH: "transformation_batch",
  PRODUCT: "product",
};

/**
 * Per-lot: traceability chain issues (T04-T08, T15), real/simulation mismatches (T09), and
 * population reconciliation (T17). A lot whose building doesn't resolve (T01 already flags
 * this separately) can't have its chain built — that portion is skipped rather than left to
 * throw and abort the whole scope-wide sweep for every other lot.
 */
async function checkLotAndChain(lot: LotWithContext, session: Session, now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  let checksRun = 0;
  let chainNodes: Awaited<ReturnType<typeof buildLotTraceabilityChain>>["nodes"] = [];

  const buildingExists = Boolean(await repositories.buildings.findById(lot.buildingId));
  if (buildingExists) {
    const chain = await buildLotTraceabilityChain(lot.id, session);
    chainNodes = chain.nodes;
    const traceIssues = await checkTraceabilityIntegrity(chain, lot);
    checksRun += 6; // relationship validity, source validity, quantity, blocked-downstream, provenance, chronology
    for (const ti of traceIssues) {
      issues.push(
        makeIssue(TRACE_CODE_MAP[ti.code], ti.severity, ti.entityType, ti.entityId, ti.message, TRACE_REASON_MAP[ti.code], now)
      );
    }
  }

  // T09 — every structured record this lot owns, plus whatever downstream chain nodes carry their own provenance.
  const [feed, water, weight, mortality, environment] = await Promise.all([
    repositories.feedUsage.listByLot(lot.id),
    repositories.waterUsage.listByLot(lot.id),
    repositories.weightMeasurements.listByLot(lot.id),
    repositories.mortalityRecords.listByLot(lot.id),
    repositories.environmentMeasurements.listByLot(lot.id),
  ]);
  const structured: { type: string; id: string; label: string; sourceType: MeasurementSourceType; dataStatus: DataStatus }[] = [
    ...feed.map((r) => ({ type: "feed_usage_record", id: r.id, label: "Enregistrement d'alimentation", sourceType: r.sourceType, dataStatus: r.dataStatus })),
    ...water.map((r) => ({ type: "water_usage_record", id: r.id, label: "Enregistrement d'eau", sourceType: r.sourceType, dataStatus: r.dataStatus })),
    ...weight.map((r) => ({ type: "weight_measurement_record", id: r.id, label: "Pesée", sourceType: r.sourceType, dataStatus: r.dataStatus })),
    ...mortality.map((r) => ({ type: "mortality_record", id: r.id, label: "Mortalité", sourceType: r.sourceType, dataStatus: r.dataStatus })),
    ...environment.map((r) => ({ type: "environment_measurement_record", id: r.id, label: "Mesure d'environnement", sourceType: r.sourceType, dataStatus: r.dataStatus })),
  ];

  for (const node of chainNodes) {
    const label = NODE_TYPE_LABEL[node.type];
    if (!label) continue; // LOT, DESTINATION — no sourceType/dataStatus of the kind T09 checks
    const record = await findProvenanceRecord(node.type, node.id);
    if (!record) continue;
    structured.push({ type: label, id: node.id, label: node.label, sourceType: record.sourceType, dataStatus: record.dataStatus });
  }

  for (const record of structured) {
    checksRun += 1;
    if (record.sourceType === "SIMULATEUR" && (record.dataStatus === "REEL" || record.dataStatus === "VALIDE")) {
      issues.push(
        makeIssue(
          "T09_REAL_SIMULATION_MISMATCH",
          "CRITICAL",
          record.type,
          record.id,
          `${record.label} est marqué "${DATA_STATUS_LABEL[record.dataStatus]}" mais provient du simulateur.`,
          "Une donnée simulée ne doit jamais être représentée comme réelle ou validée — cela ferait passer une démonstration pour de la production.",
          now
        )
      );
    }
  }

  // T17 — population reconciliation, reusing the same engine the lot's Data tab already shows.
  checksRun += 1;
  const quality = await computeLotDataQuality(lot.id);
  if (!quality.populationReconciliation.consistent) {
    issues.push(
      makeIssue(
        "T17_POPULATION_RECONCILIATION",
        "CRITICAL",
        "LOT",
        lot.id,
        `Lot ${lot.code} : population attendue ${quality.populationReconciliation.expectedPopulation}, enregistrée ${quality.populationReconciliation.recordedPopulation}.`,
        "La population courante doit se réconcilier avec la population initiale moins la mortalité déclarée et les animaux transférés.",
        now
      )
    );
  }

  // T18 — data-quality aggregate for this lot (one summary issue, not one per record — the per-record detail already lives on the lot's own Data tab).
  checksRun += 1;
  if (quality.errorCount > 0) {
    issues.push(
      makeIssue(
        "T18_DATA_QUALITY",
        "CRITICAL",
        "LOT",
        lot.id,
        `Lot ${lot.code} : ${quality.errorCount} erreur(s) de qualité de données.`,
        "Un ou plusieurs enregistrements structurés violent une règle de qualité de base (valeur, date, unité, ou statut).",
        now
      )
    );
  } else if (quality.warningCount > 0) {
    issues.push(
      makeIssue(
        "T18_DATA_QUALITY",
        "WARNING",
        "LOT",
        lot.id,
        `Lot ${lot.code} : ${quality.warningCount} avertissement(s) de qualité de données.`,
        "Un ou plusieurs enregistrements structurés présentent une anomalie mineure (provenance, doublon probable).",
        now
      )
    );
  }

  return { issues, checksRun };
}

// ---------------------------------------------------------------------------
// T10 — mutation without audit (bounded proxy: every ALERT_ACTION lot_event must have a
// matching "alert" audit_log entry) / T27 — alert lifecycle audit completeness
// ---------------------------------------------------------------------------

async function checkAlertActionAudit(lots: LotWithContext[], auditedAlertIds: Set<string>, now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  let checksRun = 0;
  const perLotEvents = await Promise.all(lots.map((lot) => repositories.lotEvents.listByLot(lot.id)));
  for (const events of perLotEvents) {
    for (const event of events) {
      if (event.eventType !== "ALERT_ACTION") continue;
      checksRun += 1;
      const payload = event.payload as { alertId?: string } | null;
      const alertId = payload?.alertId;
      if (!alertId || !auditedAlertIds.has(alertId)) {
        issues.push(
          makeIssue(
            "T10_MUTATION_WITHOUT_AUDIT",
            "CRITICAL",
            "lot_event",
            event.id,
            "Une action sur alerte a été enregistrée dans l'historique du lot sans entrée d'audit correspondante.",
            "Chaque mutation importante doit laisser une trace dans le journal d'audit, pas seulement dans l'historique métier.",
            now
          )
        );
      }
    }
  }
  return { issues, checksRun };
}

async function checkAlertLifecycleAudit(alertsWithContext: AlertWithContext[], auditedAlertIds: Set<string>, now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  const terminal = alertsWithContext.filter((a) => a.alert.status === "RESOLVED" || a.alert.status === "DISMISSED");
  // One round-trip per alert, issued in parallel rather than sequentially — the scope-wide
  // sweep already fans out over every lot, so serial waits here compound.
  const actionsByAlert = await Promise.all(terminal.map(({ alert }) => repositories.actionRecords.listByAlert(alert.id)));
  for (const [index, { alert }] of terminal.entries()) {
    const actions = actionsByAlert[index];
    const hasAudit = auditedAlertIds.has(alert.id);
    if (actions.length === 0 || !hasAudit) {
      issues.push(
        makeIssue(
          "T27_ALERT_LIFECYCLE_AUDIT",
          "CRITICAL",
          "alert",
          alert.id,
          `Une alerte ${ALERT_STATUS_LABEL[alert.status]} n'a pas de preuve complète (action : ${actions.length > 0 ? "oui" : "non"}, audit : ${hasAudit ? "oui" : "non"}).`,
          "Toute clôture d'alerte doit laisser à la fois un enregistrement d'action et une entrée d'audit.",
          now
        )
      );
    }
  }
  return { issues, checksRun: terminal.length };
}

// ---------------------------------------------------------------------------
// T13 — invalid actor permission (every audit actor must resolve to a real, active user)
// ---------------------------------------------------------------------------

function checkAuditActors(auditEntries: AuditLogEntry[], userById: Map<string, User>, now: string): Accumulator {
  const issues: IntegrityIssue[] = [];
  const seen = new Set<string>();
  for (const entry of auditEntries) {
    if (!entry.actorId || seen.has(entry.actorId)) continue;
    seen.add(entry.actorId);
    const user = userById.get(entry.actorId);
    if (!user) {
      issues.push(
        makeIssue(
          "T13_INVALID_ACTOR",
          "CRITICAL",
          "user",
          entry.actorId,
          "Un acteur référencé dans le journal d'audit n'existe plus.",
          "Chaque action doit être imputable à un utilisateur réel du système.",
          now
        )
      );
    } else if (!user.active) {
      issues.push(
        makeIssue(
          "T13_INVALID_ACTOR",
          "WARNING",
          "user",
          entry.actorId,
          `${user.fullName} a des entrées d'audit alors que son compte est désactivé.`,
          "Un compte désactivé ne devrait plus produire de nouvelles actions — vérifier la date des entrées concernées.",
          now
        )
      );
    }
  }
  return { issues, checksRun: seen.size };
}

// ---------------------------------------------------------------------------
// T19 — every OPEN anomaly should have a matching alert (the 1:1 design from phase 6)
// ---------------------------------------------------------------------------

async function checkAnomalyHasAlert(session: Session, now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  const anomalies = (await listAnomaliesInScope(session)).filter((a) => a.status === "OPEN");
  // Batched lookup instead of one sequential query per anomaly.
  const alerts = await repositories.alerts.listByAnomalyIds(anomalies.map((a) => a.id));
  const alertByAnomalyId = new Set(alerts.map((a) => a.anomalyId));
  for (const anomaly of anomalies) {
    if (!alertByAnomalyId.has(anomaly.id)) {
      issues.push(
        makeIssue(
          "T19_ANOMALY_WITHOUT_ALERT",
          "CRITICAL",
          "anomaly",
          anomaly.id,
          "Une anomalie ouverte n'a pas d'alerte associée.",
          "Le moteur de détection doit toujours créer une alerte en même temps qu'une anomalie.",
          now
        )
      );
    }
  }
  return { issues, checksRun: anomalies.length };
}

// ---------------------------------------------------------------------------
// T21 — device health, scope-wide (reuses domain/quality/iot-data-quality.ts)
// ---------------------------------------------------------------------------

async function checkDeviceHealth(session: Session, now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  const devices = await listDevicesInScope(session);
  const onlineBuildingIds = [...new Set(devices.filter((d) => d.status === "ONLINE").map((d) => d.buildingId))];
  const latestArr = await Promise.all(onlineBuildingIds.map((id) => repositories.measurements.latestByBuilding(id)));
  const latestByBuilding = new Map(onlineBuildingIds.map((id, i) => [id, latestArr[i]]));
  const nowDate = new Date(now);

  for (const device of devices) {
    const statusIssue = checkDeviceOnline(device.status);
    if (statusIssue) {
      issues.push(
        makeIssue(
          "T21_DEVICE_STALE_OFFLINE",
          statusIssue.severity === "error" ? "CRITICAL" : "WARNING",
          "device",
          device.id,
          `Appareil ${device.code} : ${statusIssue.message}`,
          "Un appareil en défaut ou hors ligne peut produire des mesures manquantes ou obsolètes en aval.",
          now
        )
      );
      continue;
    }
    const readings = latestByBuilding.get(device.buildingId) ?? [];
    const stale = readings.some((m) => m.deviceId === device.id && checkStaleReading(m.capturedAt, nowDate) !== null);
    if (stale) {
      issues.push(
        makeIssue(
          "T21_DEVICE_STALE_OFFLINE",
          "WARNING",
          "device",
          device.id,
          `Appareil ${device.code} : dernière lecture obsolète malgré un statut "en ligne".`,
          "Un appareil déclaré en ligne sans lecture récente indique une panne silencieuse.",
          now
        )
      );
    }
  }
  return { issues, checksRun: devices.length };
}

// ---------------------------------------------------------------------------
// T24 — duplicate business code (only where duplicates are genuinely invalid: lot codes are
// meant to be globally unique — service-enforced, not a DB constraint; building codes are
// meant to be unique only within their own farm, by design — see data/seed/generators/hierarchy.ts)
// ---------------------------------------------------------------------------

function checkDuplicateCodes(lots: Lot[], buildings: Building[], now: string): Accumulator {
  const issues: IntegrityIssue[] = [];

  const byLotCode = new Map<string, Lot[]>();
  for (const lot of lots) byLotCode.set(lot.code, [...(byLotCode.get(lot.code) ?? []), lot]);
  for (const group of byLotCode.values()) {
    if (group.length <= 1) continue;
    for (const lot of group) {
      issues.push(
        makeIssue(
          "T24_DUPLICATE_CODE",
          "CRITICAL",
          "LOT",
          lot.id,
          `Le numéro de lot "${lot.code}" est utilisé par ${group.length} lots.`,
          "Un identifiant métier de lot doit être unique sur toute la plateforme.",
          now
        )
      );
    }
  }

  const byBuildingKey = new Map<string, Building[]>();
  for (const building of buildings) {
    const keyValue = `${building.farmId}:${building.code}`;
    byBuildingKey.set(keyValue, [...(byBuildingKey.get(keyValue) ?? []), building]);
  }
  for (const group of byBuildingKey.values()) {
    if (group.length <= 1) continue;
    for (const building of group) {
      issues.push(
        makeIssue(
          "T24_DUPLICATE_CODE",
          "WARNING",
          "BUILDING",
          building.id,
          `Le code "${building.code}" est utilisé par ${group.length} bâtiments d'une même ferme.`,
          "Un code de bâtiment doit être unique au sein de sa ferme.",
          now
        )
      );
    }
  }

  return { issues, checksRun: byLotCode.size + byBuildingKey.size };
}

// ---------------------------------------------------------------------------
// T25 / T26 — user scope/role structural validity (global-scope viewers only, see note below)
// ---------------------------------------------------------------------------

const EXPECTED_SCOPE_TYPE: Partial<Record<Role, ScopeType>> = {
  SUPER_ADMIN: "GLOBAL",
  COOP_MANAGER: "COOPERATIVE",
  PRODUCER: "PRODUCER",
  FARM_MANAGER: "FARM",
  TECHNICIAN: "FARM",
  QUALITY_MANAGER: "GLOBAL",
  DIRECTION: "GLOBAL",
  HATCHERY_MANAGER: "FARM",
  VETERINARIAN: "GLOBAL",
};

async function checkUserScopeValidity(users: User[], now: string): Promise<Accumulator> {
  const issues: IntegrityIssue[] = [];
  for (const user of users) {
    try {
      await assertScopeTargetExists(user.scopeType, user.scopeId);
    } catch {
      issues.push(
        makeIssue(
          "T25_USER_SCOPE_INVALID",
          "CRITICAL",
          "user",
          user.id,
          `${user.fullName} a un périmètre invalide (${user.scopeType} / ${user.scopeId ?? "aucun identifiant"}).`,
          "Le périmètre référencé par ce compte n'existe pas ou est incohérent avec son type.",
          now
        )
      );
    }
  }
  return { issues, checksRun: users.length };
}

function checkUserRoleScopeStructure(users: User[], now: string): Accumulator {
  const issues: IntegrityIssue[] = [];
  for (const user of users) {
    const expected = EXPECTED_SCOPE_TYPE[user.role];
    if (expected && user.scopeType !== expected) {
      issues.push(
        makeIssue(
          "T26_USER_ROLE_SCOPE_STRUCTURE",
          user.role === "SUPER_ADMIN" ? "CRITICAL" : "WARNING",
          "user",
          user.id,
          `${user.fullName} (${ROLE_LABEL[user.role]}) a un périmètre de type "${user.scopeType}", attendu "${expected}".`,
          "Un type de périmètre inattendu pour ce rôle indique un risque d'accès trop large ou trop restreint.",
          now
        )
      );
    }
  }
  return { issues, checksRun: users.length };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function mergeInto(target: Accumulator, ...parts: Accumulator[]): void {
  for (const part of parts) {
    target.issues.push(...part.issues);
    target.checksRun += part.checksRun;
  }
}

/**
 * Runs every P0 integrity check in scope and rolls the result into one report (phase-8 brief
 * §10-§11). Every issue is derived fresh from live database state — nothing here is a stored,
 * mutable row, so the result always reflects reality at the moment it's computed.
 */
export async function runIntegrityChecks(session: Session): Promise<IntegrityReport> {
  if (!can(session, "VIEW", "INTEGRITY")) {
    throw new AuthorizationError("Vous n'avez pas les droits pour consulter le centre d'intégrité.");
  }
  const now = new Date().toISOString();
  const acc: Accumulator = { issues: [], checksRun: 0 };

  const [lots, buildings, farms, alertsWithContext, auditEntries] = await Promise.all([
    listLotsWithContext(session),
    listBuildingsInScope(session),
    listFarmsInScope(session),
    listAlertsInScope(session),
    repositories.auditLog.list(2000),
  ]);
  const buildingIds = new Set(buildings.map((b) => b.id));
  const farmIds = new Set(farms.map((f) => f.id));
  const auditedAlertIds = new Set(auditEntries.filter((e) => e.entityType === "alert").map((e) => e.entityId));

  mergeInto(acc, checkOrphanLots(lots, buildingIds, now), checkOrphanBuildings(buildings, farmIds, now));

  const perLot = await Promise.all(lots.map((lot) => checkLotAndChain(lot, session, now)));
  mergeInto(acc, ...perLot);

  const [alertActionAudit, alertLifecycleAudit, anomalyAlert, deviceHealth] = await Promise.all([
    checkAlertActionAudit(lots, auditedAlertIds, now),
    checkAlertLifecycleAudit(alertsWithContext, auditedAlertIds, now),
    checkAnomalyHasAlert(session, now),
    checkDeviceHealth(session, now),
  ]);
  mergeInto(acc, alertActionAudit, alertLifecycleAudit, anomalyAlert, deviceHealth);

  mergeInto(acc, checkDuplicateCodes(lots, buildings, now));

  // User/audit-actor checks read globally (users have no per-scope table of their own) — restricted
  // to global-scope viewers, since today INTEGRITY is only ever granted to GLOBAL-scoped roles anyway.
  if (isGlobalScope(session)) {
    const users = await repositories.users.list();
    const userById = new Map(users.map((u) => [u.id, u]));
    const userScopeValidity = await checkUserScopeValidity(users, now);
    mergeInto(acc, checkAuditActors(auditEntries, userById, now), userScopeValidity, checkUserRoleScopeStructure(users, now));
  }

  const ackEntries = await repositories.auditLog.search({ entityType: "integrity_issue" }, 2000);
  const ackedKeys = new Set(ackEntries.map((e) => e.entityId));
  for (const issue of acc.issues) {
    if (ackedKeys.has(integrityIssueKey(issue))) issue.status = "ACKNOWLEDGED";
  }

  const criticalCount = acc.issues.filter((i) => i.severity === "CRITICAL").length;
  const warningCount = acc.issues.filter((i) => i.severity === "WARNING").length;
  const checksFailed = acc.issues.length;
  const checksPassed = Math.max(acc.checksRun - checksFailed, 0);
  const statusPercent = acc.checksRun === 0 ? 100 : Math.round((checksPassed / acc.checksRun) * 100);

  return {
    issues: acc.issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1)),
    checksRun: acc.checksRun,
    checksPassed,
    criticalCount,
    warningCount,
    statusPercent,
    generatedAt: now,
  };
}
